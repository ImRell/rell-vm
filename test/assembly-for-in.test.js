import test from 'node:test';
import assert from 'node:assert/strict';
import { INSTRUCTIONS } from '../src/assembly/instructions.js';
import { parseAssembly } from '../src/assembly/parse.js';
import { AssemblyBuilder } from '../src/compiler/assembly-builder.js';
import { executeAssembly } from '../src/runtime/execute-assembly.js';
import { createForInIterator } from '../src/runtime/for-in-iterator.js';

test('контракт фиксирует стек и отсутствие операндов новых инструкций', () => {
  assert.deepEqual(INSTRUCTIONS['js.for_in.create'], {
    operands: [],
    pops: 1,
    pushes: 1,
    flow: 'next',
  });
  assert.deepEqual(INSTRUCTIONS['js.for_in.next'], {
    operands: [],
    pops: 1,
    pushes: 2,
    flow: 'next',
  });
  assert.equal(Object.isFrozen(INSTRUCTIONS['js.for_in.next']), true);
});
test('парсер принимает инструкции и сохраняет позиции', () => {
  const program = parseAssembly('\njs.for_in.create\njs.for_in.next\nhalt');
  assert.equal(program.instructions[0].line, 2);
  assert.equal(program.instructions[1].op, 'js.for_in.next');
});
test('парсер отклоняет лишние аргументы', () => {
  for (const op of ['js.for_in.create', 'js.for_in.next'])
    assert.throws(() => parseAssembly(`${op} 1\nhalt`), /expects 0 arguments/);
});
test('builder генерирует текст, не числовой байткод', () => {
  const b = new AssemblyBuilder();
  b.emit('js.const', 'ab');
  b.emit('js.for_in.create');
  b.emit('js.for_in.next');
  b.emit('drop');
  b.emit('return');
  assert.equal(executeAssembly(b.build()), '0');
});
test('неверный emit не добавляет строку', () => {
  const b = new AssemblyBuilder();
  b.emit('halt');
  const before = b.build();
  assert.throws(() => b.emit('js.for_in.next', 1), TypeError);
  assert.equal(b.build(), before);
});
test('next возвращает ключ под true, после конца undefined под false', () => {
  const token = createForInIterator({ x: 1 });
  const source = 'js.global.get "token"\njs.for_in.next\ndrop\nreturn';
  assert.equal(executeAssembly(source, { environment: { token } }), 'x');
  assert.equal(executeAssembly(source, { environment: { token } }), undefined);
  assert.equal(
    executeAssembly('js.global.get "token"\njs.for_in.next\nreturn', {
      environment: { token },
    }),
    false,
  );
});
test('next не снимает чужие значения стека', () => {
  assert.equal(
    executeAssembly(
      'js.const 42\njs.const null\njs.for_in.create\njs.for_in.next\ndrop\ndrop\nreturn',
    ),
    42,
  );
});
test('инструкции проверяют недостаток стека с позицией', () => {
  for (const op of ['js.for_in.create', 'js.for_in.next'])
    assert.throws(
      () => executeAssembly(`\n${op}\nhalt`),
      /VM 2:1: Stack underflow/,
    );
});
test('next не принимает произвольный iterable', () => {
  assert.throws(
    () => executeAssembly('js.const "text"\njs.for_in.next\nhalt'),
    /Expected a VM for-in iterator/,
  );
});
test('текстовый цикл получает унаследованные ключи', () => {
  const object = Object.assign(Object.create({ p: 1 }), { a: 1 }),
    keys = [];
  executeAssembly(
    `
js.global.get "object"
js.for_in.create
local.set 0
label loop
local.get 0
js.for_in.next
jump_if_false end
local.set 1
js.const undefined
js.global.get "capture"
local.get 1
js.call 1
drop
jump loop
label end
drop
halt
`,
    {
      environment: {
        object,
        capture(key) {
          keys.push(key);
        },
      },
    },
  );
  assert.deepEqual(keys, ['a', 'p']);
});
test('получение следующего ключа учитывается общим лимитом', () => {
  assert.throws(
    () =>
      executeAssembly('js.const "x"\njs.for_in.create\njs.for_in.next\nhalt', {
        maxSteps: 2,
      }),
    /Instruction limit exceeded: 2/,
  );
});
test('разбор не перечисляет внешний объект', () => {
  let called = false;
  const object = new Proxy(
    {},
    {
      ownKeys() {
        called = true;
        return [];
      },
    },
  );
  parseAssembly('js.global.get "object"\njs.for_in.create\nhalt');
  executeAssembly('js.global.get "object"\njs.for_in.create\nhalt', {
    environment: { object },
  });
  assert.equal(called, false);
});
