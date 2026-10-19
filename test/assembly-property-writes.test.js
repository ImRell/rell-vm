import test from 'node:test';
import assert from 'node:assert/strict';
import { INSTRUCTIONS } from '../src/assembly/instructions.js';
import { AssemblyBuilder } from '../src/compiler/assembly-builder.js';
import { parseAssembly } from '../src/assembly/parse.js';
import { executeAssembly } from '../src/runtime/execute-assembly.js';

const target = 'js.global.get "object"\njs.const "x"\njs.const 42\n';
test('контракт описывает фиксированные эффекты стека', () => {
  for (const [op, pops, pushes] of [
    ['js.prop.set', 3, 0],
    ['js.prop.tee', 3, 1],
    ['dup2', 2, 4],
  ]) {
    assert.equal(INSTRUCTIONS[op].pops, pops);
    assert.equal(INSTRUCTIONS[op].pushes, pushes);
  }
});
test('set снимает свои значения, tee оставляет RHS', () => {
  const object = {};
  assert.equal(
    executeAssembly('js.const 100\n' + target + 'js.prop.set false\nreturn', {
      environment: { object },
    }),
    100,
  );
  assert.equal(object.x, 42);
  assert.equal(
    executeAssembly(target + 'js.prop.tee true\nreturn', {
      environment: { object },
    }),
    42,
  );
});
test('dup2 сохраняет порядок двух верхних значений', () => {
  assert.equal(
    executeAssembly(
      'js.const 10\njs.const 3\ndup2\njs.sub\njs.add\njs.add\nreturn',
    ),
    20,
  );
});
test('новые инструкции проверяют недостаток стека', () => {
  for (const op of ['js.prop.set false', 'js.prop.tee true', 'dup2']) {
    assert.throws(
      () => executeAssembly('js.const 1\n' + op + '\nhalt'),
      /Stack underflow/,
    );
  }
});
test('парсер и генератор требуют boolean operand', () => {
  const builder = new AssemblyBuilder();
  builder.emit('js.const', 1);
  assert.throws(() => builder.emit('js.prop.set', 'false'));
  builder.emit('halt');
  assert.equal(executeAssembly(builder.build()), undefined);
  for (const operand of ['0', '"false"', ''])
    assert.throws(() => parseAssembly('js.prop.tee ' + operand + '\nhalt'));
});
test('strict operand управляет ошибкой readonly записи', () => {
  const environment = { object: Object.freeze({ x: 1 }) };
  assert.equal(
    executeAssembly(target + 'js.prop.tee false\nreturn', { environment }),
    42,
  );
  assert.throws(
    () => executeAssembly(target + 'js.prop.tee true\nreturn', { environment }),
    TypeError,
  );
});
test('запись и dup2 учитываются общим лимитом инструкций', () => {
  assert.equal(
    executeAssembly(target + 'js.prop.tee false\nreturn', {
      environment: { object: {} },
      maxSteps: 5,
    }),
    42,
  );
  assert.throws(
    () =>
      executeAssembly(target + 'js.prop.tee false\nreturn', {
        environment: { object: {} },
        maxSteps: 4,
      }),
    /Instruction limit/,
  );
});
