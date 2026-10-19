import test from 'node:test';
import assert from 'node:assert/strict';

import { LexicalCell } from '../src/runtime/lexical-cell.js';

test('чтение до инициализации выбрасывает ReferenceError', () => {
  for (const kind of ['let', 'const']) {
    const cell = new LexicalCell('value', kind);

    assert.throws(
      () => cell.read(),
      {
        name: 'ReferenceError',
        message: "Cannot access 'value' before initialization",
      },
    );
  }
});

test('присваивание до инициализации выбрасывает ReferenceError', () => {
  for (const kind of ['let', 'const']) {
    const cell = new LexicalCell('value', kind);

    assert.throws(
      () => cell.write(42),
      ReferenceError,
    );

    // Неудачное присваивание не должно инициализировать ячейку.
    assert.throws(
      () => cell.read(),
      ReferenceError,
    );

    cell.initialize(10);

    assert.equal(cell.read(), 10);
  }
});

test('инициализация undefined завершает TDZ', () => {
  for (const kind of ['let', 'const']) {
    const cell = new LexicalCell('value', kind);

    cell.initialize(undefined);

    assert.equal(cell.read(), undefined);
  }
});

test('let разрешает последующее присваивание', () => {
  const cell = new LexicalCell('value', 'let');

  cell.initialize(10);

  assert.equal(cell.read(), 10);
  assert.equal(cell.write(20), 20);
  assert.equal(cell.read(), 20);

  assert.equal(cell.write(undefined), undefined);
  assert.equal(cell.read(), undefined);
});

test('const запрещает присваивание, сохраняя прежнее значение', () => {
  const cell = new LexicalCell('value', 'const');

  cell.initialize(42);

  // Даже присваивание того же значения запрещено.
  for (const value of [42, 99, undefined]) {
    assert.throws(
      () => cell.write(value),
      {
        name: 'TypeError',
        message: "Assignment to constant variable 'value'",
      },
    );

    assert.equal(cell.read(), 42);
  }
});

test('повторная инициализация считается ошибкой runtime-протокола', () => {
  for (const kind of ['let', 'const']) {
    const cell = new LexicalCell('value', kind);

    cell.initialize(10);

    assert.throws(
      () => cell.initialize(20),
      /Lexical cell 'value' is already initialized/,
    );

    assert.equal(cell.read(), 10);
  }
});

test('const запрещает замену значения, но не замораживает объект', () => {
  const cell = new LexicalCell('object', 'const');
  const object = { count: 0 };

  cell.initialize(object);

  cell.read().count = 1;

  assert.equal(cell.read(), object);
  assert.equal(object.count, 1);

  assert.throws(
    () => cell.write({ count: 2 }),
    TypeError,
  );
});

test('разные ячейки с одинаковым именем независимы', () => {
  const outer = new LexicalCell('value', 'let');
  const inner = new LexicalCell('value', 'let');

  outer.initialize(10);

  assert.throws(
    () => inner.read(),
    ReferenceError,
  );

  inner.initialize(20);
  inner.write(30);

  assert.equal(outer.read(), 10);
  assert.equal(inner.read(), 30);
});

test('конструктор отклоняет некорректные аргументы', () => {
  for (const name of ['', null, undefined, 42]) {
    assert.throws(
      () => new LexicalCell(name, 'let'),
      /Cell name must be a non-empty string/,
    );
  }

  for (const kind of ['var', 'function', null, undefined]) {
    assert.throws(
      () => new LexicalCell('value', kind),
      /Cell kind must be let or const/,
    );
  }
});