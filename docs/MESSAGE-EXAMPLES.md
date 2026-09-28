# Quizly · Clean & friendly

Actual renderer examples after approval. Values below are illustrative local test data; no WhatsApp connection or AI call was made. Single asterisks and triple backticks are WhatsApp formatting.

## Help

````text
👋 *Hey, welcome to Quizly*

Solve a screenshot, play a round, or settle a random pick.

*Quiz*
Send a screenshot with “quiz”, or reply to one with !quiz.

*Play*
!game — browse games
!game code easy ds — data structures
!game math hard linear — linear algebra
!top — this chat’s leaderboard
!game me — your score

*Quick picks*
!random · !roll · !flip
!pick tea, coffee · !shuffle a, b · !8ball will I pass?

*More*
!game help — rules and game commands
!ping · !stats

*Owner tools*
!flag @member [reason] · !unflag @member · !flags
!flag @member media=sticker,image
!guard on|off|status
Game controls and question tools: !game help

The media guard stays silent, including for view-once media.
````

## Game menu

````text
🎮 *Pick a game*

🔢 *number* — A secret number, too-high/too-low hints, hot-and-cold feedback, 10 pts.
🪙 *coin* — A pre-flipped coin. Call it right for 2 pts.
➗ *math* — Arithmetic plus linear algebra, calculus and multivariable calculus. 5 easy / 10 hard.
💻 *code* — PF, OOP, data structures and COAL assembly/registers. 5 easy / 10 hard.
🔤 *scramble* — Letters shuffled at random; first correct word takes 5 pts.
🧠 *trivia* — General knowledge, plus the questions the owner contributed. 5 pts.
🎁 *lucky* — Random winner among everyone who joins. Joining alone earns a point.

Start with !game <name>
Math/code: add easy or hard.
Code topics: pf · oop · ds · coal
Math topics: linear · calc · mvc · arith

Example: !game code easy ds
!top for scores · !game help for rules and controls
````

## Detailed controls

````text
🎮 *How to play*

Send an answer, or use !guess <answer>.
The first correct answer wins. One round per chat.
Your first eligible attempt earns a participation point.
Wins earn game points; streaks can add a bonus.

🔢 *number* · 10 pts
!game number [1-100] → send a number
🪙 *coin* · 2 pts
!game coin → say heads or tails
➗ *math* · 5 pts
!game math [easy|hard] [linear|calc|mvc|arith] → send the answer
💻 *code* · 5 pts
!game code [easy|hard] [pf|oop|ds|coal] → send the answer
🔤 *scramble* · 5 pts
!game scramble → send the word
🧠 *trivia* · 5 pts
!game trivia → send the answer
🎁 *lucky* · 8 pts
!game lucky → !in to join → !game draw

Math/code hard mode pays 10 pts. Number rewards fall with wrong guesses.
Rounds end when time runs out. Wrong guesses may get hints.

*Rounds*
!game <name> — start a round
!guess <answer> — or just send your answer
!game mode easy|hard — default math/code difficulty
!game end — end your round
!in — join a lucky draw · !game draw — draw now
!game status — availability and question pools

*Scores*
!top · !top all · !game me

*Owner controls*
!game on · !game stop (all chats)
!game reset tops — clear all leaderboards
!game reset @member [all] — reset one player
!game answer — reveal the current answer

*Owner question tools*
!game addq Question ; Answer
!game listq [search]
!game modify Question ; New answer
!game delete Question
!game restore
!game add new ds
Generation topics: pf · oop · ds · coal · trivia · math · scramble
````

## number round

````text
🔢 *Guess the number*

I’ve picked a number from *1* to *100*.
Try a guess — I’ll tell you higher or lower.
Up to 10 pts; each wrong guess reduces the reward by 1.

180s · Send your answer.
!game end to end your round · !top for scores
````

## coin round

````text
🪙 *Heads or tails?*

The coin is picked. What’s your call?
Say *heads* or *tails*. Right call = 2 pts.

180s · Send your answer.
!game end to end your round · !top for scores
````

## math round

````text
➗ *Math · calculus*
easy · 5 pts

What is the derivative of x³?

180s · Send your answer.
!game end to end your round · !top for scores
````

## scramble round

````text
🔤 *Unscramble this*
8 letters · 5 pts

*NOOKTOEB*

180s · Send your answer.
!game end to end your round · !top for scores
````

## trivia round

````text
🧠 *Quick trivia*
5 pts · First correct answer wins

What process lets plants make food from sunlight?

180s · Send your answer.
!game end to end your round · !top for scores
````

## lucky round

````text
🎁 *You’re invited to a lucky draw*

Send !in to join.
Draw in 90s.
Everyone who joins earns 1 pt, and the random winner takes 8 pts.
_!game draw picks the winner right now._

🎟️ You’re in, Ali! 1 joined · Draw in ~90s (!game draw to pick now).
````

## Data-structure code snippet

````text
💻 *Data structures · Easy*
5 pts · 180s

Starting with an empty stack, what does the final pop return?

```
push(10)
push(20)
pop()
push(30)
pop()
```

Send your answer.
!game end to end your round · !top for scores
````

## Correct answer

````text
🎉 *Nice one, Ali!*
the answer was *30*

*+5* pts · 1 guess
Total: 6 pts

🎮 Ali +6
Next round: `!game code` · scores: `!game top`
````

## Leaderboard

````text
🏆 *Leaderboard · Study group*

🥇 Ali — 6 pts · 1 win

_1 player · 6 points_
````

## Your score

````text
👤 *Ali’s score*

6 pts · 1 win in 1 round
Rank #1 of 1 here
````

## Owner-only command

````text
🔒 This command is for the bot owner.
````

## Quiz screenshot answer

````text
📝 *Quiz answers · 2 questions*

*Q1.* Which data structure follows LIFO?
The last item added is the first removed.
✅ *Stack*

*Q2.* Binary search time complexity?
Each step halves the remaining search space.
✅ *O(log n)*

*Answer key*
1) Stack
2) O(log n)
````

## Dice

````text
🎲 *8*
2d6: 4 + 4
````

## Command guidance

````text
Try it like this: !pick option1, option2[, option3…]
````
