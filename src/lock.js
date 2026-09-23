/**
 * src/lock.js — one WhatsApp session, one process.
 *
 * `conflict: replaced` (status 440) is WhatsApp saying “another connection just
 * opened with these credentials”. Two copies of the bot — say `npm start` in a
 * terminal AND `pm2 restart quizly` — then kick each other off every few
 * seconds forever: each reconnect “replaces” the other, which reconnects and
 * replaces it back. The bot never stays online.
 *
 * This lock makes that impossible among copies that share a data directory
 * (every copy sharing the session also shares DATA_DIR — it holds flags.json).
 * It lives in dataDir rather than auth/ because Baileys scans auth/ for
 * credentials and never looks at data/.
 */

import fs from 'node:fs';
import path from 'node:path';

/** `kill(pid, 0)` probes existence without signalling: EPERM still means alive. */
function pidAlive(pid) {
    if (!Number.isInteger(pid) || pid <= 0) return false;
    try {
        process.kill(pid, 0);
        return true;
    } catch (err) {
        return err.code === 'EPERM';
    }
}

export function createInstanceLock({ file, log, pollMs = 2500 }) {
    let held = false;
    let cancelled = false;
    let pollTimer = null;
    let finishWait = null;

    const readHolder = () => {
        try {
            return Number.parseInt(fs.readFileSync(file, 'utf8').trim(), 10);
        } catch {
            return null;
        }
    };

    /**
     * Non-blocking. true = the lock is ours, false = a live process holds it.
     * A lock whose pid is gone (crashed copy, SIGKILL) is stale and stolen.
     */
    function tryAcquire() {
        if (held) return true;
        for (let round = 0; round < 3; round++) {
            try {
                fs.mkdirSync(path.dirname(file), { recursive: true });
                fs.writeFileSync(file, `${process.pid}`, { flag: 'wx' });
                held = true;
                return true;
            } catch (err) {
                if (err.code !== 'EEXIST') throw err;
            }
            const holder = readHolder();
            if (holder === null) continue;          // vanished mid-handshake — retry
            if (pidAlive(holder)) return false;     // a live copy owns the session
            try { fs.unlinkSync(file); } catch { /* someone else cleaned up */ }
        }
        return false;
    }

    /**
     * Blocking. Resolves true once the lock is ours, false if the wait was
     * cancelled (shutdown) first. While held by a live pid it says who holds
     * it and waits — the other copy exiting is the all-clear.
     */
    function acquire({ isStopped = () => false } = {}) {
        if (tryAcquire()) return Promise.resolve(true);
        cancelled = false;

        const holder = readHolder();
        log.error(`another Quizly Bot is already running (pid ${holder ?? '?'}) with this data/session directory`);
        log.error('  two copies fight over one WhatsApp session — WhatsApp boots one off (conflict: replaced), the other reconnects, and they trade places forever');
        log.error(`  find it:  pm2 ls   ·   ps -p ${holder ?? '<pid>'} -o pid,cmd   ·   (a stray \`npm start\` in some terminal counts too)`);
        log.error('  keep exactly one copy — once the other exits this one takes over automatically');

        return new Promise((resolve) => {
            let waits = 0;
            finishWait = (value) => {
                finishWait = null;
                if (pollTimer) clearTimeout(pollTimer);
                pollTimer = null;
                resolve(value);
            };
            const poll = () => {
                pollTimer = null;
                if (cancelled || isStopped()) return finishWait(false);
                if (tryAcquire()) {
                    log.info('previous instance exited — taking over the WhatsApp session');
                    return finishWait(true);
                }
                if (++waits % 12 === 0) {
                    log.warn(`still waiting for the other Quizly Bot (pid ${readHolder() ?? '?'}) to exit before connecting…`);
                }
                pollTimer = setTimeout(poll, pollMs);
            };
            pollTimer = setTimeout(poll, pollMs);
        });
    }

    /** Abort an in-flight acquire() and drop our claim, if any. */
    function cancel() {
        cancelled = true;
        if (finishWait) finishWait(false);
        else if (pollTimer) {
            clearTimeout(pollTimer);
            pollTimer = null;
        }
    }

    /** Give up the lock. Never deletes a file that now belongs to someone else. */
    function release() {
        if (!held) return;
        held = false;
        try {
            if (readHolder() === process.pid) fs.unlinkSync(file);
        } catch { /* already gone */ }
    }

    return {
        tryAcquire,
        acquire,
        cancel,
        release,
        get holderPid() { return readHolder(); }
    };
}

export default createInstanceLock;
