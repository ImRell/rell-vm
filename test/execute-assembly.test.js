import test from 'node:test';
import assert from 'node:assert/strict';

import { executeAssembly } from '../src/runtime/execute-assembly.js';

function run(source) {
  return executeAssembly(source, {
    maxSteps: 1_000,
  });
}

test('текстовый runtime возвращает константу или завершает программу', () => {
  assert.equal(run('js.const 42\nreturn'), 42);
  assert.equal(run('js.const 42\nhalt'), undefined);
});

test('арифметика сохраняет порядок операндов и JS-семантику', () => {
  const cases = [
    ['10', '3', 'js.add', 13],
    ['10', '3', 'js.sub', 7],
    ['10', '3', 'js.mul', 30],
    ['12', '3', 'js.div', 4],
    ['10', '3', 'js.rem', 1],
    ['1', '"2"', 'js.add', '12'],
    ['2n', '3n', 'js.add', 5n],
  ];

  for (const [left, right, op, expected] of cases) {
    assert.equal(
      run(`js.const ${left}\njs.const ${right}\n${op}\nreturn`),
      expected,
    );
  }

  assert.throws(
    () => run('js.const 1n\njs.const 1\njs.add\nreturn'),
    TypeError,
  );
});

test('унарные операции и сравнения возвращают правильные значения', () => {
  assert.equal(run('js.const 5\njs.neg\nreturn'), -5);
  assert.equal(run('js.const 0\njs.not\nreturn'), true);

  const cases = [
    ['js.strict_eq', false],
    ['js.lt', true],
    ['js.le', true],
    ['js.gt', false],
    ['js.ge', false],
  ];

  for (const [op, expected] of cases) {
    assert.equal(
      run(`js.const 2\njs.const 3\n${op}\nreturn`),
      expected,
    );
  }
});

test('dup и drop управляют стеком', () => {
  assert.equal(
    run(`
      js.const 7
      dup
      js.add
      js.const 99
      drop
      return
    `),
    14,
  );
});

test('низкоуровневые локальные ячейки поддерживают get, set и tee', () => {
  assert.equal(
    run(`
      js.const 10
      local.set 0
      js.const 20
      local.tee 1
      local.get 0
      js.add
      return
    `),
    30,
  );

  assert.equal(run('local.get 999999999\nreturn'), undefined);
});

test('лексические инструкции инициализируют, читают и изменяют let', () => {
  assert.equal(
    run(`
      js.lex.create 0 "value" let
      js.const 10
      js.lex.init 0

      js.const 20
      js.lex.set 0

      js.const 30
      js.lex.tee 0
      js.lex.get 0
      js.add
      return
    `),
    60,
  );
});

test('лексические обращения различают TDZ и отсутствие ячейки', () => {
  assert.throws(
    () => run('js.lex.create 0 "value" let\njs.lex.get 0\nreturn'),
    ReferenceError,
  );

  assert.throws(
    () => run('js.lex.get 0\nreturn'),
    /Lexical cell has not been created: 0/,
  );

  assert.equal(
    run(`
      js.lex.create 0 "value" let
      js.const undefined
      js.lex.init 0
      js.lex.get 0
      return
    `),
    undefined,
  );
});

test('лексические присваивания сохраняют запрет изменения const', () => {
  for (const op of ['js.lex.set', 'js.lex.tee']) {
    assert.throws(
      () => run(`
        js.lex.create 0 "value" const
        js.const 10
        js.lex.init 0
        js.const 20
        ${op} 0
        halt
      `),
      {
        name: 'TypeError',
        message: "Assignment to constant variable 'value'",
      },
    );
  }
});

test('именованные переходы позволяют выполнить цикл', () => {
  assert.equal(
    run(`
      js.const 0
      local.set 0

      label condition
      local.get 0
      js.const 3
      js.lt
      jump_if_false finish

      local.get 0
      js.const 1
      js.add
      local.set 0
      jump condition

      label finish
      local.get 0
      return
    `),
    3,
  );
});

test('повторное создание лексической ячейки восстанавливает TDZ', () => {
  assert.throws(
    () => run(`
      js.lex.create 0 "value" let
      js.const 42
      js.lex.init 0

      js.lex.create 0 "value" let
      js.lex.get 0
      return
    `),
    ReferenceError,
  );
});

test('ошибки стека содержат позицию инструкции', () => {
  assert.throws(
    () => run('\n  js.add'),
    {
      name: 'Error',
      message:
        'VM 2:3: Stack underflow for js.add: expected 2, received 0',
    },
  );

  assert.throws(
    () => run('js.const 42'),
    /Execution reached the end without halt or return/,
  );
});

test('лимит инструкций останавливает бесконечный текстовый цикл', () => {
  assert.throws(
    () => executeAssembly(
      'label again\njump again',
      { maxSteps: 10 },
    ),
    /Instruction limit exceeded: 10/,
  );

  assert.equal(
    executeAssembly('halt', { maxSteps: 1 }),
    undefined,
  );

  for (const maxSteps of [0, -1, 1.5, NaN, '10']) {
    assert.throws(
      () => executeAssembly('halt', { maxSteps }),
      /maxSteps must be a positive safe integer or Infinity/,
    );
  }
});

test('запуски изолированы и старый объект программы не принимается', () => {
  run('js.const 42\nlocal.set 0\nhalt');

  assert.equal(run('local.get 0\nreturn'), undefined);

  assert.throws(
    () => executeAssembly({ code: [0] }),
    /Assembly source must be a string/,
  );
});