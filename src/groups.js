/**
 * src/groups.js — cached group metadata.
 *
 * The sticker guard has to know "am I an admin here?" for every single message
 * it inspects. Asking WhatsApp each time would add a round trip to the hot path,
 * so the answer is cached per group and invalidated when membership changes.
 *
 * isAdmin() resolves to true | false | 'unknown'. 'unknown' means "we could not
 * find out" and the guard treats it as go-ahead, so a cold cache never lets a
 * sticker slip through.
 */

import { normalizeId } from './config.js';

export function createGroupCache({ sock, getMe, log, ttlMs = 10 * 60 * 1000 }) {
    const cache = new Map();   // jid → { at, admins:Set<string>, subject }

    /** Identities the bot itself may be addressed by inside a participant list. */
    function myIds() {
        const out = new Set();
        const me = normalizeId(getMe?.());
        if (me) out.add(me);
        return out;
    }

    function normaliseParticipant(p) {
        const ids = new Set();
        for (const raw of [p?.id, p?.lid, p?.phoneNumber, p?.participant]) {
            const n = normalizeId(raw);
            if (n) ids.add(n);
        }
        return ids;
    }

    async function refresh(jid) {
        try {
            const meta = await sock.groupMetadata(jid);
            const admins = new Set();
            let iAmAdmin = false;
            const me = myIds();

            for (const p of meta?.participants || []) {
                const role = p?.admin || p?.adminPn;
                if (role !== 'admin' && role !== 'superadmin') continue;
                const ids = normaliseParticipant(p);
                for (const id of ids) admins.add(id);
                for (const id of ids) if (me.has(id)) iAmAdmin = true;
            }

            // Older payloads sometimes flag the owner separately.
            for (const raw of [meta?.owner, meta?.ownerPn]) {
                const n = normalizeId(raw);
                if (n) admins.add(n);
            }
            for (const id of me) if (admins.has(id)) iAmAdmin = true;

            const entry = { at: Date.now(), admins, subject: meta?.subject || '', iAmAdmin };
            cache.set(jid, entry);
            return entry;
        } catch (err) {
            log?.debug?.(`groups: metadata failed for ${jid}: ${err.message}`);
            return null;
        }
    }

    async function get(jid) {
        const hit = cache.get(jid);
        if (hit && Date.now() - hit.at < ttlMs) return hit;
        return (await refresh(jid)) || hit || null;
    }

    async function isAdmin(jid) {
        const entry = await get(jid);
        if (!entry) return 'unknown';
        return entry.iAmAdmin === true;
    }

    /** Cheap synchronous read used for logging only. */
    function subjectOf(jid) {
        return cache.get(jid)?.subject || '';
    }

    function invalidate(jid) {
        cache.delete(jid);
    }

    return { get, refresh, isAdmin, subjectOf, invalidate, get size() { return cache.size; } };
}

export default createGroupCache;
