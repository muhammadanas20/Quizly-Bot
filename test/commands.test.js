import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { parseCommand, createCommandHandler, OWNER_ONLY, HELP_TEXT } from '../src/commands.js';
import { createFlagStore } from '../src/flags.js';
import { createRateLimiter } from '../src/limiter.js';
import { loadConfig } from '../src/config.js';
import log from '../src/log.js';

// ── parsing ──────────────────────────────────────────────────────────────────
test('parseCommand: recognises commands, aliases and arguments', () => {
    assert.deepEqual(parseCommand('!flag @Ali spamming'), { name: 'flag', args: ['@Ali', 'spamming'], raw: '!flag @Ali spamming' });
    assert.deepEqual(parseCommand('  !help  ').name, 'help');
    assert.equal(parseCommand('!ban 923001234567').name, 'flag');
    assert.equal(parseCommand('!flagged').name, 'flags');
    assert.equal(parseCommand('!solve').name, 'quiz');
    assert.equal(parseCommand('!status').name, 'stats');
});

test('parseCommand: ignores ordinary chat', () => {
    assert.equal(parseCommand('hello everyone'), null);
    assert.equal(parseCommand('quiz please'), null);
    assert.equal(parseCommand('!'), null);
    assert.equal(parseCommand('!notacommand'), null);
    assert.equal(parseCommand(''), null);
});

test('parseCommand: is case insensitive', () => {
    assert.equal(parseCommand('!FLAG 923001234567').name, 'flag');
});

// ── handler ──────────────────────────────────────────────────────────────────
function world({ isOwner = true, env = {}, groupNames = {} } = {}) {
    const flags = createFlagStore({ file: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'c-')), 'f.json') });
    const config = loadConfig({ OWNER_NUMBERS: '923001234567', GEMINI_API_KEY: 'k', ...env });
    let solved = 0;

    const groups = {
        subjectOf: () => 'G',
        nameOf   : async (jid, id) => groupNames[id] || ''
    };

    const handler = createCommandHandler({
        config,
        flags,
        log,
        guard   : { stats: { deleted: 3, skippedNotAdmin: 1, byUser: new Map([['Ali', 3]]) } },
        limiter : createRateLimiter({ perMinute: 12, perDay: 800 }),
        groups,
        startedAt: Date.now() - 90_000,
        solveNow: async () => { solved++; return { ok: true }; }
    });

    const ctx = (text, over = {}) => ({
        text,
        msg     : { key: { remoteJid: 'g@g.us', id: 'X' } },
        jid     : 'g@g.us',
        isGroup : true,
        isOwner,
        senderLabel: '923001234567@s.whatsapp.net',
        mentioned  : [],
        quotedParticipant: null,
        groups,
        ...over
    });

    return { handler, flags, config, ctx, solvedCount: () => solved };
}

test('!help answers anyone and names the configured trigger', async () => {
    const { handler, ctx } = world({ isOwner: false, env: { QUIZ_TRIGGER: 'solve' } });
    const out = await handler.handle(ctx('!help'));
    assert.equal(out.handled, true);
    assert.match(out.reply, /solve/);
    assert.ok(!out.reply.includes('{TRIGGER}'));
});

test('owner-only commands are refused for everyone else', async () => {
    const { handler, ctx } = world({ isOwner: false });
    for (const name of OWNER_ONLY) {
        const out = await handler.handle(ctx(`!${name}`));
        assert.equal(out.handled, true);
        assert.match(out.reply, /Only the bot owner/);
        assert.equal(out.react, '⛔', 'the refusal is confirmed on the message itself');
    }
});

// ── confirmation reactions ───────────────────────────────────────────────────
test('!flag and !unflag both confirm with a reaction on the command message', async () => {
    const { handler, flags, ctx } = world();
    const flagged = await handler.handle(ctx('!flag 923009876543 spam'));
    assert.equal(flagged.react, '🚩');
    assert.equal(flags.has(new Set(['923009876543'])), true);

    const unflagged = await handler.handle(ctx('!unflag 923009876543'));
    assert.equal(unflagged.react, '✅');
    assert.equal(flags.has(new Set(['923009876543'])), false);

    const missed = await handler.handle(ctx('!unflag 923009876543'));
    assert.equal(missed.react, 'ℹ️', 'a no-op still answers, so silence never means "maybe"');
    assert.match(missed.reply, /Not flagged/);
});

// ── identity handling (the LID / phone-number split) ─────────────────────────
test('!flag by @mention stores the phone number too, so the guard and !unflag agree', async () => {
    const { handler, flags, ctx } = world();
    const expand = (raw) => (String(raw).endsWith('@lid') ? [raw, '923009876543'] : [raw]);

    await handler.handle(ctx('!flag', {
        mentioned: ['219537588899977@lid'],
        expandIds: expand
    }));

    // matched by LID…
    assert.equal(flags.has(new Set(['219537588899977@lid'])), true);
    // …and by the phone number the same person's messages actually carry
    assert.equal(flags.has(new Set(['923009876543'])), true);

    // and !unflag by the plain number now finds it
    const out = await handler.handle(ctx('!unflag 923009876543'));
    assert.match(out.reply, /Unflagged/);
    assert.equal(flags.has(new Set(['219537588899977@lid'])), false);
});

test('!flag by @mention labels the entry with the member name, not the raw LID', async () => {
    const { handler, flags, ctx } = world({ groupNames: { '219537588899977@lid': 'Muhammad Anas' } });
    const out = await handler.handle(ctx('!flag @Muhammad Anas test', {
        mentioned: ['219537588899977@lid'],
        expandIds: (raw) => [raw]
    }));

    assert.match(out.reply, /Flagged Muhammad Anas/);
    const entry = flags.find(new Set(['219537588899977@lid'])).entry;
    assert.equal(entry.label, 'Muhammad Anas');
    // the mention's display name must not be swallowed into the reason
    assert.equal(entry.reason, 'test');
});

test('!flag adds a member by typed number and confirms', async () => {
    const { handler, flags, ctx } = world();
    const out = await handler.handle(ctx('!flag 923009876543 spamming stickers'));
    assert.equal(out.handled, true);
    assert.equal(flags.has(new Set(['923009876543'])), true);
    assert.match(out.reply, /Flagged 923009876543/);
    assert.equal(flags.find(new Set(['923009876543'])).entry.reason, 'spamming stickers');
});

test('!flag works from an @mention', async () => {
    const { handler, flags, ctx } = world();
    const out = await handler.handle(ctx('!flag', { mentioned: ['923009876543@s.whatsapp.net'] }));
    assert.equal(flags.has(new Set(['923009876543'])), true);
    assert.match(out.reply, /Flagged/);
});

test('!flag without a target explains the usage', async () => {
    const { handler, ctx } = world();
    const out = await handler.handle(ctx('!flag'));
    assert.match(out.reply, /Usage: !flag/);
});

test('!flag with media= overrides the global media setting for that person', async () => {
    const { handler, flags, ctx } = world();
    const out = await handler.handle(ctx('!flag 923009876543 media=sticker,link spamming'));
    assert.deepEqual(flags.find(new Set(['923009876543'])).entry.media, ['sticker', 'link']);
    assert.equal(flags.find(new Set(['923009876543'])).entry.reason, 'spamming');
    assert.match(out.reply, /Their sticker\/link will be removed/);
});

test('!flag ignores an invalid media kind', async () => {
    const { handler, flags, ctx } = world();
    await handler.handle(ctx('!flag 923009876543 media=bananas'));
    assert.equal(flags.find(new Set(['923009876543'])).entry.media, null);
});

test('!flags lists people and how much was removed', async () => {
    const { handler, flags, ctx } = world();
    flags.add(new Set(['923009876543']), { label: 'Ali' });
    flags.bumpDeleted(new Set(['923009876543']));
    const out = await handler.handle(ctx('!flags'));
    assert.match(out.reply, /Ali — 1 removed/);
});

test('!flags with nobody flagged says so', async () => {
    const { handler, ctx } = world();
    assert.match((await handler.handle(ctx('!flags'))).reply, /Nobody is flagged/);
});

test('!unflag removes and reports misses', async () => {
    const { handler, flags, ctx } = world();
    flags.add(new Set(['923009876543']), { label: 'Ali' });
    const out = await handler.handle(ctx('!unflag 923009876543 923000000000'));
    assert.equal(flags.has(new Set(['923009876543'])), false);
    assert.match(out.reply, /Unflagged 923009876543/);
    assert.match(out.reply, /Not flagged: 923000000000/);
});

test('!guard toggles the live setting', async () => {
    const { handler, config, ctx } = world();
    assert.equal(config.guardEnabled, true);
    assert.match((await handler.handle(ctx('!guard off'))).reply, /now OFF/);
    assert.equal(config.guardEnabled, false);
    assert.match((await handler.handle(ctx('!guard on'))).reply, /now ON/);
    assert.equal(config.guardEnabled, true);
    assert.match((await handler.handle(ctx('!guard status'))).reply, /Guard is ON/);
    assert.match((await handler.handle(ctx('!guard wibble'))).reply, /Usage/);
});

test('!quiz delegates to the solver', async () => {
    const { handler, ctx, solvedCount } = world();
    const out = await handler.handle(ctx('!quiz'));
    assert.equal(out.handled, true);
    assert.equal(solvedCount(), 1);
    assert.equal(out.reply, null);
});

test('!ping and !stats report memory and counters', async () => {
    const { handler, ctx } = world();
    assert.match((await handler.handle(ctx('!ping'))).reply, /pong · \d+ MB RSS/);
    const stats = (await handler.handle(ctx('!stats'))).reply;
    assert.match(stats, /Guard: ON/);
    assert.match(stats, /Removed this session: 3/);
    assert.match(stats, /Top offenders: Ali \(3\)/);
    assert.match(stats, /Memory: \d+ MB/);
});

test('a non-command returns handled:false so the quiz path still runs', async () => {
    const { handler, ctx } = world();
    assert.deepEqual(await handler.handle(ctx('quiz please')), { handled: false });
});

test('HELP_TEXT mentions the silent-delete behaviour', () => {
    assert.match(HELP_TEXT, /never replies in the group/);
});
