/**
 * src/bank-tools.js — tiny pure helpers shared by the built-in question banks.
 *
 * The extended banks are large, so their numeric answers are COMPUTED rather
 * than typed next to the question: a card is written once and the accepted
 * answer falls out of the same arithmetic the question describes. A typo in a
 * question therefore cannot silently become "the correct answer", and every
 * number in the bank can be recomputed in a test.
 *
 * Nothing here touches the network, the clock or the RNG — the whole module is
 * pure, so it costs one cheap import and no measurable memory.
 */

// ─── counting ────────────────────────────────────────────────────────────────
export const gcd = (a, b) => (b ? gcd(b, Math.abs(a) % Math.abs(b)) : Math.abs(a));
export const lcm = (a, b) => (a && b ? Math.abs(a * b) / gcd(a, b) : 0);

/** n! — exact for the small n these cards use. */
export function fact(n) {
    let out = 1;
    for (let i = 2; i <= n; i++) out *= i;
    return out;
}

/** C(n, r) — combinations without repetition ("n choose r"). */
export function binom(n, r) {
    if (r < 0 || r > n) return 0;
    const k = Math.min(r, n - r);
    let out = 1;
    for (let i = 1; i <= k; i++) out = (out * (n - k + i)) / i;
    return Math.round(out);
}

/** P(n, r) — ordered arrangements of r items out of n. */
export function perm(n, r) {
    if (r < 0 || r > n) return 0;
    let out = 1;
    for (let i = 0; i < r; i++) out *= n - i;
    return out;
}

/** Ways to put r identical items into n labelled boxes (stars and bars). */
export const starsBars = (n, r) => (n <= 0 ? (r === 0 ? 1 : 0) : binom(r + n - 1, n - 1));

/** Arrangements of n items around a circle (rotations identified). */
export const circularPerm = (n) => (n <= 1 ? 1 : fact(n - 1));

export const sumTo = (n) => (n * (n + 1)) / 2;
export const sumSquares = (n) => (n * (n + 1) * (2 * n + 1)) / 6;
export const sumCubes = (n) => sumTo(n) ** 2;

/** Euler's totient — counts the integers in [1, n] coprime to n. */
export function phi(n) {
    let out = n;
    let m = n;
    for (let p = 2; p * p <= m; p++) {
        if (m % p) continue;
        while (m % p === 0) m /= p;
        out -= out / p;
    }
    if (m > 1) out -= out / m;
    return out;
}

/** Modular exponentiation — used by the RSA/Fermat cards. */
export function modPow(base, exp, m) {
    let out = 1;
    let b = ((base % m) + m) % m;
    let e = exp;
    while (e > 0) {
        if (e & 1) out = (out * b) % m;
        b = (b * b) % m;
        e >>>= 1;
    }
    return out;
}

/** 1-indexed Fibonacci with F(1) = F(2) = 1. */
export function fib(n) {
    let a = 1, b = 1;
    for (let i = 3; i <= n; i++) [a, b] = [b, a + b];
    return n <= 0 ? 0 : b;
}

/** The nth term of a + (n-1)d. */
export const arith = (a1, d, n) => a1 + (n - 1) * d;
/** The nth term of a·r^(n-1). */
export const geom = (a1, r, n) => a1 * r ** (n - 1);
/** Sum of the first n terms of a geometric progression. */
export function geomSum(a1, r, n) {
    if (r === 1) return a1 * n;
    return (a1 * (1 - r ** n)) / (1 - r);
}

// ─── formatting ──────────────────────────────────────────────────────────────
export const toBin = (n) => Number(n).toString(2);
export const toHex = (n) => Number(n).toString(16).toUpperCase();

/** "3/4" in lowest terms — 0.75 and "3/4" already match each other as answers. */
export function frac(n, d) {
    if (d === 0) return 'undefined';
    const g = gcd(n, d) || 1;
    const num = n / g;
    const den = d / g;
    return den === 1 ? String(num) : `${num}/${den}`;
}

/** Big-O spellings, so "O(n log n)" also accepts "n log n" and "nlogn". */
export const bigO = (inner) => `O(${inner})`;

// ─── small integer simulators (for trace questions) ──────────────────────────
export const u8 = (v) => ((v % 256) + 256) % 256;
export const u16 = (v) => ((v % 65536) + 65536) % 65536;

/**
 * Worst-case probes a textbook binary search makes over n sorted items.
 * The worst key always sits in the larger half, so the loop keeps that half
 * and counts the halvings — floor(log2(n)) + 1 for n ≥ 1.
 */
export function binSearchSteps(n) {
    if (n < 1) return 0;
    let lo = 0, hi = n - 1, steps = 0;
    while (lo <= hi) {
        steps++;
        const mid = (lo + hi) >> 1;
        if (mid - lo >= hi - mid) hi = mid - 1;   // left half is at least as big
        else lo = mid + 1;
    }
    return steps;
}

/** Comparisons selection sort makes over n items — always n(n-1)/2. */
export const selectionComparisons = (n) => (n * (n - 1)) / 2;

/** Levels merge sort's recursion tree has for n items. */
export const mergeLevels = (n) => Math.ceil(Math.log2(n));

/** Moves the classic Tower of Hanoi needs for n disks. */
export const hanoi = (n) => 2 ** n - 1;

/** Distinct subarrays / substrings of n items. */
export const subArrays = (n) => (n * (n + 1)) / 2;

// ─── graph helpers ───────────────────────────────────────────────────────────
/** Edges in the complete (simple, undirected) graph on n vertices. */
export const completeEdges = (n) => binom(n, 2);

/** Sum of all degrees of an undirected graph with e edges. */
export const degreeSum = (e) => 2 * e;

/** Max nodes in a binary tree of height h, root at height 0. */
export const maxNodes = (h) => 2 ** (h + 1) - 1;

/** Nodes on level L of a binary tree, root at level 0. */
export const levelNodes = (L) => 2 ** L;

/** Leaves in a full binary tree with `internal` internal nodes. */
export const fullTreeLeaves = (internal) => internal + 1;

/** Edges of a tree on n vertices — always n − 1. */
export const treeEdges = (n) => n - 1;

/** Relaxation rounds Bellman–Ford needs for a graph on v vertices. */
export const bellmanPasses = (v) => v - 1;
