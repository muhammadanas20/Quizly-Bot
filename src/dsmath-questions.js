/** Verified discrete-maths exercises: 27 easy + 27 hard over nine topics.
 * `code` is optional working (a truth table, a recurrence, the data of a word
 * problem) and is rendered separately from the question so the prose stays
 * readable in WhatsApp chat.
 * Every answer is short enough to type; accepted spellings cover the usual
 * alternatives, and fractions and decimals both count (see looseMatches).
 * Topics: logic · sets · relfun · counting · numtheory · sequences · graphs ·
 * boolalg · prob — the same keys `!game dsmath <topic>` accepts.
 */
const entry = (topic, level, q, a, code) => ({ topic, level, q, a, ...(code ? { code } : {}) });
const easy = (topic, q, a, code) => entry(topic, 'easy', q, a, code);
const hard = (topic, q, a, code) => entry(topic, 'hard', q, a, code);

export const DSMATH_QUESTIONS = Object.freeze([
    // ── Propositional and predicate logic (3 easy / 3 hard) ──────────────────
    easy('logic', 'What is the truth value of TRUE AND FALSE?', ['false', 'f', '0']),
    easy('logic', 'What is the truth value of TRUE OR FALSE?', ['true', 't', '1']),
    easy('logic', 'Which connective is true only when exactly one of its two inputs is true?', ['xor', 'exclusive or', 'exclusive-or', 'xor gate']),
    hard('logic', 'When p is false, what is the truth value of the implication p → q, whatever q is?', ['true', 't', '1', 'vacuously true'],
        'p q | p → q\nT T |  T\nT F |  F\nF T |  T\nF F |  T'),
    hard('logic', 'The statement ¬q → ¬p is the converse, the inverse or the contrapositive of p → q?', ['contrapositive', 'the contrapositive']),
    hard('logic', 'Of the four rows of its truth table, in how many is the implication p → q false?', ['1', 'one']),

    // ── Sets (3 easy / 3 hard) ───────────────────────────────────────────────
    easy('sets', 'How many elements are in A ∪ B when A = {1, 2, 3} and B = {3, 4}?', ['4', 'four'],
        'A = {1, 2, 3}\nB = {3, 4}\nA ∪ B = ?'),
    easy('sets', 'How many elements are in A ∩ B when A = {1, 2, 3} and B = {3, 4}?', ['1', 'one']),
    easy('sets', 'How many sets are in the power set of A when A = {a, b, c}?', ['8', 'eight']),
    hard('sets', 'In a class of 30 students, 18 play cricket, 15 play football and 7 play both. How many play neither?', ['4', 'four'],
        'total    = 30\ncricket  = 18\nfootball = 15\nboth     = 7'),
    hard('sets', 'How many PROPER subsets does a set with 4 elements have?', ['15', 'fifteen']),
    hard('sets', 'Is the set of real numbers between 0 and 1 countable or uncountable?', ['uncountable', 'uncountably infinite']),

    // ── Relations and functions (3 easy / 3 hard) ───────────────────────────
    easy('relfun', 'A relation that is reflexive, symmetric and transitive is called what kind of relation?', ['equivalence', 'equivalence relation']),
    easy('relfun', 'A function in which different inputs always give different outputs is one-to-one, or what?', ['injective', 'injection', 'injective function']),
    easy('relfun', 'A function whose range is the whole codomain is onto. What is its other name?', ['surjective', 'surjection', 'surjective function']),
    hard('relfun', 'How many different relations are there on a set with 3 elements?', ['512'],
        'a relation on A is any subset of A × A\n|A| = 3, so |A × A| = 9'),
    hard('relfun', 'How many functions are there from a set with 4 elements to a set with 2 elements?', ['16'],
        'each of the 4 inputs picks 1 of 2 outputs'),
    hard('relfun', 'How many reflexive relations are there on a set with 4 elements?', ['4096'],
        'the 4 diagonal pairs are forced in;\nthe other 12 pairs are free: 2^12'),

    // ── Counting and combinatorics (3 easy / 3 hard) ─────────────────────────
    easy('counting', 'What is 5! (five factorial)?', ['120']),
    easy('counting', 'In how many orders can 3 different books be arranged in a row?', ['6', 'six']),
    easy('counting', 'You must answer 2 of 5 questions. In how many ways can you choose them?', ['10', 'ten']),
    hard('counting', 'In how many ways can a committee of 4 be chosen from 6 people?', ['15', 'fifteen']),
    hard('counting', 'How many diagonals does a convex hexagon have?', ['9', 'nine'],
        'diagonals = n(n − 3) / 2\nn = 6'),
    hard('counting', 'A box holds 10 red and 10 blue balls. What is the fewest you can draw to be sure of two of the same colour?', ['3', 'three'],
        'pigeonhole: 2 colours'),

    // ── Number theory and modular arithmetic (3 easy / 3 hard) ───────────────
    easy('numtheory', 'What is the greatest common divisor of 12 and 18?', ['6', 'six']),
    easy('numtheory', 'What is 17 mod 5?', ['2', 'two']),
    easy('numtheory', 'Which is the only even prime number?', ['2', 'two']),
    hard('numtheory', 'Write 13 in binary (base 2).', ['1101']),
    hard('numtheory', 'What is 7² mod 11?', ['5', 'five'],
        '7² = 49\n49 = 4 × 11 + 5'),
    hard('numtheory', 'How many integers from 1 to 12 are coprime to 12 — that is, what is φ(12)?', ['4', 'four']),

    // ── Sequences, series and recurrences (3 easy / 3 hard) ──────────────────
    easy('sequences', 'What is the 5th term of the arithmetic sequence 3, 7, 11, 15, …?', ['19', 'nineteen'],
        'a1 = 3, d = 4\na5 = a1 + 4d'),
    easy('sequences', 'What is the next term of the geometric sequence 2, 6, 18, 54?', ['162']),
    easy('sequences', 'What is the sum of the first 10 positive integers?', ['55', 'fifty five']),
    hard('sequences', 'With F1 = F2 = 1, what is the 8th Fibonacci number F8?', ['21', 'twenty one'],
        'Fn = Fn-1 + Fn-2\n1, 1, 2, 3, 5, 8, 13, …'),
    hard('sequences', 'a1 = 3 and a(n) = 2 · a(n−1). What is a5?', ['48', 'forty eight']),
    hard('sequences', 'What is the sum of the infinite series 1/2 + 1/4 + 1/8 + …?', ['1', 'one'],
        'a = 1/2, r = 1/2\nsum = a / (1 − r)'),

    // ── Graph theory and trees (3 easy / 3 hard) ─────────────────────────────
    easy('graphs', 'The sum of all vertex degrees in a graph equals how many times the number of edges?', ['2', 'twice', 'two']),
    easy('graphs', 'How many edges does a tree with 6 vertices have?', ['5', 'five']),
    easy('graphs', 'How many edges does the complete graph K4 have?', ['6', 'six']),
    hard('graphs', 'A connected planar graph has 6 vertices and 10 edges. How many faces does it have?', ['6', 'six'],
        'Euler: v − e + f = 2'),
    hard('graphs', 'How many colours are always enough to colour any planar map?', ['4', 'four']),
    hard('graphs', 'A connected graph has an Euler circuit exactly when every vertex has what kind of degree?', ['even', 'even degree']),

    // ── Boolean algebra and logic gates (3 easy / 3 hard) ────────────────────
    easy('boolalg', 'Which logic gate outputs 1 only when both of its inputs are 1?', ['and', 'and gate']),
    easy('boolalg', 'What is 1 XOR 1?', ['0', 'zero']),
    easy('boolalg', 'Which gate is an OR gate followed by a NOT gate?', ['nor', 'nor gate']),
    hard('boolalg', 'How many different Boolean functions of two variables are there?', ['16', 'sixteen'],
        '4 input rows → 2^4 possible outputs'),
    hard('boolalg', 'In Boolean algebra, what does A + A′ (A OR NOT A) always equal?', ['1', 'true']),
    hard('boolalg', 'Which single gate is functionally complete on its own: NAND or AND?', ['nand', 'nand gate', 'nand gates']),

    // ── Discrete probability (3 easy / 3 hard) ───────────────────────────────
    easy('prob', 'What is the probability of getting heads on one toss of a fair coin?', ['1/2', '0.5', '50%', 'half']),
    easy('prob', 'What is the probability of rolling a 4 on a fair six-sided die?', ['1/6']),
    easy('prob', 'How many outcomes are in the sample space when two six-sided dice are rolled?', ['36']),
    hard('prob', 'Two fair coins are tossed. What is the probability of getting heads on both?', ['1/4', '0.25', '25%']),
    hard('prob', 'One card is drawn from a 52-card deck. What is the probability it is a king?', ['1/13', '4/52', '4 in 52']),
    hard('prob', 'P(A) = 0.3 and P(B) = 0.4 for mutually exclusive events. What is P(A or B)?', ['0.7', '7/10', '70%'])
]);
