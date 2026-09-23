import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createFlagStore } from '../src/flags.js';

const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'flags-')), 'flags.json');

test('add + has: a flagged number is found by any of its spellings', () => {
    const store = createFlagStore({ file: tmp() });
    store.add(new Set(['923001234567']), { label: 'Ali' });

    assert.equal(store.has(new Set(['923001234567'])), true);
    assert.equal(store.has(new Set(['923009999999'])), false);
    assert.equal(store.has(new Set([])), false);
    assert.equal(store.count, 1);
});

test('add: one person can carry a PN identity and a LID identity', () => {
    const store = createFlagStore({ file: tmp() });
    store.add(new Set(['923001234567']), { label: 'Ali' });
    store.add(new Set(['123456789012345@lid']), { label: 'Ali' });   // same person, re-flagged by LID

    // re-adding an overlapping identity merges instead of duplicating
    store.add(new Set(['923001234567', '123456789012345@lid']));
    assert.equal(store.count, 1);

    const hit = store.find(new Set(['123456789012345@lid']));
    assert.ok(hit);
    assert.deepEqual(hit.entry.keys.sort(), ['123456789012345@lid', '923001234567']);
});

test('alias: a LID discovered later attaches to the existing entry', () => {
    const store = createFlagStore({ file: tmp() });
    store.add(new Set(['923001234567']), { label: 'Ali' });

    assert.equal(store.alias(new Set(['923001234567']), '555@lid'), true);
    assert.equal(store.has(new Set(['555@lid'])), true);
    // aliasing again is a no-op, and aliasing an unknown person does nothing
    assert.equal(store.alias(new Set(['923001234567']), '555@lid'), false);
    assert.equal(store.alias(new Set(['923000000000']), '777@lid'), false);
    assert.equal(store.count, 1);
});

test('remove: unflags every identity of that person', () => {
    const store = createFlagStore({ file: tmp() });
    store.add(new Set(['923001234567', '555@lid']), { label: 'Ali' });

    const r = store.remove(new Set(['555@lid']));
    assert.equal(r.ok, true);
    assert.equal(store.has(new Set(['923001234567'])), false);
    assert.equal(store.count, 0);
    assert.equal(store.remove(new Set(['555@lid'])).ok, false);
});

test('bumpDeleted: counts removals per person', () => {
    const store = createFlagStore({ file: tmp() });
    store.add(new Set(['923001234567']), { label: 'Ali' });
    assert.equal(store.bumpDeleted(new Set(['923001234567'])), 1);
    assert.equal(store.bumpDeleted(new Set(['923001234567'])), 2);
    assert.equal(store.bumpDeleted(new Set(['923009999999'])), 0);
});

test('per-user media override is stored', () => {
    const store = createFlagStore({ file: tmp() });
    store.add(new Set(['923001234567']), { label: 'Ali', media: ['sticker', 'link'] });
    assert.deepEqual(store.find(new Set(['923001234567'])).entry.media, ['sticker', 'link']);
});

test('persistence: entries survive a reload', () => {
    const file = tmp();
    const a = createFlagStore({ file });
    a.add(new Set(['923001234567']), { label: 'Ali', reason: 'spam' });
    a.flush();

    const b = createFlagStore({ file }).load();
    assert.equal(b.count, 1);
    assert.equal(b.find(new Set(['923001234567'])).entry.label, 'Ali');
    assert.equal(b.find(new Set(['923001234567'])).entry.reason, 'spam');
});

test('persistence: a corrupt file does not crash the bot', () => {
    const file = tmp();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '{ not json');
    const store = createFlagStore({ file }).load();
    assert.equal(store.count, 0);
});

test('add: refuses an empty id', () => {
    const store = createFlagStore({ file: tmp() });
    assert.equal(store.add(new Set([])).ok, false);
    assert.equal(store.add(new Set([''])).ok, false);
});
