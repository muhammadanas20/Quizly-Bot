/**
 * src/game-content.js — rotating AI pools for trivia, scramble, math and code.
 *
 * Four categories, each generated in its OWN small batch (one request each,
 * never all at once) so no provider is hit with a big burst:
 *
 *   trivia, scramble   every GAME_AI_TRIVIA_HOURS (5h). If anybody played an
 *                      AI item since the last refresh, the WHOLE pool is
 *                      replaced with a fresh batch. Untouched pools are kept
 *                      and no quota is spent.
 *   math, code         every GAME_AI_STUDY_HOURS (10h). Only items that were
 *                      used are replaced; unused ones stay.
 *
 * Batches run one at a time with BATCH_GAP_MS between requests, and each batch
 * starts at a different provider (round-robin over the configured keys, e.g.
 * groq → gemini → groq …) so the load is shared. A failure keeps the current
 * pool and backs off per category. Built-in and member questions never change.
 */

import fs from 'node:fs';
import path from 'node:path';

import { AiError } from './ai/http.js';
import { runAI } from './ai/solve.js';
import { TRIVIA, WORDS } from './games.js';
import { MATH_BANK, CODE_BANK } from './banks.js';

const HOUR_MS = 60 * 60 * 1000;
export const CONTENT_DAY_MS = 24 * HOUR_MS;
const MAX_ITEMS = 40;
const MAX_FILE_BYTES = 512 * 1024;
export const BATCH_GAP_MS = 20_000;
const TICK_MS = 5 * 60 * 1000;
export const CATEGORIES = Object.freeze(['trivia', 'scramble', 'math', 'code']);

// ─── prompts + schemas ───────────────────────────────────────────────────────
const QA_SCHEMA = {
    type: 'object',
    properties: {
        items: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    q: { type: 'string' }, a: { type: 'array', items: { type: 'string' } },
                    level: { type: 'string' }, topic: { type: 'string' }
                },
                required: ['q', 'a', 'level']
            }
        }
    },
    required: ['items']
};
const PUZZLE_SCHEMA = {
    type: 'object',
    properties: {
        items: {
            type: 'array',
            items: {
                type: 'object',
                properties: { word: { type: 'string' }, clue: { type: 'string' }, level: { type: 'string' } },
                required: ['word', 'clue']
            }
        }
    },
    required: ['items']
};
export const SCHEMAS = { trivia: QA_SCHEMA, scramble: PUZZLE_SCHEMA, math: QA_SCHEMA, code: QA_SCHEMA };

const QA_RULES = 'Each "a" is an array of 1-4 accepted short spellings (a number, a word or a short expression, never a sentence). '
    + 'Half the items "level":"easy", half "level":"hard". No multiple-choice options. Every question must have ONE unambiguous answer. Keep each value on one line. JSON only, no markdown.';

export function contentPrompt(category, count, avoid = []) {
    const skip = avoid.length ? `\nDo NOT repeat these: ${avoid.slice(0, 40).join(' | ')}` : '';
    switch (category) {
        case 'trivia':
            return `Create ${count} DIFFERENT family-friendly, timeless general-knowledge trivia questions for a WhatsApp group game (science, geography, history, sport, arts, technology).
Return ONLY {"items":[{"q":"What instrument measures air pressure?","a":["barometer"],"level":"easy"}]}. ${QA_RULES}${skip}`;
        case 'scramble':
            return `Create ${count} DIFFERENT word-scramble puzzles for a WhatsApp group game. Each word: one common English word, letters a-z only, 4-14 letters, not a proper name, with a short helpful clue that does not contain the word. "level" is "easy" for 4-7 letters, "hard" for 8+.
Return ONLY {"items":[{"word":"metronome","clue":"Helps musicians keep time","level":"hard"}]}. JSON only.${skip}`;
        case 'math':
            return `Create ${count} DIFFERENT university maths quiz questions: about 40% linear algebra (matrices, determinants, vector spaces, basis, rank, eigenvalues), 30% single-variable calculus (limits, derivatives, integrals), 30% multivariable calculus (partial derivatives, gradient, divergence, curl, double integrals, Green/Stokes). Numeric answers must be exact integers or simple fractions like 1/2.
Return ONLY {"items":[{"q":"What is the determinant of [[2,1],[3,4]]?","a":["5"],"level":"easy","topic":"linear"}]}. "topic" is one of linear, calculus, mvc. ${QA_RULES}${skip}`;
        case 'code':
            return `Create ${count} DIFFERENT computer-science quiz questions for students: programming fundamentals in C/C++ (pf), object-oriented programming (oop), data structures and complexity (ds), and computer organization & assembly language — 8086/x86 registers, flags, instructions, addressing (coal). Spread evenly across the four topics.
Return ONLY {"items":[{"q":"Which data structure follows LIFO?","a":["stack"],"level":"easy","topic":"ds"}]}. "topic" is one of pf, oop, ds, coal. ${QA_RULES}${skip}`;
        default:
            throw new Error(`unknown category ${category}`);
    }
}

// ─── validation ──────────────────────────────────────────────────────────────
const textOf = (v) => typeof v === 'string' ? v.replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim() : '';
export const keyOf = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const levelOf = (v) => (String(v || '').toLowerCase() === 'hard' ? 'hard' : 'easy');
const TOPICS = { math: ['linear', 'calculus', 'mvc'], code: ['pf', 'oop', 'ds', 'coal'] };

/** Parse and clean one category's items. Returns an array (possibly empty) or null for unparseable input. */
export function normalizeItems(category, raw, { max = MAX_ITEMS, exclude = [] } = {}) {
    let parsed = raw;
    if (typeof raw === 'string') {
        if (raw.length > MAX_FILE_BYTES) return null;
        try { parsed = JSON.parse(raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')); }
        catch { return null; }
    }
    const list = Array.isArray(parsed) ? parsed : parsed?.items;
    if (!Array.isArray(list)) return null;

    const seen = new Set(exclude.map((e) => keyOf(typeof e === 'string' ? e : (e.word || e.q))));
    const out = [];
    for (const item of list.slice(0, 128)) {
        if (category === 'scramble') {
            const word = textOf(item?.word).toLowerCase();
            const clue = textOf(item?.clue);
            if (!/^[a-z]{4,16}$/.test(word) || new Set(word).size < 2 || clue.length < 8 || clue.length > 140
                || new RegExp(`\\b${word}\\b`, 'i').test(clue) || seen.has(word)) continue;
            const entry = { word, clue, level: item?.level ? levelOf(item.level) : (word.length >= 8 ? 'hard' : 'easy') };
            if (item?.used) entry.used = true;
            out.push(entry);
            seen.add(word);
        } else {
            const q = textOf(item?.q);
            const accepted = Array.isArray(item?.a) ? item.a : [item?.a];
            const a = [...new Set(accepted.slice(0, 4).map(textOf).filter((s) => s && s.length <= 60))];
            const key = keyOf(q);
            if (q.length < 10 || q.length > 300 || !a.length || !key || seen.has(key)) continue;
            const entry = { q, a, level: levelOf(item?.level) };
            const topic = String(item?.topic || '').toLowerCase();
            if (TOPICS[category]) entry.topic = TOPICS[category].includes(topic) ? topic : TOPICS[category][0];
            if (item?.used) entry.used = true;
            out.push(entry);
            seen.add(key);
        }
        if (out.length >= max) break;
    }
    return out;
}

/** Everything a generated item must not duplicate. */
function builtinsFor(category) {
    if (category === 'trivia') return TRIVIA;
    if (category === 'scramble') return WORDS;
    if (category === 'math') return MATH_BANK;
    return CODE_BANK;
}

/** Rotate the usable providers so consecutive batches start on different AIs. */
export function rotatedOrder(config, turn) {
    const usable = (config.aiOrder || []).filter((p) => config[p]?.key);
    if (!usable.length) return config.aiOrder || [];
    const k = turn % usable.length;
    return [...usable.slice(k), ...usable.slice(0, k)];
}

/** Text-only generation config: Groq uses its text model (the vision default was retired). */
export function textConfig(config, turn) {
    const out = { ...config, aiOrder: rotatedOrder(config, turn) };
    if (config.groq?.textModel) {
        out.groq = { ...config.groq, model: config.groq.textModel, fallbacks: config.groq.textFallbacks || [] };
    }
    return out;
}

/** One validated batch for one category. */
export async function generateBatch({ category, count, config, log, fetchImpl, signal, avoid = [], turn = 0 }) {
    const n = Math.max(1, Math.min(count, MAX_ITEMS));
    const cfg = textConfig(config, turn);
    const out = await runAI({
        config: cfg, log, fetchImpl, signal,
        prompt: contentPrompt(category, n, avoid.map((e) => (typeof e === 'string' ? e : (e.word || e.q)))),
        maxTokens: Math.min(8000, Math.max(config.aiMaxTokens || 2400, 800 + n * 110)),
        responseSchema: SCHEMAS[category],
        validate: ({ text, truncated }) => {
            const items = !truncated && normalizeItems(category, text, { max: n, exclude: [...builtinsFor(category), ...avoid] });
            if (!items || items.length < Math.ceil(n / 2)) {
                throw new AiError(`AI returned incomplete or invalid ${category} content`, { kind: 'bad_response' });
            }
            return items;
        }
    });
    if (!out.ok) throw new Error(out.summary);
    return out.data;
}

// ─── the store ───────────────────────────────────────────────────────────────
export function createGameContentStore({
    file, config = {}, log, fetchImpl, scores,
    now = () => Date.now(), generate = generateBatch,
    setTimer = setTimeout, clearTimer = clearTimeout, gapMs = BATCH_GAP_MS
} = {}) {
    const cycleMs = {
        trivia  : (config.gameAiTriviaHours || 5) * HOUR_MS,
        scramble: (config.gameAiTriviaHours || 5) * HOUR_MS,
        math    : (config.gameAiStudyHours || 10) * HOUR_MS,
        code    : (config.gameAiStudyHours || 10) * HOUR_MS
    };
    const target = {
        trivia  : Math.min(config.gameAiTriviaCount || 16, MAX_ITEMS),
        scramble: Math.min(config.gameAiPuzzleCount || 16, MAX_ITEMS),
        math    : Math.min(config.gameAiMathCount || 16, MAX_ITEMS),
        code    : Math.min(config.gameAiCodeCount || 16, MAX_ITEMS)
    };
    const replaceAll = { trivia: true, scramble: true, math: false, code: false };

    const pools = Object.fromEntries(CATEGORIES.map((c) => [c, { generatedAt: null, items: [] }]));
    const state = Object.fromEntries(CATEGORIES.map((c) => [c, { failures: 0, retryAt: 0 }]));
    let timer = null;
    let running = null;
    let controller = null;
    let version = 0;
    let started = false;
    let closed = false;
    let turn = 0;
    let lastRequestAt = null;

    // ── persistence ──────────────────────────────────────────────────────────
    function load() {
        if (!file) return api;
        try {
            if (!fs.existsSync(file)) return api;
            if (fs.statSync(file).size > MAX_FILE_BYTES) throw new Error('content file is too large');
            const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
            // v1 files stored {generatedAt, trivia, puzzles}; carry them over.
            const cats = parsed?.categories || {
                trivia: { generatedAt: parsed?.generatedAt, items: parsed?.trivia },
                scramble: { generatedAt: parsed?.generatedAt, items: parsed?.puzzles }
            };
            for (const c of CATEGORIES) {
                const entry = cats[c];
                if (!entry) continue;
                const items = normalizeItems(c, entry.items || []);
                const ts = Date.parse(entry.generatedAt);
                if (items && Number.isFinite(ts)) pools[c] = { generatedAt: new Date(ts).toISOString(), items };
            }
        } catch (err) {
            log?.warn?.(`game content: could not read ${file} (${err.message}); using built-ins until refresh`);
        }
        return api;
    }

    function persist() {
        if (!file) return;
        const temporary = `${file}.tmp`;
        try {
            fs.mkdirSync(path.dirname(file), { recursive: true });
            fs.writeFileSync(temporary, JSON.stringify({ version: 2, categories: pools }));
            fs.renameSync(temporary, file);
        } catch (err) {
            try { fs.unlinkSync(temporary); } catch { /* none */ }
            throw err;
        }
    }

    let saveTimer = null;
    function saveSoon() {
        if (!file || saveTimer) return;
        saveTimer = setTimeout(() => {
            saveTimer = null;
            try { persist(); } catch (err) { log?.warn?.(`game content: save failed: ${err.message}`); }
        }, 2000);
        saveTimer.unref?.();
    }

    // ── what needs work ──────────────────────────────────────────────────────
    /** @returns {{category:string, count:number, mode:'all'|'used'}|null} */
    function planFor(c) {
        const pool = pools[c];
        const last = pool.generatedAt ? Date.parse(pool.generatedAt) : 0;
        if (now() < state[c].retryAt) return null;
        if (!pool.items.length) return { category: c, count: target[c], mode: 'all' };
        if (now() - last < cycleMs[c]) return null;
        const used = pool.items.filter((i) => i.used).length;
        const missing = Math.max(0, target[c] - pool.items.length);
        if (replaceAll[c]) return used > 0 || missing > 0 ? { category: c, count: target[c], mode: 'all' } : null;
        return used + missing > 0 ? { category: c, count: used + missing, mode: 'used' } : null;
    }

    function due() {
        return CATEGORIES.map(planFor).filter(Boolean);
    }

    /** Untouched pools still count as fresh: restart their clock so we check again next cycle. */
    function touchIdle() {
        let changed = false;
        for (const c of CATEGORIES) {
            const pool = pools[c];
            const last = pool.generatedAt ? Date.parse(pool.generatedAt) : 0;
            if (pool.items.length && now() - last >= cycleMs[c] && !planFor(c) && now() >= state[c].retryAt) {
                pool.generatedAt = new Date(now()).toISOString();
                changed = true;
            }
        }
        if (changed) saveSoon();
    }

    // ── running batches ──────────────────────────────────────────────────────
    const sleep = (ms, signal) => new Promise((resolve) => {
        if (ms <= 0 || signal?.aborted) return resolve();
        const t = setTimer(resolve, ms);
        t?.unref?.();              // background housekeeping must never keep Node alive
        signal?.addEventListener?.('abort', () => { clearTimer(t); resolve(); }, { once: true });
    });

    async function runOne(plan, signal) {
        const pool = pools[plan.category];
        const keep = plan.mode === 'used' ? pool.items.filter((i) => !i.used) : [];
        const avoid = [...pool.items, ...(plan.category === 'trivia' ? scores?.questions?.() || [] : [])];
        const fresh = await generate({
            category: plan.category, count: plan.count, config, log, fetchImpl, signal, avoid, turn: turn++
        });
        const valid = normalizeItems(plan.category, fresh, {
            max: plan.count, exclude: [...keep, ...(plan.mode === 'all' ? pool.items : [])]
        });
        if (!valid || !valid.length) throw new Error(`invalid ${plan.category} batch`);
        if (signal.aborted || closed) return false;
        const previous = pools[plan.category];
        pools[plan.category] = {
            generatedAt: new Date(now()).toISOString(),
            items: [...keep, ...valid.map(({ used, ...rest }) => rest)].slice(0, MAX_ITEMS)
        };
        try { persist(); } catch (err) { pools[plan.category] = previous; throw err; }
        log?.info?.(`game content: ${plan.category} ${plan.mode === 'all' ? 'replaced' : 'topped up'} with ${valid.length} new item(s)`);
        return true;
    }

    /** Process every due category, one request at a time. Single-flight. */
    async function refreshIfStale() {
        if (closed) return { ok: false, reason: 'closed' };
        if (running) return running;
        const myVersion = version;
        running = Promise.resolve().then(async () => {
            const plans = due();
            touchIdle();
            if (!plans.length) return { ok: true, skipped: true, refreshed: [] };
            const request = controller = new AbortController();
            const refreshed = [];
            const failed = [];
            try {
                for (const plan of plans) {
                    if (closed || myVersion !== version || request.signal.aborted) break;
                    await sleep(lastRequestAt === null ? 0 : lastRequestAt + gapMs - now(), request.signal);
                    if (closed || request.signal.aborted) break;
                    lastRequestAt = now();
                    try {
                        if (await runOne(plan, request.signal)) {
                            refreshed.push(plan.category);
                            state[plan.category] = { failures: 0, retryAt: 0 };
                        }
                    } catch (err) {
                        if (request.signal.aborted || closed) break;
                        const s = state[plan.category];
                        s.failures++;
                        s.retryAt = now() + Math.min(HOUR_MS * 2 ** (s.failures - 1), CONTENT_DAY_MS);
                        failed.push(plan.category);
                        log?.warn?.(`game content: ${plan.category} refresh failed (${err.message}); keeping previous pool`);
                    }
                }
            } finally {
                if (controller === request) controller = null;
            }
            if (closed || request.signal.aborted) return { ok: false, reason: closed ? 'closed' : 'paused', refreshed };
            return { ok: failed.length === 0, refreshed, failed };
        }).finally(() => {
            running = null;
            schedule();
        });
        return running;
    }

    function schedule() {
        if (timer) clearTimer(timer);
        timer = null;
        if (!started || closed) return;
        timer = setTimer(() => { void refreshIfStale(); }, TICK_MS);
        timer.unref?.();
    }

    function start() {
        if (started || closed) return;
        started = true;
        void refreshIfStale();
    }

    function pause() {
        started = false;
        version++;
        if (timer) clearTimer(timer);
        timer = null;
        controller?.abort();
    }

    function close() {
        closed = true;
        pause();
        if (saveTimer) {
            clearTimeout(saveTimer);
            saveTimer = null;
            try { persist(); } catch { /* best effort on shutdown */ }
        }
    }

    // ── reading + usage ──────────────────────────────────────────────────────
    const items = (c, level) => {
        const list = pools[c]?.items || [];
        return level ? list.filter((i) => i.level === level) : list;
    };

    /** Mark an AI item as played so the next cycle replaces it. */
    function markUsed(c, item) {
        const key = keyOf(item?.word || item?.q);
        const hit = (pools[c]?.items || []).find((i) => keyOf(i.word || i.q) === key);
        if (!hit || hit.used) return false;
        hit.used = true;
        saveSoon();
        return true;
    }

    function status() {
        return Object.fromEntries(CATEGORIES.map((c) => [c, {
            count: pools[c].items.length,
            used: pools[c].items.filter((i) => i.used).length,
            generatedAt: pools[c].generatedAt,
            everyHours: cycleMs[c] / HOUR_MS
        }]));
    }

    const api = {
        load, start, pause, close, refreshIfStale, items, markUsed, status,
        questions: () => pools.trivia.items,
        puzzles: () => pools.scramble.items,
        get generatedAt() { return pools.trivia.generatedAt || pools.scramble.generatedAt; },
        get questionCount() { return pools.trivia.items.length; },
        get puzzleCount() { return pools.scramble.items.length; }
    };
    return api;
}

export default createGameContentStore;
