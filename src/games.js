/**
 * src/games.js — the in-group game engine.
 *
 *   !game                      list every game + the commands that go with it
 *   !game <name> [args]        start a round in this chat
 *   !guess <answer> / !g       take a shot (plain replies work too)
 *   !in / !join                join the lucky draw
 *   !game draw                 pick the lucky winner early
 *   !game stop                 owner: stop ALL games; starter: end this round
 *   !game on                   owner: reopen games for everyone
 *   !game reset tops           owner: clear every leaderboard
 *   !game reset @member [all]  owner: reset one member's points (this chat / all chats)
 *   !game mode easy|hard       set this chat's default level for math + code
 *   !game end                  end this chat's round (starter or owner)
 *   !game top [all]            leaderboard — this chat, or everywhere
 *   !game me                   your own score card
 *   !game addq Q ; A           owner: contribute a trivia question to the pool
 *
 * Seven games: number, coin, math, code, scramble, trivia, lucky.
 * Everyone plays, everyone scores (every attempt earns a participation point),
 * and the scoreboard is per group so a big group's leaderboard means something.
 *
 * A round lives in memory only: it is short-lived, and losing an in-flight round
 * on restart costs nothing but a re-typed `!game`. Scores are what get persisted
 * (src/scores.js).
 *
 * The game rules — matching an answer, hot/cold, the maths problem, the word
 * scramble — are exported as pure functions so they can be tested without a
 * socket, in keeping with the rest of this codebase.
 */

import { randomInt, pickOne, shuffle, parseRange, parseCoinCall } from './random.js';
import { MATH_BANK, CODE_BANK, parseTopic } from './banks.js';
import { normalizeId } from './config.js';

// ─── Words for !game scramble ────────────────────────────────────────────────
export const WORDS = Object.freeze([
    'garden', 'planet', 'silver', 'bridge', 'orange', 'dinner', 'forest', 'market',
    'window', 'yellow', 'puzzle', 'rocket', 'summer', 'winter', 'camera', 'doctor',
    'engine', 'flower', 'guitar', 'hunter', 'island', 'jungle', 'kitten', 'ladder',
    'monkey', 'nature', 'ocean', 'pencil', 'queen', 'rabbit', 'school', 'tiger',
    'umbrella', 'village', 'wizard', 'zebra', 'bottle', 'castle', 'dragon', 'elephant',
    'family', 'holiday', 'insect', 'jacket', 'kitchen', 'lemon', 'mirror', 'number',
    'anchor', 'balloon', 'compass', 'eclipse', 'feather', 'galaxy', 'harvest',
    'journey', 'lantern', 'meadow', 'notebook', 'orchard', 'passport', 'quarter',
    'recycle', 'shelter', 'thunder', 'uniform', 'volcano', 'whisper', 'battery',
    'coconut', 'emerald', 'fountain', 'glacier', 'horizon', 'library', 'mystery',
    'outline', 'penguin', 'rainbow', 'sapphire', 'tornado', 'victory', 'waterfall',
    'backpack', 'chocolate', 'dolphin', 'festival', 'gravity', 'keyboard',
    'lighthouse', 'mountain', 'necklace', 'painting', 'sandwich', 'telescope',
    'calendar', 'airplane', 'treasure', 'triangle', 'universe', 'windmill',
    'accordion', 'blueprint', 'cinnamon', 'microphone', 'strawberry', 'firework',
    'snowflake', 'pineapple', 'sunflower', 'adventure', 'parachute', 'tangerine',
    'calculator', 'astronaut', 'porcupine'
]);

// A clue makes the longer built-in words fair; AI puzzles carry their own.
const WORD_CLUES = Object.freeze({
    compass: 'Tool used to find north', eclipse: 'When one celestial body blocks another',
    galaxy: 'A vast system of stars', lantern: 'A portable light',
    orchard: 'A place where fruit trees grow', passport: 'Document used for international travel',
    recycle: 'Turn used materials into new ones', volcano: 'Mountain that can erupt',
    glacier: 'A slow-moving mass of ice', penguin: 'Flightless bird from cold regions',
    rainbow: 'Colourful arc seen after rain', waterfall: 'River plunging over a ledge',
    backpack: 'Bag carried on your shoulders', keyboard: 'Keys used to type',
    lighthouse: 'Tower guiding ships at night', telescope: 'Used to look at distant stars',
    calendar: 'Shows dates and months', triangle: 'A shape with three sides',
    windmill: 'Structure that turns in the wind', microphone: 'Device that picks up sound',
    strawberry: 'Small red berry with seeds outside', parachute: 'Slows a fall through the air',
    astronaut: 'Person trained to travel in space', calculator: 'Device for working out sums'
});
const BUILTIN_PUZZLES = WORDS.map((word) => ({ word, clue: WORD_CLUES[word] || '' }));

// ─── Built-in trivia pool (members can add more with !game addq) ─────────────
export const TRIVIA = Object.freeze([
    { q: 'What is the capital of Pakistan?', a: ['islamabad'] },
    { q: 'How many days are there in a leap year?', a: ['366', 'three hundred and sixty six'] },
    { q: 'Which planet is known as the Red Planet?', a: ['mars'] },
    { q: 'What is the largest ocean on Earth?', a: ['pacific', 'the pacific', 'pacific ocean'] },
    { q: 'What is the chemical symbol for gold?', a: ['au'] },
    { q: 'How many continents are there?', a: ['7', 'seven'] },
    { q: 'Which animal is the fastest on land?', a: ['cheetah', 'the cheetah'] },
    { q: 'Which gas do plants absorb for photosynthesis?', a: ['carbon dioxide', 'co2'] },
    { q: 'What is the largest mammal in the world?', a: ['blue whale', 'the blue whale'] },
    { q: 'How many sides does a hexagon have?', a: ['6', 'six'] },
    { q: 'Which country is the home of pizza?', a: ['italy'] },
    { q: 'What is the currency of Japan?', a: ['yen', 'the yen', 'japanese yen'] },
    { q: 'Which river flows through Cairo?', a: ['nile', 'the nile', 'river nile'] },
    { q: 'How many players from one football team are on the pitch?', a: ['11', 'eleven'] },
    { q: 'What is 7 × 8?', a: ['56', 'fifty six'] },
    { q: 'Which month has exactly 28 days in a non-leap year?', a: ['february'] },
    { q: 'At what temperature does water boil at sea level, in Celsius?', a: ['100', 'one hundred'] },
    { q: 'Which animal is called the ship of the desert?', a: ['camel', 'the camel'] },
    { q: 'How many minutes are there in an hour?', a: ['60', 'sixty'] },
    { q: 'On which continent is the Sahara desert?', a: ['africa'] },
    { q: 'Which is the largest country in the world by area?', a: ['russia'] },
    { q: 'Which vitamin do you get from sunlight?', a: ['vitamin d', 'd', 'vit d'] },
    { q: 'How many colours are there in a rainbow?', a: ['7', 'seven'] },
    { q: 'What is the smallest prime number?', a: ['2', 'two'] },
    { q: 'What is the capital of France?', a: ['paris'] },
    { q: 'What do bees make?', a: ['honey'] },
    { q: 'Which shape has exactly three sides?', a: ['triangle', 'a triangle'] },
    { q: 'How many hours are there in two days?', a: ['48', 'forty eight'] },
    { q: 'Which planet do we live on?', a: ['earth', 'the earth'] },
    { q: 'At what temperature does water freeze, in Celsius?', a: ['0', 'zero'] },
    { q: 'How many bones does an adult human body have?', a: ['206', 'two hundred and six'] },
    { q: 'What is the tallest animal in the world?', a: ['giraffe', 'the giraffe'] },
    { q: 'Which country is home to the city of Mumbai?', a: ['india'] },
    { q: 'What is the hardest natural substance?', a: ['diamond'] },
    { q: 'How many strings does a standard guitar have?', a: ['6', 'six'] },
    { q: 'Which sea creature has eight arms?', a: ['octopus', 'the octopus'] },
    { q: 'Which planet is closest to the Sun?', a: ['mercury'] },
    { q: 'What is the largest planet in our solar system?', a: ['jupiter'] },
    { q: 'Which planet is famous for its rings?', a: ['saturn'] },
    { q: 'What is the chemical formula for water?', a: ['h2o'] },
    { q: 'Which gas makes up most of Earth’s atmosphere?', a: ['nitrogen'] },
    { q: 'What process lets plants make food from sunlight?', a: ['photosynthesis'] },
    { q: 'How many degrees are in a right angle?', a: ['90', 'ninety'] },
    { q: 'How many sides does an octagon have?', a: ['8', 'eight'] },
    { q: 'How many faces does a cube have?', a: ['6', 'six'] },
    { q: 'What is the square root of 144?', a: ['12', 'twelve'] },
    { q: 'What is the next prime number after 7?', a: ['11', 'eleven'] },
    { q: 'What is the Roman numeral for 50?', a: ['l'] },
    { q: 'What is the longest side of a right triangle called?', a: ['hypotenuse'] },
    { q: 'How many millimetres are in one centimetre?', a: ['10', 'ten'] },
    { q: 'What is the capital of Japan?', a: ['tokyo'] },
    { q: 'What is the capital of Canada?', a: ['ottawa'] },
    { q: 'What is the capital of Australia?', a: ['canberra'] },
    { q: 'What is the capital of Egypt?', a: ['cairo'] },
    { q: 'Which country is home to the Taj Mahal?', a: ['india'] },
    { q: 'Which mountain is highest above sea level?', a: ['mount everest', 'everest'] },
    { q: 'Which continent contains most of the Amazon rainforest?', a: ['south america'] },
    { q: 'Which ocean lies between Africa and Australia?', a: ['indian ocean', 'the indian ocean'] },
    { q: 'Which desert covers much of northern Africa?', a: ['sahara', 'sahara desert'] },
    { q: 'Who wrote Romeo and Juliet?', a: ['william shakespeare', 'shakespeare'] },
    { q: 'Who painted the Mona Lisa?', a: ['leonardo da vinci', 'da vinci'] },
    { q: 'In which sport is a shuttlecock used?', a: ['badminton'] },
    { q: 'How many players from one basketball team play on court at once?', a: ['5', 'five'] },
    { q: 'Which sport uses a bat and a wicket?', a: ['cricket'] },
    { q: 'Which musical instrument has black and white keys?', a: ['piano'] },
    { q: 'What does CPU stand for?', a: ['central processing unit'] },
    { q: 'What does HTML stand for?', a: ['hypertext markup language'] },
    { q: 'What is the SI unit of electric current?', a: ['ampere', 'amp'] },
    { q: 'What is the centre of an atom called?', a: ['nucleus'] },
    { q: 'What force pulls objects toward Earth?', a: ['gravity'] },
    { q: 'Which organ pumps blood around the human body?', a: ['heart', 'the heart'] },
    { q: 'How many chambers does a human heart have?', a: ['4', 'four'] },
    { q: 'What is the largest organ of the human body?', a: ['skin', 'the skin'] },
    { q: 'Which element makes up most of the Sun by mass?', a: ['hydrogen'] },
    { q: 'What is a plant-eating animal called?', a: ['herbivore', 'a herbivore'] },
    { q: 'Which year did humans first land on the Moon?', a: ['1969'] },
    { q: 'Who described the three laws of motion?', a: ['isaac newton', 'newton'] },
    { q: 'How many letters are in the English alphabet?', a: ['26', 'twenty six'] },
    { q: 'What is a baby frog called?', a: ['tadpole', 'a tadpole'] },
    { q: 'What is the capital of Nepal?', a: ['kathmandu'] },
    { q: 'Which planet is often called the Morning Star?', a: ['venus'] },
    { q: 'What is the frozen form of water called?', a: ['ice'] }
]);

/** Winner points per game. A round can be lost, never the scoreboard. */
export const GAME_POINTS = Object.freeze({
    number : 10,
    coin   : 2,
    math   : 5,
    code   : 5,
    scramble: 5,
    trivia : 5,
    lucky  : 8
});

export const PARTICIPATION_POINTS = 1;
/** Contributing a trivia question is worth points too — but only the first few. */
export const CONTRIBUTION_POINTS = 2;
export const CONTRIBUTION_LIMIT = 10;

/**
 * Every game the bot knows. `how` is what the player types; `blurb` is why they
 * would. Kept as data so `!game` and the README can never drift apart.
 */
export const GAMES = Object.freeze([
    {
        name: 'number', aliases: ['number', 'num', 'guess', 'n'], emoji: '🔢', mode: 'race',
        title: 'Guess the number', points: GAME_POINTS.number,
        how: '!game number [1-100] → send a number',
        blurb: 'A secret number, too-high/too-low hints, hot-and-cold feedback, 10 pts.'
    },
    {
        name: 'coin', aliases: ['coin', 'flip', 'toss', 'heads'], emoji: '🪙', mode: 'race',
        title: 'Coin toss', points: GAME_POINTS.coin,
        how: '!game coin → say heads or tails',
        blurb: 'A pre-flipped coin. Call it right for 2 pts.'
    },
    {
        name: 'math', aliases: ['math', 'maths', 'sum', 'calc'], emoji: '➗', mode: 'race',
        title: 'Maths', points: GAME_POINTS.math,
        how: '!game math [easy|hard] [linear|calc|mvc|arith] → send the answer',
        blurb: 'Arithmetic plus linear algebra, calculus and multivariable calculus. 5 easy / 10 hard.'
    },
    {
        name: 'code', aliases: ['code', 'programming', 'prog', 'coding', 'cs', 'coal', 'asm'], emoji: '💻', mode: 'race',
        title: 'Programming', points: GAME_POINTS.code,
        how: '!game code [easy|hard] [pf|oop|ds|coal] → send the answer',
        blurb: 'PF, OOP, data structures and COAL assembly/registers. 5 easy / 10 hard.'
    },
    {
        name: 'scramble', aliases: ['scramble', 'word', 'unscramble', 'anagram'], emoji: '🔤', mode: 'race',
        title: 'Word scramble', points: GAME_POINTS.scramble,
        how: '!game scramble → send the word',
        blurb: 'Letters shuffled at random; first correct word takes 5 pts.'
    },
    {
        name: 'trivia', aliases: ['trivia', 'question', 'q', 'quiz'], emoji: '🧠', mode: 'race',
        title: 'Trivia', points: GAME_POINTS.trivia,
        how: '!game trivia → send the answer',
        blurb: 'General knowledge, plus the questions the owner contributed. 5 pts.'
    },
    {
        name: 'lucky', aliases: ['lucky', 'draw', 'raffle', 'lottery', 'giveaway'], emoji: '🎁', mode: 'lucky',
        title: 'Lucky draw', points: GAME_POINTS.lucky,
        how: '!game lucky → !in to join → !game draw',
        blurb: 'Random winner among everyone who joins. Joining alone earns a point.'
    }
]);

const BY_ALIAS = new Map(GAMES.flatMap((g) => g.aliases.map((a) => [a, g])));

export function findGame(nameOrAlias) {
    return BY_ALIAS.get(String(nameOrAlias || '').toLowerCase().trim()) || null;
}

const points = (n) => `*+${n}* ${n === 1 ? 'pt' : 'pts'}`;
const pt = (n) => `${n} ${n === 1 ? 'pt' : 'pts'}`;

// ─── Pure helpers ────────────────────────────────────────────────────────────
/** Lowercase, accent- and punctuation-free form used for answer matching. */
export function normalizeAnswer(s) {
    return String(s ?? '')
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Does this message answer the question?
 *
 * Exact match always counts. A longer answer is also accepted inside a short
 * sentence ("I think it is Islamabad") — but never for a short or numeric
 * answer, otherwise "1" would match half the chat.
 */
export function answerMatches(text, accepted = []) {
    const t = normalizeAnswer(text);
    if (!t) return false;
    const words = t.split(' ').length;

    for (const raw of accepted) {
        const a = normalizeAnswer(raw);
        if (!a) continue;
        if (t === a) return true;
        if (a.length <= 3 || /^\d+$/.test(a)) continue;
        if (words <= 8 && new RegExp(`(^|\\s)${escapeRe(a)}(\\s|$)`).test(t)) return true;
    }
    return false;
}

/** "1/2" → 0.5, "-3" → -3, "0.25" → 0.25; anything else null. */
function numericValue(s) {
    const t = String(s ?? '').trim().replace(/\s+/g, '').replace(/−/g, '-');
    let m = t.match(/^(-?\d+(?:\.\d+)?)$/);
    if (m) return Number(m[1]);
    m = t.match(/^(-?\d+)\/(\d+)$/);
    if (m && Number(m[2]) !== 0) return Number(m[1]) / Number(m[2]);
    return null;
}

/**
 * Matching for maths/programming answers, where symbols matter: "O(n log n)"
 * equals "O(nlogn)", "1/2" equals "0.5", but "-3" never equals "3".
 */
export function looseMatches(text, accepted = []) {
    const raw = String(text ?? '').trim();
    if (!raw) return false;
    const spaced = (v) => String(v).toLowerCase().replace(/\s+/g, '').replace(/−/g, '-').replace(/[×]/g, 'x').replace(/²/g, '^2');
    const bare = (v) => spaced(v).replace(/\^/g, '').replace(/[^\p{L}\p{N}]+/gu, '');
    const t = spaced(raw);
    const tn = numericValue(raw);
    for (const a of accepted) {
        const an = numericValue(a);
        if (an !== null) {
            if (tn !== null && Math.abs(tn - an) < 1e-9) return true;
            if (t === spaced(a)) return true;
            continue;                      // never fuzzy-match a number
        }
        if (t === spaced(a)) return true;
        const b = bare(a);
        if (b && bare(raw) === b) return true;
        if (answerMatches(raw, [a])) return true;
    }
    return false;
}

/** First integer in a short message, or null ("42", "-3", "= 42", "i say 42"). */
export function parseNumberAnswer(text) {
    const raw = String(text ?? '').trim();
    if (!raw) return null;
    if (raw.split(/\s+/).length > 4) return null;          // too chatty to be an answer
    const m = raw.match(/-?\d+/);
    if (!m) return null;
    const n = Number(m[0]);
    return Number.isFinite(n) ? n : null;
}

/**
 * How close was that? Five bands so the number game has real feedback instead of
 * a plain "wrong" — the whole point of a guessing game.
 */
export function hotCold(guess, answer, min, max) {
    const span = Math.max(1, Math.abs(max - min));
    const frac = Math.abs(guess - answer) / span;
    if (frac === 0) return '🎯 spot on';
    if (frac <= 0.02) return '🔥 scorching';
    if (frac <= 0.06) return '♨️ hot';
    if (frac <= 0.14) return '🌤️ warm';
    if (frac <= 0.30) return '❄️ cold';
    return '🧊 freezing';
}

/** Shuffled letters that never come out as the original word. */
export function scrambleWord(word, random = Math.random) {
    const clean = String(word || '').toLowerCase();
    if (clean.length < 3) return clean;
    for (let attempt = 0; attempt < 8; attempt++) {
        const out = shuffle([...clean], random).join('');
        if (out !== clean) return out;
    }
    // a word made of one repeated letter (rare) — rotate instead
    return clean.slice(1) + clean[0];
}

/**
 * A random arithmetic problem. Hard mode has several multi-step templates,
 * including exact division (never a rounded/ambiguous answer).
 * @returns {{question:string, answer:number, level:'easy'|'hard', points:number}}
 */
export function makeMath(level = 'easy', random = Math.random) {
    if (level === 'hard') {
        const kind = randomInt(0, 4, random);
        let question, answer;
        if (kind === 0) {
            const a = randomInt(16, 39, random), b = randomInt(11, 29, random);
            const c = randomInt(12, 37, random), d = randomInt(6, 25, random);
            question = `${a} × ${b} + ${c} × ${d}`;
            answer = a * b + c * d;
        } else if (kind === 1) {
            const a = randomInt(24, 96, random), b = randomInt(17, 83, random);
            const c = randomInt(5, 19, random), d = randomInt(40, 170, random);
            question = `(${a} + ${b}) × ${c} − ${d}`;
            answer = (a + b) * c - d;
        } else if (kind === 2) {
            const a = randomInt(13, 48, random), b = randomInt(30, 79, random);
            const c = randomInt(5, b - 4, random), d = randomInt(45, 160, random);
            question = `${a} × (${b} − ${c}) + ${d}`;
            answer = a * (b - c) + d;
        } else if (kind === 3) {
            const divisor = randomInt(3, 9, random), quotient = randomInt(12, 34, random);
            const b = randomInt(7, 24, random), c = randomInt(11, 32, random);
            const d = randomInt(3, 16, random), a = divisor * quotient;
            question = `(${a} × ${b}) ÷ ${divisor} + ${c} × ${d}`;
            answer = quotient * b + c * d;
        } else {
            const a = randomInt(18, 45, random), b = randomInt(12, 31, random);
            const c = randomInt(10, 29, random), d = randomInt(14, 38, random);
            const e = randomInt(5, 17, random);
            question = `${a} × ${b} − (${c} + ${d}) × ${e}`;
            answer = a * b - (c + d) * e;
        }
        return { question, answer, level, points: 10 };
    }
    const kind = randomInt(0, 2, random);
    if (kind === 0) {
        const a = randomInt(11, 99, random);
        const b = randomInt(11, 99, random);
        return { question: `${a} + ${b}`, answer: a + b, level, points: GAME_POINTS.math };
    }
    if (kind === 1) {
        const a = randomInt(30, 99, random);
        const b = randomInt(2, a - 1, random);
        return { question: `${a} − ${b}`, answer: a - b, level, points: GAME_POINTS.math };
    }
    const a = randomInt(2, 12, random);
    const b = randomInt(2, 12, random);
    return { question: `${a} × ${b}`, answer: a * b, level, points: GAME_POINTS.math };
}

// ─── Engine ──────────────────────────────────────────────────────────────────
const REVEAL = {
    number  : (r) => `the number was *${r.answer}*`,
    coin    : (r) => `the coin was *${r.answer}*`,
    math    : (r) => `the answer was *${r.accepted ? r.accepted[0] : r.answer}*`,
    code    : (r) => `the answer was *${r.accepted[0]}*`,
    scramble: (r) => `the word was *${r.answer}*`,
    trivia  : (r) => `the answer was *${r.accepted[0]}*`
};

export function createGameEngine({
    config = {},
    log,
    scores,
    groups,
    content,                    // rotating, persisted AI trivia + scramble puzzles
    random = Math.random,
    now = () => Date.now(),
    send = null,                 // (jid, text) => Promise — used for timed-out rounds
    autoSweep = true
} = {}) {
    const timeoutMs   = Number.isFinite(config.gameTimeoutMs) ? config.gameTimeoutMs : 180_000;
    const cooldownMs  = Math.max(0, Math.min(Number.isFinite(config.gameCooldownMs) ? config.gameCooldownMs : 5_000, 5_000));
    const participationWindowMs = Math.max(5_000, cooldownMs);
    const maxAttempts = Number.isFinite(config.gameMaxAttempts) ? config.gameMaxAttempts : 12;
    let enabled = scores?.gamesEnabled?.(config.gamesEnabled !== false) ?? (config.gamesEnabled !== false);
    let generation = 0;            // invalidates in-flight starts after stop/reset

    const rounds = new Map();           // jid → round
    const cooldowns = new Map();        // jid → timestamp a new round may start
    const participationAt = new Map();  // "jid|playerKey" → when they last earned one
    let timer = null;

    // ── small helpers ────────────────────────────────────────────────────────
    async function labelOf(ctx) {
        for (const id of idsOf(ctx)) {
            const name = await ctx.groups?.nameOf?.(ctx.jid, id);
            if (name) return name;
        }
        return String(ctx.msg?.pushName || '').trim()
            || String(ctx.senderLabel || '').replace(/@.*/, '')
            || 'player';
    }

    const active = (jid) => rounds.get(jid) || null;

    /**
     * Every identity the sender can be known by, including the LID ↔ phone
     * number translation the router offers. The scoreboard must never end up
     * with two rows for one member just because the group addressed them by
     * their anonymous id.
     */
    function idsOf(ctx) {
        const out = new Set(ctx.senderIds || []);
        for (const id of [...out]) {
            for (const alt of ctx.expandIds?.(id) || []) {
                if (alt) out.add(alt);
            }
        }
        return out;
    }

    /** Who is talking, in the form the score store wants. */
    const whoOf = (ctx, name) => ({ ids: idsOf(ctx), name });

    function keyOf(ctx) {
        const ids = idsOf(ctx);
        return scores?.keyOf?.(ctx.jid, ids) || [...ids].sort()[0] || String(ctx.senderLabel || '');
    }

    /** Remember any identity we have not seen for this player before. */
    function rememberIds(ctx, key) {
        if (!scores?.link) return;
        for (const id of idsOf(ctx)) scores.link(ctx.jid, [key], id);
    }

    function playerEntry(round, key, label, ids) {
        let entry = round.players.get(key);
        if (!entry) {
            entry = { key, ids: [...(ids || [])], label, guesses: 0, earned: 0, tried: new Set() };
            round.players.set(key, entry);
        } else if (label && label !== entry.label) {
            entry.label = label;
        }
        return entry;
    }

    /**
     * The first attempt in a round earns a participation point — everyone who
     * plays contributes to the scoreboard.
     *
     * The point is rate-limited per member per five-second minimum window:
     * without that, a zero-second cooldown or replacing an open round would
     * mint participation points indefinitely. Rounds themselves stay unlimited.
     */
    function touchParticipation(round, entry, ctx, label) {
        if (!scores || entry.played) return;
        entry.played = true;
        scores.visit(round.chat, whoOf(ctx, label));      // rounds played always count

        const stamp = `${round.chat}|${entry.key}`;
        const previous = participationAt.get(stamp);
        if (previous !== undefined && now() - previous < participationWindowMs) return;
        participationAt.set(stamp, now());
        scores.award(round.chat, whoOf(ctx, label), PARTICIPATION_POINTS);
        entry.earned += PARTICIPATION_POINTS;
    }

    // ── rendering ────────────────────────────────────────────────────────────
    function listText() {
        const lines = [`🎮 *Games* — ${enabled ? 'everyone can play, everyone earns points' : 'OFF (owner: !game on)'}`, ''];
        GAMES.forEach((g, i) => {
            lines.push(`${i + 1}. ${g.emoji} *${g.name}* — ${g.blurb}`);
            lines.push(`   \`${g.how}\``);
        });
        lines.push(
            '',
            '*Scores & more*',
            '```',
            '!game top        leaderboard of this chat',
            '!game top all    leaderboard across all chats',
            '!game me         your own score card',
            '!game end        starter: end this chat’s round',
            '!game status     games on/off + rotating question counts',
            '!game mode easy|hard  math + code level for this chat',
            '```',
            `_Owner: !game on · !game stop (all chats) · !game reset tops (all boards) · !game reset @member [all] · !game addq Q ; A (+${CONTRIBUTION_POINTS} pts)_`,
            `Quick random: !random [n|1-100|a, b, c] · !roll 2d6 · !flip · !pick a, b · !shuffle a, b · !8ball <question>`
        );
        return lines.join('\n');
    }

    function helpText() {
        const lines = ['📖 *How to play*', ''];
        for (const g of GAMES) {
            lines.push(`${g.emoji} *${g.name}* — ${g.title} · ${g.points} pts`);
            lines.push(`  \`${g.how}\``);
            lines.push(`  ${g.blurb}`);
            lines.push('');
        }
        lines.push(
            'Everyone who takes part is on the scoreboard; the first right answer',
            'wins the round, and wrong guesses get hints. One game per chat at a',
            'time — the round also ends by itself if nobody finds it in time.',
            'The built-in pool, contributed questions and a daily rotating AI pool keep rounds fresh.'
        );
        return lines.join('\n');
    }

    function medal(i) {
        return ['🥇', '🥈', '🥉'][i] || `${i + 1}.`;
    }

    function boardText(ctx, scope = '') {
        const all = /^(all|global|everywhere)$/i.test(String(scope || ''));
        const rows = all ? scores?.boardAll(12) : scores?.board(ctx.jid, 12);
        if (!rows?.length) {
            return all
                ? '🏆 Nobody has played yet. Start a round: *!game*'
                : '🏆 Nobody here has played yet. Start a round: *!game*';
        }
        const { players, points: total } = all
            ? { players: rows.length, points: rows.reduce((n, r) => n + r.points, 0) }
            : scores.totals(ctx.jid);

        const head = all ? '🏆 *Top players (all chats)*' : `🏆 *Top players — ${ctx.chatName || 'this chat'}*`;
        const lines = rows.map((r, i) => {
            const name = r.name || String(r.key).replace(/@.*/, '');
            const streak = r.streak > 1 ? ` · 🔥${r.streak}` : '';
            const chats = all ? ` · ${r.chats} chat${r.chats === 1 ? '' : 's'}` : '';
            return `${medal(i)} ${name} — ${pt(r.points)} · ${r.wins} win${r.wins === 1 ? '' : 's'}${streak}${chats}`;
        });
        lines.push('', `_${players} player${players === 1 ? '' : 's'} · ${total} points${all ? ' total' : ''}_`);
        return [head, ...lines].join('\n');
    }

    function meText(ctx) {
        const key = keyOf(ctx);
        const rows = scores?.board(ctx.jid, Number.MAX_SAFE_INTEGER) || [];
        const row = rows.find((r) => r.key === key);
        if (!row) {
            return '👤 You are not on the board yet — join a round with *!game* and take a guess.';
        }
        const name = row.name || String(row.key).replace(/@.*/, '');
        const rank = rows.findIndex((r) => r.key === key) + 1;
        return [
            `👤 *${name}*`,
            `${pt(row.points)} · ${row.wins} win${row.wins === 1 ? '' : 's'} in ${row.played} round${row.played === 1 ? '' : 's'}`,
            `Rank #${rank} of ${rows.length} here${row.best > 1 ? ` · best streak ${row.best}` : ''}`
        ].join('\n');
    }

    // ── starting a round ─────────────────────────────────────────────────────
    function newRound(ctx, game, starterKey, starterLabel) {
        return {
            chat: ctx.jid,
            name: game.name,
            emoji: game.emoji,
            mode: game.mode,
            game,
            starterKey,
            starterLabel,
            startedAt: now(),
            endsAt: now() + timeoutMs,
            players: new Map(),
            wrong: 0,
            hinted: false,
            closed: false
        };
    }

    /** Build the round + the opening message for one game. */
    function build(ctx, game, args, starterKey, starterLabel) {
        const round = newRound(ctx, game, starterKey, starterLabel);
        const left = Math.round(timeoutMs / 1000);
        const tail = `\n\n_${left}s · !game stop to end · !game top for scores_`;

        switch (game.name) {
            case 'number': {
                const range = parseRange(args.join(' ')) || { min: 1, max: 100 };
                if (range.max - range.min > 100_000) {
                    return { error: 'That range is too wide — try something like `!game number 1-500`.' };
                }
                round.min = range.min;
                round.max = range.max;
                round.answer = randomInt(range.min, range.max, random);
                return {
                    round,
                    text: `${game.emoji} *Guess the number* — I picked one between *${range.min}* and *${range.max}*.\n`
                        + 'Send a number. I answer too high / too low, and how warm you are.' + tail
                };
            }

            case 'coin': {
                round.answer = random() < 0.5 ? 'Heads' : 'Tails';
                return {
                    round,
                    text: `${game.emoji} *Coin toss* — the coin is already in the air.\n`
                        + `Say *heads* or *tails*. Right call = ${game.points} pts.` + tail
                };
            }

            case 'math': {
                const level = levelFrom(ctx.jid, args);
                const topic = parseTopic(args, 'math');
                const concept = topic === 'arithmetic' ? null
                    : (topic || random() < 0.6) ? pickConcept('math', level, topic, ctx.jid) : null;
                const points = level === 'hard' ? 10 : GAME_POINTS.math;
                if (concept) {
                    round.pool = concept;
                    round.accepted = concept.a;
                    round.problem = { question: concept.q, level, points, concept: true };
                    return {
                        round,
                        text: `${game.emoji} *Maths* (${level} · ${TOPIC_LABEL[concept.topic] || concept.topic}) — first correct answer wins ${points} pts.\n\n`
                            + `❓ *${concept.q}*` + tail
                    };
                }
                const problem = makeMath(level, random);
                round.answer = problem.answer;
                round.problem = problem;
                return {
                    round,
                    text: `${game.emoji} *Maths* (${problem.level}) — first correct answer wins ${problem.points} pts.\n\n`
                        + `*${problem.question} = ?*` + tail
                };
            }

            case 'code': {
                const level = levelFrom(ctx.jid, args);
                const topic = parseTopic(args, 'code');
                const entry = pickConcept('code', level, topic, ctx.jid);
                if (!entry) return { error: 'No programming questions for that topic yet.' };
                const points = level === 'hard' ? 10 : GAME_POINTS.code;
                round.pool = entry;
                round.accepted = entry.a;
                round.problem = { question: entry.q, level, points, concept: true };
                return {
                    round,
                    text: `${game.emoji} *Programming* (${level} · ${TOPIC_LABEL[entry.topic] || entry.topic}) — first correct answer wins ${points} pts.\n\n`
                        + `❓ *${entry.q}*` + tail
                };
            }

            case 'scramble': {
                const puzzle = pickPuzzle(ctx.jid);
                const word = puzzle.word;
                round.answer = word;
                round.accepted = [word];
                round.scrambled = scrambleWord(word, random);
                lastScramble.set(ctx.jid, word);
                return {
                    round,
                    text: `${game.emoji} *Word scramble* — ${word.length} letters, first correct word wins ${game.points} pts\n\n`
                        + `🔀 *${round.scrambled.toUpperCase()}*`
                        + (puzzle.clue ? `\n_Clue: ${puzzle.clue}_` : '') + tail
                };
            }

            case 'trivia': {
                const entry = pickQuestion(ctx.jid);
                if (!entry) return { error: 'The trivia pool is empty.' };
                round.pool = entry;
                round.accepted = entry.a;
                lastQuestion.set(ctx.jid, entry.q);
                return {
                    round,
                    text: `${game.emoji} *Trivia* — first correct answer wins ${game.points} pts\n\n`
                        + `❓ *${entry.q}*`
                        + (entry.by ? `\n_by ${entry.by}_` : '')
                        + tail
                };
            }

            case 'lucky': {
                round.drawAt = now() + Math.min(timeoutMs, 90_000);
                round.endsAt = round.drawAt;
                return {
                    round,
                    text: `${game.emoji} *Lucky draw* — join with \`!in\`\n\n`
                        + `Everyone who joins earns ${PARTICIPATION_POINTS} pt, and the random winner takes ${game.points} pts.\n`
                        + '_!game draw picks the winner right now._'
                };
            }

            default:
                return { error: 'Unknown game.' };
        }
    }

    const TOPIC_LABEL = {
        linear: 'linear algebra', calculus: 'calculus', mvc: 'multivariable calculus',
        pf: 'programming fundamentals', oop: 'OOP', ds: 'data structures', coal: 'COAL / assembly'
    };
    const lastQuestion = new Map();
    const lastScramble = new Map();

    /** O(pool size), bounded; no immediate repeats even with a fixed RNG. */
    function pickDifferent(pool, previous, field) {
        const options = pool.length > 1 ? pool.filter((p) => p[field] !== previous) : pool;
        return pickOne(options.length ? options : pool, random);
    }

    /** Built-ins and member submissions persist; AI content rotates independently. */
    function pickQuestion(jid) {
        const contributed = (scores?.questions?.() || []).map((e) => ({ q: e.q, a: e.a, by: e.by }));
        const ai = content?.questions?.() || [];
        const pool = [...TRIVIA, ...contributed, ...ai];
        const picked = pickDifferent(pool, lastQuestion.get(jid), 'q');
        if (picked && ai.includes(picked)) content?.markUsed?.('trivia', picked);
        return picked;
    }

    function pickPuzzle(jid) {
        const ai = content?.puzzles?.() || [];
        const pool = [...BUILTIN_PUZZLES, ...ai];
        const picked = pickDifferent(pool, lastScramble.get(jid), 'word') || { word: 'garden', clue: '' };
        if (ai.includes(picked)) content?.markUsed?.('scramble', picked);
        return picked;
    }

    const lastConcept = new Map();   // "jid|kind" → last question text

    /** Built-in bank + AI pool for math/code, filtered by level and topic. */
    function pickConcept(kind, level, topic, jid) {
        const bank = kind === 'math' ? MATH_BANK : CODE_BANK;
        const ai = content?.items?.(kind) || [];
        const fits = (e) => e.level === level && (!topic || e.topic === topic);
        let pool = [...bank.filter(fits), ...ai.filter(fits)];
        if (!pool.length) pool = [...bank, ...ai].filter((e) => !topic || e.topic === topic);
        if (!pool.length) return null;
        const stamp = `${jid}|${kind}`;
        const picked = pickDifferent(pool, lastConcept.get(stamp), 'q');
        lastConcept.set(stamp, picked.q);
        if (ai.includes(picked)) content?.markUsed?.(kind, picked);
        return picked;
    }

    /** "hard"/"easy" typed in the command wins; otherwise the chat's mode. */
    function levelFrom(jid, args) {
        const text = (args || []).join(' ');
        if (/\b(hard|difficult)\b/i.test(text)) return 'hard';
        if (/\b(easy|simple)\b/i.test(text)) return 'easy';
        return scores?.modeOf?.(jid) || 'easy';
    }

    // ── attempts ─────────────────────────────────────────────────────────────
    /**
     * One hint per round, dropped after four wrong guesses — enough to keep a
     * stuck group playing, late enough that it does not hand the round over.
     */
    function hintFor(round) {
        switch (round.name) {
            case 'number': {
                const mid = Math.floor((round.min + round.max) / 2);
                return round.answer <= mid
                    ? `💡 It is in the lower half: *${round.min}–${mid}*`
                    : `💡 It is in the upper half: *${mid + 1}–${round.max}*`;
            }
            case 'scramble': return `💡 It starts with *${String(round.answer)[0].toUpperCase()}*`;
            case 'trivia':   return `💡 The answer starts with *${String(round.accepted[0])[0].toUpperCase()}*`;
            case 'coin':     return '💡 It begins with H or T, of course';
            case 'math':     return round.accepted
                ? `💡 The answer starts with *${String(round.accepted[0])[0].toUpperCase()}*`
                : `💡 The answer is ${round.answer % 2 === 0 ? 'even' : 'odd'}`;
            case 'code':     return `💡 The answer starts with *${String(round.accepted[0])[0].toUpperCase()}* (${String(round.accepted[0]).length} chars)`;
            default:         return '';
        }
    }

    /**
     * Score one attempt.
     * @param {object} ctx
     * @param {string} text      what the player sent
     * @param {boolean} explicit true for "!guess x" (the player is clearly trying)
     * @returns {Promise<{handled:boolean, reply?:string, react?:string, wrong?:boolean}>}
     */
    async function takeAttempt(ctx, text, explicit) {
        if (!enabled) return explicit ? gamesOff() : { handled: false };
        const round = active(ctx.jid);
        if (!round || round.closed) {
            return explicit
                ? { handled: true, react: '😴', reply: 'No game is running here. Start one with *!game*' }
                : { handled: false };
        }

        const label = await labelOf(ctx);
        // labelOf awaits group metadata: an owner stop/reset may have cancelled
        // this round while that lookup was pending. Never resurrect its score.
        if (!enabled || active(ctx.jid) !== round || round.closed) {
            return explicit ? (enabled ? { handled: true, react: 'ℹ️', reply: 'This round has ended.' } : gamesOff()) : { handled: false };
        }
        const key = keyOf(ctx);
        const entry = playerEntry(round, key, label, idsOf(ctx));
        rememberIds(ctx, key);

        if (entry.guesses >= maxAttempts) {
            return {
                handled: true,
                react: '🚫',
                reply: `🚫 You have used your ${maxAttempts} guesses here — let someone else try!`
            };
        }

        const before = entry.guesses;
        const verdict = score(round, entry, text, explicit);

        if (verdict.kind === 'ignore') {
            return explicit && verdict.reason
                ? { handled: true, react: '⚠️', reply: verdict.reason }
                : { handled: false };
        }

        if (verdict.kind === 'repeat') {
            return { handled: true, react: '♻️', reply: `♻️ You already tried *${verdict.value}*` };
        }

        entry.guesses = before + 1;

        // ── wrong ────────────────────────────────────────────────────────────
        if (verdict.kind === 'wrong') {
            round.wrong++;
            touchParticipation(round, entry, ctx, label);
            let hint = null;
            if (!round.hinted && round.wrong >= 4) {
                hint = hintFor(round);
                if (hint) round.hinted = true;
            }
            // A small answer space does not need a line of text per wrong guess,
            // so the ❌ reaction is the whole answer unless there is something to
            // say (the number game always has a direction + a warmth).
            const closing = verdict.closing ? endRound(round.chat, { head: '', reason: 'exhausted' }) : null;
            const reply = [verdict.reply, hint, closing].filter(Boolean).join('\n\n');
            return { handled: true, wrong: true, react: '❌', reply: reply || undefined };
        }

        // ── scored ───────────────────────────────────────────────────────────
        const won = verdict.points;

        // a win: score it, apply the streak bonus, then close the round.
        // The first attempt of a round counts as playing whether it wins or not.
        touchParticipation(round, entry, ctx, label);
        const scored = scores?.win(round.chat, whoOf(ctx, label), won) || { bonus: 0, streak: 1 };
        entry.earned += won + (scored.bonus || 0);
        const bonusLine = scored.bonus ? ` _(+${scored.bonus} streak bonus 🔥${scored.streak})_` : '';
        const guessLine = ` · ${entry.guesses} guess${entry.guesses === 1 ? '' : 'es'}`;

        const reply = `🎉 *${label}* wins! ${REVEAL[round.name]?.(round) || ''}`.trim()
            + `\n${points(won)}${bonusLine}${guessLine}`;

        const summary = endRound(round.chat, { winnerKey: key, head: '', reason: 'win' });
        return { handled: true, react: '🎉', reply: summary ? `${reply}\n\n${summary}` : reply };
    }

    
    /**
     * The per-game rules: does this text answer the round, and what happens?
     * @returns {{kind:'win'|'wrong'|'repeat'|'ignore', points?:number, reply?:string, reason?:string, value?:any}}
     */
    function score(round, entry, text, explicit) {
        const raw = String(text ?? '').trim();

        switch (round.name) {
            case 'number': {
                const n = parseNumberAnswer(raw);
                if (n === null) {
                    return explicit ? { kind: 'ignore', reason: 'Send a number, e.g. `!guess 42`.' } : { kind: 'ignore' };
                }
                if (n < round.min || n > round.max) {
                    return explicit
                        ? { kind: 'ignore', reason: `Pick a number between ${round.min} and ${round.max}.` }
                        : { kind: 'ignore' };
                }
                if (entry.tried.has(n)) return { kind: 'repeat', value: n };
                entry.tried.add(n);
                if (n === round.answer) {
                    return { kind: 'win', points: Math.max(4, GAME_POINTS.number - entry.guesses) };
                }
                const dir = n < round.answer ? '📈 Too low — go higher' : '📉 Too high — go lower';
                return { kind: 'wrong', reply: `${dir} · ${hotCold(n, round.answer, round.min, round.max)}` };
            }

            case 'coin': {
                const call = parseCoinCall(raw);
                if (call === null) {
                    return explicit ? { kind: 'ignore', reason: 'Say *heads* or *tails*.' } : { kind: 'ignore' };
                }
                const value = call ? 'Heads' : 'Tails';
                if (entry.tried.has(value)) return { kind: 'repeat', value };
                entry.tried.add(value);
                if (entry.tried.size >= 2) {
                    // both calls are in — nothing is left to try, so the round
                    // closes and the coin is revealed
                    return {
                        kind: 'wrong',
                        closing: true,
                        reply: `❌ Both calls are gone — the coin was *${round.answer}*`
                    };
                }
                if (value === round.answer) return { kind: 'win', points: GAME_POINTS.coin };
                return { kind: 'wrong' };
            }

            case 'code':
            case 'math': {
                if (round.accepted) {
                    // concept question: symbols matter, so use the loose matcher
                    const norm = raw.toLowerCase().replace(/\s+/g, ' ');
                    if (looseMatches(raw, round.accepted)) {
                        if (entry.tried.has(norm)) return { kind: 'repeat', value: raw };
                        return { kind: 'win', points: round.problem.points };
                    }
                    if (!explicit) return { kind: 'ignore' };
                    if (entry.tried.has(norm)) return { kind: 'repeat', value: raw };
                    entry.tried.add(norm);
                    return { kind: 'wrong', reply: `❌ ${raw} is not it` };
                }
                const n = parseNumberAnswer(raw);
                if (n === null) {
                    return explicit ? { kind: 'ignore', reason: `Send the answer to ${round.problem.question}` } : { kind: 'ignore' };
                }
                if (entry.tried.has(n)) return { kind: 'repeat', value: n };
                entry.tried.add(n);
                if (n === round.answer) return { kind: 'win', points: round.problem.points };
                return { kind: 'wrong', reply: explicit ? `❌ ${n} is not it` : undefined };
            }

            case 'scramble': {
                const guess = normalizeAnswer(raw);
                if (!guess || !/^[\p{L} ]{3,24}$/u.test(guess)) {
                    return explicit ? { kind: 'ignore', reason: 'Send one word.' } : { kind: 'ignore' };
                }
                if (entry.tried.has(guess)) return { kind: 'repeat', value: guess };
                entry.tried.add(guess);
                if (answerMatches(raw, round.accepted)) return { kind: 'win', points: GAME_POINTS.scramble };
                return { kind: 'wrong' };
            }

            case 'trivia': {
                if (answerMatches(raw, round.accepted)) {
                    const norm = normalizeAnswer(raw);
                    if (entry.tried.has(norm)) return { kind: 'repeat', value: raw };
                    return { kind: 'win', points: GAME_POINTS.trivia };
                }
                if (!explicit) return { kind: 'ignore' };          // plain chat, not an answer
                const norm = normalizeAnswer(raw);
                if (entry.tried.has(norm)) return { kind: 'repeat', value: raw };
                entry.tried.add(norm);
                return { kind: 'wrong', reply: `❌ ${raw} is not it` };
            }

            default:
                return { kind: 'ignore' };
        }
    }

    // ── ending a round ───────────────────────────────────────────────────────
    /**
     * Close the round in this chat, end the streak of everyone who did not win,
     * and build the wrap-up that lists what each player earned.
     *
     * @param {string} [head] the first line; `''` suppresses it (used when the
     *        caller has already announced the result), `undefined` uses the
     *        default "no winner this time — the answer was …" line.
     */
    function endRound(jid, { winnerKey = null, reason = 'stop', head = undefined } = {}) {
        const round = rounds.get(jid);
        if (!round) return null;
        round.closed = true;
        rounds.delete(jid);
        cooldowns.set(jid, now() + cooldownMs);

        const rows = [...round.players.values()];
        for (const p of rows) {
            if (p.key !== winnerKey) scores?.loseStreak?.(jid, p.ids);
        }
        log?.debug?.(`game: ${round.name} in ${jid} ended (${reason})`);

        const played = rows.filter((p) => p.earned > 0);
        const reveal = REVEAL[round.name] ? REVEAL[round.name](round) : '';
        const title = head !== undefined
            ? head
            : (reveal
                ? `⏰ No winner this time — ${reveal}.`
                : '⏰ Time is up.');

        const lines = [
            title,
            played.length ? `🎮 ${played.map((p) => `${p.label} +${p.earned}`).join(' · ')}` : null,
            `Next round: \`!game ${round.name}\` · scores: \`!game top\``
        ];
        return lines.filter(Boolean).join('\n');
    }

    /** A lucky round's winner is drawn, never guessed. */
    function drawLucky(jid, { manual = false } = {}) {
        const round = rounds.get(jid);
        if (!round || round.name !== 'lucky') return null;

        const rows = [...round.players.values()];
        if (!rows.length) {
            return endRound(jid, {
                reason: 'empty',
                head: '🎁 Nobody joined the draw — no winner this time.'
            });
        }
        const winner = pickOne(rows, random);
        const label = winner.label;
        const scored = scores?.win(jid, { ids: winner.ids, name: label }, GAME_POINTS.lucky) || { bonus: 0, streak: 1 };
        const bonus = scored.bonus || 0;
        const names = rows.map((r) => r.label);

        // `earned` is what the winner actually collected: the joining point (if
        // this round was their first within the cooldown window) plus the draw.
        winner.earned += GAME_POINTS.lucky + bonus;

        const text = [
            `🎁 *${label}* wins the lucky draw!`,
            `${points(winner.earned)}${bonus ? ` _(+${bonus} streak bonus 🔥${scored.streak})_` : ''}`
                + ` · ${rows.length} entr${rows.length === 1 ? 'y' : 'ies'}: ${names.join(', ')}`,
            manual ? '_drawn early by request_' : null,
            `Next round: \`!game lucky\` · scores: \`!game top\``
        ].filter(Boolean).join('\n');

        round.closed = true;
        rounds.delete(jid);
        cooldowns.set(jid, now() + cooldownMs);
        return text;
    }

    // ── owner controls and !game subcommands ─────────────────────────────────
    const gamesOff = () => ({
        handled: true, react: '🔕', reply: '🔕 Games are OFF. The bot owner can reopen them with *!game on*.'
    });
    const ownerOnly = () => ({ handled: true, react: '⛔', reply: '⛔ Only the bot owner can use that command.' });

    /** Cancel, never draw a winner or score a last guess. Inform other chats. */
    function cancelAll(origin, reason) {
        generation++;
        const cancelled = [...rounds.values()];
        for (const round of cancelled) round.closed = true;
        rounds.clear();
        cooldowns.clear();
        lastQuestion.clear();
        lastScramble.clear();
        if (send && cancelled.length) {
            // Sequential/async: do not hold up the owner's confirmation or
            // flood the WhatsApp socket if many groups had an open round.
            void (async () => {
                for (const round of cancelled) {
                    if (round.chat === origin) continue; // owner gets the command reply here
                    try { await send(round.chat, `🛑 ${reason} by the bot owner. The ${round.name} round was cancelled.`); }
                    catch (err) { log?.warn?.(`game: cancellation notice failed in ${round.chat}: ${err.message}`); }
                }
            })();
        }
        return cancelled.length;
    }

    function statusText(ctx) {
        const st = content?.status?.();
        const line = st
            ? Object.entries(st).map(([c, v]) => `${c} ${v.count}${v.used ? ` (${v.used} played)` : ''}`).join(' · ')
            : `trivia ${content?.questionCount || 0} · scramble ${content?.puzzleCount || 0}`;
        const hours = st ? `\n_trivia/scramble renew every ${st.trivia.everyHours}h if played · math/code replace played questions every ${st.math.everyHours}h_` : '';
        return `🎮 Games: *${enabled ? 'ON' : 'OFF'}* · ${rounds.size} active round(s) · ${cooldownMs / 1000}s between rounds\n`
            + `🎚️ Math/code mode here: *${scores?.modeOf?.(ctx?.jid) || 'easy'}*\n`
            + `🧠 AI pool: ${line}${hours}`;
    }

    /** Owner: !game reset @member [all] — one member, this chat or every chat. */
    async function resetMember(ctx, args) {
        const everywhere = args.some((a) => /^(all|global|everywhere)$/i.test(a));
        const typed = args.map((a) => a.replace(/\D/g, '')).filter((d) => d.length >= 6);
        const raws = ctx.mentioned?.length ? ctx.mentioned
            : typed.length ? typed
                : ctx.quotedParticipant ? [ctx.quotedParticipant] : [];
        if (!raws.length) {
            return { handled: true, react: '⚠️', reply: 'Usage: `!game reset @member` (this chat) · `!game reset @member all` (every chat) · `!game reset tops` (everyone)' };
        }
        const lines = [];
        let any = false;
        for (const raw of raws) {
            const ids = new Set(ctx.expandIds?.(raw) || []);
            ids.add(normalizeId(raw));
            ids.delete('');
            let label = '';
            for (const id of ids) { label = label || await ctx.groups?.nameOf?.(ctx.jid, id) || ''; }
            const out = scores.resetPlayer(ctx.jid, ids, { everywhere });
            const name = out.name || label || String(raw).replace(/@.*/, '');
            if (!out.found) { lines.push(`ℹ️ ${name} has no points${everywhere ? ' anywhere' : ' in this chat'}.`); continue; }
            any = true;
            for (const round of rounds.values()) {
                for (const [k, p] of round.players) if (p.ids.some((i) => ids.has(i))) round.players.delete(k);
            }
            lines.push(`🧹 ${name}: ${out.points} pts cleared${everywhere ? ` in ${out.found} chat(s)` : ''}.`
                + (out.saved ? '' : ' ⚠️ Could not save to disk.'));
        }
        log?.info?.(`game: member reset by ${ctx.senderLabel}: ${lines.join(' ')}`);
        return { handled: true, react: any ? '✅' : 'ℹ️', reply: lines.join('\n') };
    }

    async function handle(ctx, args = []) {
        const sub = String(args[0] || '').toLowerCase();

        if (sub === 'status') return { handled: true, reply: statusText(ctx) };
        if (sub === 'mode' || sub === 'level' || sub === 'difficulty') {
            const want = String(args[1] || '').toLowerCase();
            if (!['easy', 'hard'].includes(want)) {
                return { handled: true, reply: `🎚️ Math/code mode here is *${scores?.modeOf?.(ctx.jid) || 'easy'}*. Change it: \`!game mode easy\` or \`!game mode hard\`` };
            }
            const saved = scores?.setMode?.(ctx.jid, want);
            return {
                handled: true, react: want === 'hard' ? '🔥' : '🌱',
                reply: `🎚️ Math and code rounds in this chat are now *${want}* (${want === 'hard' ? 10 : 5} pts). `
                    + 'You can still override one round: `!game math easy`, `!game code hard`.'
                    + (saved === false ? '\n⚠️ Could not save this setting.' : '')
            };
        }
        if (sub === 'on') {
            if (!ctx.isOwner) return ownerOnly();
            enabled = true;
            const saved = scores?.setGamesEnabled?.(true);
            content?.start?.();
            // start() refreshes in the background, and refreshIfStale is
            // single-flight and a no-op until the next 24-hour boundary.
            if (content?.refreshIfStale) {
                void Promise.resolve().then(() => content.refreshIfStale())
                    .catch((err) => log?.warn?.(`game content: ${err.message}`));
            }
            return { handled: true, react: '✅', reply: `✅ Games are ON for all members.${saved === false ? ' ⚠️ Could not save this setting to disk.' : ''}` };
        }
        if (sub === 'off' || (sub === 'stop' && ctx.isOwner)) {
            if (!ctx.isOwner) return ownerOnly();
            enabled = false;
            const saved = scores?.setGamesEnabled?.(false);
            const count = cancelAll(ctx.jid, 'All games stopped');
            content?.pause?.();
            log?.info?.(`game: globally stopped by ${ctx.senderLabel} (${count} rounds)`);
            return {
                handled: true, react: '🛑',
                reply: `🛑 Games are OFF for all members. ${count} active round(s) cancelled. Use *!game on* to reopen.`
                    + (saved === false ? '\n⚠️ Could not save this setting to disk.' : '')
            };
        }
        if (sub === 'reset') {
            if (!ctx.isOwner) return ownerOnly();
            const what = String(args[1] || '').toLowerCase();
            if (!['tops', 'top', 'scores'].includes(what) || args.length !== 2) {
                if (!scores?.resetPlayer) return { handled: true, react: '⚠️', reply: 'The leaderboard is not available.' };
                return resetMember(ctx, args.slice(1));
            }
            if (!scores?.resetBoards) return { handled: true, react: '⚠️', reply: 'The leaderboard is not available.' };
            const count = cancelAll(ctx.jid, 'Leaderboards reset');
            participationAt.clear();
            const { players, saved } = scores.resetBoards();
            log?.info?.(`game: all leaderboards reset by ${ctx.senderLabel} (${players} players)`);
            return {
                handled: true, react: saved ? '✅' : '⚠️',
                reply: `🏆 All leaderboards reset (${players} players, ${count} rounds cancelled). Member questions are kept.`
                    + (saved ? '' : '\n⚠️ Could not save the reset to disk; the old scores may return after a restart.')
            };
        }

        if (!sub || sub === 'list' || sub === 'games') return { handled: true, reply: listText() };
        if (sub === 'help' || sub === 'how' || sub === 'rules') return { handled: true, reply: helpText() };
        if (sub === 'top' || sub === 'board' || sub === 'leaderboard' || sub === 'scores') {
            return { handled: true, reply: boardText(ctx, args[1]) };
        }
        if (sub === 'me' || sub === 'mine' || sub === 'stats') {
            return { handled: true, reply: meText(ctx) };
        }
        // addq is dispatched before the games switch on purpose: it is
        // owner-only, and the owner check inside addQuestion has to answer
        // before "games are off" can — otherwise a member is told to wait for
        // the owner to reopen games, as if that would let them contribute.
        if (sub === 'addq' || sub === 'add' || sub === 'contribute') {
            return addQuestion(ctx, args.slice(1));
        }
        if (!enabled) return gamesOff();
        if (sub === 'stop' || sub === 'end' || sub === 'quit' || sub === 'cancel') {
            return stopRound(ctx);
        }

        const game = findGame(sub);
        if (!game) {
            return {
                handled: true,
                react: '⚠️',
                reply: `⚠️ I do not know the game *${args[0]}*. Send *!game* for the list.`
            };
        }

        // With a draw already open, "!game lucky" means join it and
        // "!game draw" means pick the winner now — both are what you would type.
        const current = active(ctx.jid);
        if (game.name === 'lucky' && current?.name === 'lucky') {
            if (sub === 'draw') {
                const text = drawLucky(ctx.jid, { manual: true });
                return text
                    ? { handled: true, react: '🎁', reply: text }
                    : { handled: true, react: 'ℹ️', reply: 'No draw is open here.' };
            }
            return join(ctx);
        }

        return start(ctx, game, args.slice(1));
    }

    async function start(ctx, game, args) {
        const startGeneration = generation;
        const key = keyOf(ctx);
        const label = await labelOf(ctx);
        if (!enabled) return gamesOff(); // owner may have stopped games during the await
        if (generation !== startGeneration) {
            return { handled: true, react: 'ℹ️', reply: 'Games were cancelled while starting this round. Send the command again.' };
        }
        const current = active(ctx.jid);

        if (current) {
            if (current.name === game.name && game.name === 'lucky') return join(ctx);
            const mine = current.starterKey === key;
            if (!mine && !ctx.isOwner) {
                return {
                    handled: true,
                    react: '⏳',
                    reply: `⏳ A *${current.name}* round by ${current.starterLabel} is still running.\n`
                        + 'Play that one, or wait for it to end.'
                };
            }
            endRound(ctx.jid, { reason: 'replaced' });
        }

        // The breather only applies to starting fresh: replacing a round that is
        // still running is a deliberate restart, not a way to farm points (the
        // participation point is rate-limited separately).
        const until = cooldowns.get(ctx.jid) || 0;
        if (!current && now() < until && !ctx.isOwner) {
            const left = Math.ceil((until - now()) / 1000);
            return { handled: true, react: '⏳', reply: `⏳ Give the last round a ${left}s breather, then start again.` };
        }

        const built = build(ctx, game, args, key, label);
        if (built.error) return { handled: true, react: '⚠️', reply: `⚠️ ${built.error}` };

        rounds.set(ctx.jid, built.round);
        // The starter is registered straight away, but only counts a round as
        // played (and earns the participation point) once they actually try.
        playerEntry(built.round, key, label, ctx.senderIds);

        if (game.name === 'lucky') {
            const injected = joinInternal(built.round, ctx, label);
            return { handled: true, react: game.emoji, reply: `${built.text}\n\n🎟️ ${injected.reply}` };
        }

        log?.info?.(`game: ${label} started ${game.name} in ${ctx.jid}`);
        return { handled: true, react: game.emoji, reply: built.text };
    }

    function stopRound(ctx) {
        const round = active(ctx.jid);
        if (!round) return { handled: true, react: 'ℹ️', reply: 'ℹ️ No game is running here.' };
        const mine = round.starterKey === keyOf(ctx);

        if (!mine && !ctx.isOwner) {
            return {
                handled: true,
                react: '⛔',
                reply: `⛔ Only ${round.starterLabel} (who started it) or the bot owner can stop this round.`
            };
        }
        if (round.name === 'lucky') {
            const text = drawLucky(ctx.jid) || 'No draw is open here.';
            return { handled: true, react: '🎁', reply: text };
        }
        const text = endRound(ctx.jid, { reason: 'stop' }) || 'No game is running here.';
        return { handled: true, react: '🛑', reply: text };
    }

    // ── joining (lucky draw) ─────────────────────────────────────────────────
    function joinInternal(round, ctx, label) {
        const key = keyOf(ctx);
        const existing = round.players.get(key);
        if (existing?.joined) return { ok: false, reply: `${label}, you are already in the draw (${round.players.size} joined).` };

        const entry = playerEntry(round, key, label, idsOf(ctx));
        rememberIds(ctx, key);
        entry.joined = true;
        touchParticipation(round, entry, ctx, label);   // sets `played` and credits the point

        const seconds = Math.max(0, Math.round((round.endsAt - now()) / 1000));
        return {
            ok: true,
            reply: `${label} is in! ${round.players.size} joined · draw in ~${seconds}s (!game draw to pick now).`
        };
    }

    async function join(ctx) {
        if (!enabled) return gamesOff();
        const round = active(ctx.jid);
        if (round?.name !== 'lucky') {
            return { handled: true, react: '⚠️', reply: '⚠️ No draw is open. Start one with *!game lucky*' };
        }
        const label = await labelOf(ctx);
        if (!enabled || active(ctx.jid) !== round || round.closed) {
            return enabled ? { handled: true, react: 'ℹ️', reply: 'The draw has ended.' } : gamesOff();
        }
        const out = joinInternal(round, ctx, label);
        return { handled: true, react: out.ok ? '🎟️' : 'ℹ️', reply: out.reply };
    }

    // ── !guess and plain replies ─────────────────────────────────────────────
    async function guess(ctx, args = []) {
        if (!enabled) return gamesOff();
        const text = (args || []).join(' ').trim()
            || String(ctx.text || '').replace(/^!\S*\s*/, '').trim();
        if (!text) {
            return { handled: true, react: '⚠️', reply: 'Usage: `!guess <answer>` — or just send the answer.' };
        }
        return takeAttempt(ctx, text, true);
    }

    /**
     * The plain-message path. Deliberately strict: while a round is running,
     * only text that plainly looks like an answer is treated as one, so normal
     * chat keeps flowing to the quiz solver untouched.
     */
    async function handleMessage(ctx) {
        if (!enabled) return { handled: false };
        const round = active(ctx.jid);
        if (!round || round.closed) return { handled: false };

        const text = String(ctx.text || '').trim();
        if (!text || text.startsWith('!')) return { handled: false };

        switch (round.name) {
            case 'number':
                return /^-?\d+$/.test(text) ? takeAttempt(ctx, text, false) : { handled: false };
            case 'math':
            case 'code':
                if (round.accepted) {
                    // like trivia: only a correct answer interrupts the chat
                    return text.length <= 60 && looseMatches(text, round.accepted)
                        ? takeAttempt(ctx, text, false) : { handled: false };
                }
                return /^-?\d+$/.test(text) ? takeAttempt(ctx, text, false) : { handled: false };
            case 'coin':
                return parseCoinCall(text) !== null ? takeAttempt(ctx, text, false) : { handled: false };
            case 'scramble':
                return /^[\p{L}]{3,24}$/u.test(text) ? takeAttempt(ctx, text, false) : { handled: false };
            case 'trivia': {
                // Only a correct answer interrupts a conversation; wrong guesses
                // are for people who used !guess.
                return answerMatches(text, round.accepted) ? takeAttempt(ctx, text, false) : { handled: false };
            }
            case 'lucky':
                return /^(!?in|!?join|\+1|me too)$/i.test(text) ? join(ctx) : { handled: false };
            default:
                return { handled: false };
        }
    }

    // ── contributed trivia ───────────────────────────────────────────────────
    /**
     * The trivia pool is curated, not crowdsourced: only the owner (a number in
     * OWNER_NUMBERS, or the bot's own account) may add to it, so the questions
     * everyone plays stay under one person's control. A question lands in the
     * shared pool, and the first few contributions still earn points — capped,
     * so the pool cannot be used as a point farm.
     *
     * The owner check comes first, before the games switch and before any
     * parsing: a non-owner gets the same ⛔ whether games are on or off, and
     * never learns whether their text would have parsed.
     */
    function addQuestion(ctx, args) {
        if (!ctx.isOwner) return ownerOnly();
        if (!enabled) return gamesOff();
        const raw = args.join(' ').trim();
        const split = raw.match(/^(.*?)\s*(?:;|\||->)\s*(.+)$/);
        if (!raw || !split) {
            return {
                handled: true,
                react: '⚠️',
                reply: '⚠️ Usage: `!game addq Question ; Answer`\n'
                    + 'Example: `!game addq Which city is the capital of Japan? ; Tokyo`\n'
                    + '_An / inside the answer adds another accepted spelling._'
            };
        }

        const key = keyOf(ctx);
        const label = labelOfSync(ctx);
        const result = scores?.addQuestion?.({
            q: split[1],
            a: String(split[2]).split('/').map((s) => s.trim()).filter(Boolean),
            by: label,
            byKey: key,
            chat: ctx.jid
        });

        if (!result) return { handled: true, react: '⚠️', reply: '⚠️ The question pool is not available.' };
        if (!result.ok) return { handled: true, react: '⚠️', reply: `⚠️ I could not add that: ${result.error}.` };

        const mine = (scores.questions?.() || []).filter((e) => e.byKey && e.byKey === key).length;
        const credited = mine <= CONTRIBUTION_LIMIT;
        if (credited) scores.award(ctx.jid, whoOf(ctx, label), CONTRIBUTION_POINTS);

        return {
            handled: true,
            react: '✅',
            reply: `✅ Added to the trivia pool: *${result.entry.q}*\n`
                + `_Answer: ${result.entry.a.join(' / ')}_ · ${scores.questionCount} questions in the pool`
                + (credited ? `\n${points(CONTRIBUTION_POINTS)} for contributing 🎓` : '')
        };
    }

    /** A synchronous best-effort label for the addq confirmation. */
    function labelOfSync(ctx) {
        return String(ctx.msg?.pushName || '').trim()
            || String(ctx.senderLabel || '').replace(/@.*/, '')
            || 'member';
    }

    // ── timers ───────────────────────────────────────────────────────────────
    /** Close every round whose time is up. Returns what it announced. */
    async function sweep() {
        const out = [];
        for (const [jid, round] of [...rounds]) {
            if (active(jid) !== round || now() < round.endsAt) continue;

            let text;
            if (round.name === 'lucky') {
                text = drawLucky(jid);
            } else {
                text = endRound(jid, { reason: 'timeout' });
            }
            if (text) out.push({ chat: jid, game: round.name, text });
        }
        // Close ALL expired rounds before any slow WhatsApp send: a busy chat
        // cannot keep another chat's finished round open past its deadline.
        if (send) {
            for (const item of out) {
                try { await send(item.chat, item.text); }
                catch (err) { log?.debug?.(`game: could not announce the end of ${item.game} in ${item.chat}: ${err.message}`); }
            }
        }
        // These maps contain only short-lived rate limits, not player history.
        // Expire entries so a busy bot cannot accumulate one key per member
        // forever across thousands of groups.
        for (const [jid, until] of cooldowns) if (until <= now()) cooldowns.delete(jid);
        for (const [stamp, at] of participationAt) {
            if (at + participationWindowMs <= now()) participationAt.delete(stamp);
        }
        return out;
    }

    function close() {
        if (timer) clearInterval(timer);
        timer = null;
    }

    if (autoSweep) {
        timer = setInterval(() => { sweep().catch((err) => log?.debug?.(`game sweep: ${err.message}`)); }, 1000);
        timer.unref?.();
    }

    const api = {
        handle,
        guess,
        join,
        handleMessage,
        addQuestion,
        stop: stopRound,
        list: listText,
        help: helpText,
        board: boardText,
        active,
        sweep,
        close,
        /** Test/dev hook: finish a round without waiting for the timer. */
        end: (jid, opts) => endRound(jid, opts),
        get enabled() { return enabled; },
        get roundCount() { return rounds.size; }
    };

    return api;
}

export default createGameEngine;
