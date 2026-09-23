import test from 'node:test';
import assert from 'node:assert/strict';

import { parseQuizResult, renderQuiz, chunkText } from '../src/format.js';

const sample = {
    questions: [
        { n: 1, question: 'Capital of France?', reason: 'Paris has been the seat of government since 987.', answer: 'A — Paris' },
        { n: 2, question: '2 + 2 = ?',           reason: 'Basic addition.',                                answer: 'C — 4' }
    ],
    unreadable: []
};

test('parseQuizResult: clean JSON', () => {
    const r = parseQuizResult(JSON.stringify(sample));
    assert.equal(r.parsed, true);
    assert.equal(r.questions.length, 2);
    assert.equal(r.questions[0].answer, 'A — Paris');
});

test('parseQuizResult: JSON wrapped in a markdown fence', () => {
    const r = parseQuizResult('```json\n' + JSON.stringify(sample) + '\n```');
    assert.equal(r.parsed, true);
    assert.equal(r.questions.length, 2);
});

test('parseQuizResult: prose before and after the JSON', () => {
    const r = parseQuizResult(`Sure! Here you go:\n${JSON.stringify(sample)}\nHope that helps!`);
    assert.equal(r.parsed, true);
    assert.equal(r.questions.length, 2);
});

test('parseQuizResult: alternative field names', () => {
    const r = parseQuizResult(JSON.stringify({
        answers: [{ n: 1, q: 'Largest planet?', why: 'Jupiter is the biggest.', a: 'D — Jupiter' }]
    }));
    assert.equal(r.parsed, true);
    assert.equal(r.questions[0].question, 'Largest planet?');
    assert.equal(r.questions[0].reason, 'Jupiter is the biggest.');
    assert.equal(r.questions[0].answer, 'D — Jupiter');
});

test('parseQuizResult: flat array of strings still yields answers', () => {
    const r = parseQuizResult(JSON.stringify({ questions: ['A — Paris', 'C — 4'] }));
    assert.equal(r.questions.length, 2);
    assert.equal(r.questions[1].answer, 'C — 4');
});

test('parseQuizResult: numbering falls back to position when n is missing', () => {
    const r = parseQuizResult(JSON.stringify({ questions: [{ question: 'q1', answer: 'a' }, { question: 'q2', answer: 'b' }] }));
    assert.deepEqual(r.questions.map((q) => q.n), [1, 2]);
});

test('parseQuizResult: salvages numbered prose when JSON parsing fails', () => {
    const r = parseQuizResult('1. Capital of France? answer: Paris\n2. 2+2? answer: 4');
    assert.equal(r.parsed, true);
    assert.equal(r.questions.length, 2);
    assert.equal(r.questions[0].answer, 'Paris');
});

test('parseQuizResult: gives up cleanly on garbage (caller sends raw text)', () => {
    const r = parseQuizResult('I cannot see an image.');
    assert.equal(r.parsed, false);
    assert.equal(r.questions.length, 0);
    assert.equal(r.raw, 'I cannot see an image.');
});

test('renderQuiz: question → one-line reason → answer, in order', () => {
    const out = renderQuiz({ ...sample, provider: 'gemini', model: 'gemini-2.5-flash', ms: 3400 });

    const lines = out.split('\n');
    assert.match(lines[0], /^\*Quiz solved\* · 2 questions$/);

    // exact per-question layout
    assert.equal(lines[2], '*Q1.* Capital of France?');
    assert.equal(lines[3], '💡 Paris has been the seat of government since 987.');
    assert.equal(lines[4], '✅ *A — Paris*');

    // ordering: Q1 block must appear before Q2 block
    assert.ok(out.indexOf('*Q1.*') < out.indexOf('*Q2.*'));
    assert.ok(out.indexOf('💡 Basic addition.') > out.indexOf('*Q2.* 2 + 2 = ?'));
    assert.ok(out.indexOf('✅ *C — 4*') > out.indexOf('💡 Basic addition.'));

    // answer key at the end
    assert.match(out, /━━ \*Answer key\* ━━/);
    assert.match(out, /1\) A — Paris/);
    assert.match(out, /2\) C — 4/);
    assert.match(out, /gemini · gemini-2\.5-flash · 3\.4s/);
});

test('renderQuiz: reports unreadable questions and never guesses them', () => {
    const out = renderQuiz({ questions: sample.questions, unreadable: ['3 — blurred'] });
    assert.match(out, /⚠️ \*Could not read:\* 3 — blurred/);
});

test('renderQuiz: missing reason is skipped, missing answer is flagged', () => {
    const out = renderQuiz({ questions: [{ n: 1, question: 'q', reason: '', answer: '' }] });
    assert.ok(!out.includes('💡'));
    assert.match(out, /✅ \*— could not determine —\*/);
});

test('renderQuiz: null when there is nothing to send', () => {
    assert.equal(renderQuiz({ questions: [] }), null);
});

test('chunkText: short text is one message', () => {
    assert.deepEqual(chunkText('hello'), ['hello']);
});

test('chunkText: splits on blank lines and never mid-question', () => {
    const blocks = Array.from({ length: 40 }, (_, i) => `*Q${i + 1}.* question text here\n💡 reason\n✅ *answer*`);
    const text = `*Quiz solved*\n\n${blocks.join('\n\n')}`;
    const chunks = chunkText(text, 900);

    assert.ok(chunks.length > 1, 'expected multiple chunks');
    for (const c of chunks) assert.ok(c.length <= 900 + 20, `chunk too long: ${c.length}`);
    // a question block must never be torn in half
    for (const c of chunks) {
        const q = (c.match(/^\*Q\d+\.\*/gm) || []).length;
        const a = (c.match(/^✅/gm) || []).length;
        assert.equal(q, a, 'question/answer count mismatch inside a chunk');
    }
});

test('chunkText: hard-splits a single oversized block instead of looping forever', () => {
    const huge = 'x'.repeat(5000);
    const chunks = chunkText(huge, 1000);
    assert.ok(chunks.length >= 5);
    assert.ok(chunks.every((c) => c.length <= 1100));
});
