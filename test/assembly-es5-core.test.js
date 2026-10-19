import test from 'node:test';
import assert from 'node:assert/strict';
import { INSTRUCTIONS } from '../src/assembly/instructions.js';
import { parseAssembly } from '../src/assembly/parse.js';
import { AssemblyBuilder } from '../src/compiler/assembly-builder.js';
import { executeAssembly } from '../src/runtime/execute-assembly.js';
const binary = [
  'js.eq',
  'js.ne',
  'js.strict_ne',
  'js.bit_and',
  'js.bit_or',
  'js.bit_xor',
  'js.shl',
  'js.shr',
  'js.ushr',
  'js.in',
  'js.instanceof',
];
const unary = ['js.pos', 'js.bit_not', 'js.typeof', 'js.void'];
for (const op of [...binary, ...unary, 'throw', 'js.prop.delete'])
  test('stack validation ' + op, () => {
    const operands = op === 'js.prop.delete' ? ' false' : '';
    assert.throws(
      () => executeAssembly(`\n${op}${operands}\nhalt`),
      /VM 2:1: Stack underflow/,
    );
  });
for (const op of [...binary, ...unary, 'throw', 'nop'])
  test('нет лишних operands ' + op, () => {
    assert.throws(() => parseAssembly(`${op} 0\nhalt`), /expects 0 arguments/);
  });
test('parser проверяет name и strict flag новых инструкций', () => {
  for (const source of [
    'js.global.typeof x',
    'js.global.delete ""',
    'js.prop.delete 1',
  ])
    assert.throws(() => parseAssembly(source + '\nhalt'), SyntaxError);
});
test('builder принимает новые инструкции и создаёт исполняемую строку', () => {
  const b = new AssemblyBuilder();
  b.emit('js.const', 5);
  b.emit('js.const', 3);
  b.emit('js.bit_xor');
  b.emit('js.pos');
  b.emit('return');
  assert.equal(executeAssembly(b.build()), 6);
});
test('новые операции снимают только свои значения', () => {
  assert.equal(
    executeAssembly(
      'js.const 42\njs.const 2\njs.const 3\njs.bit_or\ndrop\nreturn',
    ),
    42,
  );
  assert.equal(
    executeAssembly('js.const 42\njs.const 3\njs.void\ndrop\nreturn'),
    42,
  );
});
test('nop учитывается maxSteps, throw сохраняет значение', () => {
  assert.equal(executeAssembly('nop\njs.const 7\nreturn', { maxSteps: 3 }), 7);
  assert.throws(
    () => executeAssembly('nop\njs.const 7\nthrow', { maxSteps: 2 }),
    /Instruction limit exceeded: 2/,
  );
  assert.throws(
    () => executeAssembly('js.const 7\nthrow'),
    (e) => e === 7,
  );
});
test('builder не меняется при неверном regex или количестве аргументов', () => {
  const b = new AssemblyBuilder();
  b.emit('halt');
  const before = b.build();
  assert.throws(() => b.emit('throw', 1), TypeError);
  assert.throws(() => b.emit('js.regexp.create', 'x', 'gg'), SyntaxError);
  assert.equal(b.build(), before);
});
test('throw и regexp descriptor защищены от изменения', () => {
  for (const op of ['throw', 'js.regexp.create']) {
    assert.equal(Object.isFrozen(INSTRUCTIONS[op]), true);
    assert.throws(() => (INSTRUCTIONS[op].pops = 9), TypeError);
  }
});
