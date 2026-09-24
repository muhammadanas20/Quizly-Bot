/**
 * src/message.js — pure helpers for reading a Baileys WAMessage.
 *
 * No socket, no I/O: every function here takes a plain object and returns a
 * plain value, which is what makes the guard and the quiz trigger testable.
 */

import { normalizeId } from './config.js';

/** Message types WhatsApp wraps in an envelope before the real payload. */
const WRAPPERS = [
    'ephemeralMessage',
    'viewOnceMessage',
    'viewOnceMessageV2',
    'viewOnceMessageV2Extension',
    'documentWithCaptionMessage',
    'editedMessage'
];

/** The three envelopes WhatsApp uses for "one time" (view-once) media. */
const VIEW_ONCE_WRAPPERS = ['viewOnceMessage', 'viewOnceMessageV2', 'viewOnceMessageV2Extension'];

/** Media nodes that can carry the flat `viewOnce: true` flag. */
const MEDIA_NODES = ['imageMessage', 'videoMessage', 'audioMessage', 'documentMessage'];

/** Peel envelopes so `imageMessage` etc. can be found wherever WhatsApp hides it. */
export function unwrap(message) {
    let cur = message;
    for (let depth = 0; cur && depth < 6; depth++) {
        const key = WRAPPERS.find((w) => cur[w]);
        if (!key) return cur;
        cur = cur[key]?.message ?? cur[key];
    }
    return cur || {};
}

/** Human-readable text of a message (body or caption), or '' if it has none. */
export function extractText(message) {
    const m = unwrap(message);
    return (
        m.conversation ||
        m.extendedTextMessage?.text ||
        m.imageMessage?.caption ||
        m.videoMessage?.caption ||
        m.documentMessage?.caption ||
        m.buttonsResponseMessage?.selectedDisplayText ||
        m.listResponseMessage?.title ||
        ''
    );
}

/**
 * Is this a view-once ("one time") message?
 *
 * Three different shapes have to count, because which one you get depends on
 * how this bot is paired:
 *
 *   1. `key.isViewOnce` — set by Baileys when WhatsApp refuses to hand the
 *      media to this linked device. The stanza then carries
 *      `<unavailable type="view_once"/>` instead of ciphertext, so the message
 *      arrives with **no `message` payload at all**, only this flag on the key.
 *      This is the normal case for a web-class companion (`Browsers.macOS(...)`,
 *      the default here) and it is exactly why "the one-time photo of a flagged
 *      member stayed in the group": there was nothing to classify.
 *   2. a `viewOnceMessage` / `V2` / `V2Extension` wrapper — media included,
 *      which is what a phone-class companion receives.
 *   3. the flat `viewOnce: true` flag on the media node itself.
 *
 * @param {object} [message] `msg.message` — may be undefined for case 1
 * @param {object} [key]     `msg.key` — carries `isViewOnce` for case 1
 */
export function isViewOnce(message, key) {
    if (key?.isViewOnce) return true;

    let cur = message;
    for (let depth = 0; cur && depth < 6; depth++) {
        if (VIEW_ONCE_WRAPPERS.some((w) => cur[w])) return true;
        if (cur.viewOnce === true) return true;
        for (const node of MEDIA_NODES) {
            if (cur[node]?.viewOnce) return true;
        }
        // step down through any other envelope (disappearing messages wrap
        // view-once media one level deeper) and look again
        const envelope = WRAPPERS.find((w) => cur[w]);
        if (!envelope) break;
        cur = cur[envelope]?.message ?? cur[envelope];
    }
    return false;
}

/**
 * Coarse media kind of a message. View-once/ephemeral wrappers are peeled by
 * unwrap(), so a one-time photo that arrives *with* its media is classified as
 * an ordinary 'image' and is covered by the guard's image policy.
 *
 * A one-time message whose media WhatsApp withheld (web-class companion) is
 * classified as `'viewonce'`: we know it is hidden media, just not which kind.
 * @returns {'sticker'|'image'|'video'|'gif'|'audio'|'document'|'link'|'text'|
 *          'location'|'contact'|'poll'|'reaction'|'system'|'viewonce'|'unknown'}
 */
export function classifyKind(message, key) {
    const viewOnce = isViewOnce(message, key);
    const m = message ? unwrap(message) : null;

    if (m?.stickerMessage)   return 'sticker';
    if (m?.imageMessage)     return 'image';
    if (m?.videoMessage)     return m.videoMessage.gifPlayback ? 'gif' : 'video';
    if (m?.audioMessage)     return 'audio';
    if (m?.documentMessage)  return 'document';
    if (m?.locationMessage)  return 'location';
    if (m?.contactMessage || m?.contactsArrayMessage) return 'contact';
    if (m?.pollCreationMessage || m?.pollCreationMessageV2 || m?.pollCreationMessageV3) return 'poll';
    if (m?.reactionMessage)  return 'reaction';
    if (m?.protocolMessage || m?.senderKeyDistributionMessage) return 'system';

    // Nothing visible, but WhatsApp told us it was a one-time message: that is
    // a media message we were not allowed to see, never an empty message.
    if (viewOnce) return 'viewonce';

    const text = extractText(message);
    if (text) return /https?:\/\/\S+/i.test(text) ? 'link' : 'text';
    return 'unknown';
}

/** True when the message carries something the AI can actually look at. */
export function isVisual(message) {
    const kind = classifyKind(message);
    return kind === 'image' || kind === 'document';
}

/**
 * Does the text ask for a quiz? Matches the trigger as a whole word so that
 * "quiz", "QUIZ", "quiz!" and "pls quiz" fire, but "quizzical" does not.
 */
export function containsTrigger(text, trigger) {
    const t = String(text || '').toLowerCase();
    const k = String(trigger || 'quiz').toLowerCase();
    if (!t || !k) return false;
    const escaped = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}([^\\p{L}\\p{N}]|$)`, 'u').test(t);
}

/**
 * If this message quotes another one, return enough to download that media.
 * Lets people reply "quiz" to a screenshot they sent earlier.
 */
export function getQuoted(message) {
    const m = unwrap(message);
    const ctx = m.extendedTextMessage?.contextInfo;
    if (!ctx?.quotedMessage) return null;
    return {
        id         : ctx.stanzaId,
        participant: ctx.participant,
        message    : ctx.quotedMessage
    };
}

/** Group sender: participant for groups, remoteJid for 1-on-1 chats. */
export function senderOf(msg) {
    return msg?.key?.participant || msg?.key?.remoteJid || '';
}

/** Strip the ":device" suffix Baileys adds to multi-device JIDs. */
export function bareJid(jid) {
    const s = String(jid || '');
    const at = s.lastIndexOf('@');
    if (at < 0) return s.split(':')[0];
    return `${s.slice(0, at).split(':')[0]}@${s.slice(at + 1)}`;
}

/**
 * Every identity one JID can be known by.
 *
 * Baileys 7 addresses the same human by phone-number JID or by LID, and which
 * one you get depends on the group: a mention in `contextInfo.mentionedJid` is
 * usually a LID, while `key.participant` is usually the phone number. A flag
 * stored under one and looked up under the other silently misses — which is
 * how "!flag worked but the blocked media stayed" and "!unflag says not flagged"
 * happen. The socket's lid-mapping store translates when it can; `sock` is
 * optional so this stays pure in tests.
 *
 * @returns {string[]} normalised identities, at least the input's own
 */
export function identitiesOf(jid, sock) {
    const out = new Set();
    const push = (v) => { const n = normalizeId(v); if (n) out.add(n); };
    const raw = String(jid || '');

    push(raw);
    try {
        const mapping = sock?.signalRepository?.lidMapping;
        if (mapping) {
            if (raw.endsWith('@lid')) {
                push(mapping.getPNForLID?.(raw));
            } else {
                // the mapping wants a full JID, but `!flag 923001234567` hands
                // us bare digits — build the phone-number JID it expects
                const pnJid = raw.includes('@') ? raw : `${normalizeId(raw)}@s.whatsapp.net`;
                push(mapping.getLIDForPN?.(pnJid));
            }
        }
    } catch { /* the mapping store is optional — never let it break a command */ }

    return [...out];
}

/** "1234-567890@g.us" → true */
export function isGroupJid(jid) {
    return String(jid || '').endsWith('@g.us');
}
