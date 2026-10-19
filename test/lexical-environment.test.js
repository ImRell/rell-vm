import test from 'node:test';
import assert from 'node:assert/strict';

import {
  LexicalEnvironment,
} from '../src/runtime/lexical-environment.js';

import {
  LexicalCell,
} from '../src/runtime/lexical-cell.js';

test('создаёт корневое и дочернее окружения', () => {
  const root = new LexicalEnvironment();
  const child = root.createChild();
  const grandchild = child.createChild();

  assert.equal(root.parent, null);

  assert.ok(child instanceof LexicalEnvironment);
  assert.equal(child.parent, root);

  assert.ok(grandchild instanceof LexicalEnvironment);
  assert.equal(grandchild.parent, child);
});

test('создаёт лексическую ячейку и возвращает её по слоту', () => {
  const environment = new LexicalEnvironment();

  const cell = environment.create(0, 'value', 'let');

  assert.ok(cell instanceof LexicalCell);
  assert.equal(environment.getCell(0), cell);

  assert.throws(
    () => cell.read(),
    ReferenceError,
  );

  cell.initialize(42);

  assert.equal(environment.getCell(0).read(), 42);

  environment.getCell(0).write(50);

  assert.equal(cell.read(), 50);
});

test('окружение сохраняет проверки TDZ и const', () => {
  const environment = new LexicalEnvironment();

  const cell = environment.create(0, 'answer', 'const');

  assert.throws(
    () => cell.read(),
    ReferenceError,
  );

  assert.throws(
    () => cell.write(10),
    ReferenceError,
  );

  cell.initialize(42);

  assert.throws(
    () => cell.write(10),
    TypeError,
  );

  assert.equal(cell.read(), 42);

  assert.throws(
    () => cell.initialize(100),
    Error,
  );

  assert.equal(cell.read(), 42);
});

test('одинаковые слоты в разных окружениях независимы', () => {
  const root = new LexicalEnvironment();
  const child = root.createChild();

  const outer = root.create(0, 'value', 'let');
  const inner = child.create(0, 'value', 'let');

  outer.initialize(10);
  inner.initialize(20);

  assert.notEqual(outer, inner);

  assert.equal(child.getCell(0).read(), 20);
  assert.equal(child.getCell(0, 1).read(), 10);

  child.getCell(0).write(30);

  assert.equal(inner.read(), 30);
  assert.equal(outer.read(), 10);
});

test('глубина явно выбирает нужное родительское окружение', () => {
  const root = new LexicalEnvironment();
  const child = root.createChild();
  const grandchild = child.createChild();

  root.create(0, 'rootValue', 'let').initialize(10);
  child.create(0, 'childValue', 'let').initialize(20);
  grandchild.create(0, 'localValue', 'let').initialize(30);

  assert.equal(grandchild.getCell(0, 0).read(), 30);
  assert.equal(grandchild.getCell(0, 1).read(), 20);
  assert.equal(grandchild.getCell(0, 2).read(), 10);

  grandchild.getCell(0, 2).write(11);

  assert.equal(root.getCell(0).read(), 11);
});

test('не подменяет отсутствующий локальный слот внешним', () => {
  const root = new LexicalEnvironment();
  const child = root.createChild();

  root.create(0, 'outer', 'let').initialize(42);

  assert.throws(
    () => child.getCell(0),
    /Lexical slot 0 does not exist at depth 0/,
  );

  assert.equal(child.getCell(0, 1).read(), 42);

  assert.throws(
    () => root.getCell(0, 1),
    /Lexical environment at depth 1 does not exist/,
  );

  assert.throws(
    () => child.getCell(99, 1),
    /Lexical slot 99 does not exist at depth 1/,
  );
});

test('захваченное окружение сохраняет общую изменяемую ячейку', () => {
  const outer = new LexicalEnvironment();

  const cell = outer.create(0, 'counter', 'let');
  cell.initialize(0);

  // Моделируем два будущих вызова функций,
  // захвативших одно внешнее окружение.
  const firstCall = new LexicalEnvironment(outer);
  const secondCall = new LexicalEnvironment(outer);

  assert.equal(firstCall.getCell(0, 1), cell);
  assert.equal(secondCall.getCell(0, 1), cell);

  firstCall.getCell(0, 1).write(1);

  assert.equal(secondCall.getCell(0, 1).read(), 1);

  secondCall.getCell(0, 1).write(2);

  assert.equal(cell.read(), 2);
});

test('новые окружения итераций не заменяют захваченные ячейки', () => {
  const root = new LexicalEnvironment();

  function createIteration(value) {
    const iteration = root.createChild();

    iteration.create(0, 'value', 'let').initialize(value);

    return iteration;
  }

  const firstIteration = createIteration(10);
  const firstCapture = new LexicalEnvironment(firstIteration);

  const secondIteration = createIteration(20);
  const secondCapture = new LexicalEnvironment(secondIteration);

  assert.notEqual(
    firstCapture.getCell(0, 1),
    secondCapture.getCell(0, 1),
  );

  assert.equal(firstCapture.getCell(0, 1).read(), 10);
  assert.equal(secondCapture.getCell(0, 1).read(), 20);

  secondCapture.getCell(0, 1).write(25);

  assert.equal(firstCapture.getCell(0, 1).read(), 10);
  assert.equal(secondCapture.getCell(0, 1).read(), 25);
});

test('запрещает повторное создание слота без замены ячейки', () => {
  const environment = new LexicalEnvironment();

  const original = environment.create(0, 'value', 'let');
  original.initialize(42);

  assert.throws(
    () => environment.create(0, 'replacement', 'const'),
    /Lexical slot 0 already exists/,
  );

  assert.equal(environment.getCell(0), original);
  assert.equal(original.read(), 42);
});

test('отдельные корневые окружения не разделяют ячейки', () => {
  const first = new LexicalEnvironment();
  const second = new LexicalEnvironment();

  first.create(0, 'value', 'let').initialize(10);
  second.create(0, 'value', 'let').initialize(20);

  assert.notEqual(first.getCell(0), second.getCell(0));

  first.getCell(0).write(15);

  assert.equal(first.getCell(0).read(), 15);
  assert.equal(second.getCell(0).read(), 20);
});

test('проверяет родителя, слоты и глубину окружения', () => {
  for (const parent of [
    undefined,
    null,
  ]) {
    const environment = new LexicalEnvironment(parent);
    assert.equal(environment.parent, null);
  }

  for (const parent of [
    {},
    [],
    0,
    'parent',
    () => {},
  ]) {
    assert.throws(
      () => new LexicalEnvironment(parent),
      TypeError,
    );
  }

  const environment = new LexicalEnvironment();

  const invalidIndexes = [
    -1,
    0.5,
    NaN,
    Infinity,
    Number.MAX_SAFE_INTEGER + 1,
    '0',
    null,
    undefined,
    0n,
  ];

  for (const slot of invalidIndexes) {
    assert.throws(
      () => environment.create(slot, 'value', 'let'),
      TypeError,
    );

    assert.throws(
      () => environment.getCell(slot),
      TypeError,
    );
  }

  environment.create(0, 'value', 'let').initialize(42);

  for (const depth of invalidIndexes) {
    // undefined означает использование depth = 0.
    if (depth === undefined) {
      continue;
    }

    assert.throws(
      () => environment.getCell(0, depth),
      TypeError,
    );
  }

  assert.equal(environment.getCell(0, undefined).read(), 42);
});

test('ошибка создания ячейки не занимает слот', () => {
  const environment = new LexicalEnvironment();

  assert.throws(
    () => environment.create(0, '', 'let'),
    TypeError,
  );

  assert.throws(
    () => environment.create(0, 'value', 'var'),
    TypeError,
  );

  const cell = environment.create(0, 'value', 'let');
  cell.initialize(42);

  assert.equal(environment.getCell(0), cell);
  assert.equal(cell.read(), 42);
});