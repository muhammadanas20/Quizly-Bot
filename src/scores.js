/**
 * src/scores.js — the game scoreboard, persisted to disk.
 *
 * Data lives in `data/scores.json` next to the flag store and holds two things:
 *
 *   chats[jid].players[key]   one row per member per group
 *                             { name, points, wins, played, streak, best, lastWin }
 *   chats[jid].aliases[id]    every identity that person is known by → player key
 *                             (Baileys 7 gives the same human a phone-number JID
 *                             and/or a LID — the same trap !flag had to solve)
 *   questions[]               trivia questions contributed by members
 *   settings.gamesEnabled     owner switch; survives a restart independently of GAMES
 *
 * Generated daily content lives separately in game-content.json, so resetting
 * leaderboards can never delete member questions or the current AI pool.
 * Writes for points are debounced; owner switches and resets flush immediately.
 */

import fs from 'node:fs';
import path from 'node:path';

const VERSION = 2;
const SAVE_DELAY_MS = 1500;
const MAX_QUESTIONS = 500;
const QUESTION_MAX_LEN = 200;
const ANSWER_MAX_LEN = 60;

/**
 * The key a person's score is stored under.
 *
 * A phone-number identity ("923001234567") is preferred over a LID
 * ("219537588899977@lid") because it survives WhatsApp handing us only one of
 * the two: any identity we later see is aliased back to this key.
 */
export function canonicalKey(ids) {
    const list = [...(ids || [])].filter(Boolean).map(String);
    if (!list.length) return '';
    const phone = list.find((id) => !id.includes('@'));
    if (phone) return phone;
    return [...list].sort()[0];
}

const clean = (s, max) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

export function createScoreStore({ file, log, maxQuestions = MAX_QUESTIONS } = {}) {
    let data = { version: VERSION, chats: {}, questions: [], settings: {} };
    let saveTimer = null;

    // ── persistence ──────────────────────────────────────────────────────────
    function load() {
        if (!file) return api;
        try {
            if (fs.existsSync(file)) {
                const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
                if (parsed && typeof parsed === 'object') {
                    data = {
                        version  : VERSION,
                        chats    : parsed.chats && typeof parsed.chats === 'object' ? parsed.chats : {},
                        questions: Array.isArray(parsed.questions) ? parsed.questions : [],
                        settings : typeof parsed.settings?.gamesEnabled === 'boolean'
                            ? { gamesEnabled: parsed.settings.gamesEnabled }
                            : {}
                    };
                }
            }
        } catch (err) {
            log?.warn?.(`score store: could not read ${file} (${err.message}) — starting fresh`);
        }
        return api;
    }

    function flush() {
        if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
        if (!file) return true;
        const temporary = `${file}.tmp`;
        try {
            fs.mkdirSync(path.dirname(file), { recursive: true });
            fs.writeFileSync(temporary, JSON.stringify(data));
            fs.renameSync(temporary, file); // never leave a half-written scoreboard
            return true;
        } catch (err) {
            log?.error?.(`score store: could not write ${file}: ${err.message}`);
            try { fs.unlinkSync(temporary); } catch { /* no temporary file */ }
            return false;
        }
    }

    function save() {
        if (saveTimer) return;
        saveTimer = setTimeout(() => { saveTimer = null; flush(); }, SAVE_DELAY_MS);
        saveTimer.unref?.();       // a pending write must not keep Node alive
    }

    /** A persisted owner override wins over the initial GAMES setting. */
    const gamesEnabled = (fallback = true) => data.settings.gamesEnabled ?? fallback;

    function setGamesEnabled(enabled) {
        data.settings.gamesEnabled = Boolean(enabled);
        return flush();           // a control command must survive an immediate restart
    }

    /** Clear ALL chats, their scores/streaks and their identity aliases only. */
    function resetBoards() {
        const players = Object.values(data.chats).reduce((n, c) => n + Object.keys(c.players || {}).length, 0);
        data.chats = {};
        return { players, saved: flush() }; // questions and owner settings stay put
    }

    // ── chats / players ──────────────────────────────────────────────────────
    function chatOf(jid, create = false) {
        const key = String(jid || '');
        if (!key) return null;
        let entry = data.chats[key];
        if (!entry && create) entry = data.chats[key] = { players: {}, aliases: {} };
        return entry || null;
    }

    /** Existing player key for any of these identities, or '' when unknown. */
    function keyFor(jid, ids) {
        const chat = chatOf(jid);
        if (!chat) return '';
        for (const id of ids || []) {
            const hit = chat.aliases[String(id)];
            if (hit && chat.players[hit]) return hit;
        }
        return '';
    }

    /**
     * Find or create the row for one person and remember every identity they
     * showed up as, so the next round finds the same row.
     * @param {{ids:Iterable<string>, name?:string}} who
     */
    function register(jid, who = {}) {
        const chat = chatOf(jid, true);
        const ids = [...(who.ids || [])].filter(Boolean).map(String);
        if (!chat || !ids.length) return null;

        const key = keyFor(jid, ids) || canonicalKey(ids);
        if (!key) return null;

        const player = chat.players[key] || (chat.players[key] = {
            name   : '',
            points : 0,
            wins   : 0,
            played : 0,
            streak : 0,
            best   : 0,
            lastWin: null,
            firstAt: new Date().toISOString()
        });

        // The newest non-empty name wins: members rename themselves and the
        // leaderboard should follow.
        const name = clean(who.name, 40);
        if (name) player.name = name;
        for (const id of ids) chat.aliases[id] = key;

        save();
        return player;
    }

    const playerOf = (jid, ids) => {
        const key = keyFor(jid, ids);
        return key ? chatOf(jid)?.players[key] || null : null;
    };

    /**
     * The row key these identities would use, without creating anything.
     * `register()` resolves to the same key, so a game round can track players
     * in a Map and the store will still find the same row afterwards.
     */
    const keyOf = (jid, ids) => keyFor(jid, ids) || canonicalKey(ids);

    /**
     * Attach one more identity to a row we already know.
     *
     * WhatsApp can hand us a LID first and the phone number later (or the other
     * way round), and nothing in the data links the two — so the caller links
     * them as they are learned, exactly like the flag store does for the guard.
     * Without it one member would slowly collect several leaderboard rows.
     */
    function link(jid, ids, newId) {
        const chat = chatOf(jid);
        const key = keyFor(jid, ids) || canonicalKey(ids);
        const id = String(newId || '');
        if (!chat || !key || !id || chat.aliases[id] === key) return false;
        chat.aliases[id] = key;
        save();
        return true;
    }

    /** Add points without touching the win counters (participation, bonuses). */
    function award(jid, who, points) {
        const player = register(jid, who);
        if (!player || !points) return player;
        player.points += points;
        save();
        return player;
    }

    /** One round won: points + streak bookkeeping + a fresh "last win" stamp. */
    function win(jid, who, points) {
        const player = register(jid, who);
        if (!player) return { player: null, bonus: 0, streak: 0 };
        const bonus = Math.min(player.streak, 5);      // 2nd win in a row +1 … capped
        player.points += points + bonus;
        player.wins += 1;
        player.streak += 1;
        player.best = Math.max(player.best || 0, player.streak);
        player.lastWin = new Date().toISOString();
        save();
        return { player, bonus, streak: player.streak };
    }

    /** Count a round as played-by-someone, once per round (the engine decides). */
    function visit(jid, who) {
        const player = register(jid, who);
        if (!player) return player;
        player.played += 1;
        save();
        return player;
    }

    /** A round ended without this person winning — their streak is over. */
    function loseStreak(jid, ids) {
        const player = playerOf(jid, ids);
        if (!player || !player.streak) return player;
        player.streak = 0;
        save();
        return player;
    }

    function board(jid, limit = 10) {
        const chat = chatOf(jid);
        if (!chat) return [];
        return Object.entries(chat.players)
            .map(([key, p]) => ({ key, ...p }))
            .filter((p) => p.points > 0 || p.played > 0)
            .sort((a, b) => b.points - a.points || b.wins - a.wins || String(a.name).localeCompare(String(b.name)))
            .slice(0, limit);
    }

    /** Same board, merged across every chat the bot has seen. */
    function boardAll(limit = 10) {
        const merged = new Map();
        for (const chat of Object.values(data.chats)) {
            for (const [key, p] of Object.entries(chat.players || {})) {
                const row = merged.get(key) || (merged.set(key, {
                    key, name: p.name, points: 0, wins: 0, played: 0, best: 0, chats: 0
                }), merged.get(key));
                row.points += p.points || 0;
                row.wins   += p.wins || 0;
                row.played += p.played || 0;
                row.best    = Math.max(row.best, p.best || 0);
                row.chats  += 1;
                if (p.name) row.name = p.name;
            }
        }
        return [...merged.values()]
            .filter((p) => p.points > 0 || p.played > 0)
            .sort((a, b) => b.points - a.points || b.wins - a.wins)
            .slice(0, limit);
    }

    /** Rank of one person in this chat (1-based), or 0 when they never scored. */
    function rank(jid, ids) {
        const rows = board(jid, Number.MAX_SAFE_INTEGER);
        const key = keyFor(jid, ids);
        if (!key) return 0;
        const i = rows.findIndex((r) => r.key === key);
        return i < 0 ? 0 : i + 1;
    }

    const totals = (jid) => {
        const rows = board(jid, Number.MAX_SAFE_INTEGER);
        return { players: rows.length, points: rows.reduce((n, r) => n + r.points, 0) };
    };

    // ── member-contributed trivia questions ─────────────────────────────────
    /**
     * @param {{q:string, a:string|string[], by?:string, byKey?:string, chat?:string}} entry
     * @returns {{ok:boolean, error?:string, entry?:object}}
     */
    function addQuestion({ q, a, by = '', byKey = '', chat = '' } = {}) {
        const question = clean(q, QUESTION_MAX_LEN);
        const answers = (Array.isArray(a) ? a : [a])
            .map((s) => clean(s, ANSWER_MAX_LEN))
            .filter(Boolean);
        if (question.length < 4) return { ok: false, error: 'the question is too short' };
        if (!answers.length) return { ok: false, error: 'the answer is missing' };
        if (answers.some((x) => x.length < 1)) return { ok: false, error: 'the answer is too short' };

        const normal = question.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
        if (data.questions.some((e) => String(e.q).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim() === normal)) {
            return { ok: false, error: 'that question is already in the pool' };
        }
        if (data.questions.length >= maxQuestions) {
            return { ok: false, error: `the pool is full (${maxQuestions} questions)` };
        }

        const entry = {
            q: question,
            a: answers,
            by: clean(by, 40),
            byKey: String(byKey || ''),
            chat: String(chat || ''),
            at: new Date().toISOString()
        };
        data.questions.push(entry);
        save();
        return { ok: true, entry };
    }

    const questions = () => data.questions;

    const api = {
        load,
        flush,
        gamesEnabled,
        setGamesEnabled,
        resetBoards,
        chatOf,
        register,
        playerOf,
        keyOf,
        link,
        award,
        win,
        visit,
        loseStreak,
        board,
        boardAll,
        rank,
        totals,
        addQuestion,
        questions,
        get playerCount() {
            return Object.values(data.chats).reduce((n, c) => n + Object.keys(c.players || {}).length, 0);
        },
        get questionCount() {
            return data.questions.length;
        }
    };

    return api;
}

export default createScoreStore;
