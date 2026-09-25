/**
 * The game engine, driven with a deterministic RNG, a controllable clock and a
 * fake group — no socket, no waiting for real timeouts.
 *
 * The RNG is a plain function, so "the secret number" is decided by the test:
 * `() => 0.5` on a 1-100 range is 51, on a d6 it is 4, and on a 1-9 reel it is 5.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createGameEngine, GAMES, TRIVIA, findGame, answerMatches, looseMatches, normalizeAnswer, hotCold, scrambleWord, makeMath, WORDS } from '../src/games.js';
import { createScoreStore } from '../src/scores.js';
import { loadConfig } from '../src/config.js';
import log from '../src/log.js';

const GROUP = '120363000000000000@g.us';
const OTHER = '120363000000000001@g.us';
const PN = '923001234567';
const PN2 = '923009876543';

const half = () => 0.5;
const seq = (values) => {
    let i = 0;
    return () => values[Math.min(i++, values.length - 1)];
};

function world({ random = half, env = {}, send = null, content = null } = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'games-'));
    const config = loadConfig({ GEMINI_API_KEY: 'k', OWNER_NUMBERS: PN, ...env });
    const scores = createScoreStore({ file: path.join(dir, 'scores.json'), log }).load();

    let clock = 1_000_000;
    const now = () => clock;
    const tick = (ms) => { clock += ms; };

    const games = createGameEngine({
        config,
        log,
        scores,
        groups: { nameOf: async () => '' },
        content,
        random,
        now,
        autoSweep: false,
        send
    });

    return { games, scores, config, tick, now, dir };
}

let msgId = 0;
function ctx(text, { ids = [PN], name = 'Ali', isOwner = false, jid = GROUP, expand } = {}) {
    const id = [...ids][0];
    return {
        jid,
        isGroup: true,
        text,
        isOwner,
        chatName: 'Test Group',
        senderIds: new Set(ids),
        senderLabel: `${id}@s.whatsapp.net`,
        expandIds: expand,
        groups: { nameOf: async () => name },
        msg: {
            key: { remoteJid: jid, participant: `${id}@s.whatsapp.net`, fromMe: false, id: `M${++msgId}` },
            pushName: name
        }
    };
}

const asAli = (text, over) => ctx(text, { ids: [PN], name: 'Ali', ...over });
const asSana = (text, over) => ctx(text, { ids: [PN2], name: 'Sana', ...over });

// ── rules: pure helpers ──────────────────────────────────────────────────────
test('answerMatches is exact for short answers and forgiving for real ones', () => {
    assert.equal(answerMatches('Islamabad', ['islamabad']), true);
    assert.equal(answerMatches('  ISLAMABAD! ', ['Islamabad']), true);
    assert.equal(answerMatches('I think it is Islamabad', ['islamabad']), true);
    assert.equal(answerMatches('Tokyo', ['tokyo city']), false, 'a partial word does not count');
    assert.equal(answerMatches('71', ['7']), false, 'a numeric answer must match exactly');
    assert.equal(answerMatches('seven', ['7']), false, 'a digit is not a word');
    assert.equal(answerMatches('', ['islamabad']), false);
});

test('normalizeAnswer strips case, accents and punctuation', () => {
    assert.equal(normalizeAnswer('  Café,  Súper! '), 'cafe super');
});

test('hotCold runs from freezing to scorching', () => {
    assert.equal(hotCold(50, 50, 1, 100), '🎯 spot on');
    assert.match(hotCold(51, 50, 1, 100), /scorching/);
    assert.match(hotCold(45, 50, 1, 100), /hot/);
    assert.match(hotCold(30, 50, 1, 100), /cold/);
    assert.match(hotCold(1, 99, 1, 100), /freezing/);
});

test('scrambleWord returns a permutation that is never the original word', () => {
    for (let i = 0; i < 50; i++) {
        const out = scrambleWord('garden', Math.random);
        assert.notEqual(out, 'garden');
        assert.deepEqual([...out].sort(), [...'garden'].sort());
    }
});

test('makeMath always produces a correct problem', () => {
    for (let i = 0; i < 200; i++) {
        const easy = makeMath('easy', Math.random);
        const hard = makeMath('hard', Math.random);
        for (const p of [easy, hard]) {
            assert.ok(Number.isInteger(p.answer), `${p.question} answered with ${p.answer}`);
            // eslint-disable-next-line no-eval
            assert.equal(p.answer, eval(p.question.replace(/×/g, '*').replace(/−/g, '-').replace(/÷/g, '/')), p.question);
            assert.ok(p.points > 0);
        }
    }
});

test('hard maths uses five genuinely multi-step, exact-answer templates', () => {
    const kinds = new Set();
    for (let i = 0; i < 5; i++) {
        const problem = makeMath('hard', () => (i + 0.5) / 5);
        kinds.add(problem.question);
        assert.equal(problem.points, 10);
        assert.ok((problem.question.match(/[+×−÷]/g) || []).length >= 3, problem.question);
        // eslint-disable-next-line no-eval
        assert.equal(eval(problem.question.replace(/×/g, '*').replace(/−/g, '-').replace(/÷/g, '/')), problem.answer);
    }
    assert.equal(kinds.size, 5);
});

test('built-in trivia and scramble pools have varied, non-duplicated fallbacks', () => {
    assert.ok(TRIVIA.length >= 80);
    assert.ok(WORDS.length >= 100);
    assert.equal(new Set(TRIVIA.map((e) => e.q.toLowerCase())).size, TRIVIA.length);
    assert.equal(new Set(WORDS).size, WORDS.length);
    assert.ok(TRIVIA.every((entry) => entry.a.length > 0));
});

test('every advertised game can be started by its canonical name', () => {
    assert.equal(GAMES.length, 7);
    assert.equal(findGame('dice'), null, 'dice was removed');
    assert.equal(findGame('slots'), null, 'slots was removed');
    for (const g of GAMES) {
        assert.equal(findGame(g.name)?.name, g.name);
        assert.equal(findGame(g.aliases[0])?.name, g.name);
        assert.ok(g.how.startsWith('!game'), `${g.name} must be startable with !game`);
    }
    assert.equal(findGame('wibble'), null);
});

// ── the listing ──────────────────────────────────────────────────────────────
test('!game lists every game and the score commands', async () => {
    const { games } = world();
    const out = await games.handle(asAli('!game'), []);

    assert.equal(out.handled, true);
    for (const g of GAMES) assert.match(out.reply, new RegExp(`\\*${g.name}\\*`));
    assert.match(out.reply, /!game top/);
    assert.match(out.reply, /!game addq/);
});

test('!game help explains each game, !game <unknown> says so', async () => {
    const { games } = world();
    assert.match((await games.handle(asAli('!game help'), ['help'])).reply, /How to play/);

    const bad = await games.handle(asAli('!game chess'), ['chess']);
    assert.match(bad.reply, /do not know the game/);
    assert.equal(bad.react, '⚠️');
});

// ── number game ──────────────────────────────────────────────────────────────
test('!game number hints too high / too low and the right guess wins', async () => {
    const { games, scores, tick } = world();          // secret number: 51

    const start = await games.handle(asAli('!game number 1-100'), ['number', '1-100']);
    assert.match(start.reply, /between \*1\* and \*100\*/);
    assert.equal(games.active(GROUP).answer, 51);

    const low = await games.guess(asAli('!guess 30'), ['30']);
    assert.match(low.reply, /Too low/);
    assert.match(low.reply, /cold/);
    assert.equal(low.react, '❌');

    const high = await games.guess(asAli('!guess 90'), ['90']);
    assert.match(high.reply, /Too high/);

    // a plain number works too — that is how people actually play
    const still = await games.guess(asAli('!guess 55'), ['55']);
    assert.match(still.reply, /Too high/);

    const win = await games.guess(asAli('!guess 51'), ['51']);
    assert.equal(win.react, '🎉');
    assert.match(win.reply, /Ali\* wins! the number was \*51\*/);
    assert.match(win.reply, /\*\+7\* pts/, '10 pts minus the 3 wrong guesses');
    assert.match(win.reply, /🎮 Ali \+8/, 'the win plus one participation point');

    assert.equal(games.active(GROUP), null, 'the round is over');
    const row = scores.playerOf(GROUP, [PN]);
    assert.equal(row.points, 8, '7 for the win + 1 for taking part');
    assert.equal(row.wins, 1);
    tick(1000);
});

test('a stuck group gets exactly one narrowing hint', async () => {
    const { games } = world();                        // secret 51 out of 100
    await games.handle(asAli('!game number 1-100'), ['number', '1-100']);

    await games.guess(asAli('!guess 1'), ['1']);
    await games.guess(asAli('!guess 2'), ['2']);
    await games.guess(asAli('!guess 3'), ['3']);
    const fourth = await games.guess(asAli('!guess 4'), ['4']);
    assert.match(fourth.reply, /upper half: \*51–100\*/, 'four wrong guesses earn the range hint');

    const fifth = await games.guess(asSana('!guess 5'), ['5']);
    assert.ok(!/half/.test(fifth.reply), 'and the hint is not repeated');
});

test('a repeated guess is refused instead of counted', async () => {
    const { games } = world();
    await games.handle(asAli('!game number'), ['number']);

    await games.guess(asAli('!guess 30'), ['30']);
    const again = await games.guess(asAli('!guess 30'), ['30']);
    assert.equal(again.react, '♻️');
    assert.match(again.reply, /already tried/);
});

test('an out-of-range number is refused, and ordinary chat is not a guess', async () => {
    const { games } = world();
    await games.handle(asAli('!game number 1-100'), ['number', '1-100']);

    const out = await games.guess(asAli('!guess 500'), ['500']);
    assert.match(out.reply, /between 1 and 100/);

    const chat = await games.handleMessage(asAli('we should meet at 5 then'));
    assert.deepEqual(chat, { handled: false }, 'a sentence is not a guess');
});

test('the per-player guess cap stops one person hogging the round', async () => {
    const { games, config } = world({ env: { GAME_MAX_ATTEMPTS: '3' } });
    assert.equal(config.gameMaxAttempts, 3);
    await games.handle(asAli('!game number 1-1000'), ['number', '1-1000']);

    await games.guess(asAli('!guess 1'), ['1']);
    await games.guess(asAli('!guess 2'), ['2']);
    await games.guess(asAli('!guess 3'), ['3']);

    const blocked = await games.guess(asAli('!guess 4'), ['4']);
    assert.equal(blocked.react, '🚫');
    assert.match(blocked.reply, /let someone else try/i);
});

test('a streak pays a bonus on the next win', async () => {
    const { games, tick } = world();
    await games.handle(asAli('!game number 1-100'), ['number', '1-100']);
    const first = await games.guess(asAli('!guess 51'), ['51']);
    assert.ok(!/streak bonus/.test(first.reply), 'the first win has no streak yet');

    tick(20_000);                                     // clear the between-round cooldown
    await games.handle(asAli('!game number 1-100'), ['number', '1-100']);
    const second = await games.guess(asAli('!guess 51'), ['51']);
    assert.match(second.reply, /streak bonus 🔥2/);
});

// ── coin ────────────────────────────────────────────────────────
test('!game coin: a wrong call is a reaction, both calls end the round', async () => {
    const { games } = world({ random: () => 0.9 });    // 0.9 → Tails
    await games.handle(asAli('!game coin'), ['coin']);

    const wrong = await games.guess(asAli('heads'), ['heads']);
    assert.equal(wrong.react, '❌');
    assert.equal(wrong.reply, undefined, 'no chatter for a wrong coin call');

    const second = await games.guess(asSana('tails'), ['tails']);
    assert.match(second.reply, /Sana\* wins/);

    // the coin is revealed: the round is closed
    assert.equal(games.active(GROUP), null);
});

// ── math, scramble, trivia ───────────────────────────────────────────────────
test('!game math asks a random sum and the first right answer takes it', async () => {
    const { games } = world();
    const start = await games.handle(asAli('!game math arith'), ['math', 'arith']);
    const round = games.active(GROUP);
    assert.match(start.reply, new RegExp(round.problem.question.replace(/[+×−()]/g, (c) => `\\${c}`)));

    await games.guess(asSana('!guess 1'), ['1']);
    const win = await games.guess(asAli('!guess ' + round.answer), [String(round.answer)]);
    assert.match(win.reply, new RegExp(`the answer was \\*${round.answer}\\*`));
});

test('!game math hard awards ten points for a multi-step problem', async () => {
    const { games, scores } = world({ random: () => 0.7 });
    const start = await games.handle(asAli('!game math hard'), ['math', 'hard']);
    const round = games.active(GROUP);
    assert.match(start.reply, /Maths\* \(hard\)/);
    assert.match(round.problem.question, /÷/);
    const win = await games.guess(asAli(`!guess ${round.answer}`), [String(round.answer)]);
    assert.match(win.reply, /\*\+10\* pts/);
    assert.equal(scores.playerOf(GROUP, [PN]).points, 11);
});

test('!game scramble: a plain single word is a guess', async () => {
    const { games } = world();
    const start = await games.handle(asAli('!game scramble'), ['scramble']);
    const round = games.active(GROUP);
    assert.ok(WORDS.includes(round.answer), 'the word comes from the shipped list');
    assert.match(start.reply, /🔀 \*/);
    assert.deepEqual([...round.scrambled].sort(), [...round.answer].sort());

    const wrong = await games.handleMessage(asSana('banana'));
    assert.equal(wrong.react, '❌');

    const win = await games.handleMessage(asAli(round.answer.toUpperCase()));
    assert.match(win.reply, new RegExp(`the word was \\*${round.answer}\\*`));
    assert.equal(win.react, '🎉');
});

test('!game trivia answers from the built-in pool, and plain wrong chat is ignored', async () => {
    const { games } = world();
    await games.handle(asAli('!game trivia'), ['trivia']);
    const round = games.active(GROUP);
    const answer = round.accepted[0];
    assert.ok(answer, 'a question was picked');

    const ignored = await games.handleMessage(asSana('what is going on here'));
    assert.deepEqual(ignored, { handled: false }, 'chat is not an answer');

    const missed = await games.guess(asSana('!guess London'), ['London']);
    assert.equal(missed.react, '❌');

    const win = await games.handleMessage(asAli(answer));
    assert.match(win.reply, /Sana|Ali/);
    assert.equal(win.react, '🎉');
});

test('a member-contributed question can be drawn for a round', async () => {
    const { games, scores } = world({ random: () => 0.9999 });   // last entry of the pool
    scores.addQuestion({ q: 'Which city is the capital of Japan?', a: ['Tokyo'], by: 'Sana', chat: GROUP });

    await games.handle(asAli('!game trivia'), ['trivia']);
    const round = games.active(GROUP);
    assert.equal(round.pool.q, 'Which city is the capital of Japan?');
    assert.match(round.pool.by, /Sana/);

    const win = await games.handleMessage(asSana('tokyo'));
    assert.match(win.reply, /wins/);
});

test('trivia and scramble use the latest AI pool; an active round keeps its original answer', async () => {
    let trivia = [{ q: 'What instrument measures air pressure?', a: ['barometer'] }];
    let puzzles = [{ word: 'metronome', clue: 'Keeps the rhythm for musicians' }];
    const content = {
        questions: () => trivia, puzzles: () => puzzles,
        get questionCount() { return trivia.length; },
        get puzzleCount() { return puzzles.length; }
    };
    const { games, tick, config } = world({ random: () => 0.999, content });
    const first = await games.handle(asAli('!game trivia'), ['trivia']);
    assert.match(first.reply, /air pressure/);
    trivia = [{ q: 'Which planet is known for its rings?', a: ['saturn'] }];
    assert.equal(games.active(GROUP).accepted[0], 'barometer', 'in-flight round is not rewritten');
    await games.guess(asAli('!guess barometer'), ['barometer']);
    tick(config.gameCooldownMs + 1);
    await games.handle(asAli('!game trivia'), ['trivia']);
    assert.equal(games.active(GROUP).accepted[0], 'saturn', 'the next round sees the replacement');
    await games.handle(asAli('!game end'), ['end']);
    tick(config.gameCooldownMs + 1);

    const opening = await games.handle(asAli('!game scramble'), ['scramble']);
    assert.match(opening.reply, /Clue: Keeps the rhythm/);
    assert.equal(games.active(GROUP).answer, 'metronome');
    puzzles = [{ word: 'stethoscope', clue: 'Used by doctors to listen to a heartbeat' }];
    await games.handle(asAli('!game end'), ['end']);
    tick(config.gameCooldownMs + 1);
    await games.handle(asAli('!game scramble'), ['scramble']);
    assert.equal(games.active(GROUP).answer, 'stethoscope');
});

test('!game addq needs a question and an answer, and refuses duplicates', async () => {
    const { games, scores } = world();

    const usage = await games.handle(asAli('!game addq no separator here'), ['addq', 'no', 'separator', 'here']);
    assert.match(usage.reply, /Usage: `?!game addq Question ; Answer/);

    const ok = await games.handle(asAli('!game addq Which planet has rings? ; Saturn/ringed'), ['addq', 'Which', 'planet', 'has', 'rings?', ';', 'Saturn/ringed']);
    assert.equal(ok.react, '✅');
    assert.match(ok.reply, /Added to the trivia pool/);
    assert.match(ok.reply, /\*\+2\* pts for contributing/, 'contributing scores too');
    assert.equal(scores.questionCount, 1);
    assert.deepEqual(scores.questions()[0].a, ['Saturn', 'ringed'], 'a / adds another accepted spelling');
    assert.equal(scores.questions()[0].by, 'Ali');
    assert.equal(scores.playerOf(GROUP, [PN]).points, 2);

    const dupe = await games.handle(asAli('!game addq which planet has rings? ; Saturn'), ['addq', 'which', 'planet', 'has', 'rings?', ';', 'Saturn']);
    assert.equal(dupe.react, '⚠️');
    assert.match(dupe.reply, /already in the pool/);
});

test('contributing is rewarded, but only for the first ten questions', async () => {
    const { games, scores } = world();

    for (let i = 1; i <= 11; i++) {
        const out = await games.handle(
            asAli(`!game addq Question number ${i}? ; answer ${i}`),
            ['addq', `Question number ${i}?`, ';', `answer ${i}`]
        );
        if (i <= 10) assert.match(out.reply, /for contributing/, `question ${i} earns points`);
        else assert.ok(!/for contributing/.test(out.reply), 'the eleventh does not');
    }

    assert.equal(scores.questionCount, 11, 'every question is still added to the pool');
    assert.equal(scores.playerOf(GROUP, [PN]).points, 10 * 2, 'capped at ten paid contributions');
    assert.equal(scores.questions()[10].byKey, PN, 'the contributor key is stored with the question');
});

// ── lucky draw ───────────────────────────────────────────────────────────────
test('!game lucky: joining earns a point, the draw picks one winner at random', async () => {
    const { games, scores } = world();                  // RNG 0.5 → picks the second entry

    const start = await games.handle(asAli('!game lucky'), ['lucky']);
    assert.match(start.reply, /Lucky draw/);
    assert.match(start.reply, /Ali is in!/, 'the starter joins automatically');

    const joined = await games.join(asSana('!in'));
    assert.match(joined.reply, /Sana is in! 2 joined/);

    const again = await games.handle(asAli('!game lucky'), ['lucky']);
    assert.match(again.reply, /already in the draw/);
    assert.equal(games.active(GROUP).players.size, 2);

    const chat = await games.handleMessage(asSana('hello everyone'));
    assert.deepEqual(chat, { handled: false }, 'a draw does not swallow chat');

    const drawn = await games.handle(asSana('!game draw'), ['draw']);
    assert.equal(drawn.react, '🎁');
    assert.match(drawn.reply, /Sana\* wins the lucky draw/);
    assert.match(drawn.reply, /\*\+9\*/, '8 for the win + 1 for joining');
    assert.equal(games.active(GROUP), null);

    assert.equal(scores.playerOf(GROUP, [PN]).points, 1);
    assert.equal(scores.playerOf(GROUP, [PN2]).points, 9);
});

test('a draw nobody joined closes without a winner', async () => {
    const { games, scores } = world();
    const lonely = createGameEngine({
        config: loadConfig({ GEMINI_API_KEY: 'k' }),
        log,
        scores,
        random: half,
        now: () => Date.now(),
        autoSweep: false
    });
    // start a draw, then remove the starter's entry to simulate an empty room
    await lonely.handle(asAli('!game lucky'), ['lucky']);
    lonely.active(GROUP).players.clear();

    const out = await lonely.handle(asAli('!game draw'), ['draw']);
    assert.match(out.reply, /Nobody joined/);
});

// ── control: stop, replace, cooldown, timeout ────────────────────────────────
test('only the starter or the owner can stop a round', async () => {
    const { games } = world();
    await games.handle(asAli('!game number'), ['number']);

    const refused = await games.handle(asSana('!game stop'), ['stop']);
    assert.equal(refused.react, '⛔');
    assert.match(refused.reply, /Only Ali/);

    // Owners use !game end for one chat; !game stop is now the GLOBAL shutoff.
    const owner = await games.handle(asSana('!game end', { isOwner: true }), ['end']);
    assert.equal(owner.react, '🛑');
    assert.match(owner.reply, /the number was \*51\*/);
    assert.equal(games.active(GROUP), null);
});

test('the starter can still stop only their own round without disabling games', async () => {
    const { games } = world();
    await games.handle(asAli('!game coin'), ['coin']);
    const stopped = await games.handle(asAli('!game stop'), ['stop']);
    assert.match(stopped.reply, /the coin was/);
    assert.equal(games.enabled, true);
    assert.equal(games.roundCount, 0);
});

test('a stranger cannot replace a running round, the starter can', async () => {
    const { games } = world();
    await games.handle(asAli('!game number'), ['number']);

    const blocked = await games.handle(asSana('!game coin'), ['coin']);
    assert.equal(blocked.react, '⏳');
    assert.match(blocked.reply, /already running|still running/);
    assert.equal(games.active(GROUP).name, 'number');

    const replaced = await games.handle(asAli('!game coin'), ['coin']);
    assert.match(replaced.reply, /Coin toss/);
    assert.equal(games.active(GROUP).name, 'coin');
});

test('a new round waits out the cooldown after the last one', async () => {
    const { games, tick, config } = world();
    await games.handle(asAli('!game number'), ['number']);
    await games.guess(asAli('!guess 51'), ['51']);

    const tooSoon = await games.handle(asAli('!game coin'), ['coin']);
    assert.equal(tooSoon.react, '⏳');
    assert.match(tooSoon.reply, /breather/);

    tick(config.gameCooldownMs + 1000);
    const ok = await games.handle(asAli('!game coin'), ['coin']);
    assert.match(ok.reply, /Coin toss/);
});

test('a round that times out is revealed to the group through send()', async () => {
    const sent = [];
    const { games, tick, config } = world({ send: async (jid, text) => sent.push({ jid, text }) });
    await games.handle(asAli('!game number'), ['number']);

    tick(config.gameTimeoutMs + 1);
    const out = await games.sweep();

    assert.equal(out.length, 1);
    assert.match(out[0].text, /No winner this time — the number was \*51\*/);
    assert.deepEqual(sent, [{ jid: GROUP, text: out[0].text }], 'the group is told, once');
    assert.equal(games.active(GROUP), null);

    // and a round inside its time is left alone
    await games.handle(asAli('!game number'), ['number']);
    assert.deepEqual(await games.sweep(), []);
});

// ── scores ───────────────────────────────────────────────────────────────────
test('!top, !top all and !game me report the board', async () => {
    const { games, tick } = world();
    await games.handle(asAli('!game number'), ['number']);
    await games.guess(asAli('!guess 51'), ['51']);
    tick(20_000);
    await games.handle(asSana('!game number'), ['number']);
    await games.guess(asSana('!guess 51'), ['51']);

    const top = await games.board(asAli('!top'), '');
    assert.match(top, /Top players — Test Group/);
    assert.match(top, /Ali/);
    assert.match(top, /2 players/);

    const all = await games.board(asAli('!top all'), 'all');
    assert.match(all, /all chats/);

    const me = await games.handle(asSana('!game me'), ['me']);
    assert.match(me.reply, /👤 \*Sana\*/);
    assert.match(me.reply, /Rank #/);

    const fresh = await games.handle(ctx('!game me', { ids: ['999@lid'], name: 'Nobody' }), ['me']);
    assert.match(fresh.reply, /not on the board yet/);
});

test('two identities of one member share a single scoreboard row', async () => {
    const { games, scores } = world();
    const lid = '219537588899977@lid';
    const expand = (raw) => (raw === lid ? [lid, PN] : [raw]);

    await games.handle(asAli('!game number', { ids: [lid], expand }), ['number']);
    await games.guess(asAli('!guess 51', { ids: [lid], expand }), ['51']);

    // now the same person is addressed by phone number only
    assert.equal(scores.playerOf(GROUP, [PN]).points, 11, '10 for a first-guess win + 1 for playing');
    assert.equal(scores.playerCount, 1);
});

test('the leaderboard survives a restart', async () => {
    const { games, scores, dir } = world();
    await games.handle(asAli('!game number'), ['number']);
    await games.guess(asAli('!guess 51'), ['51']);
    scores.flush();

    const reopened = createScoreStore({ file: path.join(dir, 'scores.json') }).load();
    assert.equal(reopened.board(GROUP)[0].name, 'Ali');
    assert.equal(reopened.board(GROUP)[0].points, 11);
});

// ── global owner controls ────────────────────────────────────────────────────
test('!game stop by the owner cancels ALL chats without drawing winners, and !game on restores play', async () => {
    const sent = [];
    const { games, scores, dir } = world({ send: async (jid, text) => sent.push({ jid, text }) });
    await games.handle(asAli('!game number'), ['number']);
    await games.handle(asSana('!game lucky', { jid: OTHER }), ['lucky']);
    assert.equal(games.roundCount, 2);
    assert.equal(scores.playerOf(OTHER, [PN2]).points, 1, 'joining earns a participation point');

    for (const [cmd, args] of [['on', ['on']], ['reset tops', ['reset', 'tops']]]) {
        const denied = await games.handle(asSana(`!game ${cmd}`), args);
        assert.equal(denied.react, '⛔');
    }
    assert.equal(scores.playerCount, 1);

    const stopped = await games.handle(asAli('!game stop', { isOwner: true }), ['stop']);
    assert.equal(stopped.react, '🛑');
    assert.match(stopped.reply, /2 active round\(s\) cancelled/);
    assert.equal(games.roundCount, 0);
    assert.equal(games.enabled, false);
    assert.equal(scores.playerOf(OTHER, [PN2]).wins, 0, 'no lucky winner on cancellation');
    assert.deepEqual(sent.map((s) => s.jid), [OTHER], 'other groups are notified once');
    assert.match(sent[0].text, /cancelled/);

    assert.match((await games.handle(asSana('!game number'), ['number'])).reply, /Games are OFF/);
    assert.match((await games.guess(asSana('!guess 51'), ['51'])).reply, /Games are OFF/);
    assert.match((await games.join(asSana('!in'))).reply, /Games are OFF/);
    assert.match((await games.handle(asSana('!game addq A question? ; An answer'), ['addq', 'A question?', ';', 'An answer'])).reply, /Games are OFF/);
    assert.deepEqual(await games.handleMessage(asSana('51')), { handled: false });
    assert.match((await games.handle(asSana('!game status'), ['status'])).reply, /Games: \*OFF\*/);
    assert.match(games.board(asSana('!top', { jid: OTHER })), /Sana/, 'existing board remains readable');

    const disk = createScoreStore({ file: path.join(dir, 'scores.json') }).load();
    assert.equal(disk.gamesEnabled(true), false, 'switch survives a restart');
    assert.equal((await games.handle(asAli('!game on', { isOwner: true }), ['on'])).react, '✅');
    assert.equal(games.enabled, true);
    assert.match((await games.handle(asSana('!game coin'), ['coin'])).reply, /Coin toss/);
});

test('!game reset tops clears all leaderboards but keeps questions and game settings', async () => {
    const { games, scores, dir } = world();
    scores.win(GROUP, { ids: [PN], name: 'Ali' }, 10);
    scores.win(OTHER, { ids: [PN2], name: 'Sana' }, 6);
    scores.addQuestion({ q: 'Which instrument plays with a bow?', a: ['violin'], by: 'Ali', byKey: PN });
    await games.handle(asAli('!game math'), ['math']);
    assert.equal(games.roundCount, 1);

    const denied = await games.handle(asSana('!game reset tops'), ['reset', 'tops']);
    assert.equal(denied.react, '⛔');
    assert.equal(scores.boardAll().length, 2);
    assert.match((await games.handle(asAli('!game reset', { isOwner: true }), ['reset'])).reply, /Usage/);
    assert.equal(scores.boardAll().length, 2);

    const reset = await games.handle(asAli('!game reset tops', { isOwner: true }), ['reset', 'tops']);
    assert.equal(reset.react, '✅');
    assert.match(reset.reply, /All leaderboards reset/);
    assert.equal(scores.boardAll().length, 0);
    assert.equal(games.roundCount, 0);
    assert.equal(scores.questionCount, 1);
    assert.equal(games.enabled, true);
    assert.deepEqual(await games.handleMessage(asAli('51')), { handled: false }, 'old guess cannot score');
    const disk = createScoreStore({ file: path.join(dir, 'scores.json') }).load();
    assert.equal(disk.playerCount, 0);
    assert.equal(disk.questionCount, 1);
    await games.handle(asAli('!game coin'), ['coin']);
    await games.guess(asAli('!guess tails'), ['tails']);
    assert.equal(scores.board(GROUP)[0].points, 3, 'new scores start from zero');
});

test('GAMES=off is an initial setting: owner can enable it and the override persists', async () => {
    const { games, scores, config, dir } = world({ env: { GAMES: 'off' } });
    assert.equal(games.enabled, false);
    assert.match((await games.handle(asSana('!game number'), ['number'])).reply, /Games are OFF/);
    assert.equal((await games.handle(asSana('!game on'), ['on'])).react, '⛔');
    await games.handle(asAli('!game on', { isOwner: true }), ['on']);
    assert.equal(games.enabled, true);

    const saved = createScoreStore({ file: path.join(dir, 'scores.json') }).load();
    const restarted = createGameEngine({ config, scores: saved, autoSweep: false });
    assert.equal(restarted.enabled, true, 'persisted override wins over .env GAMES=off');
    await restarted.handle(asAli('!game stop', { isOwner: true }), ['stop']);
    assert.equal(createScoreStore({ file: path.join(dir, 'scores.json') }).load().gamesEnabled(true), false);
    assert.equal(scores.gamesEnabled(true), true, 'stores in different processes have independent in-memory state');
});

test('a pending start or guess cannot award points after a global stop/reset', async () => {
    const { games, scores } = world();
    let release;
    const waiting = new Promise((resolve) => { release = resolve; });
    const delayed = (text) => ({ ...asAli(text), groups: { nameOf: async () => { await waiting; return 'Ali'; } } });
    const starting = games.handle(delayed('!game number'), ['number']);
    await Promise.resolve();
    await games.handle(asSana('!game stop', { isOwner: true }), ['stop']);
    release();
    assert.match((await starting).reply, /Games are OFF/);
    assert.equal(games.roundCount, 0);

    await games.handle(asSana('!game on', { isOwner: true }), ['on']);
    await games.handle(asAli('!game number'), ['number']);
    let releaseGuess;
    const pending = new Promise((resolve) => { releaseGuess = resolve; });
    const guessing = games.guess({ ...asAli('!guess 51'), groups: { nameOf: async () => { await pending; return 'Ali'; } } }, ['51']);
    await Promise.resolve();
    await games.handle(asSana('!game reset tops', { isOwner: true }), ['reset', 'tops']);
    releaseGuess();
    assert.match((await guessing).reply, /ended/);
    assert.equal(scores.playerCount, 0);

    let releaseStart;
    const held = new Promise((resolve) => { releaseStart = resolve; });
    const startedBeforeReset = games.handle({
        ...asAli('!game coin'), groups: { nameOf: async () => { await held; return 'Ali'; } }
    }, ['coin']);
    await Promise.resolve();
    await games.handle(asSana('!game reset tops', { isOwner: true }), ['reset', 'tops']);
    releaseStart();
    assert.match((await startedBeforeReset).reply, /cancelled while starting/);
    assert.equal(games.roundCount, 0);
});

// ── math concepts, programming, modes, member reset ─────────────────────────
import { MATH_BANK, CODE_BANK, parseTopic } from '../src/banks.js';

test('concept banks: linear algebra, calculus, mvc and pf/oop/ds/coal at both levels', () => {
    for (const [bank, topics] of [[MATH_BANK, ['linear', 'calculus', 'mvc']], [CODE_BANK, ['pf', 'oop', 'ds', 'coal']]]) {
        assert.equal(new Set(bank.map((e) => e.q)).size, bank.length, 'no duplicate questions');
        for (const t of topics) for (const level of ['easy', 'hard']) {
            assert.ok(bank.some((e) => e.topic === t && e.level === level), `${t}/${level}`);
        }
        assert.ok(bank.every((e) => e.a.length && e.a.every((a) => a.length <= 60)));
    }
    assert.equal(parseTopic(['hard', 'linear'], 'math'), 'linear');
    assert.equal(parseTopic(['asm'], 'code'), 'coal');
});

test('looseMatches handles symbols, fractions and signs', () => {
    assert.equal(looseMatches('O(nlogn)', ['O(n log n)']), true);
    assert.equal(looseMatches('n log n', ['O(n log n)', 'n log n']), true);
    assert.equal(looseMatches('0.5', ['1/2']), true);
    assert.equal(looseMatches('3', ['-3']), false, 'a sign is never ignored');
    assert.equal(looseMatches('-3', ['-3']), true);
    assert.equal(looseMatches('CX', ['cx']), true);
    assert.equal(looseMatches('3x^2', ['3x²']), true);
    assert.equal(looseMatches('stack', ['queue']), false);
});

test('!game math linear asks a linear-algebra question and a correct answer wins', async () => {
    const { games } = world();
    const start = await games.handle(asAli('!game math hard linear'), ['math', 'hard', 'linear']);
    const round = games.active(GROUP);
    assert.equal(round.pool.topic, 'linear');
    assert.equal(round.pool.level, 'hard');
    assert.match(start.reply, /hard · linear algebra/);
    assert.deepEqual(await games.handleMessage(asSana('lol what')), { handled: false }, 'chat is ignored');
    const win = await games.handleMessage(asAli(round.accepted[0]));
    assert.equal(win.react, '🎉');
    assert.match(win.reply, /\*\+10\* pts/);
});

test('!game code: programming questions by topic, easy by default', async () => {
    const { games, scores } = world();
    const start = await games.handle(asAli('!game code coal'), ['code', 'coal']);
    const round = games.active(GROUP);
    assert.equal(round.pool.topic, 'coal');
    assert.equal(round.pool.level, 'easy');
    assert.match(start.reply, /Programming\* \(easy · COAL/);
    const miss = await games.guess(asSana('!guess banana'), ['banana']);
    assert.equal(miss.react, '❌');
    const win = await games.guess(asAli(`!guess ${round.accepted[0]}`), [round.accepted[0]]);
    assert.equal(win.react, '🎉');
    assert.equal(scores.playerOf(GROUP, [PN]).points, 6, '5 easy + 1 participation');
    assert.equal(findGame('programming').name, 'code');
});

test('!game mode hard switches math + code for this chat and persists', async () => {
    const { games, scores, tick, dir } = world();
    assert.match((await games.handle(asAli('!game mode'), ['mode'])).reply, /easy/);
    const set = await games.handle(asAli('!game mode hard'), ['mode', 'hard']);
    assert.match(set.reply, /now \*hard\*/);
    await games.handle(asAli('!game code'), ['code']);
    assert.equal(games.active(GROUP).pool.level, 'hard');
    await games.handle(asAli('!game end'), ['end']);
    tick(10_000);
    await games.handle(asAli('!game code easy'), ['code', 'easy']);
    assert.equal(games.active(GROUP).pool.level, 'easy', 'one round can override');
    assert.equal(scores.modeOf(OTHER), 'easy', 'other chats are untouched');
    assert.equal(createScoreStore({ file: path.join(dir, 'scores.json') }).load().modeOf(GROUP), 'hard');
});

test('AI math/code items are drawn and marked as used', async () => {
    const used = [];
    const aiItem = { q: 'What is the rank of a 4x4 identity matrix?', a: ['4'], level: 'easy', topic: 'linear' };
    const content = { items: (c) => (c === 'math' ? [aiItem] : []), markUsed: (c, i) => used.push([c, i.q]) };
    const { games } = world({ random: () => 0.9999, content });
    await games.handle(asAli('!game math linear'), ['math', 'linear']);
    assert.equal(games.active(GROUP).pool, aiItem);
    assert.deepEqual(used, [['math', aiItem.q]]);
});

test('!game reset @member: owner only, clears one member in this chat (or all chats)', async () => {
    const { games, scores } = world();
    scores.win(GROUP, { ids: [PN], name: 'Ali' }, 10);
    scores.win(GROUP, { ids: [PN2], name: 'Sana' }, 6);
    scores.win(OTHER, { ids: [PN2], name: 'Sana' }, 4);
    const mention = { mentioned: [`${PN2}@s.whatsapp.net`] };

    const denied = await games.handle(asSana('!game reset @Sana', mention), ['reset', '@Sana']);
    assert.equal(denied.react, '⛔');
    assert.match((await games.handle(asAli('!game reset', { isOwner: true }), ['reset'])).reply, /Usage/);

    const out = await games.handle({ ...asAli('!game reset @Sana', { isOwner: true }), ...mention }, ['reset', '@Sana']);
    assert.equal(out.react, '✅');
    assert.match(out.reply, /Sana: 6 pts cleared/);
    assert.equal(scores.playerOf(GROUP, [PN2]), null);
    assert.equal(scores.playerOf(GROUP, [PN]).points, 10, 'others keep their points');
    assert.equal(scores.playerOf(OTHER, [PN2]).points, 4, 'other chats untouched');

    const again = await games.handle({ ...asAli('x', { isOwner: true }), ...mention }, ['reset', '@Sana']);
    assert.equal(again.react, 'ℹ️');

    const typed = await games.handle(asAli('!game reset 923009876543 all', { isOwner: true }), ['reset', PN2, 'all']);
    assert.match(typed.reply, /4 pts cleared in 1 chat/);
    assert.equal(scores.playerOf(OTHER, [PN2]), null);
});
