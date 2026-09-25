// Run in a child process. Boots the REAL startBot with a fake socket factory and
// reports the `browser` tuple the socket was created with — i.e. the device
// class this bot pairs as. Baileys derives that class from browser[1]
// ('Android' → phone class, anything else → Platform.WEB), and WhatsApp only
// ships one-time ("view once") media to a phone-class companion.
import { EventEmitter } from 'node:events';
import { startBot } from '../../src/bot.js';
import { loadConfig } from '../../src/config.js';

const [want, dir] = process.argv.slice(2);
const config = loadConfig({
    GEMINI_API_KEY  : 'k',
    OWNER_NUMBERS   : '923001234567',
    WA_BROWSER      : want,
    WA_BROWSER_NAME : 'Test Phone'
});
config.dataDir = dir;
config.sessionDir = `${dir}/auth`;

const log = Object.fromEntries(
    ['info', 'warn', 'error', 'fatal', 'debug', 'raw'].map((level) => [level, () => {}])
);

let browser = null;
const bot = await startBot({
    config,
    log,
    fetchImpl: async () => ({ status: 503, text: async () => '{"error":{"message":"offline test"}}' }),
    authStateFactory: async () => ({ state: {}, saveCreds: async () => {} }),
    socketFactory: (opts) => {
        browser = opts.browser;
        const socket = { ev: new EventEmitter(), end: () => {} };
        queueMicrotask(async () => {
            socket.ev.emit('connection.update', { connection: 'open' });
            await bot.stop();
        });
        return socket;
    }
});

process.once('beforeExit', () => {
    console.log(JSON.stringify({ browser, companion: config.companion }));
});
