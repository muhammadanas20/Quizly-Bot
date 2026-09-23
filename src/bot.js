/**
 * src/bot.js — socket lifecycle + message routing.
 *
 * Order of work for every incoming message matters:
 *   1. sticker guard  (fastest possible path — one Set lookup for non-flagged)
 *   2. commands       (!flag, !help, …)
 *   3. quiz trigger
 *
 * The WhatsApp library is Baileys, not whatsapp-web.js: Baileys speaks the
 * WhatsApp Web protocol over a WebSocket with no Chromium, which is the
 * difference between ~150 MB and ~800 MB of RAM. On a 1 GiB VM that is the
 * whole ball game.
 */

import makeWASocket, {
    DisconnectReason,
    useMultiFileAuthState,
    downloadMediaMessage,
    Browsers
} from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';

import { createFlagStore } from './flags.js';
import { createGuard } from './guard.js';
import { createGroupCache } from './groups.js';
import { createRateLimiter, createInflight } from './limiter.js';
import { createQuizHandler } from './quiz.js';
import { createCommandHandler } from './commands.js';
import { createRouter } from './router.js';

const RECONNECT_BASE_MS = 3000;
const RECONNECT_MAX_MS = 60000;

export async function startBot({ config, log, fetchImpl }) {
    config.fetchImpl = fetchImpl;      // lets tests inject a fake network
    const startedAt = Date.now();

    // ── state ────────────────────────────────────────────────────────────────
    const flags = createFlagStore({ file: `${config.dataDir}/flags.json`, log }).load();
    for (const seed of config.seededFlags) {
        flags.add(seed.ids, { label: seed.label, reason: 'from .env FLAGGED_USERS', addedBy: 'env' });
    }
    flags.flush();
    const limiter  = createRateLimiter({ perMinute: config.ratePerMinute, perDay: config.ratePerDay });
    const inflight = createInflight();
    setInterval(() => inflight.sweep(), 60_000).unref?.();

    let sock = null;
    let attempts = 0;
    let stopped = false;
    let pairingRequested = false;
    let reconnectTimer = null;
    let reconnectScheduled = false;

    const groups = createGroupCache({
        sock  : { groupMetadata: (jid) => sock.groupMetadata(jid) },
        getMe : () => sock?.user?.id,
        log
    });

    const guard = createGuard({
        sock   : { sendMessage: (jid, content) => sock.sendMessage(jid, content) },
        flags,
        config,
        log,
        isAdmin: (jid) => groups.isAdmin(jid)
    });

    const quiz = createQuizHandler({
        sock  : { sendMessage: (jid, content) => sock.sendMessage(jid, content) },
        config,
        log,
        limiter,
        inflight,
        groups,
        download: (m) => downloadMediaMessage(m, 'buffer', {})
    });

    const commands = createCommandHandler({
        config, flags, log, guard, limiter, groups, startedAt,
        solveNow: (ctx) => quiz.solve(ctx.msg, { isGroup: ctx.isGroup, chatName: ctx.chatName })
    });

    // ── per-message routing ──────────────────────────────────────────────────
    const router = createRouter({
        sock  : { sendMessage: (jid, content) => sock.sendMessage(jid, content) },
        config,
        log,
        flags,
        guard,
        groups,
        quiz,
        commands
    });

    // ── connection ───────────────────────────────────────────────────────────
    async function connect() {
        if (stopped) return;

        const { state, saveCreds } = await useMultiFileAuthState(config.sessionDir);

        sock = makeWASocket({
            auth                        : state,
            logger                      : log,
            printQRInTerminal           : false,
            browser                     : Browsers.macOS('Desktop'),
            // Speed + memory: skip the work a bot does not need.
            syncFullHistory             : false,
            markOnlineOnConnect         : false,
            fireInitQueries             : false,
            generateHighQualityLinkPreview: false,
            emitOwnEvents               : false,
            getMessage                  : async () => undefined
        });

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr, isOnline } = update;

            if (qr) {
                if (config.phoneNumber && !pairingRequested) {
                    pairingRequested = true;
                    try {
                        const code = await sock.requestPairingCode(config.phoneNumber);
                        log.raw('\n🔑  Enter this pairing code in WhatsApp (Settings → Linked devices → Link with phone number):\n');
                        log.raw(`    ${String(code).match(/.{1,4}/g)?.join(' ') || code}\n`);
                        return;
                    } catch (err) {
                        log.warn(`pairing code failed (${err.message}) — falling back to QR`);
                    }
                }
                log.raw('\n📱  Scan this QR code (WhatsApp → Settings → Linked devices → Link a device):\n');
                qrcode.generate(qr, { small: true });
                log.raw('\n⏳  The code refreshes every ~20s. A new one prints automatically.\n');
            }

            if (isOnline === false) log.debug('socket reports offline');

            if (connection === 'open') {
                attempts = 0;
                pairingRequested = false;
                const mem = Math.round(process.memoryUsage().rss / 1048576);
                log.raw('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
                log.raw('  ✅  Quizly Bot is ONLINE');
                log.raw(`  📞  number   : ${sock.user?.id || '?'}`);
                log.raw(`  🎯  trigger  : "${config.quizTrigger}" + image`);
                log.raw(`  🚩  flagged  : ${flags.count} member(s)`);
                log.raw(`  🛡️  guard    : ${config.guardEnabled ? `ON (${config.guardMedia.join(', ')})` : 'OFF'}`);
                log.raw(`  🧠  ai       : ${config.aiOrder.filter((p) => config[p]?.key).join(' → ')}`);
                log.raw(`  💾  memory   : ${mem} MB RSS`);
                log.raw('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
            }

            if (connection === 'close') {
                const status = lastDisconnect?.error?.output?.statusCode;
                if (status === DisconnectReason.loggedOut) {
                    log.fatal('WhatsApp logged this session out. Delete the auth folder and scan a new QR code:');
                    log.fatal(`  rm -rf ${config.sessionDir} && npm start`);
                    stopped = true;
                    process.exit(1);
                }
                // Baileys deliberately closes the stream with 515 after a
                // pairing code is accepted. This is a restart signal, not a
                // failed pairing; reconnect immediately using the saved creds.
                if (reconnectScheduled || stopped) return;
                const pairingRestart = status === 515;
                const wait = pairingRestart
                    ? 0
                    : Math.min(RECONNECT_BASE_MS * 2 ** attempts, RECONNECT_MAX_MS);
                attempts++;
                reconnectScheduled = true;
                if (pairingRestart) {
                    log.info('pairing completed; restarting the WhatsApp connection');
                } else {
                    log.warn(`connection closed (status=${status ?? 'none'}) — reconnecting in ${Math.round(wait / 1000)}s`);
                }
                reconnectTimer = setTimeout(() => {
                    reconnectScheduled = false;
                    reconnectTimer = null;
                    connect().catch((err) => log.error(`reconnect failed: ${err.message}`));
                }, wait);
                reconnectTimer.unref?.();
            }
        });

        sock.ev.on('messages.upsert', async ({ messages, type }) => {
            if (type !== 'notify') return;
            for (const msg of messages) {
                // Deliberately not awaited: a slow quiz must not delay the next
                // message, and above all must not delay the sticker guard.
                router.processMessage(msg).catch((err) => log.error(`message handler: ${err.message}`));
            }
        });

        // membership changes invalidate the cached admin list
        sock.ev.on('group-participants.update', ({ id }) => groups.invalidate(id));
        sock.ev.on('groups.update', (updates) => {
            for (const u of updates || []) if (u?.id) groups.invalidate(u.id);
        });
    }

    await connect();

    // ── shutdown ─────────────────────────────────────────────────────────────
    async function stop(reason = 'manual', { exit = false } = {}) {
        if (stopped) return;
        stopped = true;
        if (reconnectTimer) clearTimeout(reconnectTimer);
        reconnectTimer = null;
        reconnectScheduled = false;
        log.warn(`shutting down (${reason})`);
        flags.flush();
        try { await sock?.end?.(); } catch { /* ignore */ }
        if (exit) setTimeout(() => process.exit(0), 300).unref?.();
    }

    // PM2/systemd send SIGTERM; exiting cleanly lets them restart us if needed
    process.on('SIGINT', () => stop('SIGINT', { exit: true }));
    process.on('SIGTERM', () => stop('SIGTERM', { exit: true }));
    process.on('unhandledRejection', (err) => log.error(`unhandled rejection: ${err?.message || err}`));
    process.on('uncaughtException', (err) => {
        log.error(`uncaught exception: ${err?.message || err}`);
        flags.flush();
    });

    return {
        get socket() { return sock; },
        flags,
        guard,
        groups,
        limiter,
        inflight,
        quiz,
        commands,
        stop,
        /** Test/dev hook: run the routing logic against a synthetic message. */
        router
    };
}

export default startBot;
