#!/usr/bin/env node
/**
 * index.js — entry point.
 *
 *   npm start
 *
 * First run prints a QR code (or a pairing code if PHONE_NUMBER is set).
 * Every later run reuses ./auth and connects straight away.
 */

import 'dotenv/config';
import fs from 'node:fs';

import { loadConfig, validateConfig } from './src/config.js';
import { startBot } from './src/bot.js';
import log from './src/log.js';

function banner() {
    log.raw(`
\u001b[1m  ╔═══════════════════════════════════════╗
  ║          Q U I Z L Y   B O T          ║
  ╚═══════════════════════════════════════╝\u001b[0m`);
}

async function main() {
    banner();

    const config = loadConfig(process.env);
    const check = validateConfig(config);

    for (const w of check.warnings) log.warn(w);
    if (!check.ok) {
        for (const e of check.errors) log.fatal(e);
        log.raw('\nCopy .env.example to .env and fill in at least one API key:\n  cp .env.example .env\n');
        process.exit(1);
    }

    fs.mkdirSync(config.dataDir, { recursive: true });
    fs.mkdirSync(config.sessionDir, { recursive: true });

    log.info(`providers: ${check.usableProviders.join(' → ')} · guard: ${config.guardEnabled ? 'on' : 'off'} · trigger: "${config.quizTrigger}"`);

    const bot = await startBot({ config, log });

    // Surface something useful if nothing happens for a while.
    setTimeout(() => {
        if (!bot.socket?.user) {
            log.warn('Still not connected. If no QR code appeared above, check outbound internet access on this machine.');
        }
    }, 45_000).unref?.();
}

main().catch((err) => {
    log.fatal(`startup failed: ${err?.stack || err?.message || err}`);
    process.exit(1);
});
