import test from 'node:test';
import assert from 'node:assert/strict';

import { LexicalScope } from '../src/compiler/scope.js';

test('новая область не содержит объявлений и локальных ячеек', () => {
  const scope = new LexicalScope();

  assert.equal(scope.localCount, 0);
  assert.equal(scope.resolve('missing'), null);
});

test('объявления получают последовательные локальные ячейки', () => {
  const scope = new LexicalScope();

  assert.deepEqual(scope.declare('left', 'let'), {
    name: 'left',
    kind: 'let',
    slot: 0,
  });

  assert.deepEqual(scope.declare('right', 'const'), {
    name: 'right',
    kind: 'const',
    slot: 1,
  });

  assert.equal(scope.localCount, 2);
});

test('resolve возвращает объявление из текущей области', () => {
  const scope = new LexicalScope();
  const binding = scope.declare('value', 'let');

  assert.equal(scope.resolve('value'), binding);
});

test('вложенная область видит объявления родителя', () => {
  const root = new LexicalScope();
  const binding = root.declare('value', 'const');
  const child = root.createChild();
  const nested = child.createChild();

  assert.equal(child.resolve('value'), binding);
  assert.equal(nested.resolve('value'), binding);
});

test('внутреннее объявление затеняет внешнее', () => {
  const root = new LexicalScope();
  const outer = root.declare('value', 'let');

  const child = root.createChild();
  const inner = child.declare('value', 'const');

  assert.equal(root.resolve('value'), outer);
  assert.equal(child.resolve('value'), inner);
  assert.notEqual(outer.slot, inner.slot);
});

test('родитель и соседние области не видят внутренние объявления', () => {
  const root = new LexicalScope();
  const left = root.createChild();
  const right = root.createChild();

  left.declare('hidden', 'let');

  assert.equal(root.resolve('hidden'), null);
  assert.equal(right.resolve('hidden'), null);
});

test('все области кадра используют общий счётчик ячеек', () => {
  const root = new LexicalScope();
  const left = root.createChild();
  const right = root.createChild();

  assert.equal(root.declare('rootValue', 'let').slot, 0);
  assert.equal(left.declare('leftValue', 'let').slot, 1);
  assert.equal(right.declare('rightValue', 'const').slot, 2);

  assert.equal(root.localCount, 3);
  assert.equal(left.localCount, 3);
  assert.equal(right.localCount, 3);
});

test('повторное объявление отклоняется без выделения ячейки', () => {
  const scope = new LexicalScope();

  scope.declare('value', 'let');

  assert.throws(
    () => scope.declare('value', 'const'),
    {
      name: 'SyntaxError',
      message: 'Identifier is already declared: value',
    },
  );

  assert.equal(scope.localCount, 1);
  assert.equal(scope.declare('next', 'let').slot, 1);
});

test('отдельные корневые области имеют независимые ячейки', () => {
  const first = new LexicalScope();
  const second = new LexicalScope();

  assert.equal(first.declare('a', 'let').slot, 0);
  assert.equal(second.declare('b', 'let').slot, 0);

  first.declare('c', 'const');

  assert.equal(first.localCount, 2);
  assert.equal(second.localCount, 1);
});

test('описание объявления защищено от изменений', () => {
  const scope = new LexicalScope();
  const binding = scope.declare('value', 'const');

  assert.ok(Object.isFrozen(binding));

  assert.throws(() => {
    binding.slot = 99;
  }, TypeError);

  assert.throws(() => {
    binding.kind = 'let';
  }, TypeError);
});

test('отклоняет некорректные аргументы', () => {
  for (const parent of [{}, [], 42, false]) {
    assert.throws(
      () => new LexicalScope(parent),
      /Parent must be a LexicalScope or null/,
    );
  }

  const scope = new LexicalScope();

  for (const name of ['', null, undefined, 42]) {
    assert.throws(
      () => scope.declare(name, 'let'),
      /Binding name must be a non-empty string/,
    );

    assert.throws(
      () => scope.resolve(name),
      /Binding name must be a non-empty string/,
    );
  }

  for (const kind of ['var', 'function', undefined, null]) {
    assert.throws(
      () => scope.declare('value', kind),
      /Binding kind must be let or const/,
    );
  }

  assert.equal(scope.localCount, 0);
});

test('declareVar создаёт привязку var в корневой области', () => {
  const scope = new LexicalScope();

  const binding = scope.declareVar('value');

  assert.deepEqual(binding, {
    name: 'value',
    kind: 'var',
    slot: 0,
  });

  assert.equal(scope.resolve('value'), binding);
  assert.equal(scope.localCount, 1);
  assert.ok(Object.isFrozen(binding));
});

test('повторный var переиспользует привязку без выделения ячейки', () => {
  const scope = new LexicalScope();

  const first = scope.declareVar('value');
  const second = scope.declareVar('value');

  assert.equal(first, second);
  assert.equal(scope.localCount, 1);
});

test('var из вложенного блока виден корню и соседним блокам', () => {
  const root = new LexicalScope();
  const left = root.createChild();
  const nested = left.createChild();
  const right = root.createChild();

  const binding = nested.declareVar('value');

  assert.equal(root.resolve('value'), binding);
  assert.equal(left.resolve('value'), binding);
  assert.equal(right.resolve('value'), binding);

  assert.equal(right.declareVar('value'), binding);
  assert.equal(root.localCount, 1);
});

test('внутренний let может затенять внешний var', () => {
  const root = new LexicalScope();
  const outer = root.declareVar('value');

  const child = root.createChild();
  const inner = child.declare('value', 'let');

  assert.equal(root.resolve('value'), outer);
  assert.equal(child.resolve('value'), inner);
  assert.notEqual(outer.slot, inner.slot);
});

test('var не пересекает одноимённое лексическое объявление', () => {
  for (const kind of ['let', 'const']) {
    const root = new LexicalScope();
    const block = root.createChild();

    block.declare('value', kind);

    assert.throws(
      () => block.declareVar('value'),
      SyntaxError,
    );

    assert.throws(
      () => block.createChild().declareVar('value'),
      SyntaxError,
    );

    assert.equal(root.resolve('value'), null);
    assert.equal(root.localCount, 1);
  }
});

test('корневые var и лексические объявления конфликтуют в обе стороны', () => {
  const lexicalFirst = new LexicalScope();

  lexicalFirst.declare('value', 'let');

  assert.throws(
    () => lexicalFirst.declareVar('value'),
    SyntaxError,
  );

  const varFirst = new LexicalScope();

  varFirst.declareVar('value');

  assert.throws(
    () => varFirst.declare('value', 'const'),
    SyntaxError,
  );

  assert.equal(lexicalFirst.localCount, 1);
  assert.equal(varFirst.localCount, 1);
});

test('declareVar проверяет имя, отдельные корни остаются независимыми', () => {
  const first = new LexicalScope();
  const second = new LexicalScope();

  for (const name of ['', null, undefined, 42]) {
    assert.throws(
      () => first.declareVar(name),
      /Binding name must be a non-empty string/,
    );
  }

  const firstBinding = first.declareVar('value');
  const secondBinding = second.declareVar('value');

  assert.equal(firstBinding.slot, 0);
  assert.equal(secondBinding.slot, 0);
  assert.notEqual(firstBinding, secondBinding);
});