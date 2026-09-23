import test from 'node:test';
import assert from 'node:assert/strict';

import { createQuizHandler } from '../src/quiz.js';
import { createRateLimiter, createInflight } from '../src/limiter.js';
import { loadConfig } from '../src/config.js';
import log from '../src/log.js';

const GROUP = '120363000000000000@g.us';
const ANSWER_JSON = JSON.stringify({
    questions: [
        { n: 1, question: 'Capital of Pakistan?', reason: 'Islamabad became the capital in the 1960s.', answer: 'B — Islamabad' },
        { n: 2, question: 'Largest ocean?', reason: 'The Pacific covers a third of the Earth.', answer: 'C — Pacific' }
    ],
    unreadable: []
});

function world({ fetchImpl, downloadImpl, env = {} } = {}) {
    const sent = [];
    const config = loadConfig({ GEMINI_API_KEY: 'k', ...env });
    config.fetchImpl = fetchImpl;

    const sock = { sendMessage: async (jid, content) => { sent.push({ jid, content }); return { key: { id: 'S' } }; } };
    const limiter = createRateLimiter({ perMinute: config.ratePerMinute, perDay: config.ratePerDay });
    const inflight = createInflight();

    const quiz = createQuizHandler({
        sock,
        config,
        log,
        limiter,
        inflight,
        groups : { subjectOf: () => 'Test Group' },
        download: downloadImpl || (async () => Buffer.from([0xff, 0xd8, 0xff, 0xe0]))
    });

    return { quiz, sent, config, limiter, inflight, sock };
}

const okFetch = (text = ANSWER_JSON) => async () => ({
    status: 200,
    text  : async () => JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] })
});

const imageMsg = (text = 'quiz') => ({
    key    : { remoteJid: GROUP, participant: '923001234567@s.whatsapp.net', fromMe: false, id: 'M1' },
    message: { imageMessage: { url: 'u', mimetype: 'image/jpeg', caption: text } }
});

const textOnly = { key: imageMsg().key, message: { conversation: 'quiz please' } };
const imageNoKeyword = { key: imageMsg().key, message: { imageMessage: { url: 'u', mimetype: 'image/jpeg' } } };
const quotedImage = {
    key    : imageMsg().key,
    message: {
        extendedTextMessage: {
            text       : 'quiz',
            contextInfo: {
                stanzaId     : 'Q1',
                participant  : '923001234567@s.whatsapp.net',
                quotedMessage: { imageMessage: { url: 'u', mimetype: 'image/png' } }
            }
        }
    }
};

// ── trigger ──────────────────────────────────────────────────────────────────
test('trigger: keyword + image fires', () => {
    const { quiz } = world({ fetchImpl: okFetch() });
    assert.equal(quiz.trigger(imageMsg('solve this quiz'), true), true);
});

test('trigger: keyword alone, or image alone, does not fire', () => {
    const { quiz } = world({ fetchImpl: okFetch() });
    assert.equal(quiz.trigger(textOnly, true), false);
    assert.equal(quiz.trigger(imageNoKeyword, true), false);
});

test('trigger: replying "quiz" to an earlier screenshot fires', () => {
    const { quiz } = world({ fetchImpl: okFetch() });
    assert.equal(quiz.trigger(quotedImage, true), true);
});

test('trigger: private chats are refused when ALLOW_PRIVATE=false', () => {
    const { quiz } = world({ fetchImpl: okFetch(), env: { ALLOW_PRIVATE: 'false' } });
    assert.equal(quiz.trigger(imageMsg(), false), false);
    assert.equal(quiz.trigger(imageMsg(), true), true);
});

// ── happy path ───────────────────────────────────────────────────────────────
test('solve: sends every question as question → reason → answer, in order', async () => {
    const { quiz, sent } = world({ fetchImpl: okFetch() });
    const res = await quiz.solve(imageMsg(), { isGroup: true, chatName: 'Test Group' });

    assert.equal(res.ok, true);
    assert.equal(res.questions, 2);
    assert.equal(res.provider, 'gemini');

    const answerMsg = sent.find((s) => s.content.text?.includes('Quiz solved'));
    assert.ok(answerMsg, 'an answer message must be sent');

    const body = answerMsg.content.text;
    assert.match(body, /\*Q1\.\* Capital of Pakistan\?/);
    assert.match(body, /💡 Islamabad became the capital in the 1960s\./);
    assert.match(body, /✅ \*B — Islamabad\*/);
    assert.match(body, /━━ \*Answer key\* ━━/);

    // strict ordering: reason and answer of Q1 come before Q2 starts
    assert.ok(body.indexOf('*Q1.*') < body.indexOf('💡 Islamabad'));
    assert.ok(body.indexOf('💡 Islamabad') < body.indexOf('✅ *B — Islamabad*'));
    assert.ok(body.indexOf('✅ *B — Islamabad*') < body.indexOf('*Q2.*'));
    assert.ok(body.indexOf('*Q2.*') < body.indexOf('💡 The Pacific'));
    assert.ok(body.indexOf('💡 The Pacific') < body.indexOf('✅ *C — Pacific*'));
});

test('solve: reacts 👀 while working and ✅ when done', async () => {
    const { quiz, sent } = world({ fetchImpl: okFetch() });
    await quiz.solve(imageMsg(), { isGroup: true });

    const reactions = sent.filter((s) => s.content.react).map((s) => s.content.react.text);
    assert.deepEqual(reactions, ['👀', '✅']);
    // and it never sends a "solving…" text bubble in react mode
    assert.equal(sent.filter((s) => s.content.text?.includes('Solving')).length, 0);
});

test('solve: ACK_MODE=text skips reactions entirely', async () => {
    const { quiz, sent } = world({ fetchImpl: okFetch(), env: { ACK_MODE: 'none' } });
    await quiz.solve(imageMsg(), { isGroup: true });
    assert.equal(sent.filter((s) => s.content.react).length, 0);
});

test('solve: the image reaches the API as base64 inline data', async () => {
    let seen = null;
    const fetchImpl = async (url, init) => {
        seen = JSON.parse(init.body);
        return { status: 200, text: async () => JSON.stringify({ candidates: [{ content: { parts: [{ text: ANSWER_JSON }] } }] }) };
    };
    const { quiz } = world({ fetchImpl, downloadImpl: async () => Buffer.from('hello') });
    await quiz.solve(imageMsg(), { isGroup: true });

    assert.equal(seen.contents[0].parts[0].inline_data.data, Buffer.from('hello').toString('base64'));
});

test('solve: downloads the quoted image when the trigger message only replies to it', async () => {
    let downloaded = null;
    const { quiz } = world({
        fetchImpl   : okFetch(),
        downloadImpl: async (m) => { downloaded = m; return Buffer.from('x'); }
    });
    await quiz.solve(quotedImage, { isGroup: true });
    assert.equal(downloaded.key.id, 'Q1');
    assert.ok(downloaded.message.imageMessage);
});

// ── failure paths ────────────────────────────────────────────────────────────
test('solve: rate limit sends one short notice and calls no API', async () => {
    const { quiz, sent, limiter } = world({ fetchImpl: okFetch(), env: { RATE_PER_MINUTE: '1' } });
    await quiz.solve(imageMsg(), { isGroup: true });          // uses the only slot
    sent.length = 0;

    const res = await quiz.solve({ ...imageMsg(), key: { ...imageMsg().key, id: 'M2' } }, { isGroup: true });
    assert.equal(res.ok, false);
    assert.match(sent[0].content.text, /Per-minute cap reached/);
    assert.equal(sent.length, 1);
    assert.ok(limiter.stats().minute >= 1);
});

test('solve: a second trigger in the same chat is ignored while one is running', async () => {
    let release;
    const gate = new Promise((r) => { release = r; });   // resolved by hand at the end
    const slowFetch = async () => gate;
    const { quiz, sent } = world({ fetchImpl: slowFetch });

    const first = quiz.solve(imageMsg(), { isGroup: true });
    const second = await quiz.solve({ ...imageMsg(), key: { ...imageMsg().key, id: 'M2' } }, { isGroup: true });

    assert.deepEqual(second, { ok: false, busy: true, error: null });
    assert.equal(sent.filter((s) => s.content.text).length, 0, 'the busy path sends nothing');

    release({ status: 200, text: async () => JSON.stringify({ candidates: [{ content: { parts: [{ text: ANSWER_JSON }] } }] }) });
    await first;
});

test('solve: download failure tells the user instead of going silent', async () => {
    const { quiz, sent } = world({ fetchImpl: okFetch(), downloadImpl: async () => { throw new Error('media expired'); } });
    const res = await quiz.solve(imageMsg(), { isGroup: true });
    assert.equal(res.ok, false);
    assert.match(sent.find((s) => s.content.text).content.text, /Could not download/);
});

test('solve: no image found is explained', async () => {
    const { quiz, sent } = world({ fetchImpl: okFetch(), downloadImpl: async () => null });
    const res = await quiz.solve(imageMsg(), { isGroup: true });
    assert.equal(res.ok, false);
    assert.match(sent.find((s) => s.content.text).content.text, /No readable image/);
});

test('solve: every provider failing produces an actionable message', async () => {
    const { quiz, sent } = world({ fetchImpl: async () => ({ status: 401, text: async () => '{"error":{"message":"invalid key"}}' }) });
    const res = await quiz.solve(imageMsg(), { isGroup: true });
    assert.equal(res.ok, false);
    assert.match(sent.find((s) => s.content.text).content.text, /API key rejected/);
    // failed run shows ❌, not ✅
    assert.deepEqual(sent.filter((s) => s.content.react).map((s) => s.content.react.text), ['👀', '❌']);
});

test('solve: an answer that is not JSON is still delivered verbatim', async () => {
    const { quiz, sent } = world({ fetchImpl: okFetch('The capital of Pakistan is Islamabad.') });
    const res = await quiz.solve(imageMsg(), { isGroup: true });
    assert.equal(res.ok, true);
    assert.equal(res.unparsed, true);
    assert.match(sent.find((s) => s.content.text).content.text, /The capital of Pakistan is Islamabad\./);
});

test('solve: a huge answer is split into several messages', async () => {
    const many = {
        questions: Array.from({ length: 60 }, (_, i) => ({
            n: i + 1,
            question: `Question number ${i + 1} with some reasonably long text to fill the message body up`,
            reason  : `Reason for question ${i + 1} explaining the answer briefly`,
            answer  : `${String.fromCharCode(65 + (i % 4))} — Option text for answer ${i + 1}`
        })),
        unreadable: []
    };
    const { quiz, sent } = world({ fetchImpl: okFetch(JSON.stringify(many)) });
    const res = await quiz.solve(imageMsg(), { isGroup: true });

    assert.equal(res.ok, true);
    const texts = sent.filter((s) => s.content.text).map((s) => s.content.text);
    assert.ok(texts.length > 1, `expected chunking, got ${texts.length}`);
    for (const t of texts) assert.ok(t.length <= 4096, `chunk too long: ${t.length}`);

    // every single answer must survive the split
    const joined = texts.join('\n');
    assert.match(joined, /━━ \*Answer key\* ━━/);
    for (let i = 1; i <= 60; i++) {
        assert.ok(joined.includes(`${i}) `), `answer ${i} was lost while chunking`);
    }
    // each chunk is labelled with its position so the reader knows it continues
    assert.match(texts[0], /\(1\/\d+\)_?$/);
});
