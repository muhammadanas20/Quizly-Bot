/** Small WhatsApp-native renderers. Keep prose out of monospace blocks. */
export function questionText(entry) {
    const question = String(entry.q || '').trim();
    // A separate optional snippet avoids wrapping prose in a giant code block.
    // Remove embedded fences so supplied snippets cannot break the layout.
    const code = String(entry.code || '').replace(/```/g, '').trim();
    return code ? `${question}\n\n\`\`\`\n${code}\n\`\`\`` : question;
}

export function roundCard({ emoji, title, detail, question, footer }) {
    return [`${emoji} *${title}*`, detail, '', question, '', footer]
        .filter((line) => line !== undefined && line !== null)
        .join('\n').trim();
}

export const GAME_GUIDE = [
    '*Rounds*',
    '!game <name> — start a round',
    '!guess <answer> — or just send your answer',
    '!game mode easy|hard — default math/code difficulty',
    '!game end — end your round',
    '!game status — availability and question pools', '',
    '*Scores*',
    '!top · !top all · !game me', '',
    '*Owner controls*',
    '!game on · !game stop (all chats)',
    '!game reset tops — clear all leaderboards',
    '!game reset @member [all] — reset one player',
    '!game answer — reveal the current answer', '',
    '*Owner question tools*',
    '!game addq Question ; Answer',
    '!game addemoji Emojis ; Answer',
    '!game listq [search] · !game listemoji',
    '!game modify Question ; New answer',
    '!game delete Question · !game deleteemoji <#>',
    '!game restore',
    '!game add new ds',
    'Generation topics: pf · oop · ds · coal · trivia · riddle · emoji · math · scramble'
].join('\n');
