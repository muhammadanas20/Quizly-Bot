/**
 * The scoreboard store: identity handling, points, streaks, ranking and the
 * member-contributed trivia pool.
 *
 * The identity part matters most: Baileys 7 hands the same human a phone-number
 * JID and/or a LID, and a scoreboard that stores the wrong one silently splits
 * one member into two rows.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createScoreStore, canonicalKey } from '../src/scores.js';

const GROUP = '120363000000000000@g.us';
const OTHER = '120363000000000001@g.us';
const PN = '923001234567';
const LID = '219537588899977@lid';
const PN2 = '923009876543';

function world() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scores-'));
    const file = path.join(dir, 'scores.json');
    const store = createScoreStore({ file }).load();
    return { store, file, dir };
}

test('canonicalKey prefers the phone number over the LID', () => {
    assert.equal(canonicalKey([LID, PN]), PN);
    assert.equal(canonicalKey([LID]), LID);
    assert.equal(canonicalKey([]), '');
});

test('a member is one row even when WhatsApp addresses them two ways', () => {
    const { store } = world();

    // the sender carried both identities — one row, two aliases
    store.register(GROUP, { ids: [PN, LID], name: 'Ali' });
    assert.equal(store.playerCount, 1, 'one human, one row');
    assert.equal(store.board(GROUP).length, 0, 'registering alone does not put you on the board');
    assert.equal(store.keyOf(GROUP, [LID]), PN, 'the LID resolves to the phone number');
    assert.equal(store.playerOf(GROUP, [LID]).name, 'Ali');

    // and when a new identity shows up later it can be linked to the same row
    const other = '111222333@lid';
    assert.equal(store.keyOf(GROUP, [other]), other, 'unknown until it is linked');
    assert.equal(store.link(GROUP, [PN], other), true);
    assert.equal(store.keyOf(GROUP, [other]), PN);
    assert.equal(store.link(GROUP, [PN], other), false, 'linking twice is a no-op');
    assert.equal(store.playerCount, 1);
});

test('points, wins and the streak bonus accumulate on one row', () => {
    const { store } = world();
    const who = { ids: [PN], name: 'Ali' };

    store.award(GROUP, who, 1);                       // participation
    store.win(GROUP, who, 10);
    const second = store.win(GROUP, who, 6);          // 2nd win in a row

    assert.equal(second.bonus, 1, 'the second win in a row pays a bonus point');
    const row = store.playerOf(GROUP, [PN]);
    assert.equal(row.points, 1 + 10 + 6 + 1);
    assert.equal(row.wins, 2);
    assert.equal(row.streak, 2);
    assert.equal(row.best, 2);
    assert.ok(row.lastWin);
});

test('the streak bonus is capped and a loss ends the streak', () => {
    const { store } = world();
    const who = { ids: [PN], name: 'Ali' };

    let bonus = 0;
    for (let i = 0; i < 9; i++) bonus = store.win(GROUP, who, 5).bonus;
    assert.equal(bonus, 5, 'capped at 5');
    assert.equal(store.playerOf(GROUP, [PN]).streak, 9);

    store.loseStreak(GROUP, [PN]);
    assert.equal(store.playerOf(GROUP, [PN]).streak, 0);
});

test('board ranks by points, then wins, and totals add up', () => {
    const { store } = world();
    store.award(GROUP, { ids: [PN], name: 'Ali' }, 5);
    store.win(GROUP, { ids: [PN2], name: 'Sana' }, 12);
    store.award(GROUP, { ids: ['1@lid'], name: 'Bilal' }, 1);

    const rows = store.board(GROUP);
    assert.deepEqual(rows.map((r) => r.name), ['Sana', 'Ali', 'Bilal']);
    assert.equal(store.rank(GROUP, [PN]), 2);
    assert.equal(store.rank(GROUP, ['nobody']), 0);
    assert.deepEqual(store.totals(GROUP), { players: 3, points: 18 });
});

test('boardAll merges one person across chats', () => {
    const { store } = world();
    store.award(GROUP, { ids: [PN], name: 'Ali' }, 4);
    store.award(OTHER, { ids: [PN], name: 'Ali' }, 6);
    store.award(OTHER, { ids: [PN2], name: 'Sana' }, 3);

    const rows = store.boardAll();
    assert.equal(rows[0].name, 'Ali');
    assert.equal(rows[0].points, 10);
    assert.equal(rows[0].chats, 2);
    assert.equal(rows[1].points, 3);
});

test('a renamed member shows up under the new name', () => {
    const { store } = world();
    store.register(GROUP, { ids: [PN], name: 'Ali' });
    store.register(GROUP, { ids: [PN], name: 'Muhammad Anas' });
    assert.equal(store.playerOf(GROUP, [PN]).name, 'Muhammad Anas');
});

// ── contributed trivia questions ─────────────────────────────────────────────
test('members can contribute trivia questions', () => {
    const { store } = world();
    const out = store.addQuestion({ q: 'Which city is the capital of Japan?', a: ['Tokyo', 'tokyo city'], by: 'Ali', chat: GROUP });

    assert.equal(out.ok, true);
    assert.equal(store.questionCount, 1);
    assert.deepEqual(store.questions()[0].a, ['Tokyo', 'tokyo city']);
    assert.equal(store.questions()[0].by, 'Ali');
});

test('a duplicate or empty question is refused with a reason', () => {
    const { store } = world();
    store.addQuestion({ q: 'Capital of Japan?', a: ['Tokyo'] });

    const dupe = store.addQuestion({ q: 'capital of japan', a: ['Tokyo'] });
    assert.equal(dupe.ok, false);
    assert.match(dupe.error, /already in the pool/);

    const tooShort = store.addQuestion({ q: 'Hi?', a: ['x'] });
    assert.equal(tooShort.ok, false);

    const noAnswer = store.addQuestion({ q: 'A perfectly fine question?', a: ['   '] });
    assert.equal(noAnswer.ok, false);
    assert.match(noAnswer.error, /answer is missing/);
    assert.equal(store.questionCount, 1);
});

test('the trivia pool is capped', () => {
    const { store } = world();
    const tiny = createScoreStore({ file: null, maxQuestions: 2 }).load();
    assert.equal(tiny.addQuestion({ q: 'Question one?', a: ['1'] }).ok, true);
    assert.equal(tiny.addQuestion({ q: 'Question two?', a: ['2'] }).ok, true);
    assert.equal(tiny.addQuestion({ q: 'Question three?', a: ['3'] }).ok, false);
    assert.equal(store.questionCount, 0);
});

// ── persistence ──────────────────────────────────────────────────────────────
test('scores and questions survive a restart', () => {
    const { store, file } = world();
    store.win(GROUP, { ids: [PN, LID], name: 'Ali' }, 10);
    store.addQuestion({ q: 'Capital of Japan?', a: ['Tokyo'] });
    store.flush();

    const reopened = createScoreStore({ file }).load();
    assert.equal(reopened.playerOf(GROUP, [PN]).points, 10);
    assert.equal(reopened.playerOf(GROUP, [LID]).name, 'Ali', 'the alias map is persisted too');
    assert.equal(reopened.questionCount, 1);
});

test('a corrupt file is not fatal', () => {
    const { file } = world();
    fs.writeFileSync(file, '{ this is not json');
    const store = createScoreStore({ file }).load();
    assert.equal(store.board(GROUP).length, 0);
    assert.equal(store.questionCount, 0);

    store.award(GROUP, { ids: [PN], name: 'Ali' }, 3);
    store.flush();
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).chats[GROUP].players[PN].points, 3);
});
