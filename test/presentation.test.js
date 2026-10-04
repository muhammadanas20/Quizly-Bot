import test from 'node:test';
import assert from 'node:assert/strict';
import { DS_QUESTIONS } from '../src/ds-questions.js';
import { CODE_BANK } from '../src/banks.js';
import { looseMatches } from '../src/games.js';
import { questionText, roundCard, GAME_GUIDE } from '../src/presentation.js';

test('the original DS expansion keeps exactly 30 unique questions, 15 at each difficulty', () => {
    assert.equal(DS_QUESTIONS.length, 30);
    assert.equal(DS_QUESTIONS.filter((q) => q.level === 'easy').length, 15);
    assert.equal(DS_QUESTIONS.filter((q) => q.level === 'hard').length, 15);
    const ds = CODE_BANK.filter((q) => q.topic === 'ds');
    assert.ok(ds.length >= 48, `the DS pool should have grown, not shrunk (${ds.length})`);
    assert.equal(new Set(ds.map((q) => q.q.toLowerCase())).size, ds.length, 'no question is asked twice');
    for (const q of DS_QUESTIONS) {
        assert.ok(ds.includes(q));
        assert.ok(q.a.length && q.a.every((a) => typeof a === 'string' && a.trim()));
        for (const a of q.a) assert.ok(looseMatches(a, q.a), `${q.q}: ${a}`);
        assert.ok(!looseMatches('deliberately incorrect answer', q.a));
    }
});

test('every extended DS card is well-shaped and answers itself', () => {
    const ds = CODE_BANK.filter((q) => q.topic === 'ds');
    for (const q of ds) {
        assert.ok(q.q.length >= 10 && q.q.length <= 300, q.q);
        assert.ok(['easy', 'hard'].includes(q.level), q.q);
        assert.ok(Array.isArray(q.a) && q.a.length >= 1 && q.a.length <= 4, `${q.q}: 1-4 accepted spellings`);
        for (const a of q.a) {
            assert.ok(a === a.trim() && a.length && a.length <= 60, `${q.q}: ${a}`);
            assert.ok(looseMatches(a, q.a), `${q.q}: ${a} does not match itself`);
        }
        assert.ok(!looseMatches('deliberately incorrect answer', q.a), q.q);
    }
});

test('question renderer separates prose from fenced, indented code', () => {
    assert.equal(questionText({ q: 'What prints?', code: 'if ready:\n    print(7)' }),
        'What prints?\n\n```\nif ready:\n    print(7)\n```');
    assert.equal(questionText({ q: 'Which structure is FIFO?' }), 'Which structure is FIFO?');
    assert.equal(questionText({ q: 'Q', code: '  ' }), 'Q');
    assert.equal(questionText({ q: 'Q', code: '```\nprint(1)\n```' }), 'Q\n\n```\nprint(1)\n```');
});

test('all new DS cards fit a single message with balanced snippet fences', () => {
    for (const entry of DS_QUESTIONS) {
        const card = roundCard({ emoji: '💻', title: `Data structures · ${entry.level}`,
            detail: '5 pts · 180s', question: questionText(entry), footer: 'Send your answer.' });
        assert.ok(card.length < 3800);
        assert.equal((card.match(/```/g) || []).length, entry.code ? 2 : 0);
        assert.ok(card.includes(entry.q));
        assert.ok(!card.includes('undefined'));
        assert.ok(!card.includes('Answer:'));
    }
});

test('trace exercises agree with independently computed results', () => {
    const accepts = (fragment, value) => {
        const q = DS_QUESTIONS.find((q) => q.q.includes(fragment));
        assert.ok(q, fragment);
        assert.ok(looseMatches(String(value), q.a), `${fragment}: ${value}`);
    };
    const stack = []; stack.push(10); stack.push(20); stack.pop(); stack.push(30);
    accepts('final pop', stack.pop());
    const queue = []; queue.push(4); queue.push(7); queue.shift();
    accepts('at the front', queue[0]);
    accepts('value is at index 2', [3, 6, 9, 12][2]);
    accepts('parent index', Math.floor((10 - 1) / 2));
    accepts('load factor', 18 / 24);
    accepts('bucket receives', 24 % 7);
    accepts('rear after', (4 + 1) % 5);
    accepts('postfix expression', 2 + 3 * 4);
    accepts('inorder traversal', [8, 3, 10, 1, 6].sort((a, b) => a - b).join(', '));
    const graph = { A: ['B', 'C'], B: ['A', 'D'], C: ['A', 'D'], D: ['B', 'C'] };
    const pending = ['A'], seen = new Set(pending), visited = [];
    while (pending.length) {
        const node = pending.shift(); visited.push(node);
        for (const neighbor of graph[node]) if (!seen.has(neighbor)) {
            seen.add(neighbor); pending.push(neighbor);
        }
    }
    accepts('Run BFS', visited.join(' '));
});

test('detailed help retains owner commands and ordinary game controls', () => {
    for (const command of ['!game addq', '!game modify', '!game delete', '!game listq',
        '!game restore', '!game add new ds', '!game answer', '!game reset tops',
        '!game reset @member', '!game on', '!game stop', '!guess', '!top all']) {
        assert.ok(GAME_GUIDE.includes(command), command);
    }
    assert.ok(!GAME_GUIDE.includes('```'), 'help is prose, not a wide monospace table');
});
