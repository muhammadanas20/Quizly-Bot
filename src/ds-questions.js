/** Verified data-structure exercises: 15 easy + 15 hard.
 * `code` is optional pseudocode, rendered separately from the question.
 * Arrays are zero-indexed where stated; queue/stack traces start empty.
 */
const entry = (level, q, a, code) => ({ topic: 'ds', level, q, a, ...(code ? { code } : {}) });
const easy = (q, a, code) => entry('easy', q, a, code);
const hard = (q, a, code) => entry('hard', q, a, code);

export const DS_QUESTIONS = Object.freeze([
    // Arrays and linked lists (3 easy / 3 hard)
    easy('What value is at index 2 in this zero-indexed array?', ['9'], 'a = [3, 6, 9, 12]\nprint(a[2])'),
    easy('What is the previous pointer of the head node in a non-circular doubly linked list?', ['null', 'nullptr', 'none', 'nil']),
    easy('Which linked-list type links its last node back to its first node?', ['circular linked list', 'circular', 'circular list']),
    hard('What is the worst-case time to insert at index 0 in a contiguous array of n items with spare capacity?', ['O(n)', 'n', 'linear']),
    hard('Given a pointer to a non-tail node in a singly linked list, what is the time to delete it by copying its successor’s data and bypassing that successor?', ['O(1)', 'constant', 'constant time']),
    hard('Which cycle-detection algorithm uses a slow pointer and a fast pointer in a linked list?', ['floyd', 'floyds algorithm', 'floyd cycle detection', 'tortoise and hare', 'floyd’s algorithm', "floyd's algorithm"]),

    // Stacks and queues (3 easy / 3 hard)
    easy('Starting with an empty stack, what does the final pop return?', ['30'], 'push(10)\npush(20)\npop()\npush(30)\npop()'),
    easy('Starting with an empty queue, which value is at the front after these operations?', ['7'], 'enqueue(4)\nenqueue(7)\ndequeue()'),
    easy('Which queue variant allows insertion and deletion at both ends?', ['deque', 'double ended queue', 'double-ended queue']),
    hard('What is the amortized time per queue operation when implemented using two stacks, transferring items only when the output stack is empty?', ['O(1)', 'constant', 'constant time']),
    hard('Evaluate this postfix expression. All operands are single-digit integers.', ['14'], '2 3 4 * +'),
    hard('A circular queue has capacity 5 and rear stores the next insertion index. If rear is 4, what is rear after one successful enqueue?', ['0', 'zero']),

    // Trees and BSTs (3 easy / 3 hard)
    easy('In a binary tree, what is the maximum number of children a node can have?', ['2', 'two']),
    easy('Which traversal visits the root before its left and right subtrees?', ['preorder', 'pre-order', 'pre order']),
    easy('Insert 8, then 3, then 10 into an empty BST. What is the left child of 8?', ['3', 'three']),
    hard('Insert these distinct keys into an empty BST. Give the inorder traversal.', ['1, 3, 6, 8, 10', '1 3 6 8 10', '1,3,6,8,10'], 'insert(8)\ninsert(3)\ninsert(10)\ninsert(1)\ninsert(6)'),
    hard('A full binary tree has 7 internal nodes, each with exactly two children. How many leaves does it have?', ['8', 'eight']),
    hard('For distinct keys, the inorder successor of a BST node with a right subtree is the minimum node in which subtree?', ['right', 'right subtree', 'its right subtree']),

    // Heaps and hashing (3 easy / 3 hard)
    easy('In a max-heap, which value is at the root: the smallest or the largest?', ['largest', 'maximum', 'max', 'the largest']),
    easy('With hash function h(k) = k mod 7, which bucket receives key 24?', ['3', 'three']),
    easy('What collision-resolution method stores a collection of entries in each hash bucket?', ['chaining', 'separate chaining']),
    hard('What is the time complexity of building a binary heap from n items using bottom-up heapify?', ['O(n)', 'n', 'linear']),
    hard('A hash table holds 18 entries in 24 buckets. What is its load factor?', ['0.75', '3/4', '.75']),
    hard('In a zero-indexed binary-heap array, what is the parent index of the node at index 10?', ['4', 'four']),

    // Graphs and traversal (3 easy / 3 hard)
    easy('In a simple undirected graph, the number of edges incident to a vertex is called its what?', ['degree', 'vertex degree']),
    easy('What is a graph whose edges have a direction called?', ['directed graph', 'directed', 'digraph']),
    easy('In an adjacency list, what does a vertex’s list contain?', ['neighbors', 'neighbours', 'adjacent vertices', 'neighboring vertices', 'neighbouring vertices']),
    hard('What is BFS time complexity using adjacency lists, visiting all V vertices and E edges?', ['O(V + E)', 'O(V+E)', 'V + E', 'V+E']),
    hard('Run BFS from A on this undirected graph, visiting neighbors alphabetically and marking them on enqueue. Give the visit order.', ['A B C D', 'A, B, C, D', 'A,B,C,D', 'ABCD'], 'A: B, C\nB: A, D\nC: A, D\nD: B, C'),
    hard('A topological ordering exists exactly when a directed graph contains no directed what?', ['cycle', 'cycles', 'directed cycle', 'directed cycles'])
]);
