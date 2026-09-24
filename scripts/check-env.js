#!/usr/bin/env node
/**
 * scripts/check-env.js — "will this bot actually work on this machine?"
 *
 *   npm run check
 *
 * Checks, in order:
 *   1. Node version
 *   2. .env is present and parseable
 *   3. each configured API key is valid, and lists the models your key can use
 *   4. the model names in .env actually exist for that key
 *
 * Run this on the VM right after setup, before starting the bot. It costs one
 * tiny API call per provider.
 */

import 'dotenv/config';
import { loadConfig, validateConfig } from '../src/config.js';

const GREEN = '\u001b[32m', RED = '\u001b[31m', YEL = '\u001b[33m', DIM = '\u001b[90m', OFF = '\u001b[0m';
const ok   = (m) => console.log(`${GREEN}  ✓${OFF} ${m}`);
const bad  = (m) => console.log(`${RED}  ✗${OFF} ${m}`);
const warn = (m) => console.log(`${YEL}  !${OFF} ${m}`);
const dim  = (m) => console.log(`${DIM}    ${m}${OFF}`);

const cfg = loadConfig(process.env);
let failures = 0;

// ── 1. Node ──────────────────────────────────────────────────────────────────
console.log('\nNode');
const [major, minor] = process.versions.node.split('.').map(Number);
if (major > 20 || (major === 20 && minor >= 19)) ok(`Node ${process.versions.node}`);
else { bad(`Node ${process.versions.node} — need 20.19 or newer`); failures++; }

// ── 2. config ────────────────────────────────────────────────────────────────
console.log('\nConfiguration');
const v = validateConfig(cfg);
if (v.ok) ok(`AI providers configured: ${v.usableProviders.join(', ')}`);
else { v.errors.forEach((e) => bad(e)); failures++; }
v.warnings.forEach((w) => warn(w));
if (cfg.owners.length) dim(`owners: ${cfg.owners.join(', ')}`);
dim(`flagged from .env: ${cfg.seededFlags.length}`);
dim(cfg.gamesEnabled
    ? `games: on · ${cfg.gameTimeoutMs / 1000}s rounds · ${cfg.gameMaxAttempts} guesses each`
    : 'games: off');

// ── 3. provider keys ─────────────────────────────────────────────────────────
const TARGETS = {
    gemini: {
        label  : 'Gemini',
        url    : 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=200',
        headers: (k) => ({ 'x-goog-api-key': k }),
        pick   : (j) => (j.models || []).map((m) => String(m.name || '').replace(/^models\//, '')),
        model  : cfg.gemini.model,
        alts   : cfg.gemini.fallbacks
    },
    grok: {
        label  : 'xAI Grok',
        url    : 'https://api.x.ai/v1/models',
        headers: (k) => ({ authorization: `Bearer ${k}` }),
        pick   : (j) => (j.data || j.models || []).map((m) => m.id || m),
        model  : cfg.grok.model,
        alts   : cfg.grok.fallbacks
    },
    groq: {
        label  : 'Groq',
        url    : 'https://api.groq.com/openai/v1/models',
        headers: (k) => ({ authorization: `Bearer ${k}` }),
        pick   : (j) => (j.data || []).map((m) => m.id),
        model  : cfg.groq.model,
        alts   : cfg.groq.fallbacks
    }
};

for (const name of cfg.aiOrder) {
    const t = TARGETS[name];
    if (!t) { warn(`Unknown provider "${name}" in AI_ORDER`); continue; }

    console.log(`\n${t.label}`);
    const key = cfg[name]?.key;
    if (!key) { dim('no key set — skipped'); continue; }

    try {
        const res = await fetch(t.url, { headers: t.headers(key) });
        if (res.status !== 200) {
            const body = await res.text();
            bad(`HTTP ${res.status}: ${body.slice(0, 180)}`);
            failures++;
            continue;
        }
        const json = await res.json();
        const models = t.pick(json);
        ok(`key valid · ${models.length} model(s) available`);

        const wanted = [t.model, ...(t.alts || [])].filter(Boolean);
        for (const m of wanted) {
            if (models.includes(m)) ok(`"${m}" is available`);
            else {
                warn(`"${m}" not in this key's list — the bot will fall through to the next one`);
                const near = models.filter((x) => String(x).includes(m.split('-')[0])).slice(0, 6);
                if (near.length) dim(`candidates: ${near.join(', ')}`);
            }
        }
    } catch (err) {
        bad(`could not reach ${t.label}: ${err.message}`);
        dim('If this VM has no outbound internet, the bot cannot solve quizzes.');
        failures++;
    }
}

// ── 4. paths ─────────────────────────────────────────────────────────────────
console.log('\nPaths');
dim(`session: ${cfg.sessionDir}`);
dim(`data   : ${cfg.dataDir}`);

console.log(failures
    ? `\n${RED}${failures} problem(s) to fix before starting the bot.${OFF}\n`
    : `\n${GREEN}Everything looks good. Start it with:  npm start${OFF}\n`);

process.exit(failures ? 1 : 0);
