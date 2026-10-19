import test from 'node:test';
import assert from 'node:assert/strict';
import { LexicalScope } from '../src/compiler/scope.js';

test('новый корень функции имеет независимый счётчик слотов', () => {
  const root = new LexicalScope();
  const outer = root.declareVar('outer');
  const fn = root.createFunctionChild();
  const inner = fn.declareVar('inner');
  assert.equal(outer.slot, 0);
  assert.equal(inner.slot, 0);
  assert.equal(root.localCount, 1);
  assert.equal(fn.localCount, 1);
  assert.equal(root.resolve('inner'), null);
  assert.equal(fn.resolve('outer'), outer);
});

test('resolveReference считает блоки и границы функций', () => {
  const root = new LexicalScope();
  const outer = root.declareVar('outer');
  const block = root.createChild();
  const middle = block.declare('middle', 'let');
  const fn = block.createFunctionChild();
  const local = fn.declareVar('local');
  const inner = fn.createChild();
  assert.deepEqual(inner.resolveReference('local'), {
    binding: local,
    depth: 1,
  });
  assert.deepEqual(inner.resolveReference('middle'), {
    binding: middle,
    depth: 2,
  });
  assert.deepEqual(inner.resolveReference('outer'), {
    binding: outer,
    depth: 3,
  });
  assert.equal(inner.resolveReference('missing'), null);
  assert.equal(Object.isFrozen(inner.resolveReference('local')), true);
});

test('var не поднимается через границу функции', () => {
  const root = new LexicalScope();
  const outer = root.declare('value', 'const');
  const fn = root.createFunctionChild();
  const block = fn.createChild();
  const local = block.declareVar('value');
  assert.equal(local.kind, 'var');
  assert.notEqual(local, outer);
  assert.equal(fn.resolve('value'), local);
  assert.equal(root.resolve('value'), outer);
});

test('блоки функции разделяют её allocator, но не allocator внешнего кадра', () => {
  const root = new LexicalScope();
  root.declareVar('outer');
  const fn = root.createFunctionChild();
  const parameter = fn.declareVar('parameter');
  const block = fn.createChild();
  const value = block.declare('value', 'let');
  assert.equal(parameter.slot, 0);
  assert.equal(value.slot, 1);
  assert.equal(fn.localCount, 2);
  assert.equal(root.localCount, 1);
});

test('совпадающие слоты разрешаются по ближайшей области', () => {
  const root = new LexicalScope();
  const outer = root.declareVar('value');
  const fn = root.createFunctionChild();
  const local = fn.declareVar('value');
  assert.equal(outer.slot, local.slot);
  assert.deepEqual(fn.resolveReference('value'), { binding: local, depth: 0 });
  assert.equal(fn.declareVar('value'), local);
  assert.throws(() => fn.resolveReference(''), TypeError);
});

test('поиск в текущем кадре не захватывает привязку внешней функции', () => {
  const root = new LexicalScope();
  root.declareVar('outer');
  const fn = root.createFunctionChild();
  const local = fn.declareVar('local');
  const block = fn.createChild();
  assert.equal(block.resolveFrameReference('outer'), null);
  assert.deepEqual(block.resolveFrameReference('local'), {
    binding: local,
    depth: 1,
  });
  assert.equal(block.resolveReference('outer').depth, 2);
});
