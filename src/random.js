/**
 * src/random.js — the random-number toolbox behind the instant commands:
 *
 *   !random [n | a-b | option, option]   dice/coin/8-ball style randomness
 *   !roll [NdM]                          dice roller
 *   !flip                                coin toss
 *   !pick a b c                          random choice
 *   !shuffle a b c                       random order
 *   !8ball <question>                    one of the classic answers
 *
 * Every function takes the RNG as its last argument so the "random" behaviour is
 * deterministic in tests — no seeding hacks, no flaky assertions.
 */

export const EIGHT_BALL = Object.freeze([
    'It is certain.',
    'It is decidedly so.',
    'Without a doubt.',
    'Yes — definitely.',
    'You may rely on it.',
    'As I see it, yes.',
    'Most likely.',
    'Outlook good.',
    'Yes.',
    'Signs point to yes.',
    'Reply hazy, try again.',
    'Ask again later.',
    'Better not tell you now.',
    'Cannot predict now.',
    'Concentrate and ask again.',
    "Don't count on it.",
    'My reply is no.',
    'My sources say no.',
    'Outlook not so good.',
    'Very doubtful.'
]);

/** Inclusive integer in [min, max]. Works with min > max (they are swapped). */
export function randomInt(min, max, random = Math.random) {
    const lo = Math.ceil(Math.min(min, max));
    const hi = Math.floor(Math.max(min, max));
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return 0;
    return lo + Math.floor(random() * (hi - lo + 1));
}

export function pickOne(list, random = Math.random) {
    const items = [...(list || [])];
    if (!items.length) return null;
    return items[randomInt(0, items.length - 1, random)];
}

/** Fisher-Yates on a copy — the caller's array is never touched. */
export function shuffle(list, random = Math.random) {
    const out = [...(list || [])];
    for (let i = out.length - 1; i > 0; i--) {
        const j = randomInt(0, i, random);
        [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
}

/**
 * "1-100", "1..100", "1 to 100", "-50..50", "7" → { min, max }
 * A bare number means "1 to that number", which is what people expect from
 * `!random 20`. Returns null when there is no range in the text at all.
 */
export function parseRange(text) {
    const s = String(text ?? '').trim().replace(/[–—]/g, '-');
    if (!s) return null;

    const m = s.match(/^(-?\d+)\s*(?:-|\.\.|to)\s*(-?\d+)$/i);
    if (m) {
        const a = Number(m[1]);
        const b = Number(m[2]);
        return { min: Math.min(a, b), max: Math.max(a, b) };
    }

    const single = s.match(/^-?\d+$/);
    if (single) {
        const n = Number(s);
        return n === 0 ? { min: 0, max: 0 } : { min: Math.min(1, n), max: Math.max(1, n) };
    }
    return null;
}

/**
 * "2d6", "d20", "6", "3d8" → { count, sides } (already clamped to sane limits).
 * Bare "6" is read as "roll a six-sided die once".
 */
export function parseDice(text) {
    const s = String(text ?? '').trim().toLowerCase().replace(/\s+/g, '');
    if (!s) return { count: 1, sides: 6 };

    const m = s.match(/^(\d*)d(\d+)$/);
    if (m) {
        const count = m[1] === '' ? 1 : Number(m[1]);
        const sides = Number(m[2]);
        if (sides < 2) return null;
        return { count: Math.min(Math.max(count, 1), 20), sides: Math.min(sides, 1000) };
    }

    const single = s.match(/^(\d+)$/);
    if (single) {
        const sides = Number(single[1]);
        return sides >= 2 ? { count: 1, sides: Math.min(sides, 1000) } : null;
    }
    return null;
}

export function rollDice({ count = 1, sides = 6 } = {}, random = Math.random) {
    const rolls = Array.from({ length: count }, () => randomInt(1, sides, random));
    return { rolls, total: rolls.reduce((n, r) => n + r, 0), count, sides };
}

export function flipCoin(random = Math.random) {
    return random() < 0.5 ? 'Heads' : 'Tails';
}

/**
 * "heads", "h", "head" → true; "tails", "t", "tail" → false; anything else null.
 * Used by both `!flip` and the coin game so they agree on the spellings.
 */
export function parseCoinCall(text) {
    const s = String(text ?? '').trim().toLowerCase();
    if (!s) return null;
    if (/^(h|head|heads|up)$/.test(s)) return true;
    if (/^(t|tail|tails|down)$/.test(s)) return false;
    return null;
}

export function eightBall(random = Math.random) {
    return pickOne(EIGHT_BALL, random);
}

/**
 * Options from "!pick apple, banana" or "!pick apple banana" → ['apple','banana'].
 * A comma is taken as the separator when there is one, otherwise each argument
 * is one option — both spellings are what people type.
 */
export function parseOptions(args = []) {
    const list = [...(args || [])].map((s) => String(s));
    if (list.some((a) => a.includes(','))) {
        return list.join(' ').split(',').map((s) => s.trim()).filter(Boolean);
    }
    return list.map((s) => s.trim()).filter(Boolean);
}

const num = (n) => `*${n}*`;

/**
 * The whole instant-random command set, bound to one RNG.
 * @returns {{handle:(name:string, args:string[]) => {handled:boolean, reply?:string, react?:string}}}
 */
export function createRandomTools({ random = Math.random } = {}) {
    function handle(name, args = []) {
        switch (name) {
            case 'random': {
                const joined = args.join(' ').trim();
                const range = parseRange(joined);
                if (range) {
                    if (range.min === range.max) {
                        return { handled: true, react: '🎲', reply: `🎲 ${num(range.max)}` };
                    }
                    return {
                        handled: true,
                        react: '🎲',
                        reply: `🎲 ${num(randomInt(range.min, range.max, random))}\n_${range.min}–${range.max}_`
                    };
                }

                // No range in there, so "!random apple, banana" is a pick from a list.
                const options = parseOptions(args);
                if (options.length) {
                    return { handled: true, react: '🎯', reply: `🎲 ${num(pickOne(options, random))}` };
                }

                return {
                    handled: true,
                    react: '🎲',
                    reply: `🎲 ${num(randomInt(1, 100, random))}\n_1–100_`
                };
            }

            case 'roll': {
                const dice = parseDice(args.join(' '));
                if (!dice) {
                    return { handled: true, react: '⚠️', reply: 'Usage: !roll [NdM] — e.g. !roll, !roll 2d6, !roll d20' };
                }
                const { rolls, total } = rollDice(dice, random);
                const label = `${dice.count}d${dice.sides}`;
                const math = rolls.length > 1 ? `${rolls.join(' + ')} = ` : '';
                return { handled: true, react: '🎲', reply: `🎲 ${label} → ${math}${num(total)}` };
            }

            case 'flip': {
                const result = flipCoin(random);
                return { handled: true, react: '🪙', reply: `🪙 ${num(result)}` };
            }

            case 'pick': {
                const options = parseOptions(args);
                if (options.length < 2) {
                    return { handled: true, react: '⚠️', reply: 'Usage: !pick option1, option2[, option3…]' };
                }
                return { handled: true, react: '🎯', reply: `🎯 ${num(pickOne(options, random))}` };
            }

            case 'shuffle': {
                const options = parseOptions(args);
                if (options.length < 2) {
                    return { handled: true, react: '⚠️', reply: 'Usage: !shuffle option1, option2[, option3…]' };
                }
                const lines = shuffle(options, random).map((o, i) => `${i + 1}. ${o}`);
                return { handled: true, react: '🔀', reply: `🔀 *Shuffled*\n${lines.join('\n')}` };
            }

            case 'eightball': {
                const q = args.join(' ').trim();
                return {
                    handled: true,
                    react: '🎱',
                    reply: q ? `🎱 _${q}_\n${eightBall(random)}` : '🎱 Ask me a question: !8ball will I pass?'
                };
            }

            default:
                return { handled: false };
        }
    }

    return { handle };
}

export default createRandomTools;
