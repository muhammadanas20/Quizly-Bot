/**
 * The random-number toolbox: bounds, parsing and the instant commands.
 * Every call here takes an explicit RNG, so these assertions are exact.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
    randomInt, pickOne, shuffle, parseRange, parseDice, rollDice,
    flipCoin, parseCoinCall, eightBall, parseOptions,
    createRandomTools, EIGHT_BALL
} from '../src/random.js';

const fixed = (v) => () => v;
/** Returns the given values in order, then repeats the last one. */
const seq = (values) => {
    let i = 0;
    return () => values[Math.min(i++, values.length - 1)];
};

// ── primitives ───────────────────────────────────────────────────────────────
test('randomInt stays inside the range and is inclusive at both ends', () => {
    assert.equal(randomInt(1, 6, fixed(0)), 1);
    assert.equal(randomInt(1, 6, fixed(0.999)), 6);
    assert.equal(randomInt(10, 10, fixed(0.5)), 10);
    // a reversed range is swapped rather than returning nonsense
    assert.equal(randomInt(90, 10, fixed(0)), 10);
});

test('pickOne / shuffle never mutate the caller\'s array', () => {
    const list = ['a', 'b', 'c'];
    assert.equal(pickOne(list, fixed(0)), 'a');
    assert.equal(pickOne([], fixed(0)), null);
    const shuffled = shuffle(list, fixed(0));
    assert.deepEqual([...shuffled].sort(), list);
    assert.deepEqual(list, ['a', 'b', 'c']);
});

test('shuffle is a permutation even when it lands on the same order', () => {
    const out = shuffle(['a', 'b', 'c'], fixed(0.999));
    assert.deepEqual([...out].sort(), ['a', 'b', 'c']);
});

// ── parsing ──────────────────────────────────────────────────────────────────
test('parseRange understands the spellings people actually type', () => {
    assert.deepEqual(parseRange('1-100'), { min: 1, max: 100 });
    assert.deepEqual(parseRange('1..50'), { min: 1, max: 50 });
    assert.deepEqual(parseRange('1 to 10'), { min: 1, max: 10 });
    assert.deepEqual(parseRange('100-1'), { min: 1, max: 100 }, 'a reversed range is still a range');
    assert.deepEqual(parseRange('20'), { min: 1, max: 20 }, 'a bare number means 1..n');
    assert.equal(parseRange('apple'), null);
    assert.equal(parseRange(''), null);
});

test('parseDice reads NdM, dM and a bare number', () => {
    assert.deepEqual(parseDice('2d6'), { count: 2, sides: 6 });
    assert.deepEqual(parseDice('d20'), { count: 1, sides: 20 });
    assert.deepEqual(parseDice('3D8'), { count: 3, sides: 8 });
    assert.deepEqual(parseDice('6'), { count: 1, sides: 6 });
    assert.deepEqual(parseDice(''), { count: 1, sides: 6 });
    assert.equal(parseDice('1d1'), null, 'a one-sided die is not a die');
    assert.equal(parseDice('banana'), null);
    assert.equal(parseDice('99d6').count, 20, 'a hundred dice would flood the chat');
});

test('parseOptions splits commas and spaces', () => {
    // no comma anywhere: every argument is one option
    assert.deepEqual(parseOptions(['apple', 'banana', 'cake']), ['apple', 'banana', 'cake']);
    // a comma is the separator, so "chicken curry" survives as one option
    assert.deepEqual(parseOptions(['apple,', 'banana', 'cake']), ['apple', 'banana cake']);
    assert.deepEqual(parseOptions(['pizza']), ['pizza']);
    assert.deepEqual(parseOptions([]), []);
});

test('parseCoinCall accepts the obvious spellings and rejects the rest', () => {
    assert.equal(parseCoinCall('Heads'), true);
    assert.equal(parseCoinCall('h'), true);
    assert.equal(parseCoinCall('tails'), false);
    assert.equal(parseCoinCall('T'), false);
    assert.equal(parseCoinCall('maybe'), null);
});

// ── dice / coin / slots ──────────────────────────────────────────────────────
test('rollDice reports every roll and the total', () => {
    const rolled = rollDice({ count: 3, sides: 6 }, seq([0, 0.5, 0.999]));
    assert.deepEqual(rolled.rolls, [1, 4, 6]);
    assert.equal(rolled.total, 11);
});

test('flipCoin is a coin, not a shortcut', () => {
    assert.equal(flipCoin(fixed(0.1)), 'Heads');
    assert.equal(flipCoin(fixed(0.9)), 'Tails');
});

test('eightBall always answers from its own list', () => {
    for (const v of [0, 0.25, 0.5, 0.75, 0.999]) {
        assert.ok(EIGHT_BALL.includes(eightBall(fixed(v))));
    }
});

// ── the commands ─────────────────────────────────────────────────────────────
test('!random rolls in the asked-for range', () => {
    const tools = createRandomTools({ random: fixed(0.5) });

    const plain = tools.handle('random', []);
    assert.match(plain.reply, /\*51\*/, '1-100 by default, mid value with this RNG');

    const ranged = tools.handle('random', ['1-1000']);
    assert.match(ranged.reply, /\*501\*/);

    const single = tools.handle('random', ['20']);
    assert.match(single.reply, /\*11\*/);

    const fixedRange = tools.handle('random', ['7-7']);
    assert.match(fixedRange.reply, /\*7\*/);
});

test('!random without a range picks from a list when given one', () => {
    const tools = createRandomTools({ random: fixed(0.5) });
    assert.match(tools.handle('random', ['apple,', 'banana']).reply, /\*banana\*/);
    assert.match(tools.handle('random', ['pizza', 'pasta']).reply, /\*pasta\*/);
});

test('!roll, !flip, !pick, !shuffle and !8ball all answer', () => {
    const tools = createRandomTools({ random: fixed(0.5) });

    assert.match(tools.handle('roll', []).reply, /1d6 → \*4\*/);
    assert.match(tools.handle('roll', ['2d6']).reply, /2d6 → 4 \+ 4 = \*8\*/);
    assert.match(tools.handle('roll', ['banana']).reply, /Usage: !roll/);
    assert.match(tools.handle('flip', []).reply, /\*Tails\*/);
    assert.match(tools.handle('pick', ['a,', 'b']).reply, /\*b\*/);
    assert.match(tools.handle('pick', ['lonely']).reply, /Usage: !pick/);
    assert.match(tools.handle('shuffle', ['a,', 'b,', 'c']).reply, /🔀 \*Shuffled\*/);
    assert.match(tools.handle('eightball', ['will', 'it', 'rain?']).reply, /will it rain\?/);
    assert.match(tools.handle('eightball', []).reply, /Ask me a question/);
    assert.equal(tools.handle('wibble', []).handled, false, 'unknown names are not claimed');
});
