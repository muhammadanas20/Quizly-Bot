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
!game dsmath hard counting — discrete maths
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
🧩 *riddle* — A tricky brain teaser. First correct answer takes 8 pts.
🎭 *emoji* — Emojis stand for a film, phrase or thing — decode it for 8 pts.
✊ *rps* — The bot has already thrown. Beat its hand for 8 pts — two misses and it shows its hand.
➗ *math* — Arithmetic plus linear algebra, calculus and multivariable calculus. 5 easy / 10 hard.
💻 *code* — PF, OOP, data structures and COAL assembly/registers. 5 easy / 10 hard.
🧮 *dsmath* — Logic, sets, relations, counting, number theory, sequences, graphs, Boolean algebra. 5 easy / 10 hard.
🔤 *scramble* — Letters shuffled at random; first correct word takes 5 pts.
🧠 *trivia* — General knowledge, plus the questions the owner contributed. 5 pts.
⚡ *react* — Bot posts one random emoji — react to that message with the same emoji to win! 8 pts.

Start with !game <name>
Maths games: add easy, hard or all (mixed).
Code topics: pf · oop · ds · coal
Math topics: linear · calc · mvc · arith
Discrete topics: logic · sets · relfun · counting · numtheory · sequences · graphs · boolalg · prob

Example: !game code easy ds · !game dsmath hard counting
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
🧩 *riddle* · 8 pts
!game riddle → send the answer
🎭 *emoji* · 8 pts
!game emoji → decode the emojis
✊ *rps* · 8 pts
!game rps → call rock, paper or scissors
➗ *math* · 5 pts
!game math [easy|hard|all] [linear|calc|mvc|arith] → send the answer
💻 *code* · 5 pts
!game code [easy|hard|all] [pf|oop|ds|coal] → send the answer
🧮 *dsmath* · 5 pts
!game dsmath [easy|hard|all] [topic] → send the answer
🔤 *scramble* · 5 pts
!game scramble → send the word
🧠 *trivia* · 5 pts
!game trivia → send the answer
⚡ *react* · 8 pts
!game react → react to the bot’s emoji with the same emoji

Hard maths cards pay 10 pts, easy ones 5. Number rewards fall with wrong guesses.
Rounds end when time runs out. Wrong guesses may get hints.

*Rounds*
!game <name> — start a round
!game dsmath [easy|hard|all] <topic> — discrete maths
!guess <answer> — or just send your answer
!game mode easy|hard|all — default difficulty for maths games
!game end — end your round
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
!game add new ds · !game add new dsmath
Generation topics: pf · oop · ds · coal · dsmath · trivia · riddle · emoji · math · scramble
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

## riddle round

````text
🧩 *Riddle me this*
8 pts · First correct answer wins

I speak without a mouth and hear without ears. I have no body, but I come alive with the wind. What am I?

180s · Send your answer.
!game end to end your round · !top for scores
````

## emoji round

````text
🎭 *Emoji puzzle*
8 pts · Decode it

*🦁👑*
_Category: movie_

180s · Send your answer.
!game end to end your round · !top for scores
````

## rps round

````text
✊ *Rock · Paper · Scissors*
8 pts · Beat the bot to win

The bot has already thrown its hand — in secret.
Call *rock*, *paper* or *scissors*: only the hand that beats it wins.
_Two misses from one player and the hand is shown._

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

## discrete maths round

````text
🧮 *Counting · Easy*
5 pts · 180s

What is 5! (five factorial)?

Send your answer.
!game end to end your round · !top for scores
````

## discrete maths with the working shown

````text
🧮 *Logic · Hard*
10 pts · 180s

When p is false, what is the truth value of the implication p → q, whatever q is?

```
p q | p → q
T T |  T
T F |  F
F T |  T
F F |  T
```

Send your answer.
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
