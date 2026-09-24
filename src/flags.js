/**
 * src/flags.js — the "flagged members" store.
 *
 * A flagged member is someone whose media gets silently removed by the guard.
 * The list is seeded from FLAGGED_USERS in .env (your code) and can be edited
 * live with !flag / !unflag from WhatsApp.
 *
 * Each entry can hold several identities for the same human (phone-number JID
 * and/or LID JID) because Baileys 7 may address the same person either way.
 *
 * Writes are debounced: on a 1 GiB VM we do not want a disk write per removal.
 */

import fs from 'node:fs';
import path from 'node:path';

const VERSION = 1;
const SAVE_DELAY_MS = 1500;

export function createFlagStore({ file, log } = {}) {
    let data = { version: VERSION, entries: {} };
    let saveTimer = null;

    // ── persistence ──────────────────────────────────────────────────────────
    /** Reads the file (if any) and returns the store itself, for chaining. */
    function load() {
        if (!file) return api;
        try {
            if (fs.existsSync(file)) {
                const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
                if (parsed && typeof parsed === 'object' && parsed.entries) {
                    data = { version: VERSION, entries: parsed.entries };
                }
            }
        } catch (err) {
            log?.warn?.(`flag store: could not read ${file} (${err.message}) — starting fresh`);
        }
        return api;
    }

    function flush() {
        if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
        if (!file) return;
        try {
            fs.mkdirSync(path.dirname(file), { recursive: true });
            fs.writeFileSync(file, JSON.stringify(data, null, 2));
        } catch (err) {
            log?.error?.(`flag store: could not write ${file}: ${err.message}`);
        }
    }

    function save() {
        if (saveTimer) return;
        saveTimer = setTimeout(() => { saveTimer = null; flush(); }, SAVE_DELAY_MS);
        // never keep the event loop alive just for a pending write
        saveTimer.unref?.();
    }

    // ── queries ──────────────────────────────────────────────────────────────
    const entries = () => Object.values(data.entries);

    /** @param {Iterable<string>} ids normalised sender identities */
    function find(ids) {
        for (const id of ids || []) {
            const hit = data.entries[id];
            if (hit) return { key: id, entry: hit };
        }
        return null;
    }

    const has = (ids) => Boolean(find(ids));

    // ── mutations ────────────────────────────────────────────────────────────
    /**
     * @param {Iterable<string>} ids    normalised identities for one person
     * @param {object} meta             { label, reason, media, addedBy }
     */
    function add(ids, meta = {}) {
        const keys = [...new Set([...(ids || [])].filter(Boolean))];
        if (keys.length === 0) return { ok: false, error: 'no valid id supplied' };

        const existing = find(keys);
        const entry = existing?.entry || {
            keys   : [],
            label  : '',
            reason : '',
            media  : null,          // null = inherit the global GUARD_MEDIA
            addedBy: '',
            addedAt: new Date().toISOString(),
            deleted    : 0,
            lastDeleted: null
        };

        entry.keys   = [...new Set([...entry.keys, ...keys])];
        entry.label  = meta.label  ?? entry.label  ?? '';
        entry.reason = meta.reason ?? entry.reason ?? '';
        entry.addedBy = meta.addedBy ?? entry.addedBy ?? '';
        if (Array.isArray(meta.media) && meta.media.length) entry.media = meta.media;
        entry.updatedAt = new Date().toISOString();

        // re-key so every identity of this person resolves to the same object
        for (const k of keys) delete data.entries[k];
        for (const k of entry.keys) data.entries[k] = entry;

        save();
        return { ok: true, entry, isNew: !existing };
    }

    function remove(ids) {
        const hit = find(ids);
        if (!hit) return { ok: false, error: 'not flagged' };
        for (const k of hit.entry.keys) delete data.entries[k];
        save();
        return { ok: true, entry: hit.entry };
    }

    function bumpDeleted(ids) {
        const hit = find(ids);
        if (!hit) return 0;
        hit.entry.deleted = (hit.entry.deleted || 0) + 1;
        hit.entry.lastDeleted = new Date().toISOString();
        save();
        return hit.entry.deleted;
    }

    /** Attach an extra identity (e.g. a LID we just learned) to a known person. */
    function alias(existingIds, newId) {
        if (!newId) return false;
        const hit = find(existingIds);
        if (!hit || hit.entry.keys.includes(newId)) return false;
        hit.entry.keys.push(newId);
        data.entries[newId] = hit.entry;
        save();
        return true;
    }

    const api = {
        load,
        flush,
        entries,
        find,
        has,
        add,
        remove,
        bumpDeleted,
        alias,
        get count() {
            const seen = new Set();
            for (const e of entries()) seen.add(e);
            return seen.size;
        }
    };

    return api;
}

export default createFlagStore;
