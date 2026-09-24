/**
 * src/bot.js — socket lifecycle + message routing.
 *
 * Order of work for every incoming message matters:
 *   1. media guard    (fastest possible path — one Set lookup for non-flagged)
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
import { createInstanceLock } from './lock.js';

const RECONNECT_BASE_MS = 3000;
const RECONNECT_MAX_MS = 60000;
// status 440: "conflict: replaced" — another connection opened with this same
// session. Reconnecting fast only steals the session back, that copy reclaims
// it seconds later, and the two trade places forever. Stand down for a full
// minute instead, so a duplicate (and the operator) get time to sort it out.
const REPLACED_STAND_DOWN_MS = RECONNECT_MAX_MS;
const CONNECTION_REPLACED = DisconnectReason.connectionReplaced ?? 440;

export async function startBot({
    config, log, fetchImpl,
    socketFactory = makeWASocket,
    authStateFactory = useMultiFileAuthState
}) {
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
    // Bumped every time connect() starts a replacement socket. Handlers bound
    // to an older socket check it first: a dead socket must never schedule
    // another reconnect (that manufactures exactly the duplicate connections
    // that end in `conflict: replaced`) or overwrite newer creds on disk.
    let generation = 0;

    // One process per session. Two copies (npm start + pm2, two pm2 apps, a
    // node --watch restart overlap…) sharing one auth dir is the whole cause
    // of "conflict: replaced" reconnect loops.
    const lock = createInstanceLock({ file: `${config.dataDir}/instance.lock`, log });

    // One wrapper shared by the guard, the quiz handler and the router. The
    // getters matter: `sock` is replaced on every reconnect, so a reference
    // captured once would point at a dead socket — and would silently lose the
    // lid-mapping store the guard needs to turn a LID into a phone number.
    const sockApi = {
        sendMessage        : (jid, content) => sock.sendMessage(jid, content),
        get signalRepository() { return sock?.signalRepository; },
        get user() { return sock?.user; }
    };

    const groups = createGroupCache({
        sock  : { groupMetadata: (jid) => sock.groupMetadata(jid) },
        getMe : () => sock?.user?.id,
        log
    });

    const guard = createGuard({
        sock   : sockApi,
        flags,
        config,
        log,
        isAdmin: (jid) => groups.isAdmin(jid)
    });

    const quiz = createQuizHandler({
        sock  : sockApi,
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
        sock  : sockApi,
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

        const gen = ++generation;
        const { state, saveCreds } = await authStateFactory(config.sessionDir);
        if (stopped || gen !== generation) return;   // superseded while loading

        sock = socketFactory({
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

        // Events from a superseded socket are ignored (gen check): only the
        // live socket may persist creds, route messages or trigger reconnects.
        sock.ev.on('creds.update', (update) => {
            if (gen !== generation) return;
            saveCreds(update);
        });

        sock.ev.on('connection.update', async (update) => {
            if (gen !== generation) return;
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
                const pairingRestart = status === DisconnectReason.restartRequired;
                const replaced = status === CONNECTION_REPLACED;
                const wait = pairingRestart
                    ? 0
                    : replaced
                        ? REPLACED_STAND_DOWN_MS
                        : Math.min(RECONNECT_BASE_MS * 2 ** attempts, RECONNECT_MAX_MS);
                attempts++;
                reconnectScheduled = true;
                if (pairingRestart) {
                    log.info('pairing completed; restarting the WhatsApp connection');
                } else if (replaced) {
                    log.error('WhatsApp replaced this connection (conflict: replaced) — another connection just opened using this same session');
                    log.error('  almost always a second copy of the bot: `npm start` while PM2 runs it, two pm2 apps, or an old copy still alive');
                    log.error('  check `pm2 ls` and `ps -p <pid> -o pid,cmd` and keep exactly one copy — the single-instance lock only stops duplicates that share this data directory');
                    log.warn(`standing down ${Math.round(REPLACED_STAND_DOWN_MS / 1000)}s instead of reconnecting — a fast retry only trades places with the other copy`);
                } else {
                    log.warn(`connection closed (status=${status ?? 'none'}) — reconnecting in ${Math.round(wait / 1000)}s`);
                }
                reconnectTimer = setTimeout(() => {
                    reconnectScheduled = false;
                    reconnectTimer = null;
                    connect().catch((err) => log.error(`reconnect failed: ${err.message}`));
                }, wait);
                // This is essential work, not background housekeeping. Once
                // the old socket closes, this timer may be the only handle
                // keeping Node alive until the replacement socket is created.
                // Do not unref it, even for the zero-delay pairing restart.
            }
        });

        sock.ev.on('messages.upsert', async ({ messages, type }) => {
            if (gen !== generation || type !== 'notify') return;
            for (const msg of messages) {
                // Deliberately not awaited: a slow quiz must not delay the next
                // message, and above all must not delay the media guard.
                router.processMessage(msg).catch((err) => log.error(`message handler: ${err.message}`));
            }
        });

        // membership changes invalidate the cached admin list
        sock.ev.on('group-participants.update', ({ id }) => {
            if (gen !== generation) return;
            groups.invalidate(id);
        });
        sock.ev.on('groups.update', (updates) => {
            if (gen !== generation) return;
            for (const u of updates || []) if (u?.id) groups.invalidate(u.id);
        });
    }

    // ── shutdown ─────────────────────────────────────────────────────────────
    async function stop(reason = 'manual', { exit = false } = {}) {
        if (stopped) return;
        stopped = true;
        if (reconnectTimer) clearTimeout(reconnectTimer);
        reconnectTimer = null;
        reconnectScheduled = false;
        lock.cancel();          // abort a pending lock wait, if any
        log.warn(`shutting down (${reason})`);
        flags.flush();
        try { await sock?.end?.(); } catch { /* ignore */ }
        lock.release();         // free the session for the next copy
        if (exit) setTimeout(() => process.exit(0), 300).unref?.();
    }

    // Registered before the (possibly long) lock wait below, so Ctrl+C during
    // that wait still releases the lock and flushes flags. PM2/systemd send
    // SIGTERM; exiting cleanly lets them restart us if needed.
    process.on('SIGINT', () => stop('SIGINT', { exit: true }));
    process.on('SIGTERM', () => stop('SIGTERM', { exit: true }));
    process.on('unhandledRejection', (err) => log.error(`unhandled rejection: ${err?.message || err}`));
    process.on('uncaughtException', (err) => {
        log.error(`uncaught exception: ${err?.message || err}`);
        flags.flush();
    });

    // One live copy per session. If another copy is up (e.g. PM2's instance
    // while this one was started by hand), wait for it to exit — connect()ing
    // anyway is what produces the endless `conflict: replaced` kick-war.
    if (!lock.tryAcquire()) {
        await lock.acquire({ isStopped: () => stopped });
    }
    await connect();

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
