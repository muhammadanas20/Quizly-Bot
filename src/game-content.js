/**
 * A small, rotating AI pool for !game trivia and !game scramble.
 *
 * Only generated content is replaced every 24 hours. Built-in questions/words
 * live in games.js and member submissions live in scores.json; neither is
 * touched by refreshes, failed API calls, or leaderboard resets. One bounded
 * text-only request uses the same provider/model fallback chain as quiz images.
 */

import fs from 'node:fs';
import path from 'node:path';

import { AiError } from './ai/http.js';
import { runAI } from './ai/solve.js';
import { TRIVIA, WORDS } from './games.js';

export const CONTENT_DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const MAX_ITEMS = 32;
const MAX_FILE_BYTES = 128 * 1024;

export const GAME_CONTENT_SCHEMA = {
    type: 'object',
    properties: {
        trivia: {
            type: 'array',
            items: {
                type: 'object',
                properties: { q: { type: 'string' }, a: { type: 'array', items: { type: 'string' } } },
                required: ['q', 'a']
            }
        },
        puzzles: {
            type: 'array',
            items: {
                type: 'object',
                properties: { word: { type: 'string' }, clue: { type: 'string' } },
                required: ['word', 'clue']
            }
        }
    },
    required: ['trivia', 'puzzles']
};

export function gameContentPrompt(triviaCount, puzzleCount) {
    return `Create fresh, family-friendly WhatsApp game content. Return ONLY a JSON object, no markdown:
{"trivia":[{"q":"What instrument measures air pressure?","a":["barometer"]}],"puzzles":[{"word":"metronome","clue":"A device that helps musicians keep time"}]}
Generate ${triviaCount} DIFFERENT factual, timeless general-knowledge trivia questions with brief, unambiguous answers. Cover varied subjects. Each a is an array of 1-3 accepted spellings, not a sentence. No current events, controversial claims, opinion questions, or multiple-choice options.
Generate ${puzzleCount} DIFFERENT scramble puzzles: each word is one common English word, letters a-z only, 4-16 letters, with a short useful clue that does not contain the word. Avoid proper names and obscure words. Avoid repeating the same answers. Keep every value on one line. JSON only.`;
}

const textOf = (v) => typeof v === 'string' ? v.replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim() : '';
const keyOf = (s) => s.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** Reject malformed, duplicated or undersized output; never save partial JSON. */
export function normalizeGeneratedContent(raw, {
    minTrivia = 1, minPuzzles = 1, maxTrivia = MAX_ITEMS, maxPuzzles = MAX_ITEMS,
    excludeQuestions = [], excludeWords = []
} = {}) {
    let parsed = raw;
    if (typeof raw === 'string') {
        if (raw.length > MAX_FILE_BYTES) return null;
        try {
            parsed = JSON.parse(raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''));
        } catch { return null; }
    }
    if (!Array.isArray(parsed?.trivia) || !Array.isArray(parsed?.puzzles)) return null;

    const trivia = [];
    const seenQuestions = new Set(excludeQuestions.map((q) => keyOf(typeof q === 'string' ? q : q.q)));
    for (const item of parsed.trivia.slice(0, 128)) {
        const q = textOf(item?.q);
        const accepted = Array.isArray(item?.a) ? item.a : [item?.a];
        const a = [...new Set(accepted.slice(0, 3).map(textOf).filter((s) => s && s.length <= 60))];
        const key = keyOf(q);
        if (q.length < 10 || q.length > 200 || !a.length || seenQuestions.has(key)) continue;
        trivia.push({ q, a });
        seenQuestions.add(key);
        if (trivia.length >= maxTrivia) break;
    }

    const puzzles = [];
    const seenWords = new Set(excludeWords.map((p) => String(typeof p === 'string' ? p : p.word).toLowerCase()));
    for (const item of parsed.puzzles.slice(0, 128)) {
        const word = textOf(item?.word).toLowerCase();
        const clue = textOf(item?.clue);
        if (!/^[a-z]{4,16}$/.test(word) || new Set(word).size < 2
            || clue.length < 8 || clue.length > 140
            || new RegExp(`\\b${word}\\b`, 'i').test(clue) || seenWords.has(word)) continue;
        puzzles.push({ word, clue });
        seenWords.add(word);
        if (puzzles.length >= maxPuzzles) break;
    }

    if (trivia.length < minTrivia || puzzles.length < minPuzzles) return null;
    return { trivia, puzzles };
}

/** Generate and validate before accepting a provider's response as success. */
export async function generateDailyContent({ config, log, fetchImpl, signal, previous, memberQuestions = [] }) {
    const triviaCount = Math.min(config.gameAiTriviaCount || 16, MAX_ITEMS);
    const puzzleCount = Math.min(config.gameAiPuzzleCount || 16, MAX_ITEMS);
    const out = await runAI({
        config, log, fetchImpl, signal,
        prompt: gameContentPrompt(triviaCount, puzzleCount),
        // A 32+32 batch needs a larger JSON budget than the default quiz image.
        maxTokens: Math.min(8000, Math.max(config.aiMaxTokens || 2400,
            1200 + triviaCount * 80 + puzzleCount * 45)),
        responseSchema: GAME_CONTENT_SCHEMA,
        validate: ({ text, truncated }) => {
            const pool = !truncated && normalizeGeneratedContent(text, {
                minTrivia: Math.ceil(triviaCount / 2), minPuzzles: Math.ceil(puzzleCount / 2),
                maxTrivia: triviaCount, maxPuzzles: puzzleCount,
                excludeQuestions: [...TRIVIA, ...memberQuestions, ...(previous?.trivia || [])],
                excludeWords: [...WORDS, ...(previous?.puzzles || [])]
            });
            if (!pool) throw new AiError('AI returned incomplete or invalid game content', { kind: 'bad_response' });
            return pool;
        }
    });
    if (!out.ok) throw new Error(out.summary);
    return out.data;
}

export function createGameContentStore({
    file, config, log, fetchImpl, scores, now = () => Date.now(), generate = generateDailyContent,
    setTimer = setTimeout, clearTimer = clearTimeout
} = {}) {
    let pool = { generatedAt: null, trivia: [], puzzles: [] };
    let timer = null;
    let running = null;
    let controller = null;
    let cancellationVersion = 0;
    let started = false;
    let closed = false;
    let failures = 0;
    let nextRetryAt = 0;

    function load() {
        if (!file) return api;
        try {
            if (!fs.existsSync(file)) return api;
            if (fs.statSync(file).size > MAX_FILE_BYTES) throw new Error('content file is too large');
            const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
            const normalized = normalizeGeneratedContent(parsed);
            const timestamp = Date.parse(parsed.generatedAt);
            if (!normalized || !Number.isFinite(timestamp)) throw new Error('invalid generated pool');
            pool = { generatedAt: new Date(timestamp).toISOString(), ...normalized };
        } catch (err) {
            log?.warn?.(`game content: could not read ${file} (${err.message}); using built-ins until refresh`);
        }
        return api;
    }

    function schedule() {
        if (timer) clearTimer(timer);
        timer = null;
        if (!started || closed) return;
        const last = pool.generatedAt ? Date.parse(pool.generatedAt) : 0;
        const due = Math.max(now() + 1000, nextRetryAt, last && last <= now() ? last + CONTENT_DAY_MS : now());
        timer = setTimer(() => { void refreshIfStale(); }, Math.max(0, due - now()));
        timer.unref?.();
    }

    /** One in-flight refresh; on failure keep the old pool and back off. */
    async function refreshIfStale() {
        if (closed) return { ok: false, reason: 'closed' };
        if (running) return running;
        const last = pool.generatedAt ? Date.parse(pool.generatedAt) : 0;
        if (last && now() >= last && now() - last < CONTENT_DAY_MS) {
            schedule();
            return { ok: true, skipped: true };
        }
        if (now() < nextRetryAt) return { ok: false, reason: 'backoff' };

        // Defer execution one microtask so even a synchronous mock/failure
        // cannot finish before `running` is assigned (single-flight guarantee).
        const version = cancellationVersion;
        running = Promise.resolve().then(async () => {
            if (closed || version !== cancellationVersion) {
                return { ok: false, reason: closed ? 'closed' : 'paused' };
            }
            const request = controller = new AbortController();
            try {
                const generated = await generate({
                    config, log, fetchImpl, signal: request.signal,
                    previous: pool, memberQuestions: scores?.questions?.() || []
                });
                const valid = normalizeGeneratedContent(generated, {
                    minTrivia: 1, minPuzzles: 1,
                    maxTrivia: Math.min(config?.gameAiTriviaCount || 16, MAX_ITEMS),
                    maxPuzzles: Math.min(config?.gameAiPuzzleCount || 16, MAX_ITEMS),
                    excludeQuestions: pool.trivia, excludeWords: pool.puzzles
                });
                if (!valid) throw new Error('invalid generated pool');
                if (request.signal.aborted || closed) return { ok: false, reason: closed ? 'closed' : 'paused' };
                const next = { generatedAt: new Date(now()).toISOString(), ...valid };
                if (file) {
                    const temporary = `${file}.tmp`;
                    try {
                        fs.mkdirSync(path.dirname(file), { recursive: true });
                        fs.writeFileSync(temporary, JSON.stringify(next));
                        fs.renameSync(temporary, file);
                    } catch (err) {
                        try { fs.unlinkSync(temporary); } catch { /* no temporary file */ }
                        throw err;
                    }
                }
                pool = next; // swap only after the new file has been safely written
                failures = 0;
                nextRetryAt = 0;
                log?.info?.(`game content: refreshed ${valid.trivia.length} trivia + ${valid.puzzles.length} puzzles`);
                return { ok: true, ...valid };
            } catch (err) {
                if (request.signal.aborted || closed) return { ok: false, reason: closed ? 'closed' : 'paused' };
                failures++;
                nextRetryAt = now() + Math.min(HOUR_MS * 2 ** (failures - 1), CONTENT_DAY_MS);
                log?.warn?.(`game content: refresh failed (${err.message}); keeping previous pool`);
                return { ok: false, reason: err.message };
            } finally {
                if (controller === request) controller = null;
            }
        }).finally(() => {
            running = null;
            schedule();
        });
        return running;
    }

    /** Start in the background: WhatsApp connection/guard must never await AI. */
    function start() {
        if (started || closed) return;
        started = true;
        void refreshIfStale();
    }

    /** Save AI quota while games are off; resuming catches up if 24h elapsed. */
    function pause() {
        started = false;
        cancellationVersion++;
        if (timer) clearTimer(timer);
        timer = null;
        controller?.abort(); // stop in-flight fetches; a paused refresh is not a failure
    }

    function close() {
        closed = true;
        pause();
    }

    const api = {
        load, start, pause, close, refreshIfStale,
        questions: () => pool.trivia,
        puzzles: () => pool.puzzles,
        get generatedAt() { return pool.generatedAt; },
        get questionCount() { return pool.trivia.length; },
        get puzzleCount() { return pool.puzzles.length; }
    };
    return api;
}

export default createGameContentStore;
