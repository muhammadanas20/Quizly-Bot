// Run in a child process: a test runner's handles would hide an unref'ed
// reconnect timer. Fake sockets deliberately hold no event-loop handles.
import { EventEmitter } from 'node:events';
import { startBot } from '../../src/bot.js';
import { loadConfig } from '../../src/config.js';

const [scenario, dir] = process.argv.slice(2);
const config = loadConfig({});
config.dataDir = dir;
config.sessionDir = `${dir}/auth`;
const log = Object.fromEntries(
    ['info', 'warn', 'error', 'fatal', 'debug', 'raw'].map((level) => [level, () => {}])
);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const closeWith = (statusCode) => ({
    connection: 'close',
    lastDisconnect: { error: { output: { statusCode } } }
});

let connections = 0;
let ended = 0;
const sockets = [];
const bot = await startBot({
    config,
    log,
    authStateFactory: async () => ({ state: {}, saveCreds: async () => {} }),
    socketFactory: () => {
        connections++;
        const socket = { ev: new EventEmitter(), end: () => { ended++; } };
        sockets.push(socket);
        if (connections === 2 && scenario !== 'stale') {
            queueMicrotask(async () => {
                socket.ev.emit('connection.update', { connection: 'open' });
                await bot.stop();
            });
        } else if (scenario === 'stale') {
            queueMicrotask(() => socket.ev.emit('connection.update', { connection: 'open' }));
        }
        return socket;
    }
});

setImmediate(async () => {
    if (scenario === 'replaced') {
        sockets[0].ev.emit('connection.update', closeWith(440));
        // The old fast-reconnect path fired at 3s and started a kick-war with
        // the duplicate; a replaced session must stand well clear of that.
        await sleep(4200);
        await bot.stop();
    } else if (scenario === 'stale') {
        sockets[0].ev.emit('connection.update', closeWith(408));
        for (let i = 0; connections < 2 && i < 250; i++) await sleep(20);  // backoff is 3s
        // Late events from the dead first socket must not spawn a rival
        // connection — that is how one process ends up fighting itself.
        sockets[0].ev.emit('connection.update', closeWith(408));
        sockets[0].ev.emit('connection.update', { connection: 'close' });
        await sleep(4200);
        await bot.stop();
    } else {
        const update = closeWith(scenario === 'pairing' ? 515 : 408);
        // Duplicate close notifications must not schedule multiple replacements.
        sockets[0].ev.emit('connection.update', update);
        sockets[0].ev.emit('connection.update', update);
        if (scenario === 'stop') await bot.stop();
    }
});

process.once('beforeExit', () => {
    console.log(JSON.stringify({ connections, ended }));
});
