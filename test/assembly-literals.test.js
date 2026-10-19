import test from 'node:test';
import assert from 'node:assert/strict';
import { INSTRUCTIONS } from '../src/assembly/instructions.js';
import { parseAssembly } from '../src/assembly/parse.js';
import { AssemblyBuilder } from '../src/compiler/assembly-builder.js';
import { executeAssembly } from '../src/runtime/execute-assembly.js';

test('контракты литералов имеют фиксированные эффекты стека', () => {
  for (const [op, pops, pushes] of [
    ['js.object.create', 0, 1],
    ['js.array.create', 0, 1],
    ['js.object.define', 3, 1],
    ['js.object.getter', 3, 1],
    ['js.object.setter', 3, 1],
    ['js.object.proto', 2, 1],
  ]) {
    assert.equal(INSTRUCTIONS[op].pops, pops);
    assert.equal(INSTRUCTIONS[op].pushes, pushes);
  }
});
test('генератор и парсер создают текстовый объект с data property', () => {
  const builder = new AssemblyBuilder();
  builder.emit('js.object.create');
  builder.emit('js.const', 'x');
  builder.emit('js.const', 42);
  builder.emit('js.object.define');
  builder.emit('return');
  const text = builder.build();
  assert.equal(typeof text, 'string');
  assert.equal(parseAssembly(text).instructions.length, 5);
  assert.deepEqual(executeAssembly(text), { x: 42 });
});
test('array create и define сохраняют дырки и длину', () => {
  const array = executeAssembly(
    'js.array.create 3\njs.const "1"\njs.const 42\njs.object.define\nreturn',
  );
  assert.equal(array.length, 3);
  assert.deepEqual(Object.keys(array), ['1']);
  assert.equal(array[1], 42);
});
test('array length проверяется parser/builder и runtime', () => {
  for (const text of ['-1', '1.5', '"3"'])
    assert.throws(() => parseAssembly('js.array.create ' + text + '\nreturn'));
  const builder = new AssemblyBuilder();
  assert.throws(() => builder.emit('js.array.create', -1));
  assert.throws(
    () => executeAssembly('js.array.create 4294967296\nreturn'),
    RangeError,
  );
});
test('новые инструкции проверяют недостаток стека', () => {
  for (const op of [
    'js.object.define',
    'js.object.getter',
    'js.object.setter',
    'js.object.proto',
  ])
    assert.throws(() => executeAssembly(op + '\nhalt'), /Stack underflow/);
});
test('define сохраняет нижние значения стека', () => {
  assert.equal(
    executeAssembly(
      'js.const 100\njs.object.create\njs.const "x"\njs.const 1\njs.object.define\ndrop\nreturn',
    ),
    100,
  );
});
test('инструкции литералов учитывают общий maxSteps', () => {
  const text =
    'js.object.create\njs.const "x"\njs.const 1\njs.object.define\nreturn';
  assert.deepEqual(executeAssembly(text, { maxSteps: 5 }), { x: 1 });
  assert.throws(
    () => executeAssembly(text, { maxSteps: 4 }),
    /Instruction limit/,
  );
});
test('сырой текст определяет getter из VM-функции', () => {
  const builder = new AssemblyBuilder();
  builder.emit('js.object.create');
  builder.emit('js.const', 'x');
  builder.emit('js.function.create', '', [], false, 'js.const 42\nreturn');
  builder.emit('js.object.getter');
  builder.emit('js.const', 'x');
  builder.emit('js.prop.get');
  builder.emit('return');
  assert.equal(executeAssembly(builder.build()), 42);
});
test('assembler accessor допускает внешнюю native функцию', () => {
  const object = executeAssembly(
    'js.object.create\njs.const "x"\njs.global.get "getter"\njs.object.getter\nreturn',
    {
      environment: {
        getter() {
          return this.value;
        },
      },
    },
  );
  object.value = 42;
  assert.equal(object.x, 42);
});
test('не-callable accessor отклоняется, не меняя объект', () => {
  const object = {};
  assert.throws(
    () =>
      executeAssembly(
        'js.global.get "object"\njs.const "x"\njs.const 1\njs.object.getter\nreturn',
        { environment: { object } },
      ),
    TypeError,
  );
  assert.deepEqual(Object.keys(object), []);
});
