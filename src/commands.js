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
import { identitiesOf } from './message.js';

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

/** Identity expansion with no socket: the JID's own normalised form only. */
const defaultExpand = (raw) => {
    const id = normalizeId(raw);
    return id ? [id] : [];
};

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
    `${PREFIX}flag <@person> [why]   remove their stickers and photos (default)`,
    `${PREFIX}flag <@person> media=sticker,image`,
    'View-once photos are included; configure GUARD_MEDIA for other media types.',
    `${PREFIX}unflag <@person>       remove a flag`,
    `${PREFIX}flags                  list flagged members`,
    `${PREFIX}guard on|off|status    toggle the media guard`,
    `${PREFIX}stats                  deletes, AI usage, memory`,
    `${PREFIX}ping                   latency check`,
    '```',
    '',
    'The guard never replies in the group — flagged stickers and photos just disappear.'
].join('\n');

export function createCommandHandler({ config, flags, log, guard, limiter, groups, solveNow, startedAt }) {
    /**
     * Resolve "!flag" / "!unflag" targets: a mention wins, then a typed number.
     *
     * Each target carries EVERY identity that person can be known by (phone
     * number and LID), because `!flag @someone` is keyed by the JID WhatsApp
     * puts in the mention while the guard later matches on whatever the
     * sender's message carries. Storing both is what makes flag and unflag
     * agree with each other.
     */
    function resolveTargets({ args = [], mentioned = [], quotedParticipant = null, expand = defaultExpand } = {}) {
        const out = [];
        const seen = new Set();

        const add = (raw) => {
            const ids = expand(raw).filter(Boolean);
            if (!ids.length) return;
            const key = ids.join('|');
            if (seen.has(key)) return;
            seen.add(key);
            out.push({ raw, ids });
        };

        if (mentioned?.length) {
            for (const m of mentioned) add(m);
            return out;
        }
        for (const a of args) add(a);
        if (!out.length && quotedParticipant) add(quotedParticipant);
        return out;
    }

    /** "Muhammad Anas" when the group metadata knows them, else the bare id. */
    async function displayName(target, ctx) {
        for (const id of target.ids) {
            const name = await ctx.groups?.nameOf?.(ctx.jid, id);
            if (name) return name;
        }
        return String(target.raw).replace(/@.*/, '');
    }

    /**
     * "@Muhammad Anas test" → "test". WhatsApp folds the mention's display name
     * into the plain text, so it arrives in the args and would otherwise end up
     * as the flag's reason.
     */
    function stripMentionNames(text, names) {
        let out = ` ${String(text || '')} `;
        for (const n of names) {
            if (!n) continue;
            out = out.replace(new RegExp(`@\\s*${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'gi'), ' ');
        }
        return out.replace(/\s+/g, ' ').trim();
    }

    /**
     * @returns {Promise<{handled:boolean, reply?:string|null, react?:string}>}
     *          `react` is the emoji the router puts on the command message.
     */
    async function handle(ctx) {
        const cmd = parseCommand(ctx.text);
        if (!cmd) return { handled: false };

        if (OWNER_ONLY.has(cmd.name) && !ctx.isOwner) {
            return { handled: true, react: '⛔', reply: '⛔ Only the bot owner can use that command.' };
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
                    quotedParticipant: ctx.quotedParticipant,
                    expand           : ctx.expandIds
                });
                if (!targets.length) {
                    return { handled: true, react: '⚠️', reply: `Usage: ${PREFIX}flag <@person or number> [reason]` };
                }
                // "media=sticker,image" overrides the global GUARD_MEDIA for this person
                const mediaArg = cmd.args.find((a) => /^media=/i.test(a));
                const media = mediaArg
                    ? mediaArg.slice(6).split(',').map((k) => k.trim().toLowerCase()).filter((k) => GUARD_KINDS.includes(k))
                    : null;

                const names = [];
                for (const t of targets) names.push(await displayName(t, ctx));

                const reason = stripMentionNames(
                    cmd.args.filter((a) => !normalizeId(a) && !/^media=/i.test(a)).join(' '),
                    names
                ).slice(0, 120);

                const done = [];
                targets.forEach((t, i) => {
                    flags.add(new Set(t.ids), {
                        label  : names[i],
                        reason,
                        media,
                        addedBy: ctx.senderLabel
                    });
                    done.push(names[i]);
                });

                const applies = media?.length ? media.join('/') : config.guardMedia.join('/');
                return {
                    handled: true,
                    react  : '🚩',
                    reply  : `🚩 Flagged ${done.join(', ')}.\nTheir ${applies} will be removed silently in groups where the bot is admin.`
                };
            }

            case 'unflag': {
                const targets = resolveTargets({
                    args             : cmd.args,
                    mentioned        : ctx.mentioned,
                    quotedParticipant: ctx.quotedParticipant,
                    expand           : ctx.expandIds
                });
                if (!targets.length) {
                    return { handled: true, react: '⚠️', reply: `Usage: ${PREFIX}unflag <@person or number>` };
                }
                const done = [];
                const missed = [];
                for (const t of targets) {
                    const r = flags.remove(new Set(t.ids));
                    (r.ok ? done : missed).push(await displayName(t, ctx));
                }
                return {
                    handled: true,
                    // a partial removal is still a change worth confirming
                    react: done.length ? '✅' : 'ℹ️',
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
                        react  : '📊',
                        reply  : `Guard is ${config.guardEnabled ? 'ON' : 'OFF'} · removing: ${config.guardMedia.join(', ')} · ${flags.count} flagged`
                    };
                }
                const want = what === 'on' || what === 'off' ? what === 'on' : null;
                if (want === null) return { handled: true, react: '⚠️', reply: `Usage: ${PREFIX}guard on|off|status` };
                config.guardEnabled = want;
                log.info(`guard toggled ${want ? 'ON' : 'OFF'} by ${ctx.senderLabel}`);
                return {
                    handled: true,
                    react  : want ? '🛡️' : '🔕',
                    reply  : `Guard is now ${want ? 'ON' : 'OFF'}.`
                };
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
