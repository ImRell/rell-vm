import test from 'node:test';
import assert from 'node:assert/strict';

import { compileToAssembly } from '../src/compiler/compile-assembly.js';
import { normalizeSource } from '../src/compiler/normalize-source.js';
import { executeAssembly } from '../src/runtime/execute-assembly.js';

function evaluateScript(source, environment = Object.create(null)) {
  const assembly = compileToAssembly(source);
  const suffix = 'drop\nhalt\n';

  assert.ok(
    assembly.endsWith(suffix),
    'Test source must end with a top-level expression',
  );

  return executeAssembly(
    `${assembly.slice(0, -suffix.length)}return\n`,
    {
      environment,
      maxSteps: 10_000,
    },
  );
}

test('var доступен до объявления со значением undefined', () => {
  const values = [];

  evaluateScript(`
    capture(value);
    var value = 42;
    capture(value);
    value;
  `, {
    capture(value) {
      values.push(value);
    },
  });

  assert.deepEqual(values, [undefined, 42]);
});

test('var без инициализатора содержит undefined', () => {
  assert.equal(
    evaluateScript('var value; value;'),
    undefined,
  );
});

test('var из недостижимой ветки всё равно объявлен', () => {
  assert.equal(
    evaluateScript(`
      if (false) {
        var value = 42;
      }

      value;
    `),
    undefined,
  );
});

test('повторное объявление без инициализатора не сбрасывает значение', () => {
  assert.equal(
    evaluateScript(`
      var value = 42;
      var value;
      { var value; }
      value;
    `),
    42,
  );
});

test('присваивание до объявления использует поднятую переменную', () => {
  assert.equal(
    evaluateScript(`
      value = 10;
      var value;
      value;
    `),
    10,
  );
});

test('var внутри блока принадлежит области скрипта', () => {
  assert.equal(
    evaluateScript(`
      {
        var value = 10;
      }

      {
        value += 5;
      }

      value;
    `),
    15,
  );
});

test('поднятый var затеняет внешнее имя с начала скрипта', () => {
  assert.equal(
    evaluateScript(`
      var snapshot = value;
      var value = 10;
      snapshot;
    `, {
      value: 99,
    }),
    undefined,
  );
});

test('блочный let может затенять внешний var', () => {
  assert.equal(
    evaluateScript(`
      var value = 10;

      {
        let value = 20;
        value += 5;
      }

      value;
    `),
    10,
  );
});

test('инициализаторы var выполняются последовательно на своих местах', () => {
  assert.equal(
    evaluateScript(`
      var first = 10, second = first + 5;
      var first = second * 2;
      first;
    `),
    30,
  );
});

test('инициализатор в пропущенной ветке не вызывается', () => {
  let calls = 0;

  assert.equal(
    evaluateScript(`
      if (false) {
        var value = produce();
      }

      value;
    `, {
      produce() {
        calls++;
        return 42;
      },
    }),
    undefined,
  );

  assert.equal(calls, 0);
});

test('инициализатор выполняется при каждом достижении объявления', () => {
  assert.equal(
    evaluateScript(`
      var index = 0;
      var sum = 0;

      while (index < 3) {
        var step = index + 1;
        sum += step;
        index += 1;
      }

      sum;
    `),
    6,
  );
});

test('исполняет простой результат нормализации Babel в ES5', () => {
  const normalized = normalizeSource(`
    const value = 10;
    let result = value + 2;
    result;
  `);

  assert.equal(evaluateScript(normalized), 12);
});