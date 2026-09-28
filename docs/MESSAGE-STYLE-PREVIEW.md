# Quizly message makeover — approval preview

**Approved: A · Clean & friendly, plus 30 DS questions and snippet formatting.**

This is the original design catalog. Implementation preserves existing scoring details,
question numbering and useful diagnostics/warnings; exact live copy can differ from the
illustrative templates below. See `MESSAGE-EXAMPLES.md` for rendered examples.

Placeholders such as {name}, {points}, and {seconds} mean live values, not fixed copy. WhatsApp uses *single asterisks* for bold and triple backticks for monospace. Examples show the text that would be sent; this document is not an exact WhatsApp rendering.

## Choose a direction

### A · Clean & friendly — recommended

```text
💻 *Data structures · Easy*

Which data structure follows LIFO?

5 pts · 3 min
Send your answer to join in.
```

Winner:
```text
🎉 *Nice one, Ali!*
Stack is correct.

+5 pts · Total: 42 pts
```

### B · Minimal

```text
*Data structures* · Easy

Which data structure follows LIFO?

5 pts · 3 min · Reply to answer
```

Winner:
```text
✅ *Ali got it*
Stack · +5 pts · Total: 42 pts
```

### C · Playful, not loud

```text
🧩 *Quick challenge*
Data structures · Easy

Which data structure follows LIFO?

5 pts up for grabs · 3 min
What’s your answer?
```

Winner:
```text
🎉 *That’s it, Ali!*
Stack — last in, first out.

+5 pts · Total: 42 pts
```

Any explanation must come from verified question content, not invented at render time. Points above are illustrative: actual replies retain participation, streak and game-specific scoring.

## Full reply-template catalog

The following uses **A** as the baseline. B keeps the same information with fewer emojis; C changes the tone without changing rules. Related validation branches share templates rather than needing different visual styles.

### 1. Help and discovery

**Main help**
```text
👋 *Hey, welcome to Quizly*

Solve a screenshot, play a round, or settle a random pick.

*Quiz*
Send a screenshot with “{trigger}”, or reply to one with !quiz.

*Play*
!game — browse games
!game code easy ds — data structures
!top — this chat’s leaderboard
!game me — your score

*Quick picks*
!roll · !flip · !pick tea, coffee
!random · !shuffle · !8ball

*More*
!game help — rules and game commands
!ping · !stats

*Owner tools*
!flag · !unflag · !flags · !guard
Game controls and question management: !game help
```

**Game list**
```text
🎮 *Pick a game*

🔢 number — guess the number
🧩 riddle — a tricky brain teaser
🎭 emoji — decode the emoji rebus
✊ rps — beat the bot's hidden hand
➗ math — solve a problem
💻 code — programming challenges
🔤 scramble — unscramble a word
🧠 trivia — a little general knowledge

Start with !game {name}
Math/code: add easy or hard.
Code topics: pf · oop · ds · coal
Math topics: linear · calc · mvc · arith

Example: !game code easy ds
!game help for rules and controls.
```

**Detailed game help** — grouped short sections, never an aligned ASCII table:
```text
🎮 *How to play*

Send an answer, or use !guess {answer}.
Your first eligible attempt earns a participation point.
Wins earn game points; streaks can add a bonus.

*Rounds*
!game {name} — start
!game mode easy|hard — default difficulty
!game end — end your round
!game status — availability and content

*Scores*
!top · !top all · !game me

*Owner controls*
!game on · !game stop
!game reset tops
!game reset @member [all]
!game answer

*Owner question tools*
!game addq Question ; Answer
!game listq [search]
!game modify Question ; New answer
!game delete Question
!game restore
!game add new ds

Generation topics: pf · oop · ds · coal · trivia · math · scramble
```

### 2. Quiz solving

**Solved screenshot** — retain question → reason → answer order:
```text
📝 *Quiz answers · {count} questions*

*1. Which data structure follows LIFO?*
The last item added is the first removed.
✅ *Stack*

*2. Binary search time complexity?*
Each step halves the remaining search space.
✅ *O(log n)*

*Answer key*
1. Stack
2. O(log n)
```

Proposal: keep provider/model/timing in logs instead of appending a machine-looking footer to every solved quiz. Keep uncertainty visible.

| Reply or state | Proposed template |
| --- | --- |
| Working | 👀 reaction only |
| Success | ✅ reaction only |
| Already solving in this chat | Stay silent, preserving current behavior |
| Rate limit | ⏳ {friendly limit reason}\nTry again {retry window, if known}. |
| Download failed | 📷 That photo didn’t download. Please send it again as a screenshot. |
| No image | 📷 Send a quiz screenshot, or reply to one with !quiz. |
| Solve failed | ⚠️ I couldn’t solve this one.\n{safe, useful reason}\n\nTry again with a clear, uncropped screenshot. |
| Nothing readable | 📷 I couldn’t read the questions.\n{unreadable detail}\n\nPlease send a sharper, uncropped screenshot. |
| Partially unreadable | 📷 Couldn’t read: {question numbers/details}. Please resend that part. |
| Truncated output | ⚠️ Some answers may be missing. Send the remaining questions in a smaller screenshot. |
| Uncertain answer | Keep the question’s uncertainty note beside its answer. |
| Plain-text fallback | 📝 *Quiz response*\n\n{safe readable response}; never label unverified fallback output as confirmed correct. |

### 3. All seven round starters

Every starter keeps its own actual duration, reward, range, and relevant rules.

**Number**
```text
🔢 *Guess the number*

I’ve picked a number from {min} to {max}.
Send a guess — I’ll tell you higher or lower.

Up to {points} pts · {duration}
Each wrong guess reduces the reward by 1.
```

**Riddle**
```text
🧩 *Riddle me this*

{riddle}

{points} pts · {duration}
First correct answer wins.
```

**Emoji puzzle**
```text
🎭 *Emoji puzzle*

{emoji string}
_Category: {movie · phrase · thing · place · food}_

{points} pts · {duration}
Send the answer.
```

**Rock-Paper-Scissors**
```text
✊ *Rock · Paper · Scissors*

The bot has already thrown its hand — in secret.
Call *rock*, *paper* or *scissors*: only the hand that beats it wins.
Two misses from one player and the hand is shown.

{points} pts · {duration}
```

**Math**
```text
➗ *Math · {topic}*
{difficulty} · {points} pts · {duration}

{question}

Send your answer.
```

**Programming / data structures**
````text
💻 *Data structures · Easy*
5 pts · 3 min

What does the final pop return?

```
stack = []
push(10)
push(20)
pop()
push(30)
pop()
```

Send your answer.
````
Use the same template for PF, OOP, and COAL. Code is plain monospace with no language label, HTML, or assumed syntax highlighting. Prose stays outside the snippet. Do not insert the answer into the question message.

**Scramble**
```text
🔤 *Unscramble this*

{scrambled word}

{length} letters · {points} pts · {duration}
Hint: {clue, only when available}

Send the original word.
```

**Trivia**
```text
🧠 *Quick trivia*

{question}

{points} pts · {duration}
First correct answer wins.
```

### 4. Answers, hints, round endings and validation

| Reply or state | Proposed template |
| --- | --- |
| Correct answer | 🎉 *Nice one, {name}!*\n{answer} is correct.\n\n{actual points breakdown}\nTotal: {total} pts |
| Streak, when earned | 🔥 {streak}-win streak · +{bonus} bonus |
| Participation summary, when already emitted | {name}: +{participation} participation pt |
| Wrong implicit answer | ❌ reaction only where currently silent |
| Wrong explicit answer | Not quite — try again. |
| Number guess | ↗️ Try higher · {warmth} / ↘️ Try lower · {warmth} |
| Number narrowing hint | 💡 It’s between {low} and {high}. |
| Letter hint | 💡 Starts with *{letter}*. {length detail when applicable} |
| Riddle hint | 💡 The answer starts with *{letter}*. |
| Emoji hint | 💡 It is a {category} · the answer starts with *{letter}*. |
| RPS hint | 💡 Rock beats Scissors · Paper beats Rock · Scissors beats Paper. |
| Repeated guess | You’ve tried *{guess}* already. Try another. |
| Attempts exhausted | You’ve used all {limit} guesses this round. Next round is yours to try. |
| Invalid answer | {expected answer type}\nExample: {valid example} |
| Two RPS misses | ✊ Two misses — the bot threw *{hand}*. Nobody beat it. |
| Timeout | ⏱️ *Time’s up*\nThe answer was *{answer}*.\n\n{existing participation summary, if any} |
| Ended by starter | *Round ended*\nThe answer was *{answer}*.\n{existing score summary, if any} |
| No round | No round running here. Start one with !game. |
| Round just ended | That round has ended. Send !game to start another. |
| Already running | ⏳ {starter}’s {game} round is still running.\nJoin with !guess {answer}.\nOnly the starter or owner can replace it. |
| Cooldown | ⏳ Next round in {seconds}s. |
| Unknown game | That game isn’t on the list. Send !game to see the choices. |
| Games stopped during round setup | Games were paused before this round started. Try again when games reopen. |
| Games disabled/unavailable | 🌙 Games are unavailable right now. {owner reopening command only when applicable} |
| No stop permission | Only {starter} or the bot owner can end this round. |

### 5. Leaderboard and player card

```text
🏆 *Leaderboard · This chat*

🥇 Ali — 42 pts
🥈 Sara — 35 pts
🥉 Hamza — 28 pts
4. Noor — 19 pts

{wins and streak details per player where currently shown}
Your rank: #{rank} · {points} pts

!top all for the global board
```

Global variant: title becomes “Leaderboard · All chats”; retain relevant chat counts. Never invent a rank for an unranked player.

```text
👤 *{name}’s score*

{points} pts · Rank #{rank}
{wins} wins · {rounds} rounds
Best streak: {best}

{current streak, contributions and other existing score details}
```

Empty leaderboard: “🏆 No scores yet. Start a round with !game.”
New player: “👋 Your score starts with your first guess. Join a round with !game.”
Unavailable board: “The leaderboard isn’t available right now.”

### 6. Game settings and owner controls

| Reply | Proposed template |
| --- | --- |
| Status | 🎮 *Game status*\nGames: {on/off}\nActive rounds: {count}\nBetween rounds: {seconds}s\n\n*Question pools*\n{actual pool counts, generation readiness and current settings} |
| Read mode | 🎚️ Difficulty here: *{mode}*\nChange it with !game mode easy or !game mode hard. |
| Mode changed | ✅ Math and code now use *{mode}* here.\n{points} pts per win, before bonuses. |
| Games reopened | ✅ Games are open for everyone.\n!game to pick a round. |
| Global stop | 🌙 Games paused for everyone.\n{count} rounds cancelled.\n!game on to reopen. |
| Cancellation in another chat | 🌙 The owner paused games. This round is cancelled. |
| All scores reset | 🏆 Leaderboards cleared.\n{players} players reset · {rounds} rounds cancelled\nContributed questions are kept. |
| Member reset | ✅ {name}’s score reset {in this chat/across all chats}. |
| Nothing to reset | No saved score for {name} {scope}. |
| Owner-only rejection | 🔒 This command is for the bot owner. |
| Owner answer reveal | 🔑 *Answer:* {answer} |
| No answer to reveal | No active question here. / This game has no single answer. |
| Saving failed | ⚠️ This change couldn’t be saved. It may revert after a restart. |

Keep all existing permissions, persistence checks and scoring behavior.

### 7. Question management

| Reply | Proposed template |
| --- | --- |
| Added trivia | ✅ *Question added*\n{question}\nAnswer: {accepted answers}\n{earned contribution points, if any} |
| Generated questions | ✅ Added {count} new {topic} questions. |
| Generation failed | ⚠️ Couldn’t generate {topic} questions. Nothing was added.\n{safe reason} |
| Question deleted | 🗑️ *Question removed*\n{question}\n{pool/count details} |
| Answer modified | ✏️ *Answer updated*\n{question}\n{old answer} → {new answer}\n{affected pools} |
| Question list | 📚 *Your questions · {count}*\n\n{number}. {question}\nAnswer: {accepted answers}\n\n{pool summary} |
| Empty list | 📚 No added questions yet.\n!game addq Question ; Answer |
| Search results | 🔎 *{count} matches*\n{number}. {question} · {pool tag}\n{overflow instruction, if needed} |
| No matches | No question matches “{query}”.\nTry a shorter search with !game listq {word}. |
| Multiple matches | Found {count} matches. Use the full question to choose one.\n{matching questions with pool tags} |
| Already removed | That question is already removed.\n{question} |
| Deleted question cannot be edited | That question is hidden. Use !game restore before editing it. |
| Restored | ✅ Restored {count} questions and cleared {count} answer overrides. |
| Nothing to restore | Nothing to restore — no hidden questions or answer overrides. |
| Pool unavailable | The question pool isn’t available right now. |
| AI pool not editable | That question is in the AI pool, which can’t be edited right now. |
| Partial update | ⚠️ {successful changes}. The AI copy couldn’t be updated. |
| Operation failure | ⚠️ Couldn’t {add/delete/update} that question. {specific safe reason} |
| Invalid index, duplicate or other store validation | {friendly specific validation reason}.\n{correct command/example} |
| Empty question / missing answer | Add {a question/an answer} too.\nExample: !game addq Capital of Japan? ; Tokyo |
| Disk failure | ⚠️ Couldn’t save this change. It may revert after a restart. |

Keep list limits, stable question identifiers, accepted spellings, partial-success notices and pool distinctions. Do not expose owner answers to other players.

### 8. Moderation and health

| Reply | Proposed template |
| --- | --- |
| Flag added | 🛡️ *Media filter added*\n{name} · {media types}\nReason: {reason, if supplied}\n{existing admin/saving caveats} |
| Flag updated / already flagged | 🛡️ *Media filter updated* / Already filtering {name}.\n{actual state and media types} |
| Unflagged | ✅ Media filter removed for {name}. |
| Not flagged | {name} doesn’t have a media filter. |
| Flags list | 🛡️ *Filtered members · {count}*\n{name} — {media}\n{reason, when present} |
| Empty flags | 🛡️ No members have a media filter. |
| Guard status or toggle | 🛡️ *Media guard · {on/off}*\nFilters: {types}\n{existing admin and flag details} |
| Ping | 🏓 Here!\nUptime: {uptime} · Memory: {rss} MB |
| Stats | 📊 *Quizly stats*\n\n*Media guard*\n{state, types, removed count, view-once count, not-admin skips, flagged count}\n\n*Quiz usage*\n{minute and daily usage/limits}\n\n*System*\n{uptime, memory, existing details}\n\n{existing top-removal stats, if present} |
| Media deletion event | **No message or reaction. Keep the guard silent.** |

### 9. Random tools

| Tool | Proposed template |
| --- | --- |
| Random number | 🎲 *{number}*\nRange: {min}–{max} |
| Random option / pick | 🎯 *{chosen option}* |
| Dice | 🎲 *{total}*\n{notation}: {individual rolls} |
| Coin flip | 🪙 *{Heads/Tails}* |
| Shuffle | 🔀 *Shuffled*\n1. {option}\n2. {option} |
| Eight ball | 🎱 {answer}\n\n_{user’s question}_ |
| Eight ball without question | 🎱 What’s your question?\nTry: !8ball will I pass? |

### 10. Shared command guidance

Replace robotic “Usage:” walls with a short example, retaining exact supported syntax.

```text
Try it like this:
!roll 2d6

You can also use !roll or !roll d20.
```

Apply to invalid flag/unflag targets, guard setting, game reset, guesses, question add/delete/modify/search, generation topic, random ranges, dice, pick and shuffle. Show only relevant options, not the full help menu on each mistake. Unknown non-commands and ordinary chat remain silent.

## More data-structure questions — proposed scope

There are currently **18 built-in DS questions** in `src/banks.js` (8 easy, 10 hard).

Proposal: add **30 verified built-in DS questions**, balanced 15 easy / 15 hard:

- Arrays and linked lists: 6
- Stacks and queues: 6
- Trees and BSTs: 6
- Heaps and hashing: 6
- Graphs and traversal: 6

Mix short concept questions, operation traces, complexity questions and small pseudocode snippets. State assumptions explicitly (sorted input, graph direction, traversal neighbor order, indexing, and balanced vs unbalanced trees). Accept sensible answer variants. Avoid duplicate concepts and ambiguous outputs.

Sample additions:

| Level | Question | Accepted answer |
| --- | --- | --- |
| Easy | An empty queue receives enqueue(4), enqueue(7), dequeue(). Which value is now at the front? | 7 |
| Easy | An empty stack receives push(10), push(20), pop(), push(30), pop(). What does the final pop return? | 30 |
| Easy | What is the previous pointer of the head node in a non-circular doubly linked list? | null / nullptr / none |
| Hard | Insert 8, 3, 10, 1, 6 into an empty BST. Give its inorder traversal. | 1, 3, 6, 8, 10 |
| Hard | What is the time complexity of building a binary heap from n items using bottom-up heapify? | O(n) / linear |
| Hard | What is BFS time complexity with adjacency lists, visiting all vertices and edges? | O(V + E) |

Default proposal is **more DS content under `!game code … ds` plus readable monospace snippets**. If “code section” only means adding questions, snippet layout can be skipped.

## Implementation after approval

1. Apply your chosen style consistently across command, quiz, game, random-tool and scheduled replies.
2. Keep message templates/renderers centralized where practical; preserve public commands and game rules.
3. Add the approved DS questions with accepted-answer and difficulty checks.
4. Test formatting, scoring, permissions, quiz chunk boundaries, multiline snippets, partial failures and silent guard behavior.
5. Update README examples to match. No live WhatsApp login or API calls needed for unit tests; actual client appearance needs a live-device check.

## Web references and design rationale

WhatsApp’s official formatting guide documents bold, monospace, lists and inline code: [1](https://faq.whatsapp.com/539178204879377/?cms_platform=web).

The restrained emoji palette, shorter help, whitespace, and omission of decorative borders are design recommendations for this bot—not claims that WhatsApp requires them. Avoid Telegram-only keyboards or language-tagged syntax highlighting in this WhatsApp implementation.
