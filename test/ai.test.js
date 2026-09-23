import test from 'node:test';
import assert from 'node:assert/strict';

import { callGemini, buildGeminiBody } from '../src/ai/gemini.js';
import { callOpenAICompat, buildChatBody } from '../src/ai/openaiCompat.js';
import { solveQuiz, summarise } from '../src/ai/solve.js';
import { AiError, classifyStatus, hasPath, withoutPath } from '../src/ai/http.js';
import { loadConfig } from '../src/config.js';

const IMAGE = { mimeType: 'image/jpeg', data: 'AAAA' };

/** Mock fetch: records every request, replays canned responses in order. */
function mockFetch(responses) {
    const calls = [];
    const impl = async (url, init) => {
        calls.push({ url, headers: init.headers, body: JSON.parse(init.body) });
        const next = responses[Math.min(calls.length - 1, responses.length - 1)];
        if (typeof next === 'function') return next(calls.length - 1);
        if (next?.throw) throw next.throw;
        return { status: next.status ?? 200, text: async () => JSON.stringify(next.json ?? {}) };
    };
    impl.calls = calls;
    return impl;
}

const geminiOk = (text) => ({ status: 200, json: { candidates: [{ content: { parts: [{ text }] } }] } });
const openaiOk = (text) => ({ status: 200, json: { choices: [{ message: { content: text } }] } });

// ── request shape ────────────────────────────────────────────────────────────
test('gemini: request carries the image inline and asks for JSON', () => {
    const body = buildGeminiBody({ model: 'gemini-2.5-flash', image: IMAGE, prompt: 'P', maxTokens: 1200, thinkingBudget: 0 });
    assert.equal(body.contents[0].parts[0].inline_data.mime_type, 'image/jpeg');
    assert.equal(body.contents[0].parts[0].inline_data.data, 'AAAA');
    assert.equal(body.contents[0].parts[1].text, 'P');
    assert.equal(body.generationConfig.responseMimeType, 'application/json');
    assert.equal(body.generationConfig.responseSchema.type, 'object');
    assert.deepEqual(body.generationConfig.thinkingConfig, { thinkingBudget: 0 });
});

test('gemini: thinkingConfig is NOT sent to non-2.5 models (it would 400)', () => {
    const body = buildGeminiBody({ model: 'gemini-3-flash-preview', image: IMAGE, prompt: 'P', maxTokens: 1200, thinkingBudget: 0 });
    assert.equal(body.generationConfig.thinkingConfig, undefined);
});

test('gemini: sends the api key as a header, not in the URL', async () => {
    const f = mockFetch([geminiOk('{"questions":[]}')]);
    await callGemini({ apiKey: 'K', model: 'gemini-2.5-flash', image: IMAGE, prompt: 'P', timeoutMs: 1000, maxTokens: 100, fetchImpl: f });
    assert.equal(f.calls[0].headers['x-goog-api-key'], 'K');
    assert.ok(!f.calls[0].url.includes('key='));
    assert.ok(f.calls[0].url.includes('gemini-2.5-flash:generateContent'));
});

test('gemini: concatenates multi-part responses', async () => {
    const f = mockFetch([{ status: 200, json: { candidates: [{ content: { parts: [{ text: '{"quest' }, { text: 'ions":[]}' }] } }] } }]);
    const out = await callGemini({ apiKey: 'K', model: 'gemini-2.5-flash', image: IMAGE, prompt: 'P', timeoutMs: 1000, maxTokens: 100, fetchImpl: f });
    assert.equal(out.text, '{"questions":[]}');
});

test('openaiCompat: sends a base64 data URL in OpenAI image_url format', () => {
    const body = buildChatBody({ model: 'grok-4.5', image: IMAGE, prompt: 'P', maxTokens: 1200, extras: { reasoning_effort: 'low' } });
    assert.equal(body.messages[0].content[1].type, 'image_url');
    assert.equal(body.messages[0].content[1].image_url.url, 'data:image/jpeg;base64,AAAA');
    assert.equal(body.response_format.type, 'json_object');
    assert.equal(body.reasoning_effort, 'low');
});

test('openaiCompat: hits the right endpoint per provider', async () => {
    const grok = mockFetch([openaiOk('{}')]);
    await callOpenAICompat({ name: 'grok', apiKey: 'K', model: 'grok-4.5', image: IMAGE, prompt: 'P', timeoutMs: 1000, maxTokens: 100, fetchImpl: grok });
    assert.equal(grok.calls[0].url, 'https://api.x.ai/v1/chat/completions');
    assert.equal(grok.calls[0].headers.authorization, 'Bearer K');

    const groq = mockFetch([openaiOk('{}')]);
    await callOpenAICompat({ name: 'groq', apiKey: 'K', model: 'm', image: IMAGE, prompt: 'P', timeoutMs: 1000, maxTokens: 100, fetchImpl: groq });
    assert.equal(groq.calls[0].url, 'https://api.groq.com/openai/v1/chat/completions');
});

// ── resilience ───────────────────────────────────────────────────────────────
test('gemini: 400 retries after dropping thinkingConfig, then responseSchema', async () => {
    const f = mockFetch([
        { status: 400, json: { error: { message: 'unknown field thinkingConfig' } } },
        { status: 400, json: { error: { message: 'unknown field responseSchema' } } },
        geminiOk('{"questions":[]}')
    ]);
    const out = await callGemini({ apiKey: 'K', model: 'gemini-2.5-flash', image: IMAGE, prompt: 'P', timeoutMs: 1000, maxTokens: 100, fetchImpl: f });
    assert.equal(f.calls.length, 3);
    assert.equal(out.text, '{"questions":[]}');
    // attempt 1 had both knobs, attempt 2 lost thinkingConfig, attempt 3 lost responseSchema
    assert.deepEqual(f.calls[0].body.generationConfig.thinkingConfig, { thinkingBudget: 0 });
    assert.equal(f.calls[1].body.generationConfig.thinkingConfig, undefined);
    assert.ok(f.calls[1].body.generationConfig.responseSchema);
    assert.equal(f.calls[2].body.generationConfig.responseSchema, undefined);
});

test('openaiCompat: 400 drops reasoning_effort first, then response_format', async () => {
    const f = mockFetch([
        { status: 400, json: { error: { message: 'reasoning_effort unsupported' } } },
        { status: 400, json: { error: { message: 'response_format unsupported' } } },
        openaiOk('{}')
    ]);
    await callOpenAICompat({ name: 'grok', apiKey: 'K', model: 'grok-4.5', image: IMAGE, prompt: 'P', timeoutMs: 1000, maxTokens: 100, extras: { reasoning_effort: 'low' }, fetchImpl: f });
    assert.equal(f.calls.length, 3);
    assert.equal(f.calls[1].body.reasoning_effort, undefined);
    assert.equal(f.calls[2].body.response_format, undefined);
});

test('errors are classified so the fallback chain can act on them', async () => {
    const cases = [
        [{ status: 401, json: { error: { message: 'bad key' } } }, 'auth', false],
        [{ status: 429, json: { error: { message: 'slow down' } } }, 'rate', true],
        [{ status: 404, json: { error: { message: 'model not found' } } }, 'model', false],
        [{ status: 503, json: { error: { message: 'down' } } }, 'server', true]
    ];
    for (const [resp, kind, retryable] of cases) {
        const f = mockFetch([resp]);
        await assert.rejects(
            () => callGemini({ apiKey: 'K', model: 'm', image: IMAGE, prompt: 'P', timeoutMs: 500, maxTokens: 10, fetchImpl: f }),
            (err) => err instanceof AiError && err.kind === kind && err.retryable === retryable
        );
    }
});

test('a timeout surfaces as a retryable timeout error', async () => {
    const f = mockFetch([{ throw: Object.assign(new Error('aborted'), { name: 'AbortError' }) }]);
    await assert.rejects(
        () => callGemini({ apiKey: 'K', model: 'm', image: IMAGE, prompt: 'P', timeoutMs: 10, maxTokens: 10, fetchImpl: f }),
        (err) => err.kind === 'timeout' && err.retryable === true
    );
});

test('gemini: safety-blocked image is reported, not retried', async () => {
    const f = mockFetch([{ status: 200, json: { promptFeedback: { blockReason: 'SAFETY' } } }]);
    await assert.rejects(
        () => callGemini({ apiKey: 'K', model: 'm', image: IMAGE, prompt: 'P', timeoutMs: 500, maxTokens: 10, fetchImpl: f }),
        (err) => err.kind === 'bad_request' && /safety/i.test(err.message)
    );
});

test('empty completion is an error, not a silent success', async () => {
    const f = mockFetch([{ status: 200, json: { candidates: [{ content: { parts: [] }, finishReason: 'MAX_TOKENS' }] } }]);
    await assert.rejects(
        () => callGemini({ apiKey: 'K', model: 'm', image: IMAGE, prompt: 'P', timeoutMs: 500, maxTokens: 10, fetchImpl: f }),
        (err) => /empty response/.test(err.message)
    );
});

test('gemini: MAX_TOKENS is reported so the caller can warn about missing questions', async () => {
    const f = mockFetch([{ status: 200, json: { candidates: [{ content: { parts: [{ text: '{"questions":[' }] }, finishReason: 'MAX_TOKENS' }] } }]);
    const out = await callGemini({ apiKey: 'K', model: 'm', image: IMAGE, prompt: 'P', timeoutMs: 500, maxTokens: 10, fetchImpl: f });
    assert.equal(out.truncated, true);
    assert.equal(out.finishReason, 'MAX_TOKENS');
});

test('gemini: a normal finish is not flagged as truncated', async () => {
    const f = mockFetch([{ status: 200, json: { candidates: [{ content: { parts: [{ text: '{}' }] }, finishReason: 'STOP' }] } }]);
    const out = await callGemini({ apiKey: 'K', model: 'm', image: IMAGE, prompt: 'P', timeoutMs: 500, maxTokens: 10, fetchImpl: f });
    assert.equal(out.truncated, false);
});

test('openaiCompat: finish_reason length is reported as truncated', async () => {
    const f = mockFetch([{ status: 200, json: { choices: [{ message: { content: '{"questions":[' }, finish_reason: 'length' }] } }]);
    const out = await callOpenAICompat({ name: 'groq', apiKey: 'K', model: 'm', image: IMAGE, prompt: 'P', timeoutMs: 500, maxTokens: 10, fetchImpl: f });
    assert.equal(out.truncated, true);

    const ok = mockFetch([{ status: 200, json: { choices: [{ message: { content: '{}' }, finish_reason: 'stop' }] } }]);
    const done = await callOpenAICompat({ name: 'groq', apiKey: 'K', model: 'm', image: IMAGE, prompt: 'P', timeoutMs: 500, maxTokens: 10, fetchImpl: ok });
    assert.equal(done.truncated, false);
});

// ── provider chain ───────────────────────────────────────────────────────────
test('solveQuiz: falls through to the next provider when the first is rate limited', async () => {
    const f = mockFetch([
        { status: 429, json: { error: { message: 'quota' } } },
        openaiOk('{"questions":[{"n":1,"question":"q","reason":"r","answer":"A"}]}')
    ]);
    const config = loadConfig({ GEMINI_API_KEY: 'g', XAI_API_KEY: 'x', AI_ORDER: 'gemini,grok' });
    const out = await solveQuiz({ image: IMAGE, config, fetchImpl: f });

    assert.equal(out.ok, true);
    assert.equal(out.provider, 'grok');
    assert.equal(out.attempts.length, 1);
    assert.equal(out.attempts[0].provider, 'gemini');
});

test('solveQuiz: a retired model id falls through to the configured fallback model', async () => {
    const f = mockFetch([
        { status: 404, json: { error: { message: 'model grok-9 does not exist' } } },
        openaiOk('{"questions":[]}')
    ]);
    const config = loadConfig({ XAI_API_KEY: 'x', AI_ORDER: 'grok', XAI_MODEL: 'grok-9', XAI_MODEL_FALLBACKS: 'grok-4.5' });
    const out = await solveQuiz({ image: IMAGE, config, fetchImpl: f });

    assert.equal(out.ok, true);
    assert.equal(out.model, 'grok-4.5');
});

test('solveQuiz: skips providers with no key instead of calling them', async () => {
    const f = mockFetch([geminiOk('{"questions":[]}')]);
    const config = loadConfig({ GEMINI_API_KEY: 'g', AI_ORDER: 'grok,gemini' });
    const out = await solveQuiz({ image: IMAGE, config, fetchImpl: f });
    assert.equal(out.ok, true);
    assert.equal(f.calls.length, 1);
    assert.ok(f.calls[0].url.includes('generativelanguage'));
});

test('solveQuiz: no keys at all is a clear failure, not a crash', async () => {
    const config = loadConfig({});
    const out = await solveQuiz({ image: IMAGE, config, fetchImpl: mockFetch([]) });
    assert.equal(out.ok, false);
    assert.match(out.summary, /No AI provider is configured/);
});

test('summarise: turns failures into advice', () => {
    assert.match(summarise([{ kind: 'auth', error: 'x' }]), /API key rejected/);
    assert.match(summarise([{ kind: 'rate', error: 'x' }]), /rate limit/i);
    assert.match(summarise([{ kind: 'timeout', error: 'x' }]), /timed out/i);
    assert.match(summarise([{ kind: 'network', error: 'x' }]), /could not reach/);
    assert.match(summarise([{ kind: 'model', error: 'x' }]), /model id was rejected/);
    assert.match(summarise([]), /No AI provider/);
});

test('http helpers: dotted-path drop works on nested config', () => {
    const body = { a: { b: { c: 1, d: 2 } } };
    assert.equal(hasPath(body, 'a.b.c'), true);
    assert.equal(hasPath(body, 'a.b.z'), false);
    assert.deepEqual(withoutPath(body, 'a.b.c'), { a: { b: { d: 2 } } });
    assert.equal(hasPath(body, 'a.b.c'), true, 'original must not be mutated');
});

test('classifyStatus maps every status the chain cares about', () => {
    assert.equal(classifyStatus(401).kind, 'auth');
    assert.equal(classifyStatus(404).kind, 'model');
    assert.equal(classifyStatus(429).kind, 'rate');
    assert.equal(classifyStatus(500).kind, 'server');
    assert.equal(classifyStatus(400).kind, 'bad_request');
});
