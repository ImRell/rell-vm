import test from 'node:test';
import assert from 'node:assert/strict';
import {
  binaryOperation,
  unaryOperation,
} from '../src/runtime/es5-operators.js';
const values = [
  undefined,
  null,
  false,
  true,
  -0,
  0,
  1,
  -1,
  NaN,
  Infinity,
  4294967297,
  '',
  '1',
  '2.5',
  'text',
  1n,
  9007199254740993n,
  Symbol('s'),
  {},
  [],
  [1],
];
function result(operation) {
  try {
    return { value: operation() };
  } catch (error) {
    return { error: error.name };
  }
}
const binaries = [
  ['+', 'add'],
  ['-', 'sub'],
  ['*', 'mul'],
  ['/', 'div'],
  ['%', 'rem'],
  ['===', 'strict_eq'],
  ['!==', 'strict_ne'],
  ['==', 'eq'],
  ['!=', 'ne'],
  ['<', 'lt'],
  ['<=', 'le'],
  ['>', 'gt'],
  ['>=', 'ge'],
  ['&', 'bit_and'],
  ['|', 'bit_or'],
  ['^', 'bit_xor'],
  ['<<', 'shl'],
  ['>>', 'shr'],
  ['>>>', 'ushr'],
  ['in', 'in'],
  ['instanceof', 'instanceof'],
];
for (const [operator, name] of binaries)
  test('native matrix: ' + operator, () => {
    // Native Function is only a test oracle, never compiler/runtime implementation.
    const native = Function('a', 'b', `return a ${operator} b;`);
    for (let i = 0; i < values.length; i++)
      for (let j = 0; j < values.length; j++) {
        const actual = result(() =>
          binaryOperation('js.' + name, values[i], values[j]),
        );
        const expected = result(() => native(values[i], values[j]));
        assert.deepEqual(actual, expected, `${operator} pair ${i},${j}`);
      }
  });
for (const [operator, name] of [
  ['+', 'pos'],
  ['-', 'neg'],
  ['~', 'bit_not'],
  ['typeof ', 'typeof'],
  ['void ', 'void'],
])
  test('native matrix unary: ' + operator, () => {
    const native = Function('a', `return ${operator}a;`);
    for (let i = 0; i < values.length; i++)
      assert.deepEqual(
        result(() => unaryOperation('js.' + name, values[i])),
        result(() => native(values[i])),
        `${operator} value ${i}`,
      );
  });
