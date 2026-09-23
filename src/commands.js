/**
 * src/commands.js — the small command set the owner drives the bot with.
 *
 *   !help                       anyone
 *   !flag <@person|number> [reason]      owner
 *   !unflag <@person|number>             owner
 *   !flags                               owner
 *   !guard on|off|status                 owner
 *   !quiz                                anyone (solve attached/quoted image now)
 *   !ping  !stats                        anyone
 *
 * parseCommand() is pure so the parsing rules are covered by tests.
 */

import { normalizeId, GUARD_KINDS } from './config.js';

export const PREFIX = '!';
export const OWNER_ONLY = new Set(['flag', 'unflag', 'flags', 'guard']);

const ALIASES = {
    unflag  : ['unflag', 'removeflag', 'pardon'],
    flag    : ['flag', 'ban', 'block'],
    flags   : ['flags', 'flagged', 'list'],
    guard   : ['guard', 'stickerguard'],
    quiz    : ['quiz', 'solve'],
    help    : ['help', 'commands'],
    ping    : ['ping'],
    stats   : ['stats', 'status']
};

const CANONICAL = Object.fromEntries(
    Object.entries(ALIASES).flatMap(([canon, names]) => names.map((n) => [n, canon]))
);

/** "  !flag @Ali spamming  " → { name:'flag', args:['@Ali','spamming'] } */
export function parseCommand(text) {
    const t = String(text || '').trim();
    if (!t.startsWith(PREFIX)) return null;
    const [head, ...args] = t.slice(PREFIX.length).split(/\s+/).filter(Boolean);
    if (!head) return null;
    const name = CANONICAL[head.toLowerCase()];
    if (!name) return null;
    return { name, args, raw: t };
}

export const HELP_TEXT = [
    '*Quizly Bot*',
    '',
    `Send a message containing *${'{TRIGGER}'}* together with a screenshot of the quiz and the bot answers every question in order: question → one-line reason → answer.`,
    '',
    '*Commands*',
    '```',
    `${PREFIX}quiz                 solve the attached / replied image now`,
    `${PREFIX}flag <@person> [why]   flag a member (their stickers get removed)`,
    `${PREFIX}flag <@person> media=sticker,link`,
    `${PREFIX}unflag <@person>       remove a flag`,
    `${PREFIX}flags                  list flagged members`,
    `${PREFIX}guard on|off|status    toggle the sticker guard`,
    `${PREFIX}stats                  deletes, AI usage, memory`,
    `${PREFIX}ping                   latency check`,
    '```',
    '',
    'The guard never replies in the group — flagged stickers just disappear.'
].join('\n');

export function createCommandHandler({ config, flags, log, guard, limiter, groups, solveNow, startedAt }) {
    /** Resolve "!flag" targets: a mention wins, then a typed number. */
    function resolveTargets({ args = [], mentioned = [], quotedParticipant = null } = {}) {
        if (mentioned?.length) return mentioned.map((m) => ({ raw: m, id: normalizeId(m) })).filter((t) => t.id);
        const out = [];
        for (const a of args) {
            const id = normalizeId(a);
            if (id) out.push({ raw: a, id });
        }
        if (!out.length && quotedParticipant) {
            const id = normalizeId(quotedParticipant);
            if (id) out.push({ raw: quotedParticipant, id });
        }
        return out;
    }

    /**
     * @returns {Promise<{handled:boolean, reply?:string|null}>}
     */
    async function handle(ctx) {
        const cmd = parseCommand(ctx.text);
        if (!cmd) return { handled: false };

        if (OWNER_ONLY.has(cmd.name) && !ctx.isOwner) {
            return { handled: true, reply: '⛔ Only the bot owner can use that command.' };
        }

        switch (cmd.name) {
            case 'help':
                return { handled: true, reply: HELP_TEXT.replace('{TRIGGER}', config.quizTrigger) };

            case 'ping': {
                const mem = Math.round(process.memoryUsage().rss / 1048576);
                return { handled: true, reply: `🏓 pong · ${mem} MB RSS · up ${uptime()}` };
            }

            case 'stats': {
                const rate = limiter.stats();
                const top = [...guard.stats.byUser.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
                const mem = Math.round(process.memoryUsage().rss / 1048576);
                return {
                    handled: true,
                    reply: [
                        '*Bot stats*',
                        `Guard: ${config.guardEnabled ? 'ON' : 'OFF'} · media: ${config.guardMedia.join(', ')}`,
                        `Removed this session: ${guard.stats.deleted}` +
                            (guard.stats.skippedNotAdmin ? ` · skipped (bot not admin): ${guard.stats.skippedNotAdmin}` : ''),
                        `Flagged members: ${flags.count}`,
                        `AI calls: ${rate.minute}/${rate.perMinute} this minute · ${rate.day}/${rate.perDay} today`,
                        top.length ? `Top offenders: ${top.map(([n, c]) => `${n} (${c})`).join(', ')}` : null,
                        `Memory: ${mem} MB · uptime ${uptime()}`
                    ].filter(Boolean).join('\n')
                };
            }

            case 'flags': {
                const seen = new Set();
                const rows = [];
                for (const e of flags.entries()) {
                    if (seen.has(e)) continue;
                    seen.add(e);
                    rows.push(`• ${e.label || e.keys[0]} — ${e.deleted || 0} removed${e.reason ? ` · ${e.reason}` : ''}`);
                }
                return {
                    handled: true,
                    reply: rows.length ? `*Flagged members (${rows.length})*\n${rows.join('\n')}` : 'Nobody is flagged.'
                };
            }

            case 'flag': {
                const targets = resolveTargets({
                    args             : cmd.args,
                    mentioned        : ctx.mentioned,
                    quotedParticipant: ctx.quotedParticipant
                });
                if (!targets.length) {
                    return { handled: true, reply: `Usage: ${PREFIX}flag <@person or number> [reason]` };
                }
                // "media=sticker,link" overrides the global GUARD_MEDIA for this person
                const mediaArg = cmd.args.find((a) => /^media=/i.test(a));
                const media = mediaArg
                    ? mediaArg.slice(6).split(',').map((k) => k.trim().toLowerCase()).filter((k) => GUARD_KINDS.includes(k))
                    : null;

                const reason = cmd.args
                    .filter((a) => !normalizeId(a) && !/^media=/i.test(a))
                    .join(' ')
                    .slice(0, 120);

                const done = [];
                for (const t of targets) {
                    flags.add(new Set([t.id]), {
                        label  : t.raw.replace(/@.*/, ''),
                        reason,
                        media,
                        addedBy: ctx.senderLabel
                    });
                    done.push(t.raw);
                }

                const applies = media?.length ? media.join('/') : config.guardMedia.join('/');
                return {
                    handled: true,
                    reply: `🚩 Flagged ${done.join(', ')}.\nTheir ${applies} will be removed silently in groups where the bot is admin.`
                };
            }

            case 'unflag': {
                const targets = resolveTargets({
                    args             : cmd.args,
                    mentioned        : ctx.mentioned,
                    quotedParticipant: ctx.quotedParticipant
                });
                if (!targets.length) return { handled: true, reply: `Usage: ${PREFIX}unflag <@person or number>` };
                const done = [];
                const missed = [];
                for (const t of targets) {
                    const r = flags.remove(new Set([t.id]));
                    (r.ok ? done : missed).push(t.raw);
                }
                return {
                    handled: true,
                    reply: [
                        done.length ? `✅ Unflagged ${done.join(', ')}.` : null,
                        missed.length ? `ℹ️ Not flagged: ${missed.join(', ')}.` : null
                    ].filter(Boolean).join('\n')
                };
            }

            case 'guard': {
                const what = (cmd.args[0] || 'status').toLowerCase();
                if (what === 'status') {
                    return {
                        handled: true,
                        reply: `Guard is ${config.guardEnabled ? 'ON' : 'OFF'} · removing: ${config.guardMedia.join(', ')} · ${flags.count} flagged`
                    };
                }
                const want = what === 'on' || what === 'off' ? what === 'on' : null;
                if (want === null) return { handled: true, reply: `Usage: ${PREFIX}guard on|off|status` };
                config.guardEnabled = want;
                log.info(`guard toggled ${want ? 'ON' : 'OFF'} by ${ctx.senderLabel}`);
                return { handled: true, reply: `Guard is now ${want ? 'ON' : 'OFF'}.` };
            }

            case 'quiz': {
                const result = await solveNow(ctx);
                // solveNow sends its own messages; nothing further to reply here
                return { handled: true, reply: result?.error || null };
            }

            default:
                return { handled: false };
        }
    }

    function uptime() {
        const s = Math.floor((Date.now() - startedAt) / 1000);
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        return h ? `${h}h ${m}m` : `${m}m ${s % 60}s`;
    }

    return { handle, resolveTargets };
}

export default createCommandHandler;
