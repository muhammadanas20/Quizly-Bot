/**
 * src/games.js — the in-group game engine.
 *
 *   !game                      list every game + the commands that go with it
 *   !game <name> [args]        start a round in this chat
 *   !guess <answer> / !g       take a shot (plain replies work too)
 *   !game stop                 owner: stop ALL games; starter: end this round
 *   !game on                   owner: reopen games for everyone
 *   !game reset tops           owner: clear every leaderboard
 *   !game reset @member [all]  owner: reset one member's points (this chat / all chats)
 *   !game mode easy|hard       set this chat's default level for math + code
 *   !game end                  end this chat's round (starter or owner)
 *   !game top [all]            leaderboard — this chat, or everywhere
 *   !game me                   your own score card
 *   !game addq Q ; A           owner: contribute a trivia question to the pool
 *   !game addemoji 🦁👑 ; A     owner: contribute an emoji puzzle to its pool
 *   !game delete <Q|#>         owner: delete a trivia question (added, AI or built-in)
 *   !game deleteemoji <#>      owner: delete an added emoji puzzle
 *   !game modify <Q|#> ; A     owner: change a trivia answer (added, AI or built-in)
 *   !game listq [search]       owner: list added trivia / search every pool
 *   !game listemoji            owner: list the added emoji puzzles
 *   !game restore              owner: bring back hidden built-ins, clear modified answers
 *
 * Nine games: number, riddle, emoji, rps, math, code, scramble, trivia, react.
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

import { questionText, roundCard, GAME_GUIDE } from './presentation.js';

import { randomInt, pickOne, shuffle, parseRange } from './random.js';
import { MATH_BANK, CODE_BANK, parseTopic } from './banks.js';
import { normalizeId } from './config.js';
import { questionKey } from './scores.js';

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

// ─── Built-in riddle pool — the tricky ones (AI riddles rotate on top) ───────
export const RIDDLES = Object.freeze([
    { q: 'I speak without a mouth and hear without ears. I have no body, but I come alive with the wind. What am I?', a: ['echo'] },
    { q: 'The more of this there is, the less you can see. What is it?', a: ['darkness', 'dark'] },
    { q: 'What has many keys but can not open a single lock?', a: ['piano', 'a piano', 'keyboard', 'a keyboard'] },
    { q: 'What gets wetter and wetter the more it dries?', a: ['towel', 'a towel'] },
    { q: 'I have cities but no houses, forests but no trees, and rivers but no water. What am I?', a: ['map', 'a map'] },
    { q: 'What can travel around the world while staying in one corner?', a: ['stamp', 'a stamp', 'postage stamp'] },
    { q: 'What has a neck but no head?', a: ['bottle', 'a bottle'] },
    { q: 'The more you take away from me, the bigger I get. What am I?', a: ['hole', 'a hole', 'pit', 'a pit'] },
    { q: 'I am tall when I am young and short when I am old. What am I?', a: ['candle', 'a candle'] },
    { q: 'What has hands but can not clap?', a: ['clock', 'a clock'] },
    { q: 'What can you catch but never throw?', a: ['cold', 'a cold'] },
    { q: 'What has many teeth but can not bite?', a: ['comb', 'a comb'] },
    { q: 'What goes up but never comes down?', a: ['age', 'your age'] },
    { q: 'I shave several times a day, yet my beard stays the same. Who am I?', a: ['barber', 'a barber'] },
    { q: 'What has one eye but can not see?', a: ['needle', 'a needle'] },
    { q: 'The more you take, the more you leave behind. What are they?', a: ['footsteps', 'steps', 'footprints'] },
    { q: 'What is full of holes but still holds water?', a: ['sponge', 'a sponge'] },
    { q: 'What is always in front of you but can not be seen?', a: ['future', 'the future'] },
    { q: 'What can you break without ever touching it?', a: ['promise', 'a promise', 'silence'] },
    { q: 'Where does today come before yesterday?', a: ['dictionary', 'a dictionary', 'the dictionary'] },
    { q: 'What invention lets you look right through a wall?', a: ['window', 'a window'] },
    { q: 'What has thirteen hearts but no other organs?', a: ['deck of cards', 'a deck of cards', 'playing cards', 'cards'] },
    { q: 'Which five letter word becomes shorter when you add two letters to it?', a: ['short'] },
    { q: 'Which word is spelled wrong in every dictionary?', a: ['wrong', 'the word wrong'] },
    { q: 'What kind of band never plays a single note?', a: ['rubber band', 'a rubber band'] },
    { q: 'Forward I am heavy, but backward I am not. What am I?', a: ['ton', 'a ton'] },
    { q: 'What is so fragile that saying its name breaks it?', a: ['silence'] },
    { q: 'What can fill an entire room yet take up no space at all?', a: ['light'] },
    { q: 'If you drop me I am sure to crack, but smile at me and I always smile back. What am I?', a: ['mirror', 'a mirror'] },
    { q: 'The maker does not want it, the buyer does not use it, and the user never knows they are using it. What is it?', a: ['coffin', 'a coffin'] },
    { q: 'Which room do ghosts avoid?', a: ['living room', 'the living room'] },
    { q: 'I follow you all day in the sun, yet vanish when the rain or night comes. What am I?', a: ['shadow', 'a shadow', 'your shadow'] },
    { q: 'What has a thumb and four fingers but is not alive?', a: ['glove', 'a glove'] },
    { q: 'What starts with T, ends with T, and has tea in it?', a: ['teapot', 'a teapot'] },
    { q: 'Which building has the most stories?', a: ['library', 'a library', 'the library'] },
    { q: 'What has four wheels and flies?', a: ['garbage truck', 'a garbage truck', 'rubbish truck', 'dustbin lorry'] },
    { q: 'I have branches, yet no trunk, no leaves and no fruit. What am I?', a: ['bank', 'a bank'] },
    { q: 'What can go up a chimney down, but can not go down a chimney up?', a: ['umbrella', 'an umbrella'] },
    { q: 'What is black when it is clean and white when it is dirty?', a: ['blackboard', 'a blackboard', 'chalkboard', 'a chalkboard'] },
    { q: 'What word contains all twenty six letters?', a: ['alphabet', 'the alphabet'] },
    { q: 'What starts with E, ends with E, and has one letter inside it?', a: ['envelope', 'an envelope'] },
    { q: 'I am always hungry, I must always be fed, and the finger I touch will soon turn red. What am I?', a: ['fire', 'a fire'] },
    { q: 'What kind of room has no doors or windows?', a: ['mushroom', 'a mushroom'] },
    { q: 'What is at the end of every rainbow?', a: ['w', 'the letter w'] },
    { q: 'What is yours, yet other people use it more than you do?', a: ['your name', 'my name', 'name'] },
    { q: 'What goes through towns and hills but never moves?', a: ['road', 'a road', 'the road'] },
    { q: 'I have a bed but never sleep, and a mouth but never speak. What am I?', a: ['river', 'a river'] },
    { q: 'What can you serve, but never eat?', a: ['tennis ball', 'a tennis ball', 'volleyball', 'shuttlecock'] },
    { q: 'Which letter of the alphabet has the most water?', a: ['c', 'sea', 'the letter c'] },
    { q: 'What is the end of everything?', a: ['g', 'the letter g'] },
    { q: 'What comes once in a minute, twice in a moment, but never in a thousand years?', a: ['m', 'the letter m'] },
    { q: 'If you have me, you want to share me. But if you share me, you no longer have me. What am I?', a: ['secret', 'a secret'] },
    { q: 'Turn me on my side and I am everything. Cut me in half and I am nothing. What am I?', a: ['8', 'eight', 'the number 8', 'infinity'] },
    { q: 'What kind of ship has two mates but no captain?', a: ['relationship', 'a relationship'] },
    { q: 'Where do fish keep their money?', a: ['riverbank', 'the riverbank', 'river bank', 'a river bank'] },
    { q: 'A man was born in 1995 and died in 1953. How is that possible?', a: ['room numbers', 'room number', 'hospital room'] },
    { q: 'How many months of the year have 28 days?', a: ['all', 'all of them', '12', 'twelve', 'every month'] },
    { q: 'If a plane crashes exactly on the border between two countries, where do you bury the survivors?', a: ['nowhere', 'survivors', 'you do not bury survivors'] },
    { q: 'What two things can you never eat for breakfast?', a: ['lunch and dinner', 'lunch', 'dinner'] },
    { q: 'Before Mount Everest was discovered, which mountain was the tallest in the world?', a: ['everest', 'mount everest'] },
    { q: 'Which is heavier, a kilogram of feathers or a kilogram of stones?', a: ['neither', 'same', 'the same', 'they weigh the same', 'both'] },
    { q: 'A farmer had seventeen sheep and all but nine ran away. How many are left?', a: ['9', 'nine'] },
    { q: 'How many times can you subtract five from twenty five?', a: ['once', 'one time', 'only once', '1'] }
]);

// ─── Rock-Paper-Scissors: the bot has already thrown ─────────────────────────
export const RPS_HANDS = Object.freeze(['Rock', 'Paper', 'Scissors']);
/** hand → the hand it beats. Paper beats Rock, Scissors beats Paper, Rock beats Scissors. */
const RPS_BEATS = Object.freeze({ Rock: 'Scissors', Paper: 'Rock', Scissors: 'Paper' });

/**
 * "rock", "r", "✊" → 'Rock'; "paper", "p", "✋" → 'Paper';
 * "scissors", "scissor", "s", "✌️" → 'Scissors'; anything else null.
 */
export function parseRpsCall(text) {
    const s = String(text ?? '').trim().toLowerCase();
    if (!s) return null;
    if (/^(r|rock|✊)$/.test(s)) return 'Rock';
    if (/^(p|paper|✋)$/.test(s)) return 'Paper';
    if (/^(s|scissors|scissor|✌|✌️)$/.test(s)) return 'Scissors';
    return null;
}

// ─── Built-in emoji puzzles — decode the rebus (AI puzzles rotate on top) ────
export const EMOJI_CATS = Object.freeze(['movie', 'phrase', 'thing', 'place', 'food']);
export const EMOJI_PUZZLES = Object.freeze([
    // movies
    { emoji: '🦁👑', a: ['lion king', 'the lion king'], cat: 'movie' },
    { emoji: '🚢🧊', a: ['titanic'], cat: 'movie' },
    { emoji: '🕷️🧑', a: ['spider man', 'spiderman', 'the spider man'], cat: 'movie' },
    { emoji: '🦇🧑', a: ['batman', 'bat man', 'the batman'], cat: 'movie' },
    { emoji: '❄️👸', a: ['frozen'], cat: 'movie' },
    { emoji: '🧞🪔', a: ['aladdin'], cat: 'movie' },
    { emoji: '🐠🔍', a: ['finding nemo'], cat: 'movie' },
    { emoji: '🐼🥋', a: ['kung fu panda'], cat: 'movie' },
    { emoji: '🐀🍳', a: ['ratatouille'], cat: 'movie' },
    { emoji: '🧙💍', a: ['lord of the rings', 'the lord of the rings'], cat: 'movie' },
    { emoji: '👻🚗', a: ['ghostbusters', 'ghost busters'], cat: 'movie' },
    { emoji: '🦈🏖️', a: ['jaws'], cat: 'movie' },
    { emoji: '🐔🏃', a: ['chicken run'], cat: 'movie' },
    { emoji: '🤖🪴', a: ['wall e', 'walle'], cat: 'movie' },
    { emoji: '🐍✈️', a: ['snakes on a plane'], cat: 'movie' },
    { emoji: '🦸🛡️', a: ['captain america'], cat: 'movie' },
    { emoji: '🐇🎩', a: ['alice in wonderland'], cat: 'movie' },
    { emoji: '🐝🎬', a: ['bee movie'], cat: 'movie' },
    // phrases and sayings
    { emoji: '🌧️🐱🐶', a: ['raining cats and dogs', 'its raining cats and dogs'], cat: 'phrase' },
    { emoji: '👁️🍎', a: ['apple of my eye'], cat: 'phrase' },
    { emoji: '🐟💦', a: ['fish out of water', 'a fish out of water'], cat: 'phrase' },
    { emoji: '🐴🤫', a: ['hold your horses', 'hold the horses'], cat: 'phrase' },
    // things and creatures
    { emoji: '🌕🐺', a: ['werewolf', 'were wolf'], cat: 'thing' },
    { emoji: '🧛🦇', a: ['vampire', 'a vampire'], cat: 'thing' },
    { emoji: '🧟', a: ['zombie', 'a zombie'], cat: 'thing' },
    { emoji: '🦄🌈', a: ['unicorn', 'a unicorn'], cat: 'thing' },
    { emoji: '🧜‍♀️🌊', a: ['mermaid', 'a mermaid'], cat: 'thing' },
    { emoji: '🐉🔥', a: ['dragon', 'a dragon'], cat: 'thing' },
    { emoji: '👻🏚️', a: ['haunted house'], cat: 'thing' },
    { emoji: '🕷️🕸️', a: ['spider web', 'cobweb', 'web'], cat: 'thing' },
    { emoji: '🐝🏠', a: ['beehive', 'bee hive', 'hive'], cat: 'thing' },
    { emoji: '🦷🧚', a: ['tooth fairy', 'the tooth fairy'], cat: 'thing' },
    { emoji: '🌞🧴', a: ['sunscreen', 'sun cream', 'sunblock'], cat: 'thing' },
    { emoji: '🌧️🧢', a: ['raincoat', 'rain coat'], cat: 'thing' },
    { emoji: '🎩🐇', a: ['magician', 'magic trick', 'a magician'], cat: 'thing' },
    { emoji: '🍫🏭', a: ['chocolate factory'], cat: 'thing' },
    { emoji: '🧑‍🚀🚀', a: ['astronaut', 'an astronaut'], cat: 'thing' },
    { emoji: '👨‍🍳🍳', a: ['chef', 'cook', 'a chef'], cat: 'thing' },
    { emoji: '🎨🖼️', a: ['artist', 'painter'], cat: 'thing' },
    { emoji: '🕵️🔍', a: ['detective', 'a detective'], cat: 'thing' },
    // places
    { emoji: '🗼🥖', a: ['paris', 'france'], cat: 'place' },
    { emoji: '🐫🏜️', a: ['desert', 'the desert'], cat: 'place' },
    { emoji: '🏝️🌴', a: ['island', 'an island'], cat: 'place' },
    { emoji: '🎡🎢', a: ['funfair', 'amusement park', 'theme park', 'carnival'], cat: 'place' },
    // food
    { emoji: '🍋🍹', a: ['lemonade'], cat: 'food' },
    { emoji: '🥑🍞', a: ['avocado toast'], cat: 'food' },
    { emoji: '🍅🥣', a: ['tomato soup'], cat: 'food' },
    { emoji: '🍌🍦🥛', a: ['milkshake', 'banana shake', 'banana milkshake'], cat: 'food' }
]);

/** Winner points per game. A round can be lost, never the scoreboard. */
export const GAME_POINTS = Object.freeze({
    number : 10,
    riddle : 8,
    rps    : 8,
    emoji  : 8,
    react  : 8,
    math   : 5,
    code   : 5,
    scramble: 5,
    trivia : 5
});

// ─── Reaction race — every emoji you can react with ─────────────────────────
// A big, deduplicated pool so the bot really can drop *any* emoji. WhatsApp
// reactions work best with single-codepoint emojis; ZWJ sequences are avoided
// here on purpose so matching stays exact.
export const REACTION_EMOJIS = Object.freeze([
    '😀','😃','😄','😁','😆','😅','🤣','😂','🙂','🙃','😉','😊','😇','🥰','😍','🤩','😘','😗','😚','😙',
    '🥲','😋','😛','😜','🤪','😝','🤑','🤗','🤭','🫢','🫣','🤫','🤔','🫡','🤐','🤨','😐','😑','😶','😶‍🌫️',
    '😏','😒','🙄','😬','😮‍💨','🤥','🫨','😌','😔','😪','🤤','😴','😷','🤒','🤕','🤢','🤮','🥵','🥶','🥴',
    '😵','😵‍💫','🤯','🤠','🥳','🥸','😎','🤓','🧐','😕','🫤','😟','🙁','☹️','😮','😯','😲','😳','🥺','🥹',
    '😦','😧','😨','😰','😥','😢','😭','😱','😖','😣','😞','😓','😩','😫','🥱','😤','😡','😠','🤬','😈',
    '👿','💀','☠️','💩','🤡','👹','👺','👻','👽','👾','🤖','😺','😸','😹','😻','😼','😽','🙀','😿','😾',
    '🙈','🙉','🙊','🐵','🐒','🦍','🦧','🐶','🐕','🦮','🐩','🐺','🦊','🦝','🐱','🐈','🐈‍⬛','🦁','🐯','🐅',
    '🐆','🐴','🫎','🫏','🐎','🦄','🦓','🦌','🦬','🐮','🐂','🐃','🐄','🐷','🐖','🐗','🐽','🐏','🐑','🐐',
    '🐪','🐫','🦙','🦒','🐘','🦣','🦏','🦛','🐭','🐁','🐀','🐹','🐰','🐇','🐿️','🦫','🦔','🦇','🐻','🐨',
    '🐼','🦥','🦦','🦨','🦘','🦡','🐾','🦃','🐔','🐓','🐣','🐤','🐥','🐦','🐧','🕊️','🦅','🦆','🦢','🦉',
    '🦤','🪶','🦩','🦜','🐸','🐊','🐢','🦎','🐍','🐲','🐉','🦕','🦖','🐳','🐋','🐬','🦭','🐟','🐠','🐡',
    '🦈','🐙','🐚','🪸','🪼','🐌','🦋','🐛','🐜','🐝','🪲','🐞','🦗','🪳','🕷️','🕸️','🦂','🦟','🪰','🪱',
    '🦠','💐','🌸','💮','🪷','🏵️','🌹','🥀','🌺','🌻','🌼','🌷','🪻','🌱','🪴','🌲','🌳','🌴','🌵','🌾',
    '🌿','☘️','🍀','🍁','🍂','🍃','🫛','🍄','🌰','🍇','🍈','🍉','🍊','🍋','🍌','🍍','🥭','🍎','🍏','🍐',
    '🍑','🍒','🍓','🫐','🥝','🍅','🫒','🥥','🥑','🍆','🥔','🥕','🌽','🌶️','🫑','🥒','🥬','🥦','🧄','🧅',
    '🫘','🥜','🫚','🍞','🥐','🥖','🫓','🥨','🥯','🥞','🧇','🧀','🍖','🍗','🥩','🥓','🍔','🍟','🍕','🌭',
    '🥪','🌮','🌯','🫔','🥙','🧆','🥚','🍳','🥘','🍲','🫕','🥣','🥗','🍿','🧈','🧂','🥫','🍱','🍘','🍙',
    '🍚','🍛','🍜','🍝','🍠','🍢','🍣','🍤','🍥','🥮','🍡','🥟','🥠','🥡','🦀','🦞','🦐','🦑','🦪','🍦',
    '🍧','🍨','🍩','🍪','🎂','🍰','🧁','🥧','🍫','🍬','🍭','🍮','🍯','🍼','🥛','☕','🫖','🍵','🍶','🍾',
    '🍷','🍸','🍹','🍺','🍻','🥂','🥃','🫗','🥤','🧋','🧃','🧉','🧊','🥢','🍽️','🍴','🥄','🔪','🫙','🏺',
    '🌍','🌎','🌏','🌐','🗺️','🗾','🧭','🏔️','⛰️','🌋','🗻','🏕️','🏖️','🏜️','🏝️','🏞️','🏟️','🏛️','🏗️','🧱',
    '🪨','🪵','🛖','🏘️','🏚️','🏠','🏡','🏢','🏣','🏤','🏥','🏦','🏨','🏩','🏪','🏫','🏬','🏭','🏯','🏰',
    '💒','🗼','🗽','⛪','🕌','🛕','🕍','⛩️','🕋','⛲','⛺','🌁','🌃','🏙️','🌄','🌅','🌆','🌇','🌉','♨️',
    '🎠','🛝','🎡','🎢','💈','🎪','🚂','🚃','🚄','🚅','🚆','🚇','🚈','🚉','🚊','🚝','🚞','🚋','🚌','🚍',
    '🚎','🚐','🚑','🚒','🚓','🚔','🚕','🚖','🚗','🚘','🚙','🛻','🚚','🚛','🚜','🦯','🦽','🦼','🛴','🚲',
    '🛵','🛺','🚨','🛞','🚀','🛸','🚁','🛩️','🛥️','🚤','⛵','🛶','🚢','⚓','🪝','⛽','🚧','🚦','🚥','🗿',
    '🧳','🎈','🎏','🎀','🎁','🎗️','🎟️','🎫','🎖️','🏆','🏅','🥇','🥈','🥉','⚽','⚾','🥎','🏀','🏐','🏈',
    '🏉','🎾','🥏','🎳','🏏','🏑','🏒','🥍','🏓','🏸','🥊','🥋','🥅','⛳','⛸️','🎣','🤿','🎽','🎿','🛷',
    '🥌','🎯','🪀','🪁','🎱','🔮','🪄','🧿','🪬','🎮','🕹️','🎰','🎲','🧩','🧸','🪅','🪩','🪆','♠️','♥️',
    '♦️','♣️','🃏','🀄','🎴','🎭','🖼️','🎨','🧵','🪡','🧶','🪢','👓','🕶️','🥽','🥼','🦺','👔','👕','👖',
    '🧣','🧤','🧥','🧦','👗','👘','🥻','🩱','🩲','🩳','👙','👚','👛','👜','👝','🛍️','🎒','🩴','👞','👟',
    '🥾','🥿','👠','👡','🩰','👢','👑','👒','🎩','🎓','🧢','🪖','⛑️','📿','💄','💍','💎','🔇','🔈','🔉',
    '🔊','📢','📣','📜','📃','📄','📑','🧾','📊','📈','📉','🗒️','🗓️','📆','📅','🗑️','📇','🗃️','🗳️','🗄️',
    '📋','📁','📂','🗂️','🗞️','📰','📓','📔','📒','📕','📗','📘','📙','📚','📖','🔖','🧷','🔗','📎','🖇️',
    '📐','📏','🧮','📌','📍','✂️','🖊️','🖋️','✒️','🖌️','🖍️','📝','✏️','🔍','🔎','🔏','🔐','🔒','🔓','💌',
    '💘','💝','💖','💗','💓','💞','💕','💟','❣️','💔','❤️','🧡','💛','💚','💙','🩵','💜','🖤','🩶','🤍',
    '🤎','💋','🩸','🩹','💊','💉','🩺','🧬','🧫','🧪','🌡️','🧹','🪠','🧺','🧻','🚽','🚿','🛁','🪥','🪮',
    '🧼','🪞','🪟','🛋️','🪑','🚪','🛏️','🛌','🎁','🎈','🎏','🎀','🎊','🎉','🎎','🎐','🎑','🧧','🪔','🪭',
    '🪗','🪘','🪇','🪈','🪉','🪕','🎸','🎹','🎷','🎺','🎻','🪕','🥁','🪘','📱','📲','☎️','📞','📟','📠',
    '🔋','🪫','📡','💻','🖥️','🖨️','⌨️','🖱️','🖲️','💽','💾','💿','📀','🧲','🪛','🔧','🔨','⚒️','🛠️','⛏️',
    '🪓','🪚','🔩','⚙️','🪤','🧱','⛓️','🧰','🧲','🔫','💣','🧨','🪓','🔪','🗡️','⚔️','🛡️','🚬','⚰️','🪦',
    '⚱️','🏺','🔮','📿','🧿','💈','⚗️','🔭','🔬','🕳️','🩹','🩺','💊','💉','🩸','🧬','🦠','🧫','🧪','🌡️',
    '🧹','🧺','🧻','🚽','🚿','🛁','🪥','🧼','🪞','🪟','🛋️','🪑','🚪','🛏️','🛌','🧸','🪆','🖼️','🛍️','🎁'
]);

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
        name: 'riddle', aliases: ['riddle', 'riddles', 'teaser', 'brain', 'brainteaser'], emoji: '🧩', mode: 'race',
        title: 'Riddle', points: GAME_POINTS.riddle,
        how: '!game riddle → send the answer',
        blurb: 'A tricky brain teaser. First correct answer takes 8 pts.'
    },
    {
        name: 'emoji', aliases: ['emoji', 'emojis', 'rebus', 'puzzle'], emoji: '🎭', mode: 'race',
        title: 'Emoji puzzle', points: GAME_POINTS.emoji,
        how: '!game emoji → decode the emojis',
        blurb: 'Emojis stand for a film, phrase or thing — decode it for 8 pts.'
    },
    {
        name: 'rps', aliases: ['rps', 'rock', 'roshambo', 'rpsbot'], emoji: '✊', mode: 'race',
        title: 'Rock-Paper-Scissors', points: GAME_POINTS.rps,
        how: '!game rps → call rock, paper or scissors',
        blurb: 'The bot has already thrown. Beat its hand for 8 pts — two misses and it shows its hand.'
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
        name: 'react', aliases: ['react', 'reaction', 'reactrace', 'emojirace', 'reflex', 'speedreact', 'fastreact', 'emoji-race', 'react-race', 'reflexrace'], emoji: '⚡', mode: 'race',
        title: 'Reaction Race', points: GAME_POINTS.react,
        how: '!game react → react to the bot’s emoji with the same emoji',
        blurb: 'Bot posts one random emoji — react to that message with the same emoji to win! 8 pts.'
    }
]);

const BY_ALIAS = new Map(GAMES.flatMap((g) => g.aliases.map((a) => [a, g])));

export function findGame(nameOrAlias) {
    return BY_ALIAS.get(String(nameOrAlias || '').toLowerCase().trim()) || null;
}

const points = (n) => `*+${n}* ${n === 1 ? 'pt' : 'pts'}`;
const pt = (n) => `${n} ${n === 1 ? 'pt' : 'pts'}`;
/** Shorten a question for chat-sized replies. */
const short = (s, n = 90) => {
    const t = String(s || '');
    return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

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
    riddle  : (r) => `the answer was *${r.accepted[0]}*`,
    emoji   : (r) => `the answer was *${r.accepted[0]}*`,
    rps     : (r) => `the bot threw *${r.answer}*`,
    react   : (r) => `the emoji was *${r.targetEmoji || r.answer}*`,
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
    // How long the "don't repeat the last question" memory lives per chat.
    // It only matters across back-to-back rounds (seconds apart); after a day
    // of silence, forgetting it costs at most one repeat — and evicting it
    // keeps these maps flat in a bot that outlives its question fatigue.
    const repeatMemoryMs = 24 * 60 * 60 * 1000;
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
        return [
            '🎮 *Pick a game*',
            enabled ? '' : '🌙 Games are paused. Owner: !game on',
            ...GAMES.map((g) => `${g.emoji} *${g.name}* — ${g.blurb}`), '',
            'Start with !game <name>',
            'Math/code: add easy or hard.',
            'Code topics: pf · oop · ds · coal',
            'Math topics: linear · calc · mvc · arith', '',
            'Example: !game code easy ds',
            '!top for scores · !game help for rules and controls'
        ].join('\n');
    }

    function helpText() {
        return [
            '🎮 *How to play*', '',
            'Send an answer, or use !guess <answer>.',
            'The first correct answer wins. One round per chat.',
            'Your first eligible attempt earns a participation point.',
            'Wins earn game points; streaks can add a bonus.', '',
            ...GAMES.map((g) => `${g.emoji} *${g.name}* · ${g.points} pts\n${g.how}`), '',
            'Math/code hard mode pays 10 pts. Number rewards fall with wrong guesses.',
            'Rounds end when time runs out. Wrong guesses may get hints.', '',
            GAME_GUIDE
        ].join('\n');
    }

    function medal(i) {
        return ['🥇', '🥈', '🥉'][i] || `${i + 1}.`;
    }

    function boardText(ctx, scope = '') {
        const all = /^(all|global|everywhere)$/i.test(String(scope || ''));
        const rows = all ? scores?.boardAll(12) : scores?.board(ctx.jid, 12);
        if (!rows?.length) {
            return all
                ? '🏆 No scores yet. Start a round with !game.'
                : '🏆 No scores here yet. Start a round with !game.';
        }
        const { players, points: total } = all
            ? { players: rows.length, points: rows.reduce((n, r) => n + r.points, 0) }
            : scores.totals(ctx.jid);

        const head = all ? '🏆 *Leaderboard · All chats*' : `🏆 *Leaderboard · ${ctx.chatName || 'This chat'}*`;
        const lines = rows.map((r, i) => {
            const name = r.name || String(r.key).replace(/@.*/, '');
            const streak = r.streak > 1 ? ` · 🔥${r.streak}` : '';
            const chats = all ? ` · ${r.chats} chat${r.chats === 1 ? '' : 's'}` : '';
            return `${medal(i)} ${name} — ${pt(r.points)} · ${r.wins} win${r.wins === 1 ? '' : 's'}${streak}${chats}`;
        });
        lines.push('', `_${players} player${players === 1 ? '' : 's'} · ${total} points${all ? ' total' : ''}_`);
        return [head, '', ...lines].join('\n');
    }

    function meText(ctx) {
        const key = keyOf(ctx);
        const rows = scores?.board(ctx.jid, Number.MAX_SAFE_INTEGER) || [];
        const row = rows.find((r) => r.key === key);
        if (!row) {
            return '👋 Your score starts with your first guess. Join a round with !game.';
        }
        const name = row.name || String(row.key).replace(/@.*/, '');
        const rank = rows.findIndex((r) => r.key === key) + 1;
        return [
            `👤 *${name}’s score*\n`,
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
        const tail = `\n\n${left}s · Send your answer.\n!game end to end your round · !top for scores`;

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
                    text: `${game.emoji} *Guess the number*\n\nI’ve picked a number from *${range.min}* to *${range.max}*.\n`
                        + 'Try a guess — I’ll tell you higher or lower.\nUp to 10 pts; each wrong guess reduces the reward by 1.' + tail
                };
            }

            case 'riddle': {
                const entry = pickRiddle(ctx.jid);
                if (!entry) return { error: 'The riddle pool is empty.' };
                round.pool = entry;
                round.accepted = entry.a;
                lastRiddle.set(ctx.jid, { at: now(), value: entry.q });
                return {
                    round,
                    text: `${game.emoji} *Riddle me this*\n${game.points} pts · First correct answer wins\n\n`
                        + questionText(entry) + tail
                };
            }

            case 'emoji': {
                const entry = pickEmoji(ctx.jid);
                if (!entry) return { error: 'The emoji puzzle pool is empty.' };
                round.pool = entry;
                round.accepted = entry.a;
                round.cat = entry.cat || 'thing';
                lastEmoji.set(ctx.jid, { at: now(), value: entry.emoji });
                return {
                    round,
                    text: `${game.emoji} *Emoji puzzle*\n${game.points} pts · Decode it\n\n`
                        + `*${entry.emoji}*\n_Category: ${round.cat}_` + tail
                };
            }

            case 'rps': {
                round.answer = pickOne(RPS_HANDS, random);
                return {
                    round,
                    text: `${game.emoji} *Rock · Paper · Scissors*\n${game.points} pts · Beat the bot to win\n\n`
                        + 'The bot has already thrown its hand — in secret.\n'
                        + 'Call *rock*, *paper* or *scissors*: only the hand that beats it wins.\n'
                        + '_Two misses from one player and the hand is shown._' + tail
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
                        text: `${game.emoji} *Math · ${TOPIC_LABEL[concept.topic] || concept.topic}*\n${level} · ${points} pts\n\n`
                            + questionText(concept) + tail
                    };
                }
                const problem = makeMath(level, random);
                round.answer = problem.answer;
                round.problem = problem;
                return {
                    round,
                    text: `${game.emoji} *Math · Arithmetic*\n${problem.level} · ${problem.points} pts\n\n`
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
                    text: roundCard({
                        emoji: game.emoji,
                        title: `${TOPIC_LABEL[entry.topic] || 'Programming'} · ${level === 'hard' ? 'Hard' : 'Easy'}`,
                        detail: `${points} pts · ${left}s`,
                        question: questionText(entry),
                        footer: 'Send your answer.\n!game end to end your round · !top for scores'
                    })
                };
            }

            case 'scramble': {
                const puzzle = pickPuzzle(ctx.jid);
                const word = puzzle.word;
                round.answer = word;
                round.accepted = [word];
                round.scrambled = scrambleWord(word, random);
                lastScramble.set(ctx.jid, { at: now(), value: word });
                return {
                    round,
                    text: `${game.emoji} *Unscramble this*\n${word.length} letters · ${game.points} pts\n\n`
                        + `*${round.scrambled.toUpperCase()}*`
                        + (puzzle.clue ? `\n_Clue: ${puzzle.clue}_` : '') + tail
                };
            }

            case 'trivia': {
                const entry = pickQuestion(ctx.jid);
                if (!entry) return { error: 'The trivia pool is empty.' };
                round.pool = entry;
                round.accepted = entry.a;
                lastQuestion.set(ctx.jid, { at: now(), value: entry.q });
                return {
                    round,
                    text: `${game.emoji} *Quick trivia*\n${game.points} pts · First correct answer wins\n\n`
                        + questionText(entry)
                        + (entry.by ? `\n_by ${entry.by}_` : '')
                        + tail
                };
            }

            case 'react': {
                const emoji = pickOne(REACTION_EMOJIS, random);
                round.targetEmoji = emoji;
                round.answer = emoji;
                round.accepted = [emoji];
                round.botMessageId = null; // filled after the bot message is sent
                lastReact.set(ctx.jid, { at: now(), value: emoji });
                return {
                    round,
                    // Keep the prompt itself textless: players react directly to
                    // this emoji, and the router records this message ID for the race.
                    text: emoji
                };
            }

            default:
                return { error: 'Unknown game.' };
        }
    }

    const TOPIC_LABEL = {
        linear: 'linear algebra', calculus: 'calculus', mvc: 'multivariable calculus',
        pf: 'programming fundamentals', oop: 'OOP', ds: 'Data structures', coal: 'COAL / assembly'
    };
    const lastQuestion = new Map();   // jid → { at, value }
    const lastRiddle = new Map();     // jid → { at, value }
    const lastEmoji = new Map();      // jid → { at, value }
    const lastScramble = new Map();   // jid → { at, value }
    const lastReact = new Map();      // jid → { at, value }

    /** O(pool size), bounded; no immediate repeats even with a fixed RNG. */
    function pickDifferent(pool, previous, field) {
        const options = pool.length > 1 ? pool.filter((p) => p[field] !== previous) : pool;
        return pickOne(options.length ? options : pool, random);
    }

    /** Built-ins and member submissions persist; AI content rotates independently. */
    function pickQuestion(jid) {
        const contributed = (scores?.questions?.() || []).map((e) => ({ q: e.q, a: e.a, by: e.by }));
        const ai = content?.questions?.() || [];
        // Built-ins the owner deleted stay deleted until !game restore, and
        // answers the owner modified are applied on top of the shipped ones.
        const builtin = (scores?.isBuiltinHidden ? TRIVIA.filter((e) => !scores.isBuiltinHidden(e.q)) : TRIVIA)
            .map((e) => {
                const override = scores?.builtinAnswer?.(e.q);
                return override ? { ...e, a: override } : e;
            });
        const pool = [...builtin, ...contributed, ...ai];
        const picked = pickDifferent(pool, lastQuestion.get(jid)?.value, 'q');
        if (picked && ai.includes(picked)) content?.markUsed?.('trivia', picked);
        return picked;
    }

    function pickRiddle(jid) {
        const ai = content?.items?.('riddle') || [];
        const pool = [...RIDDLES, ...ai];
        const picked = pickDifferent(pool, lastRiddle.get(jid)?.value, 'q') || RIDDLES[0];
        if (ai.includes(picked)) content?.markUsed?.('riddle', picked);
        return picked;
    }

    function pickEmoji(jid) {
        const contributed = (scores?.emojiQuestions?.() || [])
            .map((e) => ({ emoji: e.emoji, a: e.a, cat: e.cat || 'thing', byKey: e.byKey || '' }));
        const ai = content?.items?.('emoji') || [];
        const pool = [...EMOJI_PUZZLES, ...contributed, ...ai];
        const picked = pickDifferent(pool, lastEmoji.get(jid)?.value, 'emoji') || EMOJI_PUZZLES[0];
        if (ai.includes(picked)) content?.markUsed?.('emoji', picked);
        return picked;
    }

    function pickPuzzle(jid) {
        const ai = content?.puzzles?.() || [];
        const pool = [...BUILTIN_PUZZLES, ...ai];
        const picked = pickDifferent(pool, lastScramble.get(jid)?.value, 'word') || { word: 'garden', clue: '' };
        if (ai.includes(picked)) content?.markUsed?.('scramble', picked);
        return picked;
    }

    const lastConcept = new Map();   // "jid|kind" → { at, value }

    /** Built-in bank + AI pool for math/code, filtered by level and topic. */
    function pickConcept(kind, level, topic, jid) {
        const bank = kind === 'math' ? MATH_BANK : CODE_BANK;
        const ai = content?.items?.(kind) || [];
        const fits = (e) => e.level === level && (!topic || e.topic === topic);
        let pool = [...bank.filter(fits), ...ai.filter(fits)];
        if (!pool.length) pool = [...bank, ...ai].filter((e) => !topic || e.topic === topic);
        if (!pool.length) return null;
        const stamp = `${jid}|${kind}`;
        const picked = pickDifferent(pool, lastConcept.get(stamp)?.value, 'q');
        lastConcept.set(stamp, { at: now(), value: picked.q });
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
            case 'riddle':   return `💡 The answer starts with *${String(round.accepted[0])[0].toUpperCase()}*`;
            case 'emoji':    return `💡 It is a ${round.cat} · the answer starts with *${String(round.accepted[0])[0].toUpperCase()}*`;
            case 'rps':      return '💡 Rock beats Scissors · Paper beats Rock · Scissors beats Paper';
            case 'react':    return `💡 React with ${round.targetEmoji} — same emoji, same message!`;
            case 'trivia':   return `💡 The answer starts with *${String(round.accepted[0])[0].toUpperCase()}*`;
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
                ? { handled: true, react: '😴', reply: 'No round running here. Start one with !game.' }
                : { handled: false };
        }

        const label = await labelOf(ctx);
        // labelOf awaits group metadata: an owner stop/reset may have cancelled
        // this round while that lookup was pending. Never resurrect its score.
        if (!enabled || active(ctx.jid) !== round || round.closed) {
            return explicit ? (enabled ? { handled: true, react: 'ℹ️', reply: 'That round has ended. Send !game to start another.' } : gamesOff()) : { handled: false };
        }
        const key = keyOf(ctx);
        const entry = playerEntry(round, key, label, idsOf(ctx));
        rememberIds(ctx, key);

        if (entry.guesses >= maxAttempts) {
            return {
                handled: true,
                react: '🚫',
                reply: `You’ve used all ${maxAttempts} guesses this round. Try again next round.`
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
            return { handled: true, react: '♻️', reply: `You’ve tried *${verdict.value}* already. Try another.` };
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

        const reply = `🎉 *Nice one, ${label}!*\n${REVEAL[round.name]?.(round) || ''}`.trim()
            + `\n\n${points(won)}${bonusLine}${guessLine}`
            + (scored.player ? `\nTotal: ${scored.player.points} pts` : '');

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

            case 'rps': {
                const call = parseRpsCall(raw);
                if (call === null) {
                    return explicit ? { kind: 'ignore', reason: 'Call *rock*, *paper* or *scissors*.' } : { kind: 'ignore' };
                }
                if (RPS_BEATS[call] === round.answer) return { kind: 'win', points: GAME_POINTS.rps };
                if (entry.tried.has(call)) return { kind: 'repeat', value: call };
                entry.tried.add(call);
                if (entry.tried.size >= 2) {
                    // two losing throws from one player — nothing left to hide,
                    // so the round closes and the hand is revealed
                    return {
                        kind: 'wrong',
                        closing: true,
                        reply: `✊ Two misses — the bot threw *${round.answer}*. Nobody beat it.`
                    };
                }
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
                    return { kind: 'wrong', reply: `Not quite — try again.` };
                }
                const n = parseNumberAnswer(raw);
                if (n === null) {
                    return explicit ? { kind: 'ignore', reason: `Send the answer to ${round.problem.question}` } : { kind: 'ignore' };
                }
                if (entry.tried.has(n)) return { kind: 'repeat', value: n };
                entry.tried.add(n);
                if (n === round.answer) return { kind: 'win', points: round.problem.points };
                return { kind: 'wrong', reply: explicit ? `Not quite — try again.` : undefined };
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

            case 'react': {
                // Text fallback: sending the emoji as a message also wins
                if (raw === round.targetEmoji || raw.includes(round.targetEmoji)) {
                    if (entry.tried.has(raw)) return { kind: 'repeat', value: raw };
                    return { kind: 'win', points: GAME_POINTS.react };
                }
                // For explicit !guess, any other emoji/text is a miss
                if (!explicit) {
                    // Allow bare emoji messages to be treated as attempts
                    // If it's a single emoji (or short), treat as wrong attempt
                    if (raw.length <= 8) {
                        if (entry.tried.has(raw)) return { kind: 'repeat', value: raw };
                        entry.tried.add(raw);
                        return { kind: 'wrong', reply: `Not ${round.targetEmoji} — keep trying!` };
                    }
                    return { kind: 'ignore' };
                }
                if (entry.tried.has(raw)) return { kind: 'repeat', value: raw };
                entry.tried.add(raw);
                return { kind: 'wrong', reply: `Nope — react with ${round.targetEmoji}!` };
            }

            case 'trivia':
            case 'riddle':
            case 'emoji': {
                if (answerMatches(raw, round.accepted)) {
                    const norm = normalizeAnswer(raw);
                    if (entry.tried.has(norm)) return { kind: 'repeat', value: raw };
                    return { kind: 'win', points: GAME_POINTS[round.name] || GAME_POINTS.trivia };
                }
                if (!explicit) return { kind: 'ignore' };          // plain chat, not an answer
                const norm = normalizeAnswer(raw);
                if (entry.tried.has(norm)) return { kind: 'repeat', value: raw };
                entry.tried.add(norm);
                return { kind: 'wrong', reply: `Not quite — try again.` };
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
                ? `${reason === 'timeout' ? '⏱️ *Time’s up*' : '*Round ended*'}\n${reveal}.`
                : (reason === 'timeout' ? '⏱️ Time’s up.' : 'Round ended.'));

        const lines = [
            title,
            played.length ? `🎮 ${played.map((p) => `${p.label} +${p.earned}`).join(' · ')}` : null,
            `Next round: \`!game ${round.name}\` · scores: \`!game top\``
        ];
        return lines.filter(Boolean).join('\n');
    }

    // ── owner controls and !game subcommands ─────────────────────────────────
    const gamesOff = () => ({
        handled: true, react: '🔕', reply: '🌙 Games are paused. The bot owner can reopen them with !game on.'
    });
    const ownerOnly = () => ({ handled: true, react: '⛔', reply: '🔒 This command is for the bot owner.' });

    /** Cancel, never draw a winner or score a last guess. Inform other chats. */
    function cancelAll(origin, reason) {
        generation++;
        const cancelled = [...rounds.values()];
        for (const round of cancelled) round.closed = true;
        rounds.clear();
        cooldowns.clear();
        lastQuestion.clear();
        lastRiddle.clear();
        lastEmoji.clear();
        lastScramble.clear();
        lastReact.clear();
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
        return `🎮 *Game status*\n\nGames: *${enabled ? 'ON' : 'OFF'}*\nActive rounds: ${rounds.size} · ${cooldownMs / 1000}s between rounds\n`
            + `🎚️ Math/code mode here: *${scores?.modeOf?.(ctx?.jid) || 'easy'}*\n`
            + `\n*Question pools*\nAI pool: ${line}${hours}`;
    }

    /** Owner: !game reset @member [all] — one member, this chat or every chat. */
    async function resetMember(ctx, args) {
        const everywhere = args.some((a) => /^(all|global|everywhere)$/i.test(a));
        const typed = args.map((a) => a.replace(/\D/g, '')).filter((d) => d.length >= 6);
        const raws = ctx.mentioned?.length ? ctx.mentioned
            : typed.length ? typed
                : ctx.quotedParticipant ? [ctx.quotedParticipant] : [];
        if (!raws.length) {
            return { handled: true, react: '⚠️', reply: 'Try it like this: `!game reset @member` (this chat) · `!game reset @member all` (every chat) · `!game reset tops` (everyone)' };
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

        if (sub === 'answer') {
            if (!ctx.isOwner) return ownerOnly();
            const round = active(ctx.jid);
            if (!round) return { handled: true, react: 'ℹ️', reply: 'ℹ️ No active question in this chat.' };
            const answer = round.accepted?.join(' / ') || round.answer || round.target;
            return { handled: true, react: '🔑', reply: answer ? `🔑 Answer: *${answer}*` : 'ℹ️ This game has no single answer.' };
        }
        if (sub === 'add' && String(args[1] || '').toLowerCase() === 'new') {
            if (!ctx.isOwner) return ownerOnly();
            const moduleName = String(args[2] || '').toLowerCase();
            const aliases = { coal: ['code', 'coal'], pf: ['code', 'pf'], oop: ['code', 'oop'], ds: ['code', 'ds'], trivia: ['trivia', null], riddle: ['riddle', null], emoji: ['emoji', null], math: ['math', null], calculus: ['math', 'calculus'], mvc: ['math', 'mvc'], linear: ['math', 'linear'], scramble: ['scramble', null] };
            const picked = aliases[moduleName];
            if (!picked) return { handled: true, react: '⚠️', reply: 'Try it like this: `!game add new coal|pf|oop|ds|trivia|riddle|emoji|math|scramble`' };
            try {
                const added = await content?.generateAndAdd?.(...picked);
                if (!added?.length) throw new Error('question generator is unavailable');
                return { handled: true, react: '✅', reply: `✅ Generated and added ${added.length} new ${moduleName} question(s) to the game pool.` };
            } catch (err) {
                return { handled: true, react: '⚠️', reply: `⚠️ Could not generate ${moduleName} questions; nothing was added. ${err.message}` };
            }
        }
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
            return { handled: true, react: '✅', reply: `✅ Games are ON for everyone.\n!game to pick a round.${saved === false ? ' ⚠️ Could not save this setting to disk.' : ''}` };
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
                reply: `🌙 Games are OFF for everyone.\n${count} rounds cancelled.\n!game on to reopen.`
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
        // delete/modify/listq/restore are the same family: owner-only curation
        // that answers ⛔ before the switch, and works while games are off so
        // the pool can be cleaned before reopening.
        if (sub === 'addq' || sub === 'add' || sub === 'contribute') {
            return addQuestion(ctx, args.slice(1));
        }
        if (sub === 'delete' || sub === 'del' || sub === 'delq' || sub === 'deleteq' || sub === 'removeq' || sub === 'remove') {
            return deleteQuestion(ctx, args.slice(1));
        }
        if (sub === 'modify' || sub === 'mod' || sub === 'edit' || sub === 'update') {
            return modifyQuestion(ctx, args.slice(1));
        }
        if (sub === 'listq' || sub === 'listquestions' || sub === 'questions') {
            return listQuestions(ctx, args.slice(1));
        }
        if (sub === 'restore' || sub === 'undelete') {
            return restoreHidden(ctx);
        }
        if (sub === 'addemoji' || sub === 'addemojis') {
            return addEmojiPuzzle(ctx, args.slice(1));
        }
        if (sub === 'deleteemoji' || sub === 'delemoji' || sub === 'removeemoji') {
            return deleteEmojiPuzzle(ctx, args.slice(1));
        }
        if (sub === 'listemoji' || sub === 'listemojis' || sub === 'emojipuzzles') {
            return listEmojiPuzzles(ctx);
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
                reply: `That game isn’t on the list. Send !game to see the choices.`
            };
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
            return { handled: true, react: '⏳', reply: `⏳ Next round in ${left}s.` };
        }

        const built = build(ctx, game, args, key, label);
        if (built.error) return { handled: true, react: '⚠️', reply: `⚠️ ${built.error}` };

        rounds.set(ctx.jid, built.round);
        // The starter is registered straight away, but only counts a round as
        // played (and earns the participation point) once they actually try.
        playerEntry(built.round, key, label, ctx.senderIds);

        log?.info?.(`game: ${label} started ${game.name} in ${ctx.jid}`);
        return { handled: true, react: game.emoji, reply: built.text };
    }

    function stopRound(ctx) {
        const round = active(ctx.jid);
        if (!round) return { handled: true, react: 'ℹ️', reply: 'No round running here. Start one with !game.' };
        const mine = round.starterKey === keyOf(ctx);

        if (!mine && !ctx.isOwner) {
            return {
                handled: true,
                react: '⛔',
                reply: `⛔ Only ${round.starterLabel} (who started it) or the bot owner can stop this round.`
            };
        }
        const text = endRound(ctx.jid, { reason: 'stop' }) || 'No game is running here.';
        return { handled: true, react: '🛑', reply: text };
    }

    // ── !guess and plain replies ─────────────────────────────────────────────
    async function guess(ctx, args = []) {
        if (!enabled) return gamesOff();
        const text = (args || []).join(' ').trim()
            || String(ctx.text || '').replace(/^!\S*\s*/, '').trim();
        if (!text) {
            return { handled: true, react: '⚠️', reply: 'Try it like this: `!guess <answer>` — or just send the answer.' };
        }
        return takeAttempt(ctx, text, true);
    }

    /**
     * The plain-message path. Deliberately strict: while a round is running,
     * only text that plainly looks like an answer is treated as one, so normal
     * chat keeps flowing to the quiz solver untouched.
     */
    function setBotMessageId(jid, messageId) {
        const round = active(jid);
        if (!round) return false;
        if (round.name !== 'react') return false;
        round.botMessageId = messageId;
        return true;
    }

    /**
     * Handle a reaction event — the core of the reaction race game.
     * WhatsApp sends a reaction as a message with reactionMessage.text = emoji
     * and reactionMessage.key.id = id of message being reacted to.
     */
    async function handleReaction(ctx, { emoji, targetId }) {
        if (!enabled) return { handled: false };
        const round = active(ctx.jid);
        if (!round || round.closed) return { handled: false };
        if (round.name !== 'react') return { handled: false };
        if (!emoji) return { handled: false }; // empty = removal

        const label = await labelOf(ctx);
        if (!enabled || active(ctx.jid) !== round || round.closed) {
            return { handled: false };
        }
        const key = keyOf(ctx);
        const entry = playerEntry(round, key, label, idsOf(ctx));
        rememberIds(ctx, key);

        if (entry.guesses >= maxAttempts) {
            return {
                handled: true,
                react: '🚫',
                reply: `You’ve used all ${maxAttempts} guesses this round. Try again next round.`
            };
        }

        const cleanEmoji = String(emoji).trim();
        if (!cleanEmoji) return { handled: false };

        if (entry.tried.has(cleanEmoji)) {
            return { handled: true, react: '♻️', reply: `You’ve tried *${cleanEmoji}* already. Try another.` };
        }
        entry.tried.add(cleanEmoji);
        entry.guesses = (entry.guesses || 0) + 1;

        // Check if reaction is to the bot's game message (if we know it)
        const botId = round.botMessageId;
        const targetMatches = !botId || !targetId || targetId === botId;

        if (cleanEmoji === round.targetEmoji && targetMatches) {
            // WIN!
            touchParticipation(round, entry, ctx, label);
            const scored = scores?.win(round.chat, whoOf(ctx, label), GAME_POINTS.react) || { bonus: 0, streak: 1 };
            entry.earned += GAME_POINTS.react + (scored.bonus || 0);
            const bonusLine = scored.bonus ? ` _(+${scored.bonus} streak bonus 🔥${scored.streak})_` : '';
            const reply = `🎉 *Lightning fast, ${label}!* You reacted with ${cleanEmoji} first!\n\n${points(GAME_POINTS.react)}${bonusLine} · ${entry.guesses} attempt${entry.guesses === 1 ? '' : 's'}`
                + (scored.player ? `\nTotal: ${scored.player.points} pts` : '');
            const summary = endRound(round.chat, { winnerKey: key, head: '', reason: 'win' });
            return { handled: true, react: '🎉', reply: summary ? `${reply}\n\n${summary}` : reply };
        }

        // Wrong emoji or wrong message
        round.wrong++;
        touchParticipation(round, entry, ctx, label);
        let hint = null;
        if (!round.hinted && round.wrong >= 4) {
            hint = hintFor(round);
            if (hint) round.hinted = true;
        }
        let wrongMsg = null;
        if (cleanEmoji !== round.targetEmoji) {
            wrongMsg = `❌ Not ${round.targetEmoji} — you sent ${cleanEmoji}`;
        } else if (!targetMatches) {
            wrongMsg = `⚠️ You reacted with ${cleanEmoji} but not to THIS message — react to the bot's game message!`;
        }
        const reply = [wrongMsg, hint].filter(Boolean).join('\n\n');
        return { handled: true, wrong: true, react: '❌', reply: reply || undefined };
    }

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
            case 'rps':
                return parseRpsCall(text) !== null ? takeAttempt(ctx, text, false) : { handled: false };
            case 'scramble':
                return /^[\p{L}]{3,24}$/u.test(text) ? takeAttempt(ctx, text, false) : { handled: false };
            case 'react': {
                // Text fallback: sending the emoji as plain message also counts
                // Check if text contains the target emoji
                if (text.includes(round.targetEmoji)) {
                    return takeAttempt(ctx, text, false);
                }
                // Also allow any single emoji as attempt (will be scored as wrong/win via takeAttempt)
                if (text.length <= 8) {
                    return takeAttempt(ctx, text, false);
                }
                return { handled: false };
            }
            case 'trivia':
            case 'riddle':
            case 'emoji': {
                // Only a correct answer interrupts a conversation; wrong guesses
                // are for people who used !guess.
                return answerMatches(text, round.accepted) ? takeAttempt(ctx, text, false) : { handled: false };
            }
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
                reply: '⚠️ Try it like this: `!game addq Question ; Answer`\n'
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
        if (!result.ok) return { handled: true, react: '⚠️', reply: `⚠️ Couldn’t add that: ${result.error}.` };

        const mine = (scores.questions?.() || []).filter((e) => e.byKey && e.byKey === key).length;
        const credited = mine <= CONTRIBUTION_LIMIT;
        if (credited) scores.award(ctx.jid, whoOf(ctx, label), CONTRIBUTION_POINTS);

        return {
            handled: true,
            react: '✅',
            reply: `✅ *Question added*\n${result.entry.q}\n`
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

    // ── deleting + listing trivia ────────────────────────────────────────────
    /** One line describing what the trivia pool currently holds. */
    function poolSummary() {
        const added = scores?.questionCount || 0;
        const ai = content?.questions?.().length || 0;
        const hidden = scores?.hiddenTriviaCount || 0;
        return `${added} added · ${ai} AI · ${TRIVIA.length - hidden} built-in${hidden ? ` (${hidden} hidden)` : ''}`;
    }

    /**
     * `!game delete <question or number>` — the counterpart of `!game addq`,
     * owner-only.
     *
     * A plain number removes that added question (`!game listq` shows the
     * numbers); any other text searches every trivia pool — added, AI and
     * built-in. An exact match is removed wherever it lives (a built-in is
     * hidden persistently, since it ships with the code); a lone partial match
     * goes too, while several partial matches are listed so the owner can be
     * more specific instead of deleting the wrong question.
     */
    function deleteQuestion(ctx, args) {
        if (!ctx.isOwner) return ownerOnly();
        if (!scores) return { handled: true, react: '⚠️', reply: '⚠️ The question pool is not available.' };
        const raw = args.join(' ').trim();
        if (!raw) {
            return {
                handled: true,
                react: '⚠️',
                reply: '⚠️ Try it like this: `!game delete <question or number>`\n'
                    + 'Example: `!game delete Which city is the capital of Japan?`\n'
                    + '_Added questions are numbered — see them with `!game listq`, then `!game delete 3` removes #3._'
            };
        }
        // Forgiving of the addq shape: `!game delete Q ; A` still means Q.
        const query = raw.split(';')[0].trim() || raw;

        // ── by number: added questions only ──
        const numbered = query.match(/^#?(\d+)$/);
        if (numbered) {
            const result = scores.removeQuestionAt?.(Number(numbered[1]) - 1);
            if (!result) return { handled: true, react: '⚠️', reply: '⚠️ The question pool is not available.' };
            if (!result.ok) {
                const have = scores.questionCount || 0;
                return {
                    handled: true,
                    react: '⚠️',
                    reply: `⚠️ Couldn’t delete that: ${result.error}.`
                        + (have ? ' See the numbers with `!game listq`.' : '')
                };
            }
            return {
                handled: true,
                react: '🗑️',
                reply: `🗑️ Deleted added question #${numbered[1]}: *${result.entry.q}*\n`
                    + `_Answer was: ${result.entry.a.join(' / ')}_\n\n🧠 Pool: ${poolSummary()}`
                    + (result.saved === false ? '\n⚠️ Could not save to disk; it may return after a restart.' : '')
            };
        }

        // ── by text: search every pool ──
        const needle = questionKey(query);
        if (!needle) {
            return { handled: true, react: '⚠️', reply: '⚠️ Couldn’t delete that: the question is empty.' };
        }
        const added = scores.findQuestions?.(query) || [];
        const aiItems = content?.questions?.() || [];
        const aiHits = aiItems.filter((e) => questionKey(e.q).includes(needle));
        const builtinHits = TRIVIA
            .filter((e) => !scores.isBuiltinHidden?.(e.q))
            .filter((e) => questionKey(e.q).includes(needle));

        const exact = [];
        for (const m of added) if (m.exact) exact.push({ pool: 'added', index: m.index, entry: m.entry });
        for (const e of aiHits) if (questionKey(e.q) === needle) exact.push({ pool: 'AI', entry: e });
        for (const e of builtinHits) if (questionKey(e.q) === needle) exact.push({ pool: 'built-in', entry: e });

        const partial = [];
        for (const m of added) if (!m.exact) partial.push({ tag: `added #${m.index + 1}`, pool: 'added', index: m.index, entry: m.entry });
        for (const e of aiHits) if (questionKey(e.q) !== needle) partial.push({ tag: 'AI', pool: 'AI', entry: e });
        for (const e of builtinHits) if (questionKey(e.q) !== needle) partial.push({ tag: 'built-in', pool: 'built-in', entry: e });

        // One exact question, wherever it lives — or the only partial match.
        const targets = exact.length ? exact : (partial.length === 1 ? [partial[0]] : []);
        if (targets.length) {
            const done = [];
            let aiUnavailable = false;
            let saveFailed = false;
            // Descending, so the indexes stay valid while splicing.
            for (const t of targets.filter((t) => t.pool === 'added').sort((a, b) => b.index - a.index)) {
                const r = scores.removeQuestionAt(t.index);
                if (r?.ok) {
                    done.push(`added #${t.index + 1}`);
                    if (r.saved === false) saveFailed = true;
                }
            }
            const aiTargets = targets.filter((t) => t.pool === 'AI').map((t) => t.entry);
            if (aiTargets.length) {
                if (!content?.remove) {
                    aiUnavailable = true;
                } else {
                    try {
                        for (const gone of content.remove('trivia', (item) => aiTargets.includes(item))) {
                            void gone;
                            done.push('AI pool');
                        }
                    } catch {
                        saveFailed = true;
                    }
                }
            }
            for (const t of targets.filter((t) => t.pool === 'built-in')) {
                const r = scores.hideBuiltinTrivia?.(t.entry.q);
                if (r?.ok) {
                    done.push('built-in');
                    if (r.saved === false) saveFailed = true;
                }
            }
            if (!done.length) {
                if (aiUnavailable && targets.every((t) => t.pool === 'AI')) {
                    return { handled: true, react: '⚠️', reply: '⚠️ That question lives in the AI pool, which cannot be edited right now.' };
                }
                return { handled: true, react: '⚠️', reply: '⚠️ Couldn’t delete that: nothing was removed.' };
            }
            const from = [...new Set(done)].join(', ');
            return {
                handled: true,
                react: '🗑️',
                reply: `🗑️ *Question removed*\n${targets[0].entry.q}\n`
                    + `_Removed from ${from}._\n\n🧠 Pool: ${poolSummary()}`
                    + (aiUnavailable ? '\n⚠️ The AI copy could not be removed.' : '')
                    + (saveFailed ? '\n⚠️ Could not save to disk; it may return after a restart.' : '')
            };
        }

        if (!partial.length) {
            const hiddenHits = TRIVIA.filter((e) => scores.isBuiltinHidden?.(e.q) && questionKey(e.q).includes(needle));
            if (hiddenHits.length) {
                return {
                    handled: true,
                    react: 'ℹ️',
                    reply: `ℹ️ That question is already deleted: *${hiddenHits[0].q}*\n`
                        + '_`!game restore` brings back hidden built-ins._'
                };
            }
            return {
                handled: true,
                react: 'ℹ️',
                reply: `ℹ️ No trivia question matches *${short(query, 60)}*.\n\n🧠 Pool: ${poolSummary()}`
            };
        }

        const shown = partial.slice(0, 5).map((p) => `• [${p.tag}] ${short(p.entry.q)}`);
        return {
            handled: true,
            react: '⚠️',
            reply: `⚠️ ${partial.length} questions match *${short(query, 60)}* — be more specific:\n`
                + shown.join('\n')
                + (partial.length > 5 ? `\n_…and ${partial.length - 5} more._` : '')
                + '\n_Copy the full question to delete exactly one._'
        };
    }

    /**
     * `!game modify <question or number> ; <new answer>` — fix a wrong trivia
     * answer, owner-only.
     *
     * A plain number updates that added question (`!game listq` shows the
     * numbers); any other text searches every pool like `!game delete` does.
     * An exact match is updated wherever it lives — a built-in is overridden
     * persistently, since it ships with the code. `/` adds another accepted
     * spelling, and a `:` works as the separator too.
     */
    function modifyQuestion(ctx, args) {
        if (!ctx.isOwner) return ownerOnly();
        if (!scores) return { handled: true, react: '⚠️', reply: '⚠️ The question pool is not available.' };
        const raw = args.join(' ').trim();
        const split = raw.match(/^(.*?)\s*(?:;|\||->)\s*(.+)$/);
        let left = '';
        let right = '';
        if (split) {
            left = split[1].trim();
            right = split[2].trim();
        } else {
            // No addq-style separator: fall back to the last colon, so colons
            // inside the question itself survive.
            const colon = raw.lastIndexOf(':');
            if (colon > 0) {
                left = raw.slice(0, colon).trim();
                right = raw.slice(colon + 1).trim();
            }
        }
        if (!left || !right) {
            return {
                handled: true,
                react: '⚠️',
                reply: '⚠️ Try it like this: `!game modify <question or number> ; <new answer>`\n'
                    + 'Example: `!game modify Which planet has rings? ; Saturn`\n'
                    + '_A `:` works too (`!game modify 3 : Saturn`), and `/` adds another accepted spelling._'
            };
        }
        const answers = right.split('/').map((s) => s.trim()).filter(Boolean);
        if (!answers.length) {
            return { handled: true, react: '⚠️', reply: '⚠️ Couldn’t modify that: the answer is missing.' };
        }

        // ── by number: added questions only ──
        const numbered = left.match(/^#?(\d+)$/);
        if (numbered) {
            const result = scores.updateQuestionAt?.(Number(numbered[1]) - 1, answers);
            if (!result) return { handled: true, react: '⚠️', reply: '⚠️ The question pool is not available.' };
            if (!result.ok) {
                return {
                    handled: true,
                    react: '⚠️',
                    reply: `⚠️ Couldn’t modify that: ${result.error}.`
                        + (scores.questionCount ? ' See the numbers with `!game listq`.' : '')
                };
            }
            return {
                handled: true,
                react: '✏️',
                reply: `✏️ Updated added question #${numbered[1]}: *${result.entry.q}*\n`
                    + `_Was: ${result.before.join(' / ')} → Now: ${result.entry.a.join(' / ')}_`
                    + (result.saved === false ? '\n⚠️ This change couldn’t be saved. It may revert after a restart.' : '')
            };
        }

        // ── by text: search every pool ──
        const needle = questionKey(left);
        if (!needle) {
            return { handled: true, react: '⚠️', reply: '⚠️ Couldn’t modify that: the question is empty.' };
        }
        const added = scores.findQuestions?.(left) || [];
        const aiItems = content?.questions?.() || [];
        const aiHits = aiItems.filter((e) => questionKey(e.q).includes(needle));
        const builtinHits = TRIVIA
            .filter((e) => !scores.isBuiltinHidden?.(e.q))
            .filter((e) => questionKey(e.q).includes(needle));

        const exact = [];
        for (const m of added) if (m.exact) exact.push({ pool: 'added', index: m.index, entry: m.entry });
        for (const e of aiHits) if (questionKey(e.q) === needle) exact.push({ pool: 'AI', entry: e });
        for (const e of builtinHits) if (questionKey(e.q) === needle) exact.push({ pool: 'built-in', entry: e });

        const partial = [];
        for (const m of added) if (!m.exact) partial.push({ tag: `added #${m.index + 1}`, pool: 'added', index: m.index, entry: m.entry });
        for (const e of aiHits) if (questionKey(e.q) !== needle) partial.push({ tag: 'AI', pool: 'AI', entry: e });
        for (const e of builtinHits) if (questionKey(e.q) !== needle) partial.push({ tag: 'built-in', pool: 'built-in', entry: e });

        // One exact question, wherever it lives — or the only partial match.
        const targets = exact.length ? exact : (partial.length === 1 ? [partial[0]] : []);
        if (targets.length) {
            const done = [];
            let aiUnavailable = false;
            let saveFailed = false;
            for (const t of targets.filter((t) => t.pool === 'added')) {
                const r = scores.updateQuestionAt(t.index, answers);
                if (r?.ok) {
                    done.push({ where: `added #${t.index + 1}`, old: r.before });
                    if (r.saved === false) saveFailed = true;
                }
            }
            const aiTargets = targets.filter((t) => t.pool === 'AI').map((t) => t.entry);
            if (aiTargets.length) {
                if (!content?.updateAnswers) {
                    aiUnavailable = true;
                } else {
                    const olds = new Map(aiTargets.map((e) => [questionKey(e.q), [...e.a]]));
                    try {
                        const updated = content.updateAnswers('trivia', (item) => aiTargets.includes(item), answers);
                        for (const u of updated) done.push({ where: 'AI pool', old: olds.get(questionKey(u.q)) || [] });
                    } catch {
                        saveFailed = true;
                    }
                }
            }
            for (const t of targets.filter((t) => t.pool === 'built-in')) {
                const previous = scores.builtinAnswer?.(t.entry.q) || t.entry.a;
                const r = scores.setBuiltinAnswer?.(t.entry.q, answers);
                if (r?.ok) {
                    done.push({ where: 'built-in', old: previous });
                    if (r.saved === false) saveFailed = true;
                }
            }
            if (!done.length) {
                if (aiUnavailable && targets.every((t) => t.pool === 'AI')) {
                    return { handled: true, react: '⚠️', reply: '⚠️ That question lives in the AI pool, which cannot be edited right now.' };
                }
                return { handled: true, react: '⚠️', reply: '⚠️ Couldn’t modify that: nothing was updated.' };
            }
            const fresh = answers.join(' / ');
            const lines = done.map((d) => `• ${d.where}: _${(d.old || []).join(' / ') || '?'} → ${fresh}_`);
            return {
                handled: true,
                react: '✏️',
                reply: `✏️ *Answer updated*\n${targets[0].entry.q}\n${lines.join('\n')}`
                    + (aiUnavailable ? '\n⚠️ The AI copy could not be updated.' : '')
                    + (saveFailed ? '\n⚠️ This change couldn’t be saved. It may revert after a restart.' : '')
            };
        }

        if (!partial.length) {
            const hiddenHits = TRIVIA.filter((e) => scores.isBuiltinHidden?.(e.q) && questionKey(e.q).includes(needle));
            if (hiddenHits.length) {
                return {
                    handled: true,
                    react: 'ℹ️',
                    reply: 'ℹ️ That question is deleted — `!game restore` brings it back before it can be modified.'
                };
            }
            return {
                handled: true,
                react: 'ℹ️',
                reply: `ℹ️ No trivia question matches *${short(left, 60)}*.\n\n🧠 Pool: ${poolSummary()}`
            };
        }

        const shown = partial.slice(0, 5).map((p) => `• [${p.tag}] ${short(p.entry.q)}`);
        return {
            handled: true,
            react: '⚠️',
            reply: `⚠️ ${partial.length} questions match *${short(left, 60)}* — be more specific:\n`
                + shown.join('\n')
                + (partial.length > 5 ? `\n_…and ${partial.length - 5} more._` : '')
                + '\n_Copy the full question to modify exactly one._'
        };
    }

    /**
     * `!game listq [search]` — owner-only. Without a search it numbers the
     * added questions (the numbers `!game delete` takes); with one it searches
     * every pool. Answers are shown because the owner already sees them via
     * `!game answer` — members get ⛔ so the game is never spoiled.
     */
    function listQuestions(ctx, args) {
        if (!ctx.isOwner) return ownerOnly();
        if (!scores) return { handled: true, react: '⚠️', reply: '⚠️ The question pool is not available.' };
        const query = args.join(' ').trim();
        const added = scores.questions?.() || [];

        if (!query) {
            const lines = added.slice(0, 20).map((e, i) => `${i + 1}. ${short(e.q)} — _${short(e.a.join(' / '), 40)}_`);
            const head = added.length
                ? `📚 *Your questions · ${added.length}*\n${lines.join('\n')}`
                : '📚 No added questions yet. Try !game addq Question ; Answer';
            const more = added.length > 20 ? `\n_…and ${added.length - 20} more — refine with \`!game listq <search>\`._` : '';
            return { handled: true, reply: `${head}${more}\n\n🧠 Pool: ${poolSummary()}` };
        }

        const needle = questionKey(query);
        if (!needle) {
            return { handled: true, react: '⚠️', reply: '⚠️ Type something to search for: `!game listq capital`' };
        }
        const matches = [];
        added.forEach((e, i) => {
            if (questionKey(e.q).includes(needle)) matches.push({ tag: `added #${i + 1}`, entry: e });
        });
        for (const e of content?.questions?.() || []) {
            if (questionKey(e.q).includes(needle)) matches.push({ tag: 'AI', entry: e });
        }
        for (const e of TRIVIA) {
            if (!questionKey(e.q).includes(needle)) continue;
            const tag = scores.isBuiltinHidden?.(e.q) ? 'built-in (deleted)'
                : scores.builtinAnswer?.(e.q) ? 'built-in (modified)' : 'built-in';
            matches.push({ tag, entry: e });
        }
        if (!matches.length) {
            return {
                handled: true,
                react: 'ℹ️',
                reply: `ℹ️ No trivia question matches *${short(query, 60)}*.\n\n🧠 Pool: ${poolSummary()}`
            };
        }
        const shown = matches.slice(0, 10).map((m) => `• [${m.tag}] ${short(m.entry.q)}`);
        const more = matches.length > 10 ? `\n_…and ${matches.length - 10} more — be more specific._` : '';
        return {
            handled: true,
            reply: `🔎 *${matches.length} match${matches.length === 1 ? '' : 'es'} for “${short(query, 60)}”*\n`
                + shown.join('\n') + more
        };
    }

    /** `!game restore` — owner-only: bring back hidden built-ins and clear modified built-in answers. */
    function restoreHidden(ctx) {
        if (!ctx.isOwner) return ownerOnly();
        if (!scores?.restoreBuiltins) return { handled: true, react: '⚠️', reply: '⚠️ The question pool is not available.' };
        const { restored, saved } = scores.restoreBuiltins();
        const cleared = scores.clearBuiltinAnswers?.() || { cleared: 0, saved: true };
        if (!restored && !cleared.cleared) {
            return { handled: true, react: 'ℹ️', reply: 'ℹ️ No hidden built-in questions — nothing to restore.' };
        }
        const parts = [];
        if (restored) parts.push(`Restored ${restored} hidden built-in trivia question(s).`);
        if (cleared.cleared) parts.push(`Cleared ${cleared.cleared} modified built-in answer(s).`);
        return {
            handled: true,
            react: '✅',
            reply: `✅ ${parts.join(' ')}`
                + (saved === false || cleared.saved === false ? ' ⚠️ Could not save to disk.' : '')
        };
    }

    // ── owner-curated emoji puzzles ──────────────────────────────────────────
    /**
     * `!game addemoji 🦁👑 ; The Lion King` — owner-only, the addq of the
     * emoji game. `/` inside the answer adds another accepted spelling.
     */
    function addEmojiPuzzle(ctx, args) {
        if (!ctx.isOwner) return ownerOnly();
        if (!enabled) return gamesOff();
        const raw = args.join(' ').trim();
        const split = raw.match(/^(.*?)\s*(?:;|\||->)\s*(.+)$/);
        if (!raw || !split) {
            return {
                handled: true,
                react: '⚠️',
                reply: '⚠️ Try it like this: `!game addemoji 🦁👑 ; The Lion King`\n'
                    + '_An / inside the answer adds another accepted spelling._'
            };
        }
        const emoji = split[1].trim();
        const answers = String(split[2]).split('/').map((x) => x.trim()).filter(Boolean);
        if (!emoji || emoji.length > 48 || !answers.length) {
            return { handled: true, react: '⚠️', reply: '⚠️ Both parts are needed: `!game addemoji 🦁👑 ; The Lion King`' };
        }

        const key = keyOf(ctx);
        const result = scores?.addEmojiPuzzle?.({
            emoji, a: answers, by: labelOfSync(ctx), byKey: key, chat: ctx.jid
        });
        if (!result) return { handled: true, react: '⚠️', reply: '⚠️ The emoji pool is not available.' };
        if (!result.ok) return { handled: true, react: '⚠️', reply: `⚠️ Couldn’t add that: ${result.error}.` };

        const mine = (scores.emojiQuestions?.() || []).filter((e) => e.byKey && e.byKey === key).length;
        const credited = mine <= CONTRIBUTION_LIMIT;
        if (credited) scores.award(ctx.jid, whoOf(ctx, labelOfSync(ctx)), CONTRIBUTION_POINTS);

        return {
            handled: true,
            react: '✅',
            reply: `✅ *Emoji puzzle added*\n${result.entry.emoji}\n`
                + `_Answer: ${result.entry.a.join(' / ')}_ · ${scores.emojiQuestionCount} in the pool`
                + (credited ? `\n${points(CONTRIBUTION_POINTS)} for contributing 🎓` : '')
        };
    }

    /** `!game listemoji` — owner-only: the added puzzles, numbered for deleteemoji. */
    function listEmojiPuzzles(ctx) {
        if (!ctx.isOwner) return ownerOnly();
        const added = scores?.emojiQuestions?.() || [];
        if (!added.length) {
            return { handled: true, reply: '🎭 No added emoji puzzles yet. Try `!game addemoji 🦁👑 ; The Lion King`' };
        }
        const lines = added.slice(0, 20).map((e, i) => `${i + 1}. ${e.emoji} — _${short(e.a.join(' / '), 40)}_`);
        const more = added.length > 20 ? `\n_…and ${added.length - 20} more._` : '';
        return { handled: true, reply: `🎭 *Your emoji puzzles · ${added.length}*\n${lines.join('\n')}${more}` };
    }

    /** `!game deleteemoji <#>` — owner-only: remove one added puzzle by its number. */
    function deleteEmojiPuzzle(ctx, args) {
        if (!ctx.isOwner) return ownerOnly();
        if (!scores?.removeEmojiPuzzleAt) return { handled: true, react: '⚠️', reply: '⚠️ The emoji pool is not available.' };
        const numbered = args.join(' ').trim().match(/^#?(\d+)$/);
        if (!numbered) {
            return {
                handled: true,
                react: '⚠️',
                reply: '⚠️ Try it like this: `!game deleteemoji 3` — see the numbers with `!game listemoji`.'
            };
        }
        const result = scores.removeEmojiPuzzleAt(Number(numbered[1]) - 1);
        if (!result) return { handled: true, react: '⚠️', reply: '⚠️ The emoji pool is not available.' };
        if (!result.ok) return { handled: true, react: '⚠️', reply: `⚠️ Couldn’t delete that: ${result.error}.` };
        return {
            handled: true,
            react: '🗑️',
            reply: `🗑️ Deleted emoji puzzle #${numbered[1]}: *${result.entry.emoji}*\n`
                + `_Answer was: ${result.entry.a.join(' / ')}_`
                + (result.saved === false ? '\n⚠️ Could not save to disk; it may return after a restart.' : '')
        };
    }

    // ── timers ───────────────────────────────────────────────────────────────
    /** Close every round whose time is up. Returns what it announced. */
    async function sweep() {
        const out = [];
        for (const [jid, round] of [...rounds]) {
            if (active(jid) !== round || now() < round.endsAt) continue;

            const text = endRound(jid, { reason: 'timeout' });
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
        // The "don't repeat the last question" memory is per-chat too; let it
        // die with the silence it was protecting against.
        for (const [jid, e] of lastQuestion) if (now() - e.at >= repeatMemoryMs) lastQuestion.delete(jid);
        for (const [jid, e] of lastRiddle) if (now() - e.at >= repeatMemoryMs) lastRiddle.delete(jid);
        for (const [jid, e] of lastEmoji) if (now() - e.at >= repeatMemoryMs) lastEmoji.delete(jid);
        for (const [jid, e] of lastScramble) if (now() - e.at >= repeatMemoryMs) lastScramble.delete(jid);
        for (const [jid, e] of lastReact) if (now() - e.at >= repeatMemoryMs) lastReact.delete(jid);
        for (const [stamp, e] of lastConcept) if (now() - e.at >= repeatMemoryMs) lastConcept.delete(stamp);
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
        handleMessage,
        handleReaction,
        setBotMessageId,
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
