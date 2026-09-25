/**
 * src/banks.js — built-in concept question banks for !game math and !game code.
 *
 * Every entry: { q, a:[accepted answers], level:'easy'|'hard', topic }.
 * Answers are short and unambiguous so they can be typed in a chat.
 * These are permanent; the AI pools in game-content.js add to them.
 */

const E = 'easy', H = 'hard';
const q = (topic, level, question, ...a) => ({ q: question, a, level, topic });

// ─── Maths: linear algebra, calculus, multivariable calculus ────────────────
export const MATH_TOPICS = Object.freeze(['linear', 'calculus', 'mvc']);

export const MATH_BANK = Object.freeze([
    // linear algebra — easy
    q('linear', E, 'What is the determinant of the 2×2 matrix [[2, 1], [3, 4]]?', '5'),
    q('linear', E, 'What is the determinant of the identity matrix I₃?', '1'),
    q('linear', E, 'A 3×2 matrix times a 2×4 matrix gives a matrix of what size?', '3x4', '3×4', '3 by 4'),
    q('linear', E, 'What is the dot product of (1, 2, 3) and (4, 5, 6)?', '32'),
    q('linear', E, 'What is the transpose of a row vector called?', 'column vector', 'a column vector'),
    q('linear', E, 'What is the trace of [[5, 2], [7, 3]]?', '8'),
    q('linear', E, 'A square matrix with determinant 0 is called?', 'singular', 'singular matrix'),
    q('linear', E, 'What is the dimension of the vector space R⁴?', '4', 'four'),
    q('linear', E, 'What is the magnitude of the vector (3, 4)?', '5'),
    q('linear', E, 'Two vectors whose dot product is 0 are called?', 'orthogonal', 'perpendicular'),
    q('linear', E, 'A matrix equal to its own transpose is called?', 'symmetric', 'symmetric matrix'),
    q('linear', E, 'What is the rank of the 3×3 zero matrix?', '0', 'zero'),
    q('linear', E, 'What is the determinant of [[4, 0], [0, 3]]?', '12'),
    q('linear', E, 'How many vectors are in a basis of R³?', '3', 'three'),
    q('linear', E, 'The set of all linear combinations of some vectors is called their?', 'span'),
    // linear algebra — hard
    q('linear', H, 'What is the determinant of [[1, 2, 3], [0, 4, 5], [0, 0, 6]]?', '24'),
    q('linear', H, 'What are the eigenvalues of [[2, 0], [0, 7]]? (smaller first, comma separated)', '2,7', '2, 7', '2 and 7'),
    q('linear', H, 'What is the largest eigenvalue of [[4, 1], [2, 3]]?', '5'),
    q('linear', H, 'By the rank–nullity theorem, a 5×7 matrix with rank 3 has nullity?', '4'),
    q('linear', H, 'If det(A) = 3 for a 3×3 matrix A, what is det(2A)?', '24'),
    q('linear', H, 'If det(A) = 4, what is det(A⁻¹)?', '1/4', '0.25'),
    q('linear', H, 'What is the dimension of the space of all 2×3 real matrices?', '6', 'six'),
    q('linear', H, 'What is the dimension of the space of polynomials of degree at most 3?', '4', 'four'),
    q('linear', H, 'A square matrix Q with QᵀQ = I is called?', 'orthogonal', 'orthogonal matrix'),
    q('linear', H, 'The null space of a matrix is also called its?', 'kernel'),
    q('linear', H, 'What is the rank of [[1, 2], [2, 4]]?', '1', 'one'),
    q('linear', H, 'Cross product (1, 0, 0) × (0, 1, 0) equals which vector?', '(0,0,1)', '0,0,1', 'k'),
    q('linear', H, 'The product of all eigenvalues of a matrix equals its?', 'determinant'),
    q('linear', H, 'The sum of all eigenvalues of a matrix equals its?', 'trace'),
    q('linear', H, 'Which process turns a basis into an orthonormal basis?', 'gram schmidt', 'gram-schmidt'),
    // calculus — easy
    q('calculus', E, 'What is the derivative of x³?', '3x^2', '3x²', '3x2'),
    q('calculus', E, 'What is the derivative of sin x?', 'cos x', 'cosx', 'cos(x)'),
    q('calculus', E, 'What is the derivative of eˣ?', 'e^x', 'ex', 'eˣ'),
    q('calculus', E, 'What is the derivative of ln x?', '1/x'),
    q('calculus', E, 'What is the integral of 2x dx (ignore the constant)?', 'x^2', 'x²', 'x2'),
    q('calculus', E, 'What is lim (x→0) sin(x)/x?', '1'),
    q('calculus', E, 'What is the derivative of a constant?', '0', 'zero'),
    q('calculus', E, 'What is the derivative of cos x?', '-sin x', '-sinx', '-sin(x)'),
    q('calculus', E, 'What is ∫₀¹ 3x² dx?', '1'),
    q('calculus', E, 'What is the slope of y = 7x + 2?', '7'),
    // calculus — hard
    q('calculus', H, 'What is lim (x→∞) (1 + 1/x)ˣ?', 'e'),
    q('calculus', H, 'What is the derivative of tan x?', 'sec^2 x', 'sec²x', 'sec^2x', 'sec2x'),
    q('calculus', H, 'What is ∫ 1/x dx (ignore the constant)?', 'ln x', 'ln|x|', 'lnx'),
    q('calculus', H, 'What is ∫₀^π sin x dx?', '2'),
    q('calculus', H, 'What is the second derivative of x⁴ at x = 1?', '12'),
    q('calculus', H, 'Which rule differentiates f(g(x))?', 'chain rule', 'chain'),
    q('calculus', H, 'Which rule evaluates limits of the form 0/0 using derivatives?', "l'hopital", 'lhopital', "l'hôpital", "l'hopital's rule"),
    q('calculus', H, 'What is the derivative of x·ln x?', 'ln x + 1', 'lnx+1', '1+ln x'),
    q('calculus', H, 'What is the Maclaurin series coefficient of x² in eˣ?', '1/2', '0.5'),
    q('calculus', H, 'What is ∫₀^∞ e^(−x) dx?', '1'),
    // multivariable calculus — easy
    q('mvc', E, 'For f(x, y) = x²y, what is ∂f/∂y?', 'x^2', 'x²', 'x2'),
    q('mvc', E, 'For f(x, y) = 3x + 5y, what is ∂f/∂x?', '3'),
    q('mvc', E, 'The vector of all first partial derivatives is called the?', 'gradient'),
    q('mvc', E, 'Which symbol denotes the gradient operator?', '∇', 'nabla', 'del'),
    q('mvc', E, 'For f(x, y) = xy, what is ∂f/∂x?', 'y'),
    q('mvc', E, 'A double integral over a region with integrand 1 gives the region’s?', 'area'),
    // multivariable calculus — hard
    q('mvc', H, 'For f(x, y) = x²y³, what is ∂²f/∂x∂y?', '6xy^2', '6xy²', '6xy2'),
    q('mvc', H, 'What is the divergence of F = (x, y, z)?', '3'),
    q('mvc', H, 'What is the curl of a gradient field?', '0', 'zero', 'zero vector'),
    q('mvc', H, 'Which theorem relates a line integral around a closed curve to a double integral over the plane region?', "green's theorem", 'green', 'greens theorem'),
    q('mvc', H, 'Which theorem relates flux through a closed surface to the volume integral of divergence?', 'divergence theorem', "gauss's theorem", 'gauss'),
    q('mvc', H, 'The matrix of second partial derivatives is called the?', 'hessian', 'hessian matrix'),
    q('mvc', H, 'The Jacobian determinant for polar coordinates (dx dy = ? dr dθ) is?', 'r'),
    q('mvc', H, 'For f(x, y) = x² + y², what is the gradient at (1, 2)?', '(2,4)', '2,4', '<2,4>'),
    q('mvc', H, 'What is ∬ over [0,1]×[0,2] of 1 dA?', '2'),
    q('mvc', H, 'Which theorem relates a surface integral of curl to a line integral around its boundary?', "stokes theorem", "stokes", "stokes' theorem")
]);

// ─── Programming: PF, OOP, data structures, COAL (assembly + registers) ─────
export const CODE_TOPICS = Object.freeze(['pf', 'oop', 'ds', 'coal']);

export const CODE_BANK = Object.freeze([
    // programming fundamentals — easy
    q('pf', E, 'In C/C++, which operator gives the remainder of a division?', '%', 'modulus', 'mod'),
    q('pf', E, 'In C++, what is the index of the first element of an array?', '0', 'zero'),
    q('pf', E, 'Which loop always runs its body at least once?', 'do while', 'do-while', 'do while loop'),
    q('pf', E, 'In C++, what is the value of 7 / 2 when both are int?', '3'),
    q('pf', E, 'Which keyword exits a loop immediately?', 'break'),
    q('pf', E, 'Which keyword skips to the next loop iteration?', 'continue'),
    q('pf', E, 'What does a variable of type bool store?', 'true or false', 'true/false', 'boolean'),
    q('pf', E, 'In C++, which header gives you cout and cin?', 'iostream', '<iostream>'),
    q('pf', E, 'A function that calls itself is called?', 'recursive', 'recursion', 'recursive function'),
    q('pf', E, 'What is the result of 5 == 5 in C++ (as an int)?', '1', 'true'),
    // programming fundamentals — hard
    q('pf', H, 'In C++, what does sizeof(char) always return?', '1'),
    q('pf', H, 'What is printed by: int x = 5; cout << x++ << x;', '56'),
    q('pf', H, 'In C, what is the value of 10 >> 1?', '5'),
    q('pf', H, 'What is 6 & 3 (bitwise AND)?', '2'),
    q('pf', H, 'What is 6 ^ 3 (bitwise XOR)?', '5'),
    q('pf', H, 'A variable declared static inside a function keeps its value between calls. True or false?', 'true'),
    q('pf', H, 'In C++, what is passing a variable with & in the parameter list called?', 'pass by reference', 'by reference', 'call by reference'),
    q('pf', H, 'What does a dangling pointer point to?', 'freed memory', 'deallocated memory', 'invalid memory'),
    // OOP — easy
    q('oop', E, 'An instance of a class is called an?', 'object'),
    q('oop', E, 'Which OOP principle hides data behind methods?', 'encapsulation'),
    q('oop', E, 'A class acquiring members of another class is called?', 'inheritance'),
    q('oop', E, 'Which special member function runs when an object is created?', 'constructor'),
    q('oop', E, 'Which special member function runs when an object is destroyed?', 'destructor'),
    q('oop', E, 'In C++, which access specifier is the default for a class?', 'private'),
    q('oop', E, 'Same function name with different parameter lists is called function?', 'overloading'),
    // OOP — hard
    q('oop', H, 'In C++, which keyword enables run-time polymorphism?', 'virtual'),
    q('oop', H, 'A class with at least one pure virtual function is called?', 'abstract', 'abstract class'),
    q('oop', H, 'In C++, which pointer inside a member function points to the calling object?', 'this'),
    q('oop', H, 'Redefining a base-class virtual function in a derived class is called?', 'overriding', 'function overriding', 'method overriding'),
    q('oop', H, 'Which problem does virtual inheritance solve in C++?', 'diamond problem', 'diamond'),
    q('oop', H, 'Which constructor makes a new object from an existing object of the same class?', 'copy constructor', 'copy'),
    q('oop', H, 'A "has-a" relationship where the part cannot exist without the whole is called?', 'composition'),
    q('oop', H, 'Which C++ keyword lets a non-member function access private members?', 'friend'),
    // data structures — easy
    q('ds', E, 'Which data structure follows LIFO?', 'stack'),
    q('ds', E, 'Which data structure follows FIFO?', 'queue'),
    q('ds', E, 'What is the time complexity of binary search?', 'O(log n)', 'log n', 'logn'),
    q('ds', E, 'Accessing an array element by index takes what time complexity?', 'O(1)', 'constant'),
    q('ds', E, 'Which stack operation adds an element?', 'push'),
    q('ds', E, 'In a linked list, each node stores data and a?', 'pointer', 'next pointer', 'link'),
    q('ds', E, 'The topmost node of a tree is called the?', 'root'),
    q('ds', E, 'A tree node with no children is called a?', 'leaf', 'leaf node'),
    // data structures — hard
    q('ds', H, 'What is the average time complexity of quicksort?', 'O(n log n)', 'n log n', 'nlogn'),
    q('ds', H, 'What is the worst-case time complexity of quicksort?', 'O(n^2)', 'n^2', 'n2', 'O(n²)'),
    q('ds', H, 'Which traversal of a BST visits keys in sorted order?', 'inorder', 'in-order', 'in order'),
    q('ds', H, 'What is the maximum number of nodes in a binary tree of height 3 (root at height 0)?', '15'),
    q('ds', H, 'Which data structure is used for BFS?', 'queue'),
    q('ds', H, 'Which data structure is used by DFS (iterative) and function calls?', 'stack'),
    q('ds', H, 'In a min-heap, where is the smallest element?', 'root', 'at the root'),
    q('ds', H, 'What is the worst-case search time in an unbalanced BST?', 'O(n)', 'n'),
    q('ds', H, 'Which self-balancing BST keeps balance factors in {−1, 0, 1}?', 'avl', 'avl tree'),
    q('ds', H, 'Two keys mapping to the same hash slot is called a?', 'collision'),
    // COAL — easy (8086 assembly and registers)
    q('coal', E, 'In 8086, which register is the accumulator?', 'ax', 'al', 'eax'),
    q('coal', E, 'In 8086, which register is used as the counter by LOOP?', 'cx', 'ecx'),
    q('coal', E, 'How many bits wide is an 8086 general-purpose register?', '16'),
    q('coal', E, 'Which instruction copies data from source to destination?', 'mov'),
    q('coal', E, 'Which register holds the address of the next instruction in 8086?', 'ip', 'instruction pointer'),
    q('coal', E, 'Which flag is set when a result is zero?', 'zf', 'zero flag'),
    q('coal', E, 'Which register points to the top of the stack?', 'sp', 'stack pointer', 'esp'),
    q('coal', E, 'The high byte of AX is called?', 'ah'),
    q('coal', E, 'Which instruction pushes a value onto the stack?', 'push'),
    q('coal', E, 'In assembly, which instruction adds 1 to a register?', 'inc'),
    // COAL — hard
    q('coal', H, 'Which flag is set when unsigned addition produces a carry out?', 'cf', 'carry flag'),
    q('coal', H, 'Which flag is set when signed arithmetic overflows?', 'of', 'overflow flag'),
    q('coal', H, 'In 8086, what physical address does segment 1000h offset 0020h give?', '10020h', '10020'),
    q('coal', H, 'After MOV AL, 0FFh and INC AL, what is AL?', '0', '00h', '0h'),
    q('coal', H, 'Which instruction returns from a procedure called with CALL?', 'ret'),
    q('coal', H, 'After MOV AX, 8 and SHL AX, 1, what is AX (decimal)?', '16'),
    q('coal', H, 'Which DOS interrupt is used for most services like printing a string?', 'int 21h', '21h', 'int21h'),
    q('coal', H, 'With INT 21h, which AH value prints a $-terminated string?', '9', '09h', '09'),
    q('coal', H, 'Which conditional jump jumps if the zero flag is set?', 'jz', 'je'),
    q('coal', H, 'Which register is used with DI as destination in string instructions (segment)?', 'es', 'extra segment'),
    q('coal', H, 'What does XOR AX, AX leave in AX?', '0', 'zero'),
    q('coal', H, 'Which register is the base pointer used for stack frames?', 'bp', 'ebp', 'base pointer'),
    q('coal', H, 'In MUL BL, the 16-bit product is stored in which register?', 'ax'),
    q('coal', H, 'Which addressing mode is used in MOV AX, [BX]?', 'register indirect', 'indirect')
]);

/** Parse a topic keyword typed after !game math / !game code. */
export function parseTopic(args, kind) {
    const words = (args || []).map((w) => String(w).toLowerCase());
    const map = kind === 'math'
        ? { linear: 'linear', la: 'linear', matrix: 'linear', matrices: 'linear', vector: 'linear', vectors: 'linear',
            calc: 'calculus', calculus: 'calculus', mvc: 'mvc', multivariable: 'mvc', multi: 'mvc',
            arith: 'arithmetic', arithmetic: 'arithmetic', sums: 'arithmetic' }
        : { pf: 'pf', fundamentals: 'pf', basics: 'pf', oop: 'oop', ds: 'ds', dsa: 'ds', data: 'ds',
            coal: 'coal', asm: 'coal', assembly: 'coal', registers: 'coal', register: 'coal' };
    for (const w of words) if (map[w]) return map[w];
    return null;
}
