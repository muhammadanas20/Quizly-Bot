import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
    CATEGORIES, contentPrompt, normalizeItems, generateBatch, createGameContentStore,
    rotatedOrder, textConfig
} from '../src/game-content.js';
import { loadConfig } from '../src/config.js';

const HOUR = 60 * 60 * 1000;
const config = loadConfig({
    GROQ_API_KEY: 'g', GEMINI_API_KEY: 'm', AI_ORDER: 'groq,gemini',
    GAME_AI_TRIVIA_COUNT: '2', GAME_AI_PUZZLE_COUNT: '2', GAME_AI_MATH_COUNT: '2', GAME_AI_CODE_COUNT: '2'
});

const qa = (prefix, n = 2, extra = {}) => Array.from({ length: n }, (_, i) => ({
    q: `${prefix} question number ${i + 1}?`, a: [`${prefix}${i + 1}`], level: i % 2 ? 'hard' : 'easy', ...extra
}));
const words = (list) => list.map((word) => ({ word, clue: `A clue for the word number ${word.length}` }));

/** Fake generator: records every call and returns fresh, unique items. */
function fakeGenerate(calls) {
    let serial = 0;
    return async ({ category, count, turn }) => {
        calls.push({ category, count, turn });
        serial++;
        if (category === 'scramble') {
            return words(['metronome', 'carousel', 'periscope', 'kaleidoscope', 'harmonica', 'trombone']
                .slice((serial % 3) * 2, (serial % 3) * 2 + count));
        }
        return qa(`${category}${serial}`, count, category === 'math' ? { topic: 'linear' } : category === 'code' ? { topic: 'ds' } : {});
    };
}

function disk(t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'game-content-'));
    t.after(() => fs.rmSync(dir, { force: true, recursive: true }));
    return path.join(dir, 'game-content.json');
}

const geminiOk = (text) => ({ status: 200, text: async () => JSON.stringify({
    candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }]
}) });
const groqOk = (text) => ({ status: 200, text: async () => JSON.stringify({
    choices: [{ message: { content: text }, finish_reason: 'stop' }]
}) });

test('normalization: bounded, unique, levels + topics, answer never in scramble clue', () => {
    const items = normalizeItems('math', { items: [
        { q: 'What is the determinant of [[1,0],[0,1]] exactly?', a: ['1', '1'], level: 'HARD', topic: 'linear' },
        { q: 'what is the determinant of [[1,0],[0,1]] exactly?', a: ['1'] },
        { q: 'short', a: ['x'] },
        { q: 'What is the derivative of x squared?', a: ['2x'], topic: 'nonsense' }
    ] });
    assert.deepEqual(items.map((i) => [i.level, i.topic, i.a]), [['hard', 'linear', ['1']], ['easy', 'linear', ['2x']]]);
    const puzzles = normalizeItems('scramble', { items: [
        { word: 'MeTrOnOmE', clue: 'Helps musicians keep time' },
        { word: 'carousel', clue: 'A carousel is a fair ride' },
        { word: 'aaaa', clue: 'Identical letters cannot scramble' }
    ] });
    assert.deepEqual(puzzles.map((p) => [p.word, p.level]), [['metronome', 'hard']]);
    assert.equal(normalizeItems('trivia', '{bad json'), null);
    assert.equal(normalizeItems('trivia', { items: qa('t', 5) }, { max: 2 }).length, 2);
    for (const c of CATEGORIES) assert.match(contentPrompt(c, 3), /JSON/);
    assert.match(contentPrompt('math', 3), /linear algebra/);
    assert.match(contentPrompt('code', 3), /assembly/);
});

test('batches rotate providers and Groq uses its text model', () => {
    assert.deepEqual(rotatedOrder(config, 0), ['groq', 'gemini']);
    assert.deepEqual(rotatedOrder(config, 1), ['gemini', 'groq']);
    const cfg = textConfig(config, 0);
    assert.equal(cfg.groq.model, 'openai/gpt-oss-120b');
    assert.equal(config.groq.model, 'meta-llama/llama-4-scout-17b-16e-instruct', 'the quiz config is untouched');
});

test('generateBatch is text-only, one category per request, falls back on failure', async () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
        calls.push({ url, body: JSON.parse(init.body) });
        return calls.length === 1
            ? { status: 429, text: async () => '{"error":{"message":"quota"}}' }
            : geminiOk(JSON.stringify({ items: qa('code', 2, { topic: 'oop' }) }));
    };
    const items = await generateBatch({ category: 'code', count: 2, config, fetchImpl });
    assert.equal(items.length, 2);
    assert.equal(calls[0].body.model, 'openai/gpt-oss-120b');
    assert.equal(typeof calls[0].body.messages[0].content, 'string');
    assert.match(calls[0].body.messages[0].content, /assembly/);
    assert.ok(!JSON.stringify(calls).includes('inline_data'));

    await assert.rejects(() => generateBatch({
        category: 'trivia', count: 2, config,
        fetchImpl: async (url) => (url.includes('generativelanguage') ? geminiOk('{bad') : groqOk('{bad'))
    }), /incomplete or invalid/);
});

test('first start fills all four pools, one sequential request each, alternating providers', async (t) => {
    const file = disk(t);
    const calls = [];
    const store = createGameContentStore({ file, config, now: () => Date.UTC(2026, 8, 25), generate: fakeGenerate(calls), gapMs: 0 }).load();
    const out = await store.refreshIfStale();
    assert.deepEqual(out.refreshed, CATEGORIES);
    assert.deepEqual(calls.map((c) => c.category), CATEGORIES);
    assert.deepEqual(calls.map((c) => c.turn), [0, 1, 2, 3], 'each batch starts at the next provider');
    for (const c of CATEGORIES) assert.equal(store.items(c).length, 2);
    assert.equal(createGameContentStore({ file, config }).load().items('math').length, 2, 'survives restart');
    store.close();
});

test('trivia/scramble: after 5h replaced ONLY if played; untouched pools cost no quota', async (t) => {
    const file = disk(t);
    let clock = Date.UTC(2026, 8, 25);
    const calls = [];
    const store = createGameContentStore({ file, config, now: () => clock, generate: fakeGenerate(calls), gapMs: 0 }).load();
    await store.refreshIfStale();
    calls.length = 0;
    const before = store.questions().map((q) => q.q);

    clock += 5 * HOUR - 1;
    assert.equal((await store.refreshIfStale()).skipped, true);
    clock += 1;
    assert.equal((await store.refreshIfStale()).skipped, true, 'nobody played: nothing generated');
    assert.equal(calls.length, 0);
    assert.deepEqual(store.questions().map((q) => q.q), before);

    store.markUsed('trivia', store.questions()[0]);
    clock += 5 * HOUR;
    const out = await store.refreshIfStale();
    assert.deepEqual(out.refreshed, ['trivia']);
    assert.ok(store.questions().every((q) => !before.includes(q.q)), 'the whole trivia pool is new');
    assert.equal(store.status().trivia.used, 0);
    store.close();
});

test('math/code: every 10h only the used questions are replaced', async (t) => {
    const file = disk(t);
    let clock = Date.UTC(2026, 8, 25);
    const calls = [];
    const store = createGameContentStore({ file, config, now: () => clock, generate: fakeGenerate(calls), gapMs: 0 }).load();
    await store.refreshIfStale();
    calls.length = 0;
    const [played, kept] = store.items('code');
    store.markUsed('code', played);

    clock += 5 * HOUR;
    await store.refreshIfStale();
    assert.equal(calls.length, 0, 'code waits for its 10h cycle');
    clock += 5 * HOUR;
    const out = await store.refreshIfStale();
    assert.deepEqual(out.refreshed, ['code']);
    assert.deepEqual(calls.map((c) => [c.category, c.count]), [['code', 1]], 'asks only for the used count');
    const qs = store.items('code').map((i) => i.q);
    assert.ok(qs.includes(kept.q), 'unused question kept');
    assert.ok(!qs.includes(played.q), 'used question replaced');
    assert.equal(qs.length, 2);
    assert.equal(store.items('code', 'hard').every((i) => i.level === 'hard'), true);
    store.close();
});

test('failures keep the pool, back off per category, and other categories still refresh', async (t) => {
    const file = disk(t);
    let clock = Date.UTC(2026, 8, 25);
    let failMath = false;
    const calls = [];
    const ok = fakeGenerate(calls);
    const store = createGameContentStore({
        file, config, now: () => clock, gapMs: 0,
        generate: async (args) => {
            if (failMath && args.category === 'math') throw new Error('quota');
            return ok(args);
        }
    }).load();
    await store.refreshIfStale();
    const math = store.items('math').map((i) => i.q);
    store.markUsed('math', store.items('math')[0]);
    store.markUsed('code', store.items('code')[0]);
    failMath = true;
    clock += 10 * HOUR;
    const out = await store.refreshIfStale();
    assert.deepEqual(out.failed, ['math']);
    assert.deepEqual(out.refreshed, ['code']);
    assert.deepEqual(store.items('math').map((i) => i.q), math, 'failed pool unchanged');
    assert.equal((await store.refreshIfStale()).skipped, true, 'math is in backoff');
    failMath = false;
    clock += HOUR;
    assert.deepEqual((await store.refreshIfStale()).refreshed, ['math']);
    store.close();
});

test('batches are spaced out by the gap timer', async (t) => {
    const file = disk(t);
    let clock = 0;
    const delays = [];
    const calls = [];
    const store = createGameContentStore({
        file, config, now: () => clock, generate: fakeGenerate(calls), gapMs: 20_000,
        setTimer: (fn, ms) => { delays.push(ms); clock += ms; queueMicrotask(fn); return { unref() {} }; },
        clearTimer: () => {}
    }).load();
    await store.refreshIfStale();
    assert.equal(calls.length, 4);
    assert.deepEqual(delays.filter((d) => d === 20_000).length, 3, 'a 20s gap between the four requests');
    store.close();
});

test('pause/close abort the in-flight batch; single-flight', async (t) => {
    const file = disk(t);
    let resolve;
    let calls = 0;
    const store = createGameContentStore({
        file, config, gapMs: 0, generate: () => { calls++; return new Promise((r) => { resolve = r; }); }
    }).load();
    const a = store.refreshIfStale();
    const b = store.refreshIfStale();
    await new Promise((r) => setImmediate(r));
    assert.equal(calls, 1);
    store.close();
    resolve(qa('late'));
    assert.deepEqual((await Promise.all([a, b])).map((r) => r.reason), ['closed', 'closed']);
    assert.equal(fs.existsSync(file), false);
});

test('v1 files migrate; corrupt/oversized files fall back to built-ins', (t) => {
    const file = disk(t);
    fs.writeFileSync(file, JSON.stringify({
        generatedAt: '2026-09-24T00:00:00.000Z',
        trivia: [{ q: 'What instrument measures air pressure?', a: ['barometer'] }],
        puzzles: words(['metronome'])
    }));
    const migrated = createGameContentStore({ file, config }).load();
    assert.equal(migrated.questionCount, 1);
    assert.equal(migrated.puzzleCount, 1);
    fs.writeFileSync(file, '{not json');
    assert.equal(createGameContentStore({ file }).load().questionCount, 0);
    fs.writeFileSync(file, 'x'.repeat(600 * 1024));
    assert.equal(createGameContentStore({ file }).load().puzzleCount, 0);
});
