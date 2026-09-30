/**
 * The discrete-maths subject: the built-in bank, its answers and its cards.
 *
 * Every numeric answer here is *recomputed* in this file — a small oracle
 * (gcd, binomials, Fibonacci, Euler's formula, sample spaces enumerated from
 * scratch) — so a typo in a question cannot survive just because the game
 * accepts whatever the bank says.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { DSMATH_QUESTIONS } from '../src/dsmath-questions.js';
import { DSMATH_BANK, DSMATH_TOPICS, MATH_BANK, CODE_BANK } from '../src/banks.js';
import { looseMatches } from '../src/games.js';
import { questionText, roundCard } from '../src/presentation.js';
import { contentPrompt, normalizeItems } from '../src/game-content.js';

// ─── the small maths oracle ──────────────────────────────────────────────────
const gcd = (a, b) => (b ? gcd(b, a % b) : a);
const phi = (n) => Array.from({ length: n }, (_, i) => i + 1).filter((k) => gcd(k, n) === 1).length;
const fact = (n) => (n <= 1 ? 1 : n * fact(n - 1));
const binom = (n, r) => Math.round(Array.from({ length: r }, (_, i) => (n - i) / (i + 1)).reduce((x, y) => x * y, 1));
const implies = (p, q) => !p || q;
const rows = [[true, true], [true, false], [false, true], [false, false]];
const die = [1, 2, 3, 4, 5, 6];
const coin = ['H', 'T'];
const tosses = coin.flatMap((a) => coin.map((b) => [a, b]));
const dicePairs = die.flatMap((a) => die.map((b) => [a, b]));

test('the subject ships 54 verified cards: three easy and three hard per topic', () => {
    assert.equal(DSMATH_QUESTIONS.length, 54);
    assert.equal(DSMATH_BANK.length, 54, 'the bank is the whole subject');
    assert.equal(DSMATH_QUESTIONS.filter((q) => q.level === 'easy').length, 27);
    assert.equal(DSMATH_QUESTIONS.filter((q) => q.level === 'hard').length, 27);
    assert.deepEqual([...new Set(DSMATH_QUESTIONS.map((q) => q.topic))], [...DSMATH_TOPICS]);
    for (const topic of DSMATH_TOPICS) {
        for (const level of ['easy', 'hard']) {
            assert.equal(DSMATH_BANK.filter((q) => q.topic === topic && q.level === level).length, 3, `${topic}/${level}`);
        }
    }
});

test('every card is chat-shaped, unique and never leaks its answer', () => {
    const texts = DSMATH_BANK.map((q) => q.q.toLowerCase());
    assert.equal(new Set(texts).size, texts.length, 'no question is asked twice');
    const shared = new Set([...MATH_BANK, ...CODE_BANK].map((q) => q.q.toLowerCase()));
    for (const q of DSMATH_BANK) assert.ok(!shared.has(q.q.toLowerCase()), `duplicate of another subject: ${q.q}`);
    for (const q of DSMATH_BANK) {
        assert.ok(q.q.length >= 10 && q.q.length <= 300, q.q);
        assert.ok(['easy', 'hard'].includes(q.level), q.q);
        assert.ok(DSMATH_TOPICS.includes(q.topic), q.q);
        assert.ok(q.a.length >= 1 && q.a.length <= 4, `${q.q}: 1-4 accepted spellings`);
        for (const a of q.a) {
            assert.ok(a === a.trim() && a.length && a.length <= 60, `${q.q}: ${a}`);
            assert.ok(looseMatches(a, q.a), `${q.q}: ${a}`);
        }
        assert.ok(!looseMatches('deliberately incorrect answer', q.a), q.q);
    }
});

test('every numeric answer matches the independently computed result', () => {
    const checked = new Set();
    const accepts = (fragment, value) => {
        const matches = DSMATH_BANK.filter((q) => q.q.includes(fragment));
        assert.equal(matches.length, 1, `“${fragment}” must name exactly one card`);
        const [card] = matches;
        assert.ok(looseMatches(String(value), card.a), `${fragment}: ${value} is not accepted by [${card.a}]`);
        checked.add(card);
    };

    // logic — truth tables computed from the connectives themselves
    accepts('TRUE AND FALSE', Number(true && false));
    accepts('TRUE OR FALSE', Number(true || false));
    accepts('When p is false', implies(false, true) && implies(false, false) ? 'true' : 'false');
    accepts('in how many is the implication p → q false', rows.filter(([p, q]) => !implies(p, q)).length);
    accepts('contrapositive of p → q', 'contrapositive');

    // sets
    const A = [1, 2, 3]; const B = [3, 4];
    accepts('A ∪ B when A = {1, 2, 3}', new Set([...A, ...B]).size);
    accepts('A ∩ B when A = {1, 2, 3}', A.filter((x) => B.includes(x)).length);
    accepts('power set of A when A = {a, b, c}', 2 ** 3);
    accepts('How many play neither', 30 - (18 + 15 - 7));
    accepts('PROPER subsets does a set with 4', 2 ** 4 - 1);
    accepts('countable or uncountable', 'uncountable');

    // relations and functions
    accepts('relations are there on a set with 3 elements', 2 ** (3 * 3));
    accepts('from a set with 4 elements to a set with 2', 2 ** 4);
    accepts('reflexive relations are there on a set with 4', 2 ** (4 * 4 - 4));

    // counting
    accepts('What is 5!', fact(5));
    accepts('3 different books be arranged', fact(3));
    accepts('answer 2 of 5 questions', binom(5, 2));
    accepts('committee of 4 be chosen from 6', binom(6, 4));
    accepts('diagonals does a convex hexagon', (6 * (6 - 3)) / 2);
    accepts('fewest you can draw to be sure of two of the same colour', 2 + 1);

    // number theory
    accepts('greatest common divisor of 12 and 18', gcd(12, 18));
    accepts('What is 17 mod 5', 17 % 5);
    accepts('only even prime number', 2);
    accepts('Write 13 in binary', (13).toString(2));
    accepts('What is 7² mod 11', 7 ** 2 % 11);
    accepts('what is φ(12)', phi(12));

    // sequences
    accepts('5th term of the arithmetic sequence 3, 7, 11, 15', 3 + 4 * 4);
    accepts('next term of the geometric sequence 2, 6, 18, 54', 54 * 3);
    accepts('sum of the first 10 positive integers', (10 * 11) / 2);
    const fib = [1, 1]; while (fib.length < 8) fib.push(fib.at(-1) + fib.at(-2));
    accepts('what is the 8th Fibonacci number F8', fib[7]);
    let a5 = 3; for (let i = 2; i <= 5; i++) a5 *= 2;
    accepts('a(n) = 2 · a(n−1). What is a5', a5);
    accepts('sum of the infinite series 1/2 + 1/4 + 1/8', (1 / 2) / (1 - 1 / 2));

    // graphs
    accepts('sum of all vertex degrees', 2);
    accepts('tree with 6 vertices have', 6 - 1);
    accepts('complete graph K4', binom(4, 2));
    accepts('6 vertices and 10 edges. How many faces', 2 - 6 + 10);
    accepts('colours are always enough to colour any planar map', 4);
    accepts('Euler circuit exactly when every vertex has', 'even');

    // Boolean algebra and gates
    accepts('outputs 1 only when both of its inputs', 'and');
    accepts('What is 1 XOR 1', 1 ^ 1);
    accepts('OR gate followed by a NOT gate', 'nor');
    accepts('Boolean functions of two variables', 2 ** (2 ** 2));
    accepts('A + A′ (A OR NOT A) always equal', 1);
    accepts('NAND or AND', 'nand');

    // probability — sample spaces enumerated, not remembered
    accepts('heads on one toss of a fair coin', coin.length / 2 / coin.length);
    accepts('rolling a 4 on a fair six-sided die', 1 / die.length);
    accepts('outcomes are in the sample space when two six-sided dice', dicePairs.length);
    accepts('probability of getting heads on both', tosses.filter(([x, y]) => x === 'H' && y === 'H').length / tosses.length);
    accepts('probability it is a king', 4 / 52);
    accepts('mutually exclusive events. What is P(A or B)', 0.3 + 0.4);

    // Coverage: no card whose answer is a number may ride along unchecked.
    const numbers = DSMATH_BANK.filter((q) => q.a.some((a) => /^-?\d+(\.\d+)?(\/\d+)?$/.test(a)));
    const missed = numbers.filter((q) => !checked.has(q)).map((q) => q.q);
    assert.deepEqual(missed, [], 'every numeric card was recomputed above');
});

test('every dsmath card fits one WhatsApp message, fences balanced', () => {
    for (const entry of DSMATH_BANK) {
        const card = roundCard({
            emoji: '🧮',
            title: `Counting · ${entry.level === 'hard' ? 'Hard' : 'Easy'}`,
            detail: `${entry.level === 'hard' ? 10 : 5} pts · 180s`,
            question: questionText(entry),
            footer: 'Send your answer.\n!game end to end your round · !top for scores'
        });
        assert.ok(card.length < 3800, `too long: ${entry.q}`);
        assert.equal((card.match(/```/g) || []).length, entry.code ? 2 : 0, entry.q);
        assert.ok(card.includes(entry.q));
        assert.ok(!card.includes('undefined'));
        assert.ok(!card.includes('Answer:'), 'the card never reveals the answer');
    }
    assert.ok(DSMATH_BANK.some((q) => q.code), 'the working blocks are exercised');
});

test('the generator is pointed at the same nine topics the bank covers', () => {
    const prompt = contentPrompt('dsmath', 8);
    for (const topic of DSMATH_TOPICS) assert.match(prompt, new RegExp(topic));
    assert.match(prompt, /discrete-mathematics/);
    const items = normalizeItems('dsmath', { items: [
        { q: 'How many edges does a tree with nine vertices have?', a: ['8'], level: 'hard', topic: 'graphs' },
        { q: 'What is 9 mod 4?', a: ['1'], level: 'easy', topic: 'made-up' }
    ] });
    assert.deepEqual(items.map((i) => [i.level, i.topic]), [['hard', 'graphs'], ['easy', 'logic']],
        'an unknown topic is folded onto the first real one');
});
