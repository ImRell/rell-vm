import test from 'node:test';
import assert from 'node:assert/strict';

import { parseSource } from '../src/compiler/parse.js';
import { collectVarNames } from '../src/compiler/collect-var-names.js';

function collect(source) {
  return collectVarNames(parseSource(source).program);
}

test('собирает имена var в порядке первого появления', () => {
  assert.deepEqual(
    collect('var first; var second = 2, third = 3;'),
    ['first', 'second', 'third'],
  );
});

test('повторные объявления не создают повторных имён', () => {
  assert.deepEqual(
    collect(`
      var value = 1;
      var value;
      { var value = 2; }
    `),
    ['value'],
  );
});

test('собирает объявления из вложенных блоков и недостижимых веток', () => {
  assert.deepEqual(
    collect(`
      if (false) {
        var hidden = 42;
      } else {
        var alternative;
      }

      {
        {
          var nested;
        }
      }
    `),
    ['hidden', 'alternative', 'nested'],
  );
});

test('собирает объявления из циклов, switch и catch', () => {
  assert.deepEqual(
    collect(`
      for (var index = 0; index < 3; index++) {
        var item;
      }

      for (var key in object) {
        var entry;
      }

      while (false) {
        var never;
      }

      switch (value) {
        case 1:
          var selected;
          break;
      }

      try {
        var attempted;
      } catch (error) {
        var recovered;
      }
    `),
    [
      'index',
      'item',
      'key',
      'entry',
      'never',
      'selected',
      'attempted',
      'recovered',
    ],
  );
});

test('не входит во вложенные функции и методы', () => {
  assert.deepEqual(
    collect(`
      var outer;

      function declared() {
        var insideDeclaration;
      }

      var expression = function () {
        var insideExpression;
      };

      var arrow = () => {
        var insideArrow;
      };

      var object = {
        method() {
          var insideMethod;
        }
      };
    `),
    ['outer', 'expression', 'arrow', 'object'],
  );
});

test('умеет собирать объявления отдельного тела функции', () => {
  const ast = parseSource(`
    function example() {
      var local;

      if (false) {
        var nested;
      }

      function inner() {
        var hidden;
      }
    }
  `);

  const body = ast.program.body[0].body;

  assert.deepEqual(
    collectVarNames(body),
    ['local', 'nested'],
  );
});

test('игнорирует let и const и не выполняет инициализаторы', () => {
  assert.deepEqual(
    collect(`
      let lexical = 1;
      const fixed = 2;
      var result = mustNotExecute();
    `),
    ['result'],
  );

  assert.deepEqual(collect(''), []);
});

test('не изменяет AST и возвращает неизменяемый список', () => {
  const ast = parseSource('var value = 42;');
  const snapshot = structuredClone(ast);

  // Замораживаем всё дерево: попытка изменить его внутри
  // ES-модуля должна привести к исключению.
  function deepFreeze(value) {
    if (
      value === null ||
      typeof value !== 'object' ||
      Object.isFrozen(value)
    ) {
      return;
    }

    for (const child of Object.values(value)) {
      deepFreeze(child);
    }

    Object.freeze(value);
  }

  deepFreeze(ast);

  const names = collectVarNames(ast.program);

  // Сравниваем две копии с одинаковым представлением прототипов.
  assert.deepEqual(structuredClone(ast), snapshot);
  assert.deepEqual(names, ['value']);
  assert.ok(Object.isFrozen(names));

  assert.throws(() => {
    names.push('other');
  }, TypeError);
});

test('проверяет вход и отклоняет ненормализованную деструктуризацию var', () => {
  for (const value of [
    null,
    undefined,
    42,
    {},
    { type: 'Program' },
  ]) {
    assert.throws(
      () => collectVarNames(value),
      /Expected a Program or function body BlockStatement/,
    );
  }

  assert.throws(
    () => collect('var { value } = object;'),
    /Unsupported var binding pattern: ObjectPattern/,
  );

  assert.throws(
    () => collect('var [value] = array;'),
    /Unsupported var binding pattern: ArrayPattern/,
  );
});