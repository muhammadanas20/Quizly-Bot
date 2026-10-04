/**
 * src/coal-questions.js — the extended Computer Organisation & Assembly
 * Language bank (8086/x86 real mode, the language most COAL midterms use).
 *
 * Topic key stays `coal`, so `!game code [easy|hard] coal` and all the
 * existing `asm`/`assembly`/`registers` keywords keep working.
 *
 * ANSWER SAFETY
 * Every "what is in the register afterwards" card is executed by the tiny
 * 8/16-bit core at the top of this file: the question prints the operands and
 * the accepted answer is the value that core actually produced. Physical
 * addresses are computed the way the 8086 computes them (segment × 16 +
 * offset). Nothing is typed by hand twice.
 */

import { u8, u16, toHex } from './bank-tools.js';

const card = (sub, level, q, a, code) => ({ topic: 'coal', sub, level, q, a, ...(code ? { code } : {}) });
const easy = (sub, q, a, code) => card(sub, 'easy', q, a, code);
const hard = (sub, q, a, code) => card(sub, 'hard', q, a, code);
/** Every accepted spelling is stringified, so a stray number cannot slip in raw. */
const num = (sub, level, q, value, ...extra) => card(sub, level, q, [...new Set([String(value), ...extra.map(String)])]);

// ─── the tiny core the trace cards are executed on ───────────────────────────
const H2 = (v) => `${toHex(u8(v)).padStart(2, '0')}h`;
const H4 = (v) => `${toHex(u16(v)).padStart(4, '0')}h`;
const H5 = (v) => `${toHex(u16(v * 16)).padStart(5, '0')}h`;
const plain2 = (v) => H2(v).replace(/h$/, '');
const plain4 = (v) => H4(v).replace(/h$/, '');
const hexBoth4 = (v) => [H4(v), plain4(v)];

// The 8086 address bus is 20 bits wide, so a physical address must NOT be
// squeezed through the 16-bit register width (2000h:0010h is 20010h, not 0010h).
const u20 = (v) => ((v % 1048576) + 1048576) % 1048576;
const H5of = (seg, off) => u20(seg * 16 + off).toString(16).toUpperCase().padStart(5, '0') + 'h';

/** mov AX, start → <op> AX, operand, then report AX. */
const trace16 = (sub, op, start, operand, fn) => {
    const out = u16(fn(start, operand));
    return num(sub, 'hard',
        `MOV AX, ${H4(start)} runs, then ${op} AX, ${H4(operand)}. What is AX afterwards (hex)?`,
        ...hexBoth4(out),
        String(out));
};

export const COAL_QUESTIONS = Object.freeze([
    // ═══ 8086 architecture & registers ══════════════════════════════════════
    easy('arch', 'How many bits wide are the 8086 general-purpose registers?', ['16', 'sixteen', '16 bits']),
    easy('arch', 'Which four registers form the 8086 data group?', ['ax bx cx dx', 'ax, bx, cx, dx', 'a b c d']),
    easy('arch', 'Which two 8-bit halves make up BX?', ['bh and bl', 'bh bl', 'bh, bl']),
    easy('arch', 'Which register traditionally supplies the operand in I/O instructions?', ['ax', 'al', 'accumulator']),
    easy('arch', 'Which register is the destination in a multiplication by MUL?', ['ax', 'dx:ax', 'the accumulator']),
    easy('arch', 'Which register holds the address of the next instruction?', ['ip', 'instruction pointer']),
    easy('arch', 'Which register is the 8086 stack pointer?', ['sp', 'stack pointer']),
    easy('arch', 'Which register is the base pointer for stack frames?', ['bp', 'base pointer', 'frame pointer']),
    easy('arch', 'Which registers are the 8086 index registers?', ['si and di', 'si di', 'si, di', 'source and destination index']),
    easy('arch', 'Which segment register is used by default for the stack?', ['ss', 'stack segment']),
    easy('arch', 'Which segment register holds code?', ['cs', 'code segment']),
    easy('arch', 'Which segment register points at data by default?', ['ds', 'data segment']),
    easy('arch', 'Which segment register is the extra segment used by string operations?', ['es', 'extra segment']),
    easy('arch', 'How many segment registers does the 8086 have?', ['4', 'four']),
    easy('arch', 'Which register counts iterations in a LOOP instruction?', ['cx', 'the counter register']),
    easy('arch', 'How many bits wide is the 8086 address bus?', ['20', 'twenty', '20 bits']),
    easy('arch', 'How many bits wide is the 8086 data bus?', ['16', 'sixteen']),
    easy('arch', 'Which register pair holds the 32-bit result of MUL on a 16-bit operand?', ['dx:ax', 'dx ax', 'dx and ax']),
    easy('arch', 'What does SI traditionally point at in string operations?', ['source', 'the source', 'source string']),
    easy('arch', 'What does DI traditionally point at in string operations?', ['destination', 'the destination', 'destination string']),
    easy('arch', 'Which register is named the accumulator?', ['ax', 'al', 'ah']),
    easy('arch', 'Can AX be split into two byte registers?', ['yes', 'true']),
    hard('arch', 'What is the maximum memory the 8086 can address?', ['1 mb', '1mb', '1 megabyte', '1048576 bytes']),
    hard('arch', 'What is the size of one 8086 segment?', ['64 kb', '64kb', '65536 bytes', '2^16']),
    hard('arch', 'How many general-purpose registers does the 8086 have in its data and pointer groups?', ['8', 'eight']),
    hard('arch', 'Which two index registers may be combined with BX and BP in an effective address?', ['si and di', 'si di', 'si, di']),
    hard('arch', 'Which two registers can act as a base in a 16-bit effective address?', ['bx and bp', 'bx, bp', 'bx bp']),
    hard('arch', 'What is a register that holds data rather than an address called?', ['general purpose register', 'data register', 'general purpose']),
    hard('arch', 'Which flag register bit controls single-stepping in a debugger?', ['tf', 'trap flag']),
    hard('arch', 'Which register holds the flags in the 8086?', ['flags', 'flag register', 'psw', 'processor status word']),

    // ═══ Flags ═══════════════════════════════════════════════════════════════
    easy('flags', 'Which flag is set when the result of an operation is zero?', ['zf', 'zero flag']),
    easy('flags', 'Which flag records a carry out of the most significant bit?', ['cf', 'carry flag']),
    easy('flags', 'Which flag records a carry out of bit 3 into bit 4?', ['af', 'auxiliary carry', 'auxiliary carry flag']),
    easy('flags', 'Which flag records signed overflow?', ['of', 'overflow flag']),
    easy('flags', 'Which flag holds the sign bit of the result?', ['sf', 'sign flag']),
    easy('flags', 'Which flag is set when the result has an even number of 1 bits?', ['pf', 'parity flag']),
    easy('flags', 'Which flag controls whether string operations auto-increment or auto-decrement?', ['df', 'direction flag']),
    easy('flags', 'Which flag enables maskable interrupts?', ['if', 'interrupt flag']),
    easy('flags', 'How many flag bits does the 8086 define in its flag register?', ['9', 'nine']),
    easy('flags', 'CLD clears which flag?', ['df', 'direction flag']),
    easy('flags', 'STI sets which flag?', ['if', 'interrupt flag']),
    easy('flags', 'Which instruction sets the direction flag?', ['std']),
    hard('flags', 'After CMP AX, BX with AX equal to BX, which flag is set?', ['zf', 'zero flag']),
    hard('flags', 'Which flag does signed comparison use in addition to ZF and SF?', ['of', 'overflow flag']),
    hard('flags', 'Which flag does unsigned comparison use for "above" and "below"?', ['cf', 'carry flag']),
    hard('flags', 'Does INC change the carry flag?', ['no', 'false', 'it does not']),
    hard('flags', 'Does the AND instruction always clear CF and OF?', ['yes', 'true', 'it clears both']),
    hard('flags', 'Which flag is set when the low nibble carries in a BCD addition?', ['af', 'auxiliary carry']),
    hard('flags', 'Adding two positive numbers and getting a negative result sets which flag?', ['of', 'overflow flag']),
    hard('flags', 'Which conditional jump tests the parity flag?', ['jp', 'jpe']),
    hard('flags', 'What does the TEST instruction set flags from without storing a result?', ['and', 'a logical and', 'bitwise and']),
    hard('flags', 'Which instruction pushes the flags onto the stack?', ['pushf', 'pushf']),
    hard('flags', 'Which instruction pops the flags from the stack?', ['popf', 'popf']),
    hard('flags', 'When a subtraction produces a borrow, which flag is set?', ['cf', 'carry flag']),

    // ═══ Memory segmentation ═════════════════════════════════════════════════
    easy('memory', 'How does the 8086 form a physical address from a segment and an offset?', ['segment * 16 + offset', 'segment×16+offset', 'seg*16+off', '(segment × 16) + offset']),
    easy('memory', 'What do overlapping segments let one physical address have?', ['many logical addresses', 'several segment offsets', 'many representations']),
    easy('memory', 'What is a logical address written as?', ['segment:offset', 'segment: offset', 'seg:off']),
    easy('memory', 'How many bytes long is one paragraph in 8086 addressing?', ['16', 'sixteen']),
    easy('memory', 'Which part of a logical address selects the 64 KB window?', ['segment', 'the segment', 'segment register']),
    hard('memory', 'What is the highest physical address the 8086 can reach?', ['fffffh', 'fffff', '11111111111111111111b']),
    hard('memory', 'How many distinct segment values can a 16-bit segment register hold?', ['65536', '2^16']),
    hard('memory', 'Can two different segment:offset pairs name the same byte?', ['yes', 'true']),
    hard('memory', 'What is the offset range inside one segment?', ['0 to ffffh', '0000h to ffffh', '0-65535', '0 to 65535']),
    hard('memory', 'Which unit of memory does the 8086 read in one bus cycle?', ['word', 'a word', '16 bits', 'byte or word']),
    hard('memory', 'What is an unaligned word access an example of?', ['penalty', 'misaligned access', 'extra bus cycle']),
    num('memory', 'hard', 'In 8086, what physical address does segment 2000h, offset 0010h give?', H5of(0x2000, 0x0010)),
    num('memory', 'hard', 'In 8086, what physical address does segment 1234h, offset 0001h give?', H5of(0x1234, 0x0001)),
    num('memory', 'hard', 'In 8086, what physical address does segment 0abcch, offset 0014h give?', H5of(0x0abcc, 0x0014)),
    num('memory', 'hard', 'A byte sits at physical address 30050h. With segment 3000h, what is its offset (hex)?', '0050h', '50h', '50'),
    num('memory', 'hard', 'How many bytes are in a full 8086 segment?', 65536),
    num('memory', 'hard', 'Segment 4000h and offset 1000h land on which physical address?', H5of(0x4000, 0x1000)),

    // ═══ Addressing modes ════════════════════════════════════════════════════
    easy('addressing', 'Which addressing mode puts the operand right in the instruction?', ['immediate', 'immediate addressing', 'immediate mode']),
    easy('addressing', 'Which addressing mode takes the operand from a register?', ['register', 'register addressing', 'register mode']),
    easy('addressing', 'MOV AX, [BX] is which addressing mode?', ['register indirect', 'indirect', 'register-indirect']),
    easy('addressing', 'MOV AX, [1234h] is which mode when the address is in the instruction?', ['direct', 'direct addressing']),
    easy('addressing', 'MOV AX, BX is which addressing mode?', ['register', 'register addressing']),
    easy('addressing', 'MOV AX, 1234h is which addressing mode?', ['immediate', 'immediate addressing']),
    easy('addressing', 'MOV AX, [BX+SI] is which broad mode?', ['based indexed', 'based-indexed', 'base indexed']),
    easy('addressing', 'MOV AX, [BX+8] is which mode?', ['based', 'based addressing', 'base plus displacement']),
    easy('addressing', 'MOV AX, [SI+4] is which mode?', ['indexed', 'indexed addressing', 'index plus displacement']),
    easy('addressing', 'Which register must be used to hold the offset in register-indirect addressing besides BX, SI and DI?', ['bp', 'bp or si', 'bp si di bx']),
    easy('addressing', 'In MOV AX, [SI], what does SI hold?', ['offset', 'an offset', 'the offset', 'address']),
    hard('addressing', 'Which two displacement sizes can a based-indexed instruction encode?', ['8 bit or 16 bit', 'disp8 disp16', '8 or 16 bits']),
    hard('addressing', 'Which addressing mode is used by a jump table indexed with a register?', ['based indexed', 'indexed', 'register indirect']),
    num('addressing', 'hard', 'What is the effective address of MOV AX, [BX+SI+10] when BX=2000h and SI=0050h?', '2060h', '2060'),
    hard('addressing', 'Which two index registers can never appear together in one 16-bit effective address?', ['si and di', 'si, di', 'si di']),
    hard('addressing', 'What does the segment override prefix in MOV AX, ES:[BX] do?', ['changes the segment', 'uses ES instead of DS', 'chooses ES']),
    hard('addressing', 'On the 8086, which addressing mode does not need a segment register calculation?', ['immediate', 'register', 'register mode']),
    num('addressing', 'hard', 'In MOV AX, [BX+SI+20h] with BX=1000h and SI=0100h and DS=2000h, what physical address is read?', H5of(0x2000, 0x1000 + 0x0100 + 0x0020)),
    num('addressing', 'hard', 'In MOV AL, [BX] with BX=0140h and DS=3000h, what physical address is read?', H5of(0x3000, 0x0140)),
    num('addressing', 'hard', 'In MOV AX, [BP+6] with BP=0FF0h and SS=1000h, what physical address is read?', H5of(0x1000, 0x0ff0 + 6)),

    // ═══ Data transfer ═══════════════════════════════════════════════════════
    easy('transfer', 'Which instruction copies a value between registers or memory?', ['mov']),
    easy('transfer', 'Which instruction exchanges two operands?', ['xchg']),
    easy('transfer', 'Which instruction loads the offset of a variable instead of its contents?', ['lea']),
    easy('transfer', 'Can MOV copy directly from memory to memory?', ['no', 'false']),
    easy('transfer', 'Which instruction swaps the bytes of a 16-bit register?', ['xchg', 'bswap', 'xlat']),
    easy('transfer', 'Which instruction pushes a register onto the stack?', ['push']),
    easy('transfer', 'Which instruction removes a value from the stack into a register?', ['pop']),
    easy('transfer', 'Which instruction translates AL using a table pointed at by BX?', ['xlat', 'xlatb']),
    hard('transfer', 'LEA AX, [BX+2] puts what into AX?', ['the address', 'the effective address', 'offset', 'the offset']),
    hard('transfer', 'What is the difference between LEA and MOV with brackets?', ['lea loads the address', 'mov loads the data', 'lea gives address, mov gives data']),
    hard('transfer', 'Which instructions can read a far pointer into DS and a register?', ['lds', 'les']),
    hard('transfer', 'Which instruction loads ES and a register from a far pointer?', ['les']),
    hard('transfer', 'Which pair of instructions works with I/O ports under 256?', ['in and out', 'in out', 'in/out']),
    hard('transfer', 'Can MOV set CS directly?', ['no', 'false']),
    hard('transfer', 'What value is left in a register by XCHG of two equal values?', ['unchanged', 'the same', 'the same value']),
    hard('transfer', 'Which instruction pushes the flags register?', ['pushf']),
    hard('transfer', 'Which instruction copies a byte from a port into AL?', ['in al, dx', 'in', 'in al,dx']),
    hard('transfer', 'Which instruction can copy SP into AX?', ['mov ax, sp', 'mov']),
    hard('transfer', 'Why must PUSH SP be used carefully on the 8086?', ['it pushes the decremented value', 'it pushes the new sp', 'push sp stores the changed sp']),
    hard('transfer', 'What does POP into DS require the assembler to emit?', ['a prefix or special handling', 'segment handling', 'nothing special']),
    num('transfer', 'hard', 'After MOV AX, 4C21h and XCHG AH, AL, what is AX in hex?', H4(0x214c)),
    num('transfer', 'hard', 'With BX = 0200h and the byte at that offset equal to 41h, what is AL after MOV AL, [BX]?', H2(0x41)),

    // ═══ Arithmetic ══════════════════════════════════════════════════════════
    easy('arithmetic', 'Which instruction adds two operands without carry?', ['add']),
    easy('arithmetic', 'Which instruction adds with the incoming carry flag?', ['adc']),
    easy('arithmetic', 'Which instruction subtracts with borrow?', ['sbb']),
    easy('arithmetic', 'Which instruction subtracts without storing the result?', ['cmp']),
    easy('arithmetic', 'Which instruction negates an operand (two’s complement)?', ['neg']),
    easy('arithmetic', 'Which instruction multiplies unsigned bytes or words?', ['mul']),
    easy('arithmetic', 'Which instruction multiplies signed values?', ['imul']),
    easy('arithmetic', 'Which instruction divides unsigned values?', ['div']),
    easy('arithmetic', 'Which instruction divides signed values?', ['idiv']),
    easy('arithmetic', 'In MUL r/m8, where does the 16-bit product go?', ['ax', 'ax register']),
    easy('arithmetic', 'In MUL r/m16, where does the high half of the product go?', ['dx']),
    easy('arithmetic', 'What does CBW sign-extend?', ['al into ax', 'al to ax', 'al into ah']),
    easy('arithmetic', 'What does CWD sign-extend?', ['ax into dx', 'ax to dx:ax', 'ax into dx:ax']),
    hard('arithmetic', 'In DIV r/m8, which register holds the dividend?', ['ax']),
    hard('arithmetic', 'In DIV r/m8, which register receives the remainder?', ['ah']),
    hard('arithmetic', 'In DIV r/m16, which register holds the quotient?', ['ax']),
    hard('arithmetic', 'In DIV r/m16, which register receives the remainder?', ['dx']),
    hard('arithmetic', 'What happens if a DIV divisor is zero?', ['divide error', 'divide by zero interrupt', 'int 0', 'exception']),
    hard('arithmetic', 'What happens if a quotient does not fit its destination register?', ['divide error', 'overflow', 'exception']),
    hard('arithmetic', 'Which instruction adjusts AL after packed BCD addition?', ['daa']),
    hard('arithmetic', 'Which instruction adjusts AL after unpacked BCD addition?', ['aaa']),
    hard('arithmetic', 'Which instruction converts AX into an unpacked BCD string after division?', ['aam']),
    hard('arithmetic', 'Which two flags does MUL set based on whether the upper half is zero?', ['cf and of', 'cf of', 'carry and overflow']),
    hard('arithmetic', 'Which flag does INC leave untouched apart from AF?', ['cf', 'carry flag']),
    hard('arithmetic', 'How does a 32-bit add get built on a 16-bit CPU?', ['add then adc', 'add with adc', 'use adc for the high word']),
    ...[[0x1234, 0x0009], [0x0abc, 0x0111], [0x7fff, 0x0001], [0x00ff, 0x0001],
        [0x4321, 0x1234], [0xfffe, 0x0003], [0x5555, 0x2aaa], [0x1000, 0x0fff]]
        .map(([a, b]) => trace16('arithmetic', 'ADD', a, b, (x, y) => x + y)),
    ...[[0x5000, 0x0001], [0x0000, 0x0001], [0x4321, 0x0011], [0x8000, 0x0001]]
        .map(([a, b]) => trace16('arithmetic', 'SUB', a, b, (x, y) => x - y)),
    ...[[0x00ff, 0x0001], [0x7fff, 0x0001], [0xabcd, 0x0010], [0xffff, 0x0001]]
        .map(([a, b]) => num('arithmetic', 'hard',
            `The carry flag is already set. MOV AX, ${H4(a)} runs, then ADC AX, ${H4(b)}. What is AX afterwards (hex)?`,
            ...hexBoth4(a + b + 1), String(u16(a + b + 1)))),
    num('arithmetic', 'hard', 'MOV AL, 12h runs, then MUL BL with BL = 34h. What is AX in hex?', H4(0x12 * 0x34), plain4(0x12 * 0x34)),
    num('arithmetic', 'hard', 'MOV AL, 20h runs, then MUL BL with BL = 0Ah. What is AX in hex?', H4(0x20 * 0x0a), plain4(0x20 * 0x0a)),
    num('arithmetic', 'hard', 'MOV AL, 0FFh runs, then MUL BL with BL = 02h. What is AX in hex?', H4(0xff * 0x02), plain4(0xff * 0x02)),
    num('arithmetic', 'hard', 'MOV AX, 001Ah runs, then MOV BL, 04h, then DIV BL. What is AL in hex?', H2(Math.floor(0x1a / 4)), plain2(Math.floor(0x1a / 4))),
    num('arithmetic', 'hard', 'MOV AX, 001Ah runs, then MOV BL, 04h, then DIV BL. What is AH (the remainder) in hex?', H2(0x1a % 4), plain2(0x1a % 4)),
    num('arithmetic', 'hard', 'MOV AX, 0064h runs, then MOV BL, 0Ah, then DIV BL. What is AL in hex?', H2(Math.floor(0x64 / 10)), plain2(Math.floor(0x64 / 10))),
    num('arithmetic', 'hard', 'MOV AX, 0064h runs, then MOV BL, 0Ah, then DIV BL. What is AH (the remainder) in hex?', H2(0x64 % 10), plain2(0x64 % 10)),

    // ═══ Logic ═══════════════════════════════════════════════════════════════
    easy('logic', 'Which instruction performs a bitwise AND and stores the result?', ['and']),
    easy('logic', 'Which instruction performs a bitwise OR?', ['or']),
    easy('logic', 'Which instruction performs a bitwise exclusive OR?', ['xor']),
    easy('logic', 'Which instruction inverts every bit of its operand?', ['not']),
    easy('logic', 'Which instruction sets flags from an AND but stores nothing?', ['test']),
    easy('logic', 'What is the fastest way to clear a register?', ['xor ax, ax', 'xor reg, reg', 'xor ax,ax', 'sub ax, ax']),
    easy('logic', 'Which operation masks off bits you want to keep?', ['and', 'and with a mask']),
    easy('logic', 'Which operation turns specific bits on?', ['or', 'or with a mask']),
    easy('logic', 'Which operation toggles specific bits?', ['xor', 'xor with a mask']),
    hard('logic', 'What is AX after AND AX, 0000h?', ['0', 'zero', '0000h']),
    hard('logic', 'What does OR AX, AX accomplish?', ['flags only', 'sets flags from ax', 'no change to ax, sets flags']),
    hard('logic', 'Why does XOR reg, reg cost less than MOV reg, 0?', ['it does not fetch an immediate', 'shorter encoding', 'no immediate operand']),
    hard('logic', 'Which instruction tests a single bit without changing it?', ['test', 'bt']),
    hard('logic', 'Which instruction scans an operand for the first set bit?', ['bsf', 'bit scan forward']),
    hard('logic', 'What is AX after NOT AX when AX was 0000h?', ['ffffh', 'ffff']),
    hard('logic', 'What is the result of XOR with all ones equivalent to?', ['not', 'bitwise not']),
    hard('logic', 'Which instruction counts the set bits in an operand on later x86 chips?', ['popcnt']),
    ...[[0xf0f0, 0x00ff], [0x1234, 0x00ff], [0xaaaa, 0x5555], [0xffff, 0x000f]]
        .map(([a, b]) => trace16('logic', 'AND', a, b, (x, y) => x & y)),
    ...[[0x0f0f, 0x00f0], [0x1234, 0x8000], [0x0000, 0x0001]]
        .map(([a, b]) => trace16('logic', 'OR', a, b, (x, y) => x | y)),
    ...[[0xffff, 0x00ff], [0x1234, 0x00ff], [0xaaaa, 0xffff]]
        .map(([a, b]) => trace16('logic', 'XOR', a, b, (x, y) => x ^ y)),
    num('logic', 'hard', 'MOV AX, 000Fh runs, then NOT AX. What is AX in hex?', H4(~0x000f), plain4(~0x000f)),
    num('logic', 'hard', 'MOV AX, 0001h runs, then NEG AX. What is AX in hex?', H4(0xffff), plain4(0xffff)),

    // ═══ Shifts & rotates ════════════════════════════════════════════════════
    easy('shifts', 'Which instruction shifts left, filling with zeros?', ['shl', 'sal']),
    easy('shifts', 'Which instruction shifts right, filling with zeros?', ['shr']),
    easy('shifts', 'Which instruction shifts right, copying the sign bit?', ['sar']),
    easy('shifts', 'Which instruction rotates left through the carry flag?', ['rcl']),
    easy('shifts', 'Which instruction rotates right through the carry flag?', ['rcr']),
    easy('shifts', 'Which instruction rotates left without the carry?', ['rol']),
    easy('shifts', 'Which instruction rotates right without the carry?', ['ror']),
    easy('shifts', 'Which register holds the shift count when it is not an immediate?', ['cl']),
    easy('shifts', 'What does shifting a binary number left by one do to its value?', ['doubles', 'multiplies by 2', 'x2']),
    easy('shifts', 'What does shifting an unsigned number right by one do?', ['halves', 'divides by 2', '÷2']),
    hard('shifts', 'Which flag receives the last bit shifted out?', ['cf', 'carry flag']),
    hard('shifts', 'Why does SAR of a negative number round toward negative infinity?', ['it copies the sign bit', 'the sign bit fills in', 'sign extension']),
    hard('shifts', 'What is the difference between SHL and SAL on the 8086?', ['none', 'nothing', 'they are identical']),
    hard('shifts', 'What is AX after ROL AX, 1 when AX was 8001h?', ['0003h', '0003', '3h']),
    hard('shifts', 'Which instruction pair multiplies and divides by powers of two?', ['shl and shr', 'sal and sar', 'shift left and shift right']),
    hard('shifts', 'Can a shift by more than 31 happen on the 8086 with CL?', ['the count is taken modulo 32', 'yes it wraps', 'count is masked to 5 bits']),
    hard('shifts', 'Which rotate instruction moves the carry bit into the operand?', ['rcl', 'rcr']),
    ...[[0x0001, 1], [0x0001, 4], [0x00ff, 8], [0x000f, 4], [0x1234, 2]]
        .map(([a, b]) => trace16('shifts', 'SHL', a, b, (x, y) => x << y)),
    ...[[0xff00, 4], [0x1234, 4], [0x8000, 1], [0xffff, 8]]
        .map(([a, b]) => trace16('shifts', 'SHR', a, b, (x, y) => x >>> y)),
    ...[[0xff00, 4], [0x8000, 3], [0x4000, 2]]
        .map(([a, b]) => trace16('shifts', 'SAR', a, b, (x, y) => (x << 16 >> 16) >> y)),
    num('shifts', 'hard', 'MOV AX, 0009h runs, then ROL AX, 1. What is AX in hex?', H4((0x0009 << 1) | 0), plain4(0x0009 << 1)),
    num('shifts', 'hard', 'MOV AX, 8001h runs, then ROR AX, 1. What is AX in hex?', H4((0x8001 >>> 1) | (0x8001 << 15)), plain4((0x8001 >>> 1) | (0x8001 << 15))),
    num('shifts', 'hard', 'MOV AL, 02h runs, then SHL AL, 3. What is AL in decimal?', 2 * (2 ** 3)),

    // ═══ String instructions ═════════════════════════════════════════════════
    easy('strings', 'Which instruction moves a byte or word from DS:SI to ES:DI?', ['movs', 'movsb', 'movsw']),
    easy('strings', 'Which instruction compares two strings?', ['cmps', 'cmpsb', 'cmpsw']),
    easy('strings', 'Which instruction scans a string for a value in AL or AX?', ['scas', 'scasb', 'scasw']),
    easy('strings', 'Which instruction loads a byte from DS:SI into AL?', ['lods', 'lodsb', 'lodsw']),
    easy('strings', 'Which instruction stores AL or AX at ES:DI?', ['stos', 'stosb', 'stosw']),
    easy('strings', 'Which segment register does MOVSB read from by default?', ['ds']),
    easy('strings', 'Which segment register does MOVSB write to?', ['es']),
    easy('strings', 'Which REP prefix works with CMPS and SCAS to stop on a match?', ['repe', 'repz']),
    easy('strings', 'Which REP prefix stops when a comparison is equal?', ['repne', 'repnz']),
    hard('strings', 'Which register is decremented by MOVSB when DF is set?', ['si and di', 'si di', 'both']),
    hard('strings', 'What does CLD do before a forward MOVSB loop?', ['clears df', 'makes si and di increase', 'direction forward']),
    hard('strings', 'Which prefix repeats a string instruction CX times?', ['rep']),
    hard('strings', 'Which two registers does SCAS compare and update?', ['al and es:di', 'al, es:di', 'ax and es:di']),
    hard('strings', 'What does LODSB leave in AL?', ['the byte at ds:si', 'the byte', 'a byte from the source string']),
    hard('strings', 'Why must ES be set explicitly for MOVS?', ['there is no ES override', 'movs always writes to es', 'es cannot be overridden']),
    hard('strings', 'Which instruction stores a whole string with one prefix and a loop?', ['stosb', 'stos']),
    hard('strings', 'What happens to SI and DI when DF is 0?', ['they increment', 'increase', 'they increase']),
    hard('strings', 'How do you copy a string backwards?', ['set df with std', 'use std', 'std then movsb']),
    hard('strings', 'Which flag pair does CMPS set that REPE tests?', ['zf', 'zero flag']),
    num('strings', 'hard', 'MOVSB runs once with SI=0100h and DF=0. What is SI now (hex)?', '0101h', '101h', '101'),
    num('strings', 'hard', 'MOVSW runs once with DI=0200h and DF=1. What is DI now (hex)?', '01FEh', '1feh', '1FE'),

    // ═══ Control transfer ════════════════════════════════════════════════════
    easy('control', 'Which instruction jumps unconditionally?', ['jmp']),
    easy('control', 'Which jump runs when the zero flag is set?', ['jz', 'je']),
    easy('control', 'Which jump runs when the zero flag is clear?', ['jnz', 'jne']),
    easy('control', 'Which jump runs when the carry flag is set?', ['jc', 'jb', 'jnae']),
    easy('control', 'Which jump tests for signed less-than?', ['jl', 'jnge']),
    easy('control', 'Which instruction calls a procedure?', ['call']),
    easy('control', 'Which instruction returns from a procedure?', ['ret']),
    easy('control', 'Which instruction decrements CX and jumps while it is not zero?', ['loop']),
    easy('control', 'Which jump is used after CMP for unsigned "below"?', ['jb', 'jc']),
    easy('control', 'Which jump is used after CMP for signed "greater or equal"?', ['jge', 'jnl']),
    hard('control', 'What does LOOP do when CX is already zero?', ['falls through', 'decrements to ffffh and jumps', 'it jumps']),
    hard('control', 'What is the difference between LOOPE and LOOPNE?', ['zero flag is tested', 'loop tests zf', 'one stops on equal the other on not equal']),
    hard('control', 'How far can a short conditional jump reach?', ['-128 to +127', '-128..127', 'one byte displacement']),
    hard('control', 'Which jump class can reach anywhere in the segment?', ['near', 'near jump']),
    hard('control', 'What is the difference between a near and a far CALL?', ['far saves CS too', 'far pushes cs as well', 'near stays in segment']),
    hard('control', 'Which jump is taken when the sign flag differs from the overflow flag?', ['jl', 'jnge']),
    hard('control', 'Which jump tests CF=0 and ZF=0 for unsigned greater?', ['ja', 'jnbe']),
    hard('control', 'What does JCXZ do?', ['jumps if cx is zero', 'jump if cx zero', 'tests cx']),
    hard('control', 'Which instruction jumps to the address held in a register or memory operand?', ['jmp', 'call', 'indirect jump']),
    hard('control', 'Which flag combination makes JBE true?', ['cf=1 or zf=1', 'cf or zf', 'carry or zero']),

    // ═══ Stack & procedures ══════════════════════════════════════════════════
    easy('stack', 'Which direction does the 8086 stack grow?', ['down', 'downwards', 'toward lower addresses']),
    easy('stack', 'Which register points at the top of the stack?', ['sp']),
    easy('stack', 'Which register does SP point at after a PUSH?', ['the new top', 'decremented address', 'the new top of stack']),
    easy('stack', 'Which register pair does a far CALL push?', ['cs and ip', 'cs ip', 'cs:ip']),
    easy('stack', 'What does CALL push for a near call?', ['ip', 'the instruction pointer', 'return address']),
    easy('stack', 'What does RET pop?', ['ip', 'return address']),
    easy('stack', 'Which instruction sets up a stack frame pointer?', ['mov bp, sp', 'push bp then mov bp, sp', 'push bp / mov bp, sp']),
    easy('stack', 'What must SP be restored to after a procedure that pushed registers?', ['its entry value', 'the saved value', 'its original value']),
    hard('stack', 'In what order are the return address and BP saved in a standard frame?', ['return address then bp', 'ip then bp', 'caller frame first']),
    hard('stack', 'How are local variables usually addressed in a stack frame?', ['[bp-n]', 'bp minus offset', 'negative offsets from bp']),
    hard('stack', 'How are incoming arguments addressed after a far call?', ['[bp+n]', 'bp plus offset', 'positive offsets from bp']),
    hard('stack', 'What is the purpose of the LEAVE instruction?', ['restore sp and bp', 'undo the frame', 'mov sp, bp then pop bp']),
    hard('stack', 'What does PUSHA push?', ['all general registers', 'ax bx cx dx bx bp si di', 'the general purpose registers']),
    hard('stack', 'What does RET n do after popping the return address?', ['adds n to sp', 'pops n bytes', 'discards arguments']),
    hard('stack', 'Besides IP, which register does a far RET restore?', ['cs', 'code segment']),
    hard('stack', 'What is recursion’s memory cost per call on this CPU?', ['one frame on the stack', 'a stack frame', 'frame']),
    hard('stack', 'What happens when too many pushes exceed the stack segment?', ['stack overflow', 'wrap or fault', 'data corruption']),
    num('stack', 'hard', 'SP is 2000h and one PUSH AX runs. What is SP now (hex)?', '1FFEh', '1ffe', '1FFE'),
    num('stack', 'hard', 'SP is 1FF0h, then PUSH AX runs, then POP AX runs. What is SP now (hex)?', '1FF0h', '1ff0'),

    // ═══ Interrupts & DOS/BIOS services ══════════════════════════════════════
    easy('interrupts', 'Which interrupt is the main DOS services entry point?', ['int 21h', '21h']),
    easy('interrupts', 'Which interrupt controls BIOS video services?', ['int 10h', '10h']),
    easy('interrupts', 'Which register selects the DOS function?', ['ah']),
    easy('interrupts', 'Which DOS function terminates the program?', ['4ch', 'int 21h ah=4ch', 'ah=4ch']),
    easy('interrupts', 'Which interrupt is the divide-error exception?', ['0', 'int 0', 'type 0']),
    easy('interrupts', 'Where does the interrupt vector table live?', ['00000h', 'at the start of memory', 'first 1024 bytes']),
    easy('interrupts', 'How many bytes does one interrupt vector occupy?', ['4', 'four']),
    easy('interrupts', 'How many interrupts does the 8086 vector table hold?', ['256', '256 vectors']),
    easy('interrupts', 'Which instruction always forces a software interrupt?', ['int']),
    easy('interrupts', 'Which register does DOS function 02h print a character from?', ['dl']),
    hard('interrupts', 'What does INT 21h with AH=09h print?', ['a $ terminated string', 'string ending in $', 'dx string']),
    hard('interrupts', 'Which register points at the string for DOS function 09h?', ['dx']),
    hard('interrupts', 'Which DOS function reads a character without echo?', ['07h', '7', 'ah=07h']),
    hard('interrupts', 'Which DOS function reads a buffered string from the keyboard?', ['0ah', '10', 'ah=0ah']),
    hard('interrupts', 'What does an interrupt push before jumping to the handler?', ['flags, cs and ip', 'flags cs ip', 'the machine state']),
    hard('interrupts', 'Which instruction returns from an interrupt handler?', ['iret']),
    hard('interrupts', 'Which signals can pass through the 8086 INTR pin?', ['maskable interrupts', 'maskable']),
    hard('interrupts', 'Which interrupts ignore the interrupt flag?', ['nmi', 'non-maskable', 'non maskable interrupts']),
    hard('interrupts', 'What is the purpose of the 8259 interrupt controller?', ['manage interrupt priorities', 'prioritise interrupts', 'priority controller']),
    hard('interrupts', 'Which BIOS interrupt reads a key with echo?', ['int 16h', '16h']),
    hard('interrupts', 'What does DOS function 4Ch return control to?', ['the operating system', 'dos', 'the command prompt']),
    num('interrupts', 'hard', 'Which vector address holds interrupt 21h in the vector table (hex)?', '00084h', '84h', '084h'),

    // ═══ Assembler & program structure ═══════════════════════════════════════
    easy('assembler', 'Which directive reserves a byte?', ['db']),
    easy('assembler', 'Which directive reserves a word?', ['dw']),
    easy('assembler', 'Which directive reserves a doubleword?', ['dd']),
    easy('assembler', 'Which directive defines a constant value?', ['equ']),
    easy('assembler', 'Which directive sets the location counter?', ['org']),
    easy('assembler', 'Which directive ends the source file?', ['end']),
    easy('assembler', 'Which directive starts a logical code block?', ['segment']),
    easy('assembler', 'Which pair of directives wraps a procedure?', ['proc and endp', 'proc endp', 'proc/endp']),
    easy('assembler', 'What does the ASSUME directive tell the assembler?', ['segment register mapping', 'which segment is which', 'segment roles']),
    hard('assembler', 'Which directive repeats a block of source lines?', ['macro']),
    hard('assembler', 'What does the DUP operator do in a data directive?', ['repeats a value', 'duplicates the value', 'repeats initialisation']),
    hard('assembler', 'What does the OFFSET operator return?', ['the offset', 'address offset', 'offset of a label']),
    hard('assembler', 'Which directive declares an external symbol?', ['extern', 'extrn']),
    hard('assembler', 'Which directive makes a label visible to other modules?', ['public', 'global']),
    hard('assembler', 'What does the PTR operator do?', ['sets the operand size', 'specifies size', 'declares operand type']),
    hard('assembler', 'What is the difference between a label and a variable in assembly?', ['label marks an address', 'labels are addresses', 'a label names code or data']),
    hard('assembler', 'What does the LENGTHOF operator give in MASM?', ['number of elements', 'element count']),
    hard('assembler', 'What does the $ symbol mean in an expression?', ['current location counter', 'here', 'the current address']),
    hard('assembler', 'What does the EVEN directive do?', ['aligns to word boundary', 'align on even address', 'word alignment']),
    hard('assembler', 'In the MASM model directive, what does SMALL select?', ['one code and one data segment', 'small model', 'single segment each']),
    num('assembler', 'hard', 'A DW directive holds how many bytes?', 2),
    num('assembler', 'hard', 'A DD directive holds how many bytes?', 4),
    num('assembler', 'hard', 'A DB directive holds how many bits?', 8),

    // ═══ Instruction encoding & misc ═════════════════════════════════════════
    hard('encoding', 'What is the byte following the opcode in most 8086 instructions called?', ['modrm', 'mod-reg-r/m', 'mod reg r/m byte']),
    hard('encoding', 'Which field of the ModR/M byte selects a register or memory form?', ['mod', 'the mod field']),
    hard('encoding', 'How many bytes does MOV AX, [BX+SI+1234h] occupy?', ['4', 'four']),
    hard('encoding', 'How many bytes does MOV AX, BX occupy?', ['2', 'two']),
    hard('encoding', 'How many bytes does a short conditional jump occupy?', ['2', 'two']),
    hard('encoding', 'What does an operand-size prefix 66h switch on a later x86 CPU?', ['16 and 32 bit sizes', 'operand size', 'between word and dword']),
    hard('encoding', 'What does a segment override prefix change?', ['the default segment', 'the segment register used', 'segment choice']),
    hard('encoding', 'Which register-memory direction bit selects whether the register is source or destination?', ['d', 'direction bit']),
    hard('encoding', 'What is the encoding of the two-operand ADD r/m16, r16 direction?', ['01', '01 /r', 'opcode 01']),
    hard('encoding', 'Which table holds the microcode for complex 8086 instructions?', ['microcode rom', 'control store', 'pla']),
    num('encoding', 'hard', 'MOV AX, BX is how many bytes long (opcode plus ModR/M)?', 2),
    num('encoding', 'hard', 'MOV AX, 1234h is how many bytes long (opcode plus immediate word)?', 3),
]);
