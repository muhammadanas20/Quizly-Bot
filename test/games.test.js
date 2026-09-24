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

import { createGameEngine, GAMES, findGame, answerMatches, normalizeAnswer, hotCold, scrambleWord, makeMath, WORDS } from '../src/games.js';
import { createScoreStore } from '../src/scores.js';
import { loadConfig } from '../src/config.js';
import log from '../src/log.js';

const GROUP = '120363000000000000@g.us';
const PN = '923001234567';
const PN2 = '923009876543';

const half = () => 0.5;
const seq = (values) => {
    let i = 0;
    return () => values[Math.min(i++, values.length - 1)];
};

function world({ random = half, env = {}, send = null } = {}) {
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
            assert.equal(p.answer, eval(p.question.replace(/×/g, '*').replace(/−/g, '-')), p.question);
            assert.ok(p.points > 0);
        }
    }
});

test('every advertised game can be started by its canonical name', () => {
    assert.equal(GAMES.length, 8);
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

// ── dice, coin, slots ────────────────────────────────────────────────────────
test('!game dice: the die is 4 with this RNG', async () => {
    const { games } = world();
    await games.handle(asAli('!game dice'), ['dice']);
    assert.equal(games.active(GROUP).answer, 4);

    const hint = await games.guess(asAli('!guess 2'), ['2']);
    assert.match(hint.reply, /higher than 2/);

    const win = await games.guess(asAli('!guess 4'), ['4']);
    assert.match(win.reply, /the die was \*4\*/);
    assert.match(win.reply, /\*\+6\* pts/);
});

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

test('!game slots pays a pair and a jackpot, and stops on the jackpot', async () => {
    // reels [5, 5, 2]: digit 5 pays a pair, digit 2 pays nothing
    const pair = world({ random: seq([0.5, 0.5, 0.2]) });
    await pair.games.handle(asAli('!game slots'), ['slots']);
    assert.deepEqual(pair.games.active(GROUP).reels, [5, 5, 2]);

    const paid = await pair.games.guess(asAli('!guess 5'), ['5']);
    assert.equal(paid.react, '✅');
    assert.match(paid.reply, /two on the reels/);
    assert.equal(pair.scores.playerOf(GROUP, [PN]).points, 3 + 1, 'pair + participation');

    const nothing = await pair.games.guess(asSana('!guess 8'), ['8']);
    assert.equal(nothing.react, '❌');

    const oneEach = await pair.games.guess(asSana('!guess 5'), ['5']);
    assert.match(oneEach.reply, /One pick each/);

    // three reels the same: jackpot, and the round closes with the reveal
    const jackpot = world();                            // 0.5 → reels [5, 5, 5]
    await jackpot.games.handle(asAli('!game slots'), ['slots']);
    assert.deepEqual(jackpot.games.active(GROUP).reels, [5, 5, 5]);
    const hit = await jackpot.games.guess(asAli('!guess 5'), ['5']);
    assert.equal(hit.react, '🎉');
    assert.match(hit.reply, /THREE of a kind/);
    assert.match(hit.reply, /🎮 Ali \+16/, 'the jackpot plus the participation point');
    assert.equal(jackpot.games.active(GROUP), null);
    assert.equal(jackpot.scores.playerOf(GROUP, [PN]).points, 15 + 1);
});

// ── math, scramble, trivia ───────────────────────────────────────────────────
test('!game math asks a random sum and the first right answer takes it', async () => {
    const { games } = world();
    const start = await games.handle(asAli('!game math'), ['math']);
    const round = games.active(GROUP);
    assert.match(start.reply, new RegExp(round.problem.question.replace(/[+×−()]/g, (c) => `\\${c}`)));

    await games.guess(asSana('!guess 1'), ['1']);
    const win = await games.guess(asAli('!guess ' + round.answer), [String(round.answer)]);
    assert.match(win.reply, new RegExp(`the answer was \\*${round.answer}\\*`));
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

    const owner = await games.handle(asSana('!game stop', { isOwner: true }), ['stop']);
    assert.equal(owner.react, '🛑');
    assert.match(owner.reply, /the number was \*51\*/);
    assert.equal(games.active(GROUP), null);
});

test('a stranger cannot replace a running round, the starter can', async () => {
    const { games } = world();
    await games.handle(asAli('!game number'), ['number']);

    const blocked = await games.handle(asSana('!game dice'), ['dice']);
    assert.equal(blocked.react, '⏳');
    assert.match(blocked.reply, /already running|still running/);
    assert.equal(games.active(GROUP).name, 'number');

    const replaced = await games.handle(asAli('!game dice'), ['dice']);
    assert.match(replaced.reply, /Dice/);
    assert.equal(games.active(GROUP).name, 'dice');
});

test('a new round waits out the cooldown after the last one', async () => {
    const { games, tick, config } = world();
    await games.handle(asAli('!game number'), ['number']);
    await games.guess(asAli('!guess 51'), ['51']);

    const tooSoon = await games.handle(asAli('!game dice'), ['dice']);
    assert.equal(tooSoon.react, '⏳');
    assert.match(tooSoon.reply, /breather/);

    tick(config.gameCooldownMs + 1000);
    const ok = await games.handle(asAli('!game dice'), ['dice']);
    assert.match(ok.reply, /Dice/);
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
