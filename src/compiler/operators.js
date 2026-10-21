/**
 * Operator to instruction mapping tables used by the compiler.
 */

export const BINARY_OPERATORS = Object.freeze(
  new Map([
    ['+', 'js.add'],
    ['-', 'js.sub'],
    ['*', 'js.mul'],
    ['/', 'js.div'],
    ['%', 'js.rem'],
    ['===', 'js.strict_eq'],
    ['!==', 'js.strict_ne'],
    ['==', 'js.eq'],
    ['!=', 'js.ne'],
    ['&', 'js.bit_and'],
    ['|', 'js.bit_or'],
    ['^', 'js.bit_xor'],
    ['<<', 'js.shl'],
    ['>>', 'js.shr'],
    ['>>>', 'js.ushr'],
    ['in', 'js.in'],
    ['instanceof', 'js.instanceof'],
    ['<', 'js.lt'],
    ['<=', 'js.le'],
    ['>', 'js.gt'],
    ['>=', 'js.ge'],
  ]),
);

export const UNARY_OPERATORS = Object.freeze(
  new Map([
    ['+', 'js.pos'],
    ['~', 'js.bit_not'],
    ['typeof', 'js.typeof'],
    ['void', 'js.void'],
    ['-', 'js.neg'],
    ['!', 'js.not'],
  ]),
);

export const ASSIGNMENT_OPERATORS = Object.freeze(
  new Map([
    ['&=', 'js.bit_and'],
    ['|=', 'js.bit_or'],
    ['^=', 'js.bit_xor'],
    ['<<=', 'js.shl'],
    ['>>=', 'js.shr'],
    ['>>>=', 'js.ushr'],
    ['+=', 'js.add'],
    ['-=', 'js.sub'],
    ['*=', 'js.mul'],
    ['/=', 'js.div'],
    ['%=', 'js.rem'],
  ]),
);
