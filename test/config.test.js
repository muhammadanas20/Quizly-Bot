import test from 'node:test';
import assert from 'node:assert/strict';

import { Browsers } from '@whiskeysockets/baileys';

import { loadConfig, validateConfig, normalizeId, parseSeedFlags, parseCompanion, companionBrowser } from '../src/config.js';

test('normalizeId: every spelling of a phone number collapses to digits', () => {
    const forms = [
        '923001234567',
        '+92 300 1234567',
        '0092-300-1234567',
        '923001234567@s.whatsapp.net',
        '923001234567:12@s.whatsapp.net',
        ' 923001234567 '
    ];
    for (const f of forms) assert.equal(normalizeId(f), '923001234567', `failed for "${f}"`);
});

test('normalizeId: LID jids are preserved (they hold no phone number)', () => {
    assert.equal(normalizeId('123456789012345@lid'), '123456789012345@lid');
    assert.equal(normalizeId('123456789012345:3@lid'), '123456789012345@lid');
});

test('normalizeId: group jids stay distinct from users', () => {
    assert.notEqual(normalizeId('1234-567@g.us'), normalizeId('1234567@s.whatsapp.net'));
});

test('normalizeId: junk becomes an empty string, never a match', () => {
    assert.equal(normalizeId(''), '');
    assert.equal(normalizeId(null), '');
    assert.equal(normalizeId(undefined), '');
});

test('loadConfig: defaults are sane with an empty environment', () => {
    const cfg = loadConfig({});
    assert.equal(cfg.quizTrigger, 'quiz');
    assert.deepEqual(cfg.guardMedia, ['sticker', 'image']);
    assert.equal(cfg.guardEnabled, true);
    assert.equal(cfg.ackMode, 'react');
    assert.deepEqual(cfg.aiOrder, ['groq', 'gemini', 'grok']);
    assert.equal(cfg.gemini.model, 'gemini-2.5-flash');
    assert.equal(cfg.gemini.thinkingBudget, 0);
    assert.equal(cfg.grok.model, 'grok-4.5');
    assert.equal(cfg.ratePerMinute, 12);
});

test('loadConfig: GROK_API_KEY is accepted as an alias for XAI_API_KEY', () => {
    const cfg = loadConfig({ GROK_API_KEY: 'xai-key-123' });
    assert.equal(cfg.grok.key, 'xai-key-123');
});

test('loadConfig: invalid GUARD_MEDIA falls back to stickers and photos, valid list is kept', () => {
    assert.deepEqual(loadConfig({ GUARD_MEDIA: 'nonsense' }).guardMedia, ['sticker', 'image']);
    assert.deepEqual(loadConfig({ GUARD_MEDIA: 'sticker, link, ALL' }).guardMedia, ['sticker', 'link', 'all']);
});

test('loadConfig: STICKER_GUARD=off disables the guard', () => {
    assert.equal(loadConfig({ STICKER_GUARD: 'off' }).guardEnabled, false);
    assert.equal(loadConfig({ STICKER_GUARD: 'on' }).guardEnabled, true);
});

test('loadConfig: owners and whitelist are normalised', () => {
    const cfg = loadConfig({ OWNER_NUMBERS: '+92 300 1234567, 923009876543', GUARD_WHITELIST: '923111111111' });
    assert.deepEqual(cfg.owners, ['923001234567', '923009876543']);
    assert.deepEqual(cfg.guardWhitelist, ['923111111111']);
});

test('parseSeedFlags: "number:label" pairs', () => {
    const seeds = parseSeedFlags('923001234567:Ali, +923009876543');
    assert.equal(seeds.length, 2);
    assert.equal(seeds[0].label, 'Ali');
    assert.ok(seeds[0].ids.has('923001234567'));
    assert.equal(seeds[1].label, '');
});

test('validateConfig: fails with no keys, warns with no owner', () => {
    const v = validateConfig(loadConfig({}));
    assert.equal(v.ok, false);
    assert.match(v.errors[0], /No AI provider key/);
    assert.ok(v.warnings.some((w) => /OWNER_NUMBERS/.test(w)));
});

test('validateConfig: passes with a single key and reports which provider', () => {
    const v = validateConfig(loadConfig({ GEMINI_API_KEY: 'k', OWNER_NUMBERS: '923001234567' }));
    assert.equal(v.ok, true);
    assert.deepEqual(v.usableProviders, ['gemini']);
});

// ── one-time ("view once") media ─────────────────────────────────────────────
test('loadConfig: GUARD_MEDIA accepts the withheld one-time kind', () => {
    assert.deepEqual(loadConfig({ GUARD_MEDIA: 'sticker,image,viewonce' }).guardMedia, ['sticker', 'image', 'viewonce']);
});

test('loadConfig: the companion identity defaults to web-class', () => {
    const c = loadConfig({}).companion;
    assert.equal(c.kind, 'web');
    assert.equal(c.receivesViewOnceMedia, false);
});

test('loadConfig: WA_BROWSER=android pairs as a phone-class companion', () => {
    assert.equal(loadConfig({ WA_BROWSER: 'android' }).companion.kind, 'android');
    assert.equal(loadConfig({ WA_BROWSER: 'ANDROID' }).companion.receivesViewOnceMedia, true);
    assert.equal(loadConfig({ WA_BROWSER: 'android', WA_BROWSER_NAME: 'Pixel 8' }).companion.name, 'Pixel 8');
    assert.equal(loadConfig({ WA_BROWSER: 'carrier-pigeon' }).companion.kind, 'web', 'unknown values fall back');
});

test('companionBrowser: only android lands on Baileys\' Android identity', () => {
    // Baileys keys the device class off browser[1]: 'Android' → phone class,
    // anything else → Platform.WEB, which WhatsApp withholds one-time media from.
    assert.deepEqual(companionBrowser(parseCompanion('android', 'Pixel 8'), Browsers), ['Pixel 8', 'Android', '']);
    assert.deepEqual(companionBrowser(parseCompanion('web'), Browsers), Browsers.macOS('Desktop'));
    assert.notEqual(String(companionBrowser(parseCompanion('web'), Browsers)[1]).toLowerCase(), 'android');
});

test('validateConfig: warns that a web-class device is not sent one-time media', () => {
    const base = { GEMINI_API_KEY: 'k', OWNER_NUMBERS: '923001234567' };
    assert.ok(validateConfig(loadConfig(base)).warnings.some((w) => /one-time/.test(w)));
    assert.equal(validateConfig(loadConfig({ ...base, WA_BROWSER: 'android' })).warnings.some((w) => /one-time/.test(w)), false);
    assert.equal(validateConfig(loadConfig({ ...base, STICKER_GUARD: 'off' })).warnings.some((w) => /one-time/.test(w)), false);
});
