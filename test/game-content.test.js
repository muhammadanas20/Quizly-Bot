import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
    CONTENT_DAY_MS, GAME_CONTENT_SCHEMA, gameContentPrompt,
    normalizeGeneratedContent, generateDailyContent, createGameContentStore
} from '../src/game-content.js';
import { createScoreStore } from '../src/scores.js';
import { loadConfig } from '../src/config.js';

const first = {
    trivia: [
        { q: 'What instrument measures air pressure?', a: ['barometer'] },
        { q: 'What part of a plant absorbs water?', a: ['roots', 'root'] }
    ],
    puzzles: [
        { word: 'metronome', clue: 'A device used by musicians to keep time' },
        { word: 'carousel', clue: 'A ride that goes round at a fair' }
    ]
};
const second = {
    trivia: [{ q: 'Which organ filters blood in the body?', a: ['kidney'] }],
    puzzles: [{ word: 'periscope', clue: 'Lets someone see above a submarine' }]
};
const config = loadConfig({
    GROQ_API_KEY: 'g', GEMINI_API_KEY: 'm', AI_ORDER: 'groq,gemini',
    GAME_AI_TRIVIA_COUNT: '2', GAME_AI_PUZZLE_COUNT: '2'
});

const geminiOk = (text) => ({ status: 200, text: async () => JSON.stringify({
    candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }]
}) });
const groqOk = (text, finish_reason = 'stop') => ({ status: 200, text: async () => JSON.stringify({
    choices: [{ message: { content: text }, finish_reason }]
}) });

function disk(t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'game-content-'));
    t.after(() => fs.rmSync(dir, { force: true, recursive: true }));
    return { dir, file: path.join(dir, 'game-content.json') };
}

test('normalization enforces bounded, unique trivia and solvable scramble puzzles', () => {
    const cleaned = normalizeGeneratedContent({
        trivia: [
            { q: '  What instrument measures air pressure?  ', a: ['Barometer', 'Barometer'] },
            { q: 'what instrument measures air pressure?', a: ['barometer'] },
            { q: 'Too short', a: ['x'] },
            { q: 'What grows in an orchard?', a: ['Fruit'] }
        ],
        puzzles: [
            { word: 'MeTrOnOmE', clue: '  A device used by musicians to keep time  ' },
            { word: 'metronome', clue: 'A duplicate word is not another puzzle' },
            { word: 'carousel', clue: 'A carousel rotates in a fairground' }, // answer in clue
            { word: 'good-bye', clue: 'Punctuation does not make a single word' },
            { word: 'aaaa', clue: 'Identical letters cannot be scrambled' },
            { word: 'periscope', clue: 'Lets someone see above a submarine' }
        ]
    }, { minTrivia: 2, minPuzzles: 2 });
    assert.deepEqual(cleaned.trivia.map((q) => q.q), [
        'What instrument measures air pressure?', 'What grows in an orchard?'
    ]);
    assert.deepEqual(cleaned.trivia[0].a, ['Barometer']);
    assert.deepEqual(cleaned.puzzles.map((p) => p.word), ['metronome', 'periscope']);
    assert.equal(normalizeGeneratedContent('{bad json'), null);
    assert.equal(normalizeGeneratedContent({ trivia: [], puzzles: [] }), null);
    assert.equal(normalizeGeneratedContent({ trivia: first.trivia, puzzles: [] }), null);
    assert.equal(normalizeGeneratedContent(first, { minTrivia: 3 }), null, 'too few valid results: reject whole batch');
    assert.deepEqual(normalizeGeneratedContent('```json\n' + JSON.stringify(first) + '\n```'), first);
    assert.equal(normalizeGeneratedContent(first, { maxTrivia: 1, maxPuzzles: 1 }).trivia.length, 1);
    assert.deepEqual(normalizeGeneratedContent({
        trivia: [first.trivia[0], second.trivia[0]],
        puzzles: [first.puzzles[0], second.puzzles[0]]
    }, { excludeQuestions: first.trivia, excludeWords: first.puzzles }), second);
    assert.match(gameContentPrompt(2, 2), /timeless/);
    assert.deepEqual(GAME_CONTENT_SCHEMA.required, ['trivia', 'puzzles']);
});

test('daily AI uses text-only requests and falls back from Groq to Gemini', async () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
        calls.push({ url, body: JSON.parse(init.body) });
        return calls.length === 1
            ? { status: 429, text: async () => '{"error":{"message":"quota"}}' }
            : geminiOk(JSON.stringify(first));
    };
    const out = await generateDailyContent({ config, fetchImpl });
    assert.deepEqual(out, first);
    assert.equal(calls.length, 2);
    assert.equal(typeof calls[0].body.messages[0].content, 'string', 'no image_url or base64');
    assert.deepEqual(calls[1].body.contents[0].parts.map((p) => Object.keys(p)), [['text']]);
    assert.deepEqual(calls[1].body.generationConfig.responseSchema.required, ['trivia', 'puzzles']);
    assert.ok(!JSON.stringify(calls).includes('inline_data'));
});

test('invalid/truncated AI content falls through to an available provider or model', async () => {
    const calls = [];
    const fetchImpl = async (url) => {
        calls.push(url);
        return calls.length === 1 ? groqOk('{"trivia":[]}', 'length') : geminiOk(JSON.stringify(first));
    };
    assert.deepEqual(await generateDailyContent({ config, fetchImpl }), first);
    assert.equal(calls.length, 2);

    await assert.rejects(
        () => generateDailyContent({
            config, fetchImpl: async (url) => url.includes('generativelanguage')
                ? geminiOk('{bad json') : groqOk('{bad json')
        }),
        /incomplete or invalid game content/
    );
});

test('AI does not reuse a built-in or yesterday’s generated question/word', async () => {
    const repeated = {
        trivia: [{ q: 'What is the capital of Pakistan?', a: ['islamabad'] }],
        puzzles: [{ word: 'garden', clue: 'A place where flowers grow' }]
    };
    let calls = 0;
    const fetchImpl = async () => ++calls === 1
        ? groqOk(JSON.stringify(repeated)) : geminiOk(JSON.stringify(second));
    assert.deepEqual(await generateDailyContent({ config, previous: first, fetchImpl }), second);
    assert.equal(calls, 2, 'the invalid first batch falls through to a second provider');
});

test('24h refresh replaces only generated content; scores and member questions remain', async (t) => {
    const { file, dir } = disk(t);
    const scores = createScoreStore({ file: path.join(dir, 'scores.json') }).load();
    scores.award('group@g.us', { ids: ['123'], name: 'Ali' }, 7);
    scores.addQuestion({ q: 'How many days are in a week?', a: ['seven'] });
    scores.flush();

    let clock = Date.UTC(2026, 8, 25);
    let calls = 0;
    const store = createGameContentStore({
        file, config, now: () => clock,
        generate: async () => (++calls === 1 ? first : second)
    }).load();
    assert.equal((await store.refreshIfStale()).ok, true);
    assert.deepEqual(store.questions(), first.trivia);
    assert.equal((await store.refreshIfStale()).skipped, true);
    assert.equal(calls, 1);
    assert.deepEqual(createGameContentStore({ file }).load().puzzles(), first.puzzles, 'survives a restart');
    clock += CONTENT_DAY_MS - 1;
    assert.equal((await store.refreshIfStale()).skipped, true);
    clock += 1;
    assert.equal((await store.refreshIfStale()).ok, true);
    assert.equal(calls, 2);
    assert.deepEqual(store.questions(), second.trivia);
    assert.deepEqual(store.puzzles(), second.puzzles);
    assert.ok(!fs.readFileSync(file, 'utf8').includes('barometer'), 'yesterday’s generated content is gone');
    assert.equal(fs.existsSync(`${file}.tmp`), false);
    assert.equal(createScoreStore({ file: path.join(dir, 'scores.json') }).load().boardAll()[0].points, 7);
    assert.equal(scores.questionCount, 1);
    store.close();
});

test('invalid output and API failures keep the last good pool; retry is backed off', async (t) => {
    const { file } = disk(t);
    let clock = Date.UTC(2026, 8, 25);
    let calls = 0;
    const store = createGameContentStore({
        file, config, now: () => clock,
        generate: async () => {
            calls++;
            if (calls === 1) return first;
            if (calls === 2) throw new Error('quota');
            if (calls === 3) return { trivia: first.trivia, puzzles: [] };
            return second;
        }
    }).load();
    await store.refreshIfStale();
    const previous = fs.readFileSync(file, 'utf8');
    clock += CONTENT_DAY_MS;
    assert.equal((await store.refreshIfStale()).ok, false);
    assert.equal((await store.refreshIfStale()).reason, 'backoff');
    clock += 60 * 60 * 1000;
    assert.equal((await store.refreshIfStale()).ok, false, 'invalid batch is rejected');
    assert.deepEqual(store.questions(), first.trivia);
    assert.equal(fs.readFileSync(file, 'utf8'), previous);
    clock += 2 * 60 * 60 * 1000;
    assert.equal((await store.refreshIfStale()).ok, true);
    assert.deepEqual(store.questions(), second.trivia);
    store.close();
});

test('a duplicate daily batch cannot overwrite yesterday’s saved pool', async (t) => {
    const { file } = disk(t);
    let clock = Date.UTC(2026, 8, 25);
    const store = createGameContentStore({ file, config, now: () => clock, generate: async () => first }).load();
    assert.equal((await store.refreshIfStale()).ok, true);
    const saved = fs.readFileSync(file, 'utf8');
    clock += CONTENT_DAY_MS;
    assert.equal((await store.refreshIfStale()).ok, false);
    assert.equal(fs.readFileSync(file, 'utf8'), saved);
    store.close();
});

test('scheduler refreshes automatically when 24h elapses, then disarms on close', async (t) => {
    const { file } = disk(t);
    let clock = Date.UTC(2026, 8, 25);
    let scheduled;
    const delays = [];
    let cancelled = 0;
    let calls = 0;
    const store = createGameContentStore({
        file, config, now: () => clock,
        generate: async () => (++calls === 1 ? first : second),
        setTimer: (fn, ms) => { scheduled = fn; delays.push(ms); return { unref() {} }; },
        clearTimer: () => { cancelled++; }
    }).load();
    store.start(); // no await: the WhatsApp connection must not wait on AI
    await store.refreshIfStale();
    assert.equal(delays.at(-1), CONTENT_DAY_MS);
    clock += CONTENT_DAY_MS;
    scheduled();
    await store.refreshIfStale();
    assert.equal(calls, 2);
    assert.deepEqual(store.puzzles(), second.puzzles);
    assert.equal(delays.at(-1), CONTENT_DAY_MS);
    store.close();
    assert.ok(cancelled > 0);
    assert.equal((await store.refreshIfStale()).reason, 'closed');
});

test('pausing daily AI while games are off saves quota and resumes if stale', async (t) => {
    const { file } = disk(t);
    let clock = Date.UTC(2026, 8, 25);
    let calls = 0;
    let cancels = 0;
    const store = createGameContentStore({
        file, config, now: () => clock,
        generate: async () => (++calls === 1 ? first : second),
        setTimer: () => ({ unref() {} }),
        clearTimer: () => { cancels++; }
    }).load();
    store.start();
    await store.refreshIfStale();
    store.pause();
    assert.equal(cancels, 1);
    clock += CONTENT_DAY_MS;
    assert.equal(calls, 1, 'no scheduled request ran while games were off');
    store.start();
    await store.refreshIfStale();
    assert.equal(calls, 2);
    assert.deepEqual(store.questions(), second.trivia);
    store.close();
});

test('one in-flight generation only, and shutdown cannot persist a late result', async (t) => {
    const { file } = disk(t);
    let resolve;
    const pending = new Promise((r) => { resolve = r; });
    let calls = 0;
    const store = createGameContentStore({ file, config, generate: () => { calls++; return pending; } }).load();
    const a = store.refreshIfStale();
    const b = store.refreshIfStale();
    await Promise.resolve();
    assert.equal(calls, 1);
    store.close();
    resolve(first);
    assert.deepEqual((await Promise.all([a, b])).map((r) => r.reason), ['closed', 'closed']);
    assert.equal(fs.existsSync(file), false);
});

test('pausing or shutting down aborts an in-flight API request without provider retries', async (t) => {
    const { file } = disk(t);
    const calls = [];
    const store = createGameContentStore({
        file, config,
        fetchImpl: (url, init) => new Promise((resolve, reject) => {
            calls.push(url);
            init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true });
        })
    }).load();
    const pending = store.refreshIfStale();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(calls.length, 1);
    store.pause();
    assert.equal((await pending).reason, 'paused');
    assert.equal(calls.length, 1, 'do not try Gemini after cancelling Groq');
    assert.equal(fs.existsSync(file), false);
    store.close();
});

test('corrupt or oversized content files fall back to the shipped question pool', (t) => {
    const { file } = disk(t);
    fs.writeFileSync(file, '{not json');
    assert.equal(createGameContentStore({ file }).load().questionCount, 0);
    fs.writeFileSync(file, 'x'.repeat(129 * 1024));
    assert.equal(createGameContentStore({ file }).load().puzzleCount, 0);
});
