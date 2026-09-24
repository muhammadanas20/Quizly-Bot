/**
 * Integration tests for the message router — the place where the guard, the
 * commands and the quiz solver meet. Driven with a fake socket, so the real
 * decision path runs without a WhatsApp connection.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createRouter, shouldIgnore } from '../src/router.js';
import { createFlagStore } from '../src/flags.js';
import { createGuard } from '../src/guard.js';
import { createGroupCache } from '../src/groups.js';
import { createRateLimiter, createInflight } from '../src/limiter.js';
import { createQuizHandler } from '../src/quiz.js';
import { createCommandHandler } from '../src/commands.js';
import { createScoreStore } from '../src/scores.js';
import { createGameEngine } from '../src/games.js';
import { createRandomTools } from '../src/random.js';
import { loadConfig } from '../src/config.js';
import log from '../src/log.js';

const GROUP = '120363000000000000@g.us';
const BOT = '923001234567@s.whatsapp.net';
const OWNER = '923001234567';
const TARGET = '923009876543@s.whatsapp.net';

const ANSWER = JSON.stringify({
    questions: [{ n: 1, question: 'Capital of Pakistan?', reason: 'Islamabad replaced Karachi in the 1960s.', answer: 'B — Islamabad' }]
});

function world({ env = {}, botIsAdmin = true, fetchImpl, random = () => 0.5 } = {}) {
    const sent = [];
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'router-'));
    const config = loadConfig({ OWNER_NUMBERS: OWNER, GEMINI_API_KEY: 'k', ...env });

    const sock = {
        sendMessage   : async (jid, content) => { sent.push({ jid, content }); return { key: { id: 'S' } }; },
        groupMetadata : async () => ({
            id      : GROUP,
            subject : 'Study Group',
            participants: [
                { id: BOT, admin: botIsAdmin ? 'admin' : null },
                { id: TARGET, admin: null }
            ]
        }),
        signalRepository: { lidMapping: { getPNForLID: () => undefined } }
    };

    const flags = createFlagStore({ file: path.join(dir, 'flags.json') }).load();
    const limiter = createRateLimiter({ perMinute: 50, perDay: 500 });
    const inflight = createInflight();
    const groups = createGroupCache({ sock, getMe: () => BOT, log });

    const guard = createGuard({ sock, flags, config, log, isAdmin: (j) => groups.isAdmin(j) });

    config.fetchImpl = fetchImpl || (async () => ({
        status: 200,
        text  : async () => JSON.stringify({ candidates: [{ content: { parts: [{ text: ANSWER }] } }] })
    }));

    const quiz = createQuizHandler({
        sock, config, log, limiter, inflight, groups,
        download: async () => Buffer.from([0xff, 0xd8, 0xff])
    });

    // games: the same wiring bot.js uses, minus the auto-sweep timer
    const scores = createScoreStore({ file: path.join(dir, 'scores.json') }).load();
    const games = createGameEngine({
        config, log, scores, groups, random, autoSweep: false,
        send: async (jid, text) => { sent.push({ jid, content: { text } }); }
    });

    const commands = createCommandHandler({
        config, flags, log, guard, limiter, groups, games, scores,
        randomTools: createRandomTools({ random }),
        startedAt: Date.now(),
        solveNow : (ctx) => quiz.solve(ctx.msg, { isGroup: ctx.isGroup, chatName: ctx.chatName })
    });

    const router = createRouter({ sock, config, log, flags, guard, groups, quiz, commands, games });

    const texts = () => sent.filter((s) => s.content.text).map((s) => s.content.text);
    const deletes = () => sent.filter((s) => s.content.delete);
    const reacts = () => sent.filter((s) => s.content.react).map((s) => s.content.react.text);
    const lastText = () => texts().filter(Boolean).pop();
    const lastReact = () => reacts().pop();

    return { router, sent, texts, lastText, lastReact, deletes, reacts, flags, scores, games, config, sock };
}

const msg = (over = {}) => ({
    key    : { remoteJid: GROUP, participant: TARGET, fromMe: false, id: 'M1' },
    message: { conversation: 'hello' },
    ...over
});

const sticker = () => msg({ message: { stickerMessage: { url: 'u', mimetype: 'image/webp' } } });
const quizMsg = () => msg({ message: { imageMessage: { url: 'u', mimetype: 'image/jpeg', caption: 'quiz please' } } });

// ── routing hygiene ──────────────────────────────────────────────────────────
test('shouldIgnore: statuses, channels and broadcasts are skipped', () => {
    assert.equal(shouldIgnore('status@broadcast'), true);
    assert.equal(shouldIgnore('abc@newsletter'), true);
    assert.equal(shouldIgnore('abc@broadcast'), true);
    assert.equal(shouldIgnore(GROUP), false);
    assert.equal(shouldIgnore(''), true);
});

test('router: an ordinary message produces zero WhatsApp calls', async () => {
    const { router, sent } = world();
    const res = await router.processMessage(msg());
    assert.deepEqual(res, { nothing: true });
    assert.equal(sent.length, 0);
});

test('router: the bot never reacts to its own message', async () => {
    const { router, sent } = world();
    const res = await router.processMessage(msg({ key: { remoteJid: GROUP, participant: BOT, fromMe: true, id: 'X' } }));
    assert.deepEqual(res, { own: true });
    assert.equal(sent.length, 0);
});

// ── commands typed on the bot's own account ──────────────────────────────────
// Driving the bot from the phone it runs on is the normal thing to do, and it
// used to be silently dropped: the router returned `own` before the command
// handler ever ran, so !flag / !unflag appeared to do nothing at all.
const ownCmd = (text, mentioned = []) => ({
    key    : { remoteJid: GROUP, participant: BOT, fromMe: true, id: 'OWN1' },
    message: mentioned.length
        ? { extendedTextMessage: { text, contextInfo: { mentionedJid: mentioned } } }
        : { conversation: text }
});

test('router: !flag typed on the bot\'s own account still flags, and confirms with a reaction', async () => {
    const { router, flags, sent, reacts } = world();
    const res = await router.processMessage(ownCmd('!flag 923009876543 sticker spam'));

    assert.deepEqual(res, { command: 'flag' });
    assert.equal(flags.has(new Set(['923009876543'])), true);
    assert.deepEqual(reacts(), ['🚩'], 'the reaction is the confirmation');
    assert.match(sent.find((s) => s.content.text).content.text, /Flagged 923009876543/);
});

test('router: !unflag typed on the bot\'s own account still unflags', async () => {
    const { router, flags, reacts, texts } = world();
    flags.add(new Set(['923009876543']), { label: 'Spammer' });

    await router.processMessage(ownCmd('!unflag 923009876543'));

    assert.equal(flags.has(new Set(['923009876543'])), false);
    assert.deepEqual(reacts(), ['✅']);
    assert.match(texts()[0], /Unflagged 923009876543/);
});

test('router: !flag by @mention from the bot\'s own account resolves the mention', async () => {
    const { router, flags } = world();
    await router.processMessage(ownCmd('!flag @Ali spam', ['923009876543@s.whatsapp.net']));
    assert.equal(flags.has(new Set(['923009876543'])), true);
});

test('router: the bot\'s own quiz trigger never re-solves its own answer', async () => {
    // the bot's answer quotes the quiz image, so re-processing it would loop
    const { router, sent } = world();
    const res = await router.processMessage({
        key    : { remoteJid: GROUP, participant: BOT, fromMe: true, id: 'OWN2' },
        message: {
            extendedTextMessage: {
                text       : '*Quiz solved* · 1 question',
                contextInfo: { stanzaId: 'Q1', quotedMessage: { imageMessage: { url: 'u' } } }
            }
        }
    });

    assert.deepEqual(res, { own: true });
    assert.equal(sent.filter((s) => s.content.text).length, 0, 'no second answer is produced');
});

test('router: an unknown "!command" is ignored, not an error', async () => {
    const { router, sent } = world();
    const res = await router.processMessage(msg({ message: { conversation: '!wibble' } }));
    assert.deepEqual(res, { unknownCommand: true });
    assert.equal(sent.length, 0);
});

// ── guard first, always ──────────────────────────────────────────────────────
test('router: a flagged member\'s sticker is deleted with no message sent', async () => {
    const { router, flags, sent, texts, deletes } = world();
    flags.add(new Set(['923009876543']), { label: 'Spammer' });

    const res = await router.processMessage(sticker());

    assert.deepEqual(res, { guarded: true }, 'the revoked media is not routed further');
    assert.equal(deletes().length, 1, 'exactly one revoke');
    assert.equal(texts().length, 0, 'the bot must not say anything');
    assert.equal(sent[0].content.delete.id, 'M1');
});

test('router: flagged photos, including view-once, are revoked before quiz processing', async () => {
    const { router, flags, sent, texts, deletes } = world();
    flags.add(new Set(['923009876543']), { label: 'Spammer' });

    const normalPhoto = msg({
        key: { remoteJid: GROUP, participant: TARGET, fromMe: false, id: 'IMG1' },
        message: { imageMessage: { url: 'u', mimetype: 'image/jpeg', caption: 'quiz please' } }
    });
    const viewOncePhoto = msg({
        key: { remoteJid: GROUP, participant: TARGET, fromMe: false, id: 'IMG2' },
        message: { viewOnceMessageV2: { message: { imageMessage: { url: 'u', mimetype: 'image/jpeg', caption: 'quiz please' } } } }
    });

    assert.deepEqual(await router.processMessage(normalPhoto), { guarded: true });
    assert.deepEqual(await router.processMessage(viewOncePhoto), { guarded: true });
    assert.deepEqual(deletes().map((s) => s.content.delete.id), ['IMG1', 'IMG2']);
    assert.equal(texts().length, 0, 'deleted photos are never sent to the quiz solver or posted');
});

test('router: the guard runs even for a sender who is not the owner', async () => {
    const { router, flags, deletes } = world({ botIsAdmin: true });
    flags.add(new Set(['923009876543']));
    await router.processMessage(sticker());
    assert.equal(deletes().length, 1);
});

test('router: without admin rights the sticker survives and the bot stays quiet', async () => {
    const { router, flags, sent } = world({ botIsAdmin: false });
    flags.add(new Set(['923009876543']));
    await router.processMessage(sticker());
    assert.equal(sent.length, 0);
});

test('router: blocked photos are not sent to the quiz solver when the bot is not admin', async () => {
    const { router, flags, sent, texts } = world({ botIsAdmin: false });
    flags.add(new Set(['923009876543']));

    const res = await router.processMessage(msg({
        message: { viewOnceMessageV2: { message: { imageMessage: { url: 'u', caption: 'quiz please' } } } }
    }));

    assert.deepEqual(res, { guarded: true });
    assert.equal(sent.length, 0, 'the bot cannot revoke without admin rights');
    assert.equal(texts().length, 0, 'blocked media still must not reach the quiz solver');
});

test('router: GUARD_WHITELIST protects a number even when it is flagged', async () => {
    const flaggedSticker = (id) => msg({
        key    : { remoteJid: GROUP, participant: `${id}@s.whatsapp.net`, fromMe: false, id: 'M9' },
        message: { stickerMessage: { url: 'u' } }
    });

    const unprotected = world();
    unprotected.flags.add(new Set([OWNER]));
    await unprotected.router.processMessage(flaggedSticker(OWNER));
    assert.equal(unprotected.sent.filter((s) => s.content.delete).length, 1);

    const protected_ = world({ env: { GUARD_WHITELIST: OWNER } });
    protected_.flags.add(new Set([OWNER]));
    await protected_.router.processMessage(flaggedSticker(OWNER));
    assert.equal(protected_.sent.length, 0, 'a whitelisted number keeps its stickers');
});

// ── commands ─────────────────────────────────────────────────────────────────
test('router: the owner can flag someone mid-conversation', async () => {
    const { router, flags, texts } = world();
    await router.processMessage(msg({
        key    : { remoteJid: GROUP, participant: BOT, fromMe: false, id: 'C1' },
        message: { conversation: '!flag 923009876543 sticker spam' }
    }));

    assert.equal(flags.has(new Set(['923009876543'])), true);
    assert.match(texts()[0], /Flagged 923009876543/);

    // and the very next sticker from that person disappears
    await router.processMessage(sticker());
    assert.equal(texts().length, 1, 'deleting a sticker adds no message');
});

test('router: a non-owner is refused', async () => {
    const { router, flags, texts } = world();
    await router.processMessage(msg({ message: { conversation: '!flag 923009876543' } }));
    assert.equal(flags.count, 0);
    assert.match(texts()[0], /Only the bot owner/);
});

test('router: a throwing command is reported, not swallowed', async () => {
    const w = world();
    // force an internal failure by replacing the flags store with a broken one
    w.flags.add = () => { throw new Error('disk full'); };
    await w.router.processMessage(msg({
        key    : { remoteJid: GROUP, participant: BOT, fromMe: false, id: 'C2' },
        message: { conversation: '!flag 923009876543' }
    }));
    assert.match(w.texts()[0], /That command failed: disk full/);
});

// ── quiz ─────────────────────────────────────────────────────────────────────
test('router: "quiz" + image answers with question → reason → answer', async () => {
    const { router, texts, reacts } = world();
    const res = await router.processMessage(quizMsg());

    assert.equal(res.quiz.ok, true);
    const body = texts().find((t) => t.includes('Quiz solved'));
    assert.match(body, /\*Q1\.\* Capital of Pakistan\?/);
    assert.match(body, /💡 Islamabad replaced Karachi in the 1960s\./);
    assert.match(body, /✅ \*B — Islamabad\*/);
    assert.deepEqual(reacts(), ['👀', '✅']);
});

test('router: "quiz" without an image does nothing', async () => {
    const { router, sent } = world();
    const res = await router.processMessage(msg({ message: { conversation: 'anyone up for a quiz' } }));
    assert.deepEqual(res, { nothing: true });
    assert.equal(sent.length, 0);
});

test('router: an image with no trigger word does nothing', async () => {
    const { router, sent } = world();
    const res = await router.processMessage(msg({ message: { imageMessage: { url: 'u', mimetype: 'image/jpeg' } } }));
    assert.deepEqual(res, { nothing: true });
    assert.equal(sent.length, 0);
});

test('router: the configured trigger word is respected', async () => {
    const { router, texts } = world({ env: { QUIZ_TRIGGER: 'solve' } });
    await router.processMessage(msg({ message: { imageMessage: { url: 'u', mimetype: 'image/jpeg', caption: 'solve this' } } }));
    assert.ok(texts().some((t) => t.includes('Quiz solved')));
});

test('router: in a private chat the quiz still works but the guard does not', async () => {
    const { router, flags, sent, texts } = world();
    flags.add(new Set(['923009876543']));

    // a sticker in a DM is left alone (the guard is group-only)
    await router.processMessage(msg({
        key    : { remoteJid: TARGET, fromMe: false, id: 'D1' },
        message: { stickerMessage: { url: 'u' } }
    }));
    assert.equal(sent.filter((s) => s.content.delete).length, 0);

    // but a quiz in a DM is answered
    await router.processMessage(msg({
        key    : { remoteJid: TARGET, fromMe: false, id: 'D2' },
        message: { imageMessage: { url: 'u', mimetype: 'image/jpeg', caption: 'quiz' } }
    }));
    assert.ok(texts().some((t) => t.includes('Quiz solved')));
});

test('router: a failing AI is reported to the group', async () => {
    const { router, texts, reacts } = world({
        fetchImpl: async () => ({ status: 401, text: async () => '{"error":{"message":"bad key"}}' })
    });
    const res = await router.processMessage(quizMsg());
    assert.equal(res.quiz.ok, false);
    assert.match(texts()[0], /API key rejected/);
    assert.deepEqual(reacts(), ['👀', '❌']);
});

// ── games ────────────────────────────────────────────────────────────────────
// The whole point of routing games before the quiz solver: a bare "51" from a
// member is a guess while a round is running, and the round is played through
// the same deliver() path as the commands (reaction + one reply).
const OTHER = '923001111111@s.whatsapp.net';

test('router: !game starts a round and a bare number from another member wins it', async () => {
    const { router, texts, reacts, scores, games } = world();      // RNG 0.5 → 51

    await router.processMessage(msg({
        key    : { remoteJid: GROUP, participant: OWNER + '@s.whatsapp.net', fromMe: false, id: 'G1' },
        message: { conversation: '!game number 1-100' }
    }));
    assert.match(texts()[0], /Guess the number/);
    assert.equal(games.active(GROUP).answer, 51);

    // a plain "20" is a guess, not chat
    const a = await router.processMessage(msg({ message: { conversation: '20' } }));
    assert.deepEqual(a, { game: true });
    assert.match(texts()[1], /Too low/);

    // another member wins with a plain number too
    const b = await router.processMessage(msg({
        key    : { remoteJid: GROUP, participant: OTHER, fromMe: false, id: 'G2' },
        message: { conversation: '51' }
    }));
    assert.deepEqual(b, { game: true });
    assert.equal(reacts().pop(), '🎉');
    assert.match(texts().pop(), /wins! the number was \*51\*/);
    assert.equal(games.active(GROUP), null);
    assert.equal(scores.board(GROUP).length, 2, 'both members are on the board');
});

test('router: a quiz screenshot still reaches the solver while a round is running', async () => {
    const { router, texts, games } = world();

    await router.processMessage(msg({ message: { conversation: '!game number 1-100' } }));
    assert.ok(games.active(GROUP), 'the round is on');

    const res = await router.processMessage(quizMsg());
    assert.equal(res.quiz.ok, true, 'the quiz trigger wins over the game');
    assert.ok(texts().some((t) => t.includes('Quiz solved')));
    assert.ok(games.active(GROUP), 'and it does not end the round');
});

test('router: a plain message is ignored when no round is running', async () => {
    const { router, sent } = world();
    const res = await router.processMessage(msg({ message: { conversation: '51' } }));
    assert.deepEqual(res, { nothing: true });
    assert.equal(sent.length, 0);
});

test('router: the caption of a revoked photo can never win a round', async () => {
    const { router, flags, sent, texts, games, scores } = world();
    // the owner starts the round; TARGET (flagged) sends the answer as a caption
    flags.add(new Set(['923009876543']), { label: 'Spammer' });
    await router.processMessage(msg({
        key    : { remoteJid: GROUP, participant: OWNER + '@s.whatsapp.net', fromMe: false, id: 'G0' },
        message: { conversation: '!game number 1-100' }
    }));
    const before = texts().length;

    const res = await router.processMessage(msg({
        message: { imageMessage: { url: 'u', mimetype: 'image/jpeg', caption: '51' } }
    }));

    assert.deepEqual(res, { guarded: true });
    assert.equal(sent.filter((s) => s.content.delete).length, 1, 'the photo is revoked');
    assert.equal(texts().length, before, 'and its caption is not fed to the game');
    assert.ok(games.active(GROUP), 'the round is still on');
    assert.equal(scores.playerOf(GROUP, ['923009876543']), null, 'nothing was credited to them');
});

test('router: !guess, !top and the instant random commands are all reachable', async () => {
    const { router, texts, lastText, lastReact } = world();

    await router.processMessage(msg({ message: { conversation: '!game trivia' } }));
    await router.processMessage(msg({ message: { conversation: '!guess London' } }));
    assert.equal(lastReact(), '❌');
    assert.match(lastText(), /London is not it/, 'an explicit wrong guess gets a one-liner');

    await router.processMessage(msg({ message: { conversation: '!roll 2d6' } }));
    assert.match(texts().pop(), /2d6 → 4 \+ 4 = \*8\*/);

    await router.processMessage(msg({ message: { conversation: '!random 1-100' } }));
    assert.match(texts().pop(), /\*51\*/);

    await router.processMessage(msg({ message: { conversation: '!flip' } }));
    assert.match(texts().pop(), /\*Tails\*/);

    await router.processMessage(msg({ message: { conversation: '!game stop' } }));
    const stopped = texts().pop();
    assert.match(stopped, /Next round: `!game trivia`/, 'the starter can end their own round');

    await router.processMessage(msg({ message: { conversation: '!top' } }));
    assert.match(texts().pop(), /Top players — Study Group/);
});

test('router: a lucky draw is played with !game lucky, !in and !game draw', async () => {
    const { router, texts, scores } = world();

    await router.processMessage(msg({ message: { conversation: '!game lucky' } }));
    assert.match(texts().pop(), /Ali is in|is in!/);

    await router.processMessage(msg({
        key    : { remoteJid: GROUP, participant: OTHER, fromMe: false, id: 'L2' },
        message: { conversation: '!in' }
    }));
    assert.match(texts().pop(), /2 joined/);

    await router.processMessage(msg({ message: { conversation: '!game draw' } }));
    const drawn = texts().pop();
    assert.match(drawn, /wins the lucky draw/);
    assert.equal(scores.board(GROUP).length, 2, 'every entrant earned a point');
    assert.equal(scores.boardAll()[0].points >= 8, true);
});

test('router: an unknown "!game chess" answers instead of going quiet', async () => {
    const { router, texts, lastReact } = world();
    const res = await router.processMessage(msg({ message: { conversation: '!game chess' } }));
    assert.deepEqual(res, { command: 'game' });
    assert.equal(lastReact(), '⚠️');
    assert.match(texts().pop(), /do not know the game/);
});

test('router: a bot-authored game message is never treated as a guess', async () => {
    const { router, sent, games } = world();
    await router.processMessage(msg({ message: { conversation: '!game number 1-100' } }));

    const res = await router.processMessage({
        key    : { remoteJid: GROUP, participant: BOT, fromMe: true, id: 'B1' },
        message: { conversation: '51' }
    });
    assert.deepEqual(res, { own: true });
    assert.ok(games.active(GROUP), 'the round is untouched by the bot quoting a number');
    assert.equal(sent.filter((s) => s.content.text).length, 1, 'only the round announcement');
});
