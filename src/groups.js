/**
 * src/groups.js — cached group metadata.
 *
 * The media guard has to know "am I an admin here?" for every single message
 * it inspects. Asking WhatsApp each time would add a round trip to the hot path,
 * so the answer is cached per group and invalidated when membership changes.
 *
 * isAdmin() resolves to true | false | 'unknown'. 'unknown' means "we could not
 * find out" and the guard treats it as go-ahead, so a cold cache never lets a
 * blocked media slip through.
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
            const names = new Map();
            let iAmAdmin = false;
            const me = myIds();

            for (const p of meta?.participants || []) {
                const ids = normaliseParticipant(p);
                const name = p?.notify || p?.verifiedName || p?.name || p?.pushName || '';
                if (name) for (const id of ids) names.set(id, name);

                const role = p?.admin || p?.adminPn;
                if (role !== 'admin' && role !== 'superadmin') continue;
                for (const id of ids) admins.add(id);
                for (const id of ids) if (me.has(id)) iAmAdmin = true;
            }

            // Older payloads sometimes flag the owner separately.
            for (const raw of [meta?.owner, meta?.ownerPn]) {
                const n = normalizeId(raw);
                if (n) admins.add(n);
            }
            for (const id of me) if (admins.has(id)) iAmAdmin = true;

            const entry = { at: Date.now(), admins, names, subject: meta?.subject || '', iAmAdmin };
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

    /**
     * Display name for one participant, from the cached metadata. Used to label
     * a flag with "Muhammad Anas" instead of the raw LID the mention carries.
     * Returns '' when the cache is cold or the name is unknown.
     */
    async function nameOf(jid, id) {
        const key = normalizeId(id);
        if (!key) return '';
        const entry = await get(jid);
        return entry?.names?.get(key) || '';
    }

    function invalidate(jid) {
        cache.delete(jid);
    }

    return { get, refresh, isAdmin, subjectOf, nameOf, invalidate, get size() { return cache.size; } };
}

export default createGroupCache;
