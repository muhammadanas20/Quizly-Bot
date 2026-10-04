/**
 * The extended question banks and the per-chat "already seen" memory.
 *
 * The original subjects keep their own files: test/dsmath.test.js recomputes
 * the 54 curated discrete-maths cards and test/presentation.test.js the 30
 * curated DS cards. This file covers the bulk layer added on top —
 *
 *   src/dsa-questions.js    the extended data-structures bank
 *   src/coal-questions.js   the extended COAL/8086 bank
 *   src/dsmath-extra.js     the extended discrete-maths bank
 *
 * — and, crucially, the cheap per-chat memory that stops a chat of 400
 * questions from seeing the same one twice.
 *
 * Where a card states a number, this file recomputes it from scratch with its
 * own arithmetic (an 8086 trace, dice enumeration, binomials, heap index
 * formulas) so a wrong answer in the bank cannot pass just because the bank
 * says so.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { DSA_QUESTIONS } from '../src/dsa-questions.js';
import { COAL_QUESTIONS } from '../src/coal-questions.js';
import { DSMATH_EXTRA } from '../src/dsmath-extra.js';
import { MATH_BANK, CODE_BANK, DSMATH_BANK, DSMATH_TOPICS, conceptPool, textKey, BANK_SIZES } from '../src/banks.js';
import { createGameEngine, looseMatches } from '../src/games.js';
import { createScoreStore } from '../src/scores.js';
import { loadConfig } from '../src/config.js';
import log from '../src/log.js';

const ALL = [...DSA_QUESTIONS, ...COAL_QUESTIONS, ...DSMATH_EXTRA];

// ─── shape of every card ─────────────────────────────────────────────────────
test('every extended card is chat-shaped, unique and answers itself', () => {
    assert.ok(ALL.length >= 900, `the bulk layer should be big (${ALL.length} cards)`);
    const texts = ALL.map((e) => e.q.toLowerCase());
    assert.equal(new Set(texts).size, texts.length, 'no question is asked twice');
    for (const [bank, topic] of [[DSA_QUESTIONS, 'ds'], [COAL_QUESTIONS, 'coal']]) {
        for (const q of bank) {
            assert.equal(q.topic, topic, q.q);
            assert.ok(typeof q.sub === 'string' && q.sub.length, `${q.q}: a sub-topic tag`);
        }
    }
    for (const q of DSMATH_EXTRA) assert.ok(DSMATH_TOPICS.includes(q.topic), q.q);

    for (const q of ALL) {
        assert.ok(q.q.length >= 10 && q.q.length <= 300, q.q);
        assert.ok(['easy', 'hard'].includes(q.level), q.q);
        assert.ok(Array.isArray(q.a) && q.a.length >= 1 && q.a.length <= 4, `${q.q}: 1-4 accepted spellings`);
        for (const a of q.a) {
            assert.ok(typeof a === 'string' && a === a.trim() && a.length && a.length <= 60, `${q.q}: ${a}`);
            assert.ok(looseMatches(a, q.a), `${q.q}: ${a} does not match itself`);
        }
        assert.ok(!looseMatches('deliberately incorrect answer', q.a), q.q);
        assert.ok(!/undefined|NaN/.test(JSON.stringify(q)), q.q);
    }
});

test('no extended card collides with a card another subject already asks', () => {
    // (the DSA cards ARE part of CODE_BANK, so it is the other subjects the
    // comparison has to exclude — not the ds topic.)
    const foreign = new Set([...MATH_BANK, ...CODE_BANK.filter((e) => e.topic !== 'ds')].map((e) => e.q.toLowerCase()));
    for (const q of DSA_QUESTIONS) assert.ok(!foreign.has(q.q.toLowerCase()), q.q);
    // DSMATH_EXTRA joins DSMATH_BANK, which must not duplicate another subject
    const other = new Set([...MATH_BANK, ...CODE_BANK].map((e) => e.q.toLowerCase()));
    for (const q of DSMATH_EXTRA) assert.ok(!other.has(q.q.toLowerCase()), `duplicate of another subject: ${q.q}`);
    const seen = new Set();
    for (const q of [...DSMATH_BANK]) {
        const key = q.q.toLowerCase();
        assert.ok(!seen.has(key), `duplicate inside the discrete-maths bank: ${q.q}`);
        seen.add(key);
    }
});

// ─── the numbers are real ────────────────────────────────────────────────────
const pick = (bank, fragment) => {
    const [card] = bank.filter((q) => q.q.includes(fragment));
    assert.ok(card, `no card contains “${fragment}”`);
    return card;
};
const accepts = (card, value) => assert.ok(looseMatches(String(value), card.a), `${card.q}\n  should accept ${value}, accepts [${card.a}]`);

const u16 = (v) => ((v % 65536) + 65536) % 65536;
const h4 = (v) => u16(v).toString(16).toUpperCase().padStart(4, '0') + 'h';
const h2 = (v) => (((v % 256) + 256) % 256).toString(16).toUpperCase().padStart(2, '0') + 'h';

test('the 8086 trace cards agree with an independently traced core', () => {
    accepts(pick(COAL_QUESTIONS, 'MOV AX, 1234h runs, then ADD AX, 0009h'), h4(0x1234 + 0x0009));
    accepts(pick(COAL_QUESTIONS, 'MOV AX, 7FFFh runs, then ADD AX, 0001h'), h4(0x7fff + 1));
    accepts(pick(COAL_QUESTIONS, 'MOV AX, 5000h runs, then SUB AX, 0001h'), h4(0x5000 - 1));
    accepts(pick(COAL_QUESTIONS, 'MOV AX, FF00h runs, then SAR AX, 0004h'), h4((0xff00 << 16 >> 16) >> 4));
    accepts(pick(COAL_QUESTIONS, 'MOV AX, 8000h runs, then SAR AX, 0003h'), h4((0x8000 << 16 >> 16) >> 3));
    accepts(pick(COAL_QUESTIONS, 'MOV AX, 0001h runs, then SHL AX, 0004h'), h4(1 << 4));
    accepts(pick(COAL_QUESTIONS, 'MOV AX, FFFFh runs, then XOR AX, 00FFh'), h4(0xffff ^ 0x00ff));
    accepts(pick(COAL_QUESTIONS, 'The carry flag is already set. MOV AX, 00FFh runs, then ADC AX, 0001h'), h4(0x00ff + 1 + 1));
    accepts(pick(COAL_QUESTIONS, 'MOV AL, 12h runs, then MUL BL with BL = 34h'), h4(0x12 * 0x34));
    accepts(pick(COAL_QUESTIONS, 'MOV AL, 0FFh runs, then MUL BL with BL = 02h'), h4(0xff * 2));
    accepts(pick(COAL_QUESTIONS, 'MOV BL, 04h, then DIV BL. What is AL'), h2(Math.floor(0x1a / 4)));
    accepts(pick(COAL_QUESTIONS, 'MOV BL, 04h, then DIV BL. What is AH'), h2(0x1a % 4));
    accepts(pick(COAL_QUESTIONS, 'MOV AX, 000Fh runs, then NOT AX'), h4(~0x000f));
    accepts(pick(COAL_QUESTIONS, 'MOV AX, 8001h runs, then ROR AX, 1'), h4((0x8001 >>> 1) | (0x8001 << 15)));
    // physical address = segment × 16 + offset, computed here from scratch
    accepts(pick(COAL_QUESTIONS, 'segment 2000h, offset 0010h'), ((0x2000 * 16 + 0x10).toString(16).toUpperCase().padStart(5, '0')) + 'h');
    accepts(pick(COAL_QUESTIONS, 'segment 1234h, offset 0001h'), ((0x1234 * 16 + 1).toString(16).toUpperCase().padStart(5, '0')) + 'h');
    accepts(pick(COAL_QUESTIONS, 'How many bytes are in a full 8086 segment?'), 65536);
    accepts(pick(COAL_QUESTIONS, 'MOVSW runs once with DI=0200h and DF=1'), '01FEh');
});

test('the data-structure cards agree with answers recomputed from their own inputs', () => {
    accepts(pick(DSA_QUESTIONS, '4-byte items starts at address 1000'), 1000 + 7 * 4);
    accepts(pick(DSA_QUESTIONS, '2-byte items starts at address 2000'), 2000 + 13 * 2);
    accepts(pick(DSA_QUESTIONS, '8-byte items starts at address 4096'), 4096 + 5 * 8);
    accepts(pick(DSA_QUESTIONS, 'flat index of element [3][4]'), 3 * 6 + 4);
    accepts(pick(DSA_QUESTIONS, 'subarrays does an array of 10 items'), (10 * 11) / 2);
    accepts(pick(DSA_QUESTIONS, 'log₂(1024)'), Math.log2(1024));
    accepts(pick(DSA_QUESTIONS, 'reversing an array of 9 items'), Math.floor(9 / 2));
    accepts(pick(DSA_QUESTIONS, 'parent index of the node at index 18'), Math.floor((18 - 1) / 2));
    accepts(pick(DSA_QUESTIONS, 'left child index of the node at index 6'), 2 * 6 + 1);
    accepts(pick(DSA_QUESTIONS, 'A binary heap holds 21 nodes'), Math.ceil(21 / 2));
    accepts(pick(DSA_QUESTIONS, 'selection sort make over 10 items'), (10 * 9) / 2);
    accepts(pick(DSA_QUESTIONS, 'selection sort make over 25 items'), (25 * 24) / 2);
    accepts(pick(DSA_QUESTIONS, 'Merge sort halves 32 items'), 5);
    accepts(pick(DSA_QUESTIONS, 'Tower of Hanoi need for 5 disks'), 2 ** 5 - 1);
    accepts(pick(DSA_QUESTIONS, 'maximum number of nodes in a binary tree of height 4'), 2 ** 5 - 1);
    accepts(pick(DSA_QUESTIONS, 'complete graph K10'), 45);
    accepts(pick(DSA_QUESTIONS, 'sum of the degrees of a graph with 12 edges'), 24);
    accepts(pick(DSA_QUESTIONS, 'connected graph on 9 vertices is a tree'), 8);
    accepts(pick(DSA_QUESTIONS, 'Bellman–Ford need for a graph with 6 vertices'), 5);
    accepts(pick(DSA_QUESTIONS, 'simple directed graph on 5 vertices'), 20);
    // worst-case probes for binary search, counted by this file's own loop
    const steps = (n) => { let lo = 0, hi = n - 1, k = 0; while (lo <= hi) { k++; const mid = (lo + hi) >> 1; lo = mid + 1; } return k; };
    accepts(pick(DSA_QUESTIONS, 'binary search make over 16 sorted items'), steps(16));
    accepts(pick(DSA_QUESTIONS, 'binary search make over 100 sorted items'), steps(100));
});

test('the discrete-maths cards agree with answers recomputed from their own inputs', () => {
    const gcd = (a, b) => (b ? gcd(b, a % b) : a);
    const phi = (n) => Array.from({ length: n }, (_, i) => i + 1).filter((k) => gcd(k, n) === 1).length;
    const fact = (n) => (n <= 1 ? 1 : n * fact(n - 1));
    const binom = (n, r) => fact(n) / (fact(r) * fact(n - r));
    const die = [1, 2, 3, 4, 5, 6];
    const dice = die.flatMap((a) => die.map((b) => [a, b]));

    accepts(pick(DSMATH_EXTRA, 'What is φ(20)'), phi(20));
    accepts(pick(DSMATH_EXTRA, 'What is φ(12)'), phi(12));
    accepts(pick(DSMATH_EXTRA, 'What is gcd(12, 30)'), gcd(12, 30));
    accepts(pick(DSMATH_EXTRA, 'What is lcm(12, 18)'), (12 * 18) / gcd(12, 18));
    accepts(pick(DSMATH_EXTRA, 'What is 3⁵ mod 7'), (3 ** 5) % 7);
    accepts(pick(DSMATH_EXTRA, 'What is 2^10 mod 11'), (2 ** 10) % 11);
    accepts(pick(DSMATH_EXTRA, 'What is 7!?'), fact(7));
    accepts(pick(DSMATH_EXTRA, 'How many 5-card hands'), binom(52, 5));
    accepts(pick(DSMATH_EXTRA, 'How many subsets does a set with 7 elements have'), 2 ** 7);
    accepts(pick(DSMATH_EXTRA, 'How many relations are there on a set with 4 elements'), 2 ** 16);
    accepts(pick(DSMATH_EXTRA, 'How many bijections are there from a 6-element set'), fact(6));
    accepts(pick(DSMATH_EXTRA, 'sum of the first 15 positive integers'), (15 * 16) / 2);
    accepts(pick(DSMATH_EXTRA, 'sum 1² + 2² + … + 12²'), (12 * 13 * 25) / 6);
    accepts(pick(DSMATH_EXTRA, 'What is F10 with F1 = F2 = 1'), 55);
    accepts(pick(DSMATH_EXTRA, 'Kn is the complete graph on 10 vertices'), binom(10, 2));
    accepts(pick(DSMATH_EXTRA, 'sum of 1/3 + 1/9 + 1/27'), 1 / 2);
    // probabilities enumerated here, not remembered
    accepts(pick(DSMATH_EXTRA, 'sum of 7 with two dice'), dice.filter(([a, b]) => a + b === 7).length / dice.length);
    accepts(pick(DSMATH_EXTRA, 'sum of 12 with two dice'), dice.filter(([a, b]) => a + b === 12).length / dice.length);
    accepts(pick(DSMATH_EXTRA, 'rolling a double with two dice'), dice.filter(([a, b]) => a === b).length / dice.length);
    accepts(pick(DSMATH_EXTRA, 'exactly two heads in three fair coin tosses'), 3 / 8);
    accepts(pick(DSMATH_EXTRA, 'card drawn from 52 is a face card'), 12 / 52);
});

// ─── the pools the games actually draw from ──────────────────────────────────
test('the lazy pool index answers exactly what a full bank filter would', () => {
    for (const [kind, bank] of [['math', MATH_BANK], ['code', CODE_BANK], ['dsmath', DSMATH_BANK]]) {
        const topics = [null, ...new Set(bank.map((e) => e.topic))];
        for (const level of ['easy', 'hard', 'all']) {
            for (const topic of topics) {
                const expected = bank.filter((e) => (level === 'all' || e.level === level) && (!topic || e.topic === topic));
                assert.deepEqual(conceptPool(kind, level, topic), expected, `${kind}/${level}/${topic}`);
            }
        }
    }
    assert.deepEqual(BANK_SIZES, { math: MATH_BANK.length, code: CODE_BANK.length, dsmath: DSMATH_BANK.length });
    assert.ok(BANK_SIZES.code >= 600 && BANK_SIZES.dsmath >= 400, JSON.stringify(BANK_SIZES));
    // the hash is stable and separates neighbouring texts
    assert.equal(textKey('same text'), textKey('same text'));
    assert.notEqual(textKey('same text'), textKey('same text.'));
});

// ─── "huge random gap": the per-chat memory ──────────────────────────────────
const GROUP = '120363000000000000@g.us';
const PN = '923001234567';

let msgId = 0;
const ctx = (text, jid = GROUP) => ({
    jid, isGroup: true, text, isOwner: false, chatName: 'Test Group',
    senderIds: new Set([PN]), senderLabel: `${PN}@s.whatsapp.net`, expandIds: undefined,
    groups: { nameOf: async () => 'Ali' },
    msg: { key: { remoteJid: jid, participant: `${PN}@s.whatsapp.net`, fromMe: false, id: `B${++msgId}` }, pushName: 'Ali' }
});

function world({ random = Math.random, env = {} } = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'banks-'));
    const config = loadConfig({ GEMINI_API_KEY: 'k', OWNER_NUMBERS: PN, ...env });
    const scores = createScoreStore({ file: path.join(dir, 'scores.json'), log }).load();
    let clock = 1_000_000;
    const games = createGameEngine({
        config, log, scores, groups: { nameOf: async () => '' },
        content: null, random, now: () => clock, autoSweep: false
    });
    return { games, tick: (ms) => { clock += ms; } };
}

/** Play `rounds` rounds of one concept game in one chat, returning the cards. */
async function play(games, tick, rounds, command, jid = GROUP) {
    const cards = [];
    const args = command.split(' ').slice(1);           // the engine gets args after "!game"
    for (let i = 0; i < rounds; i++) {
        await games.handle(ctx(command, jid), args);
        const round = games.active(jid);
        assert.ok(round, `${command} did not start a round`);
        cards.push(round.pool);
        await games.guess(ctx(`!guess ${round.accepted[0]}`, jid), [round.accepted[0]]);
        tick(20_000);                                   // clear the between-round cooldown
    }
    return cards;
}

test('a chat can play dozens of rounds without ever seeing a card twice', async () => {
    const { games, tick } = world({ random: () => 0.5 });
    const cards = await play(games, tick, 30, '!game code easy coal');
    assert.equal(cards.length, 30);
    assert.equal(new Set(cards.map((c) => c.q)).size, 30, 'no repeat in 30 rounds');
    assert.ok(cards.every((c) => c.topic === 'coal' && c.level === 'easy'), 'the command still filters');
});

test('the memory keeps working past the old single-question limit', async () => {
    const { games, tick } = world({ random: () => 0.5 });
    const cards = await play(games, tick, 20, '!game dsmath hard counting');
    assert.equal(new Set(cards.map((c) => c.q)).size, 20);
});

test('GAME_REPEAT_MEMORY sizes the gap, and a day of silence forgets', async () => {
    // With room for only five cards, the sixth draw has to rewind the memory —
    // which is exactly what the sweep does for a chat that has gone quiet.
    const { games, tick } = world({ random: () => 0.5, env: { GAME_REPEAT_MEMORY: '5' } });
    const cards = await play(games, tick, 8, '!game code hard ds');
    const firstSix = cards.slice(0, 6).map((c) => c.q);
    assert.equal(new Set(firstSix).size, 6, 'the first six are all different');
    assert.ok(cards.slice(6).every((c) => firstSix.includes(c.q)), 'a rewound memory can serve old cards again');

    tick(25 * 60 * 60 * 1000);                          // a full day of silence
    const swept = await games.sweep();
    assert.ok(Array.isArray(swept), 'the sweep ran');
    const after = await play(games, tick, 1, '!game code hard ds');
    assert.equal(after[0].q, cards[0].q, 'with the memory gone, the draw starts over');
});

test('the memory is per chat: another group starts with a clean slate', async () => {
    const { games, tick } = world({ random: () => 0.5 });
    const [here] = await play(games, tick, 1, '!game dsmath hard graphs');
    const [there] = await play(games, tick, 1, '!game dsmath hard graphs', '120363000000000009@g.us');
    assert.equal(there.q, here.q, 'a different chat is not bound by this chat’s memory');
    const [again] = await play(games, tick, 1, '!game dsmath hard graphs');
    assert.notEqual(again.q, here.q, 'the same chat still is');
});
