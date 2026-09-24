/**
 * src/guard.js — silent media removal for flagged members.
 *
 * By default, a flagged member's stickers and photos (including view-once
 * photos) are revoked in groups where the bot is an admin. The bot says
 * NOTHING: no warning, reply, or replacement media. The only trace is one
 * debug line in the server console plus a counter you can read with !stats.
 *
 * One-time ("view once") media is the awkward case: WhatsApp only ships it to
 * phone-class linked devices, so a web-class companion receives the message
 * with the media withheld and no message body at all — just `key.isViewOnce`.
 * The revoke needs only the key, so those are removed too, blind.
 *
 * The decision is a pure function (decide) so it can be unit-tested without a
 * live WhatsApp socket.
 */

import { classifyKind, identitiesOf } from './message.js';
import { DEFAULT_GUARD_MEDIA } from './config.js';

const NOTHING_TO_DELETE = new Set(['system', 'reaction', 'unknown']);

/**
 * What a one-time message could be hiding. WhatsApp only allows view-once for
 * photos, videos and voice notes, so a rule that blocks any of those also
 * covers a `'viewonce'` message whose media WhatsApp never showed us — we
 * cannot tell which of them it was, and a flagged member's hidden media is
 * precisely what the guard exists to remove.
 */
const VIEW_ONCE_COVERS = ['image', 'video', 'gif', 'audio'];

/** Does this rule cover a one-time message whose media we were not shown? */
export function ruleCoversViewOnce(rule = []) {
    return rule.includes('all') || rule.includes('viewonce') || rule.some((k) => VIEW_ONCE_COVERS.includes(k));
}

/**
 * Pure decision. `botIsAdmin` may be true | false | 'unknown'.
 * 'unknown' still attempts the delete, so the first blocked media in a group
 * is not missed while the group-metadata cache is warming up.
 */
export function decide({
    kind,
    senderIds,
    guardEnabled,
    isGroup,
    fromMe,
    whitelist = new Set(),
    blocked = DEFAULT_GUARD_MEDIA,
    flags,
    botIsAdmin
}) {
    if (!isGroup)                    return { act: 'skip', reason: 'not-a-group' };
    if (fromMe)                      return { act: 'skip', reason: 'own-message' };
    if (!guardEnabled)               return { act: 'skip', reason: 'guard-off' };
    if (NOTHING_TO_DELETE.has(kind)) return { act: 'skip', reason: `nothing-to-delete:${kind}` };

    for (const id of senderIds || []) {
        if (whitelist.has(id)) return { act: 'skip', reason: 'whitelisted' };
    }

    const hit = flags?.find?.(senderIds);
    if (!hit) return { act: 'skip', reason: 'not-flagged' };

    const rule = (hit.entry?.media?.length ? hit.entry.media : blocked) || [];
    if (kind === 'viewonce') {
        // One-time media WhatsApp withheld: the kind is unknowable, so any
        // media rule at all covers it. GUARD_MEDIA=sticker on its own is an
        // explicit "stickers only" policy and still leaves it alone.
        if (!ruleCoversViewOnce(rule)) return { act: 'skip', reason: 'kind-allowed:viewonce' };
    } else if (!rule.includes('all') && !rule.includes(kind)) {
        return { act: 'skip', reason: `kind-allowed:${kind}` };
    }

    if (botIsAdmin === false) return { act: 'skip', reason: 'bot-not-admin' };

    return { act: 'delete', reason: `flagged:${kind}`, entry: hit.entry };
}

/**
 * Every identity this sender might be known by. Baileys 7 addresses the same
 * human by phone-number JID or by LID; `participantAlt` carries the other one
 * and the lid-mapping store can fill in the rest.
 */
export function collectSenderIds(msg, sock) {
    const out = new Set();
    for (const jid of [msg?.key?.participant, msg?.key?.participantAlt]) {
        for (const id of identitiesOf(jid, sock)) out.add(id);
    }
    // In a 1-on-1 chat the sender is the chat itself.
    if (!msg?.key?.participant) {
        for (const id of identitiesOf(msg?.key?.remoteJid, sock)) out.add(id);
    }
    return out;
}

/** Live guard bound to a socket. */
export function createGuard({ sock, flags, config, log, isAdmin }) {
    const stats = { deleted: 0, viewOnce: 0, skippedNotAdmin: 0, byUser: new Map(), lastAt: null };
    const whitelist = new Set(config.guardWhitelist);

    async function handle(msg) {
        if (!msg?.key) return null;

        // Cheapest possible pre-check: for the ~99% of messages sent by people
        // who are not flagged this costs one Set lookup and nothing else.
        const senderIds = collectSenderIds(msg, sock);
        if (!flags.has(senderIds)) return null;

        const jid     = msg.key.remoteJid;
        const sender  = msg.key.participant || jid;
        // `msg.key` matters: a one-time message a web-class companion is not
        // allowed to see arrives with NO message body, only `key.isViewOnce`.
        const kind    = classifyKind(msg.message, msg.key);
        const admin   = await Promise.resolve(isAdmin(jid));

        const verdict = decide({
            kind,
            senderIds,
            guardEnabled : config.guardEnabled,
            isGroup      : String(jid).endsWith('@g.us'),
            fromMe       : Boolean(msg.key.fromMe),
            whitelist,
            blocked      : config.guardMedia,
            flags,
            botIsAdmin   : admin
        });

        if (verdict.act !== 'delete') {
            if (verdict.reason === 'bot-not-admin') stats.skippedNotAdmin++;
            return verdict;
        }

        const started = Date.now();
        await sock.sendMessage(jid, { delete: msg.key });

        // Learn every identity this person has just shown us. A flag set from
        // an @mention is keyed by LID; the same person's next message may only
        // carry the phone number. Storing both means a later !unflag by either
        // form finds the flag instead of reporting "not flagged".
        for (const id of senderIds) {
            if (verdict.entry && !verdict.entry.keys.includes(id)) flags.alias?.(senderIds, id);
        }

        const label = verdict.entry?.label || sender;
        const total = flags.bumpDeleted(senderIds);
        stats.deleted++;
        if (kind === 'viewonce') stats.viewOnce++;
        stats.lastAt = new Date().toISOString();
        stats.byUser.set(label, (stats.byUser.get(label) || 0) + 1);

        // A revoked one-time message is revoked blind: WhatsApp keeps the media
        // from web-class linked devices, so all we ever get is `key.isViewOnce`.
        // The revoke only needs the key, so the removal still works.
        const blind = kind === 'viewonce' ? ' — one-time media, withheld by WhatsApp' : '';
        log.debug(`guard: removed ${kind} from ${label} in ${jid} (${Date.now() - started}ms, ${total} total)${blind}`);
        return verdict;
    }

    return { handle, stats };
}

export default createGuard;
