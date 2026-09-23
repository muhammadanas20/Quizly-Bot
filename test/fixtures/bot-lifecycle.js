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
let connections = 0;
let ended = 0;
const bot = await startBot({
    config,
    log,
    authStateFactory: async () => ({ state: {}, saveCreds: async () => {} }),
    socketFactory: () => {
        connections++;
        const socket = { ev: new EventEmitter(), end: () => { ended++; } };
        if (connections === 2) {
            queueMicrotask(async () => {
                socket.ev.emit('connection.update', { connection: 'open' });
                await bot.stop();
            });
        }
        return socket;
    }
});

setImmediate(async () => {
    const update = {
        connection: 'close',
        lastDisconnect: { error: { output: { statusCode: scenario === 'pairing' ? 515 : 408 } } }
    };
    // Duplicate close notifications must not schedule multiple replacements.
    bot.socket.ev.emit('connection.update', update);
    bot.socket.ev.emit('connection.update', update);
    if (scenario === 'stop') await bot.stop();
});

process.once('beforeExit', () => {
    console.log(JSON.stringify({ connections, ended }));
});
