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
import { loadConfig } from '../src/config.js';
import log from '../src/log.js';

const GROUP = '120363000000000000@g.us';
const BOT = '923001234567@s.whatsapp.net';
const OWNER = '923001234567';
const TARGET = '923009876543@s.whatsapp.net';

const ANSWER = JSON.stringify({
    questions: [{ n: 1, question: 'Capital of Pakistan?', reason: 'Islamabad replaced Karachi in the 1960s.', answer: 'B — Islamabad' }]
});

function world({ env = {}, botIsAdmin = true, fetchImpl } = {}) {
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

    const commands = createCommandHandler({
        config, flags, log, guard, limiter, groups,
        startedAt: Date.now(),
        solveNow : (ctx) => quiz.solve(ctx.msg, { isGroup: ctx.isGroup, chatName: ctx.chatName })
    });

    const router = createRouter({ sock, config, log, flags, guard, groups, quiz, commands });

    const texts = () => sent.filter((s) => s.content.text).map((s) => s.content.text);
    const deletes = () => sent.filter((s) => s.content.delete);
    const reacts = () => sent.filter((s) => s.content.react).map((s) => s.content.react.text);

    return { router, sent, texts, deletes, reacts, flags, config, sock };
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

    assert.equal(res.nothing, true, 'the sticker is not a quiz and not a command');
    assert.equal(deletes().length, 1, 'exactly one revoke');
    assert.equal(texts().length, 0, 'the bot must not say anything');
    assert.equal(sent[0].content.delete.id, 'M1');
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
