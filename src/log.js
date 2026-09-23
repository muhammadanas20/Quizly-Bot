/**
 * src/log.js — tiny logger.
 *
 * Deliberately NOT pino/winston. On a 1 GiB VM every megabyte and every
 * millisecond of startup time counts, and console.log is both.
 * It still exposes the pino surface (.info/.warn/.error/.child) because
 * Baileys expects a logger that looks like pino.
 */

const LEVELS = { silent: 0, error: 1, warn: 2, info: 3, debug: 4, trace: 5 };

const level = LEVELS[String(process.env.LOG_LEVEL || 'info').toLowerCase()] ?? LEVELS.info;

const paint = (code) => (s) => `\u001b[${code}m${s}\u001b[0m`;
const C = {
    grey  : paint('90'),
    red   : paint('31'),
    yellow: paint('33'),
    green : paint('32'),
    cyan  : paint('36'),
    bold  : paint('1'),
    dim   : paint('2')
};

const stamp = () => new Date().toISOString().slice(11, 19);

/**
 * Baileys logs `logger.info({ trace: '<whole stack>' }, 'connection errored')`.
 * Printing raw stacks for every reconnect makes the log unreadable, so collapse
 * those objects to their first line.
 */
function tidy(arg) {
    if (arg === null || typeof arg !== 'object') return arg;
    if (typeof arg.trace === 'string' && Object.keys(arg).length === 1) {
        return arg.trace.split('\n')[0].replace(/^Error: /, '');
    }
    return arg;
}

function write(stream, tag, color, args) {
    const line = `${C.grey(stamp())} ${color(tag)}`;
    stream(line, ...args.map(tidy));
}

export const log = {
    level,
    error : (...a) => level >= LEVELS.error && write(console.error, 'ERR ', C.red, a),
    warn  : (...a) => level >= LEVELS.warn  && write(console.warn,  'WARN', C.yellow, a),
    info  : (...a) => level >= LEVELS.info  && write(console.log,   'INFO', C.cyan, a),
    debug : (...a) => level >= LEVELS.debug && write(console.log,   'DBG ', C.grey, a),
    trace : (...a) => level >= LEVELS.trace && write(console.log,   'TRC ', C.dim, a),
    fatal : (...a) => { write(console.error, 'FATAL', C.red, a); },
    /** Raw line, no timestamp — used for banners and the QR code. */
    raw   : (...a) => console.log(...a),
    /** Baileys calls logger.child({...}) — return something equally usable. */
    child : () => log,
    C
};

export default log;
