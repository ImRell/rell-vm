import test from 'node:test';
import assert from 'node:assert/strict';
import { FunctionNameCell } from '../src/runtime/function-name-cell.js';
import { LexicalCell } from '../src/runtime/lexical-cell.js';
import { LexicalEnvironment } from '../src/runtime/lexical-environment.js';

test('именная ячейка сохраняет протокол инициализации LexicalCell', () => {
  const cell = new FunctionNameCell('self');
  assert.ok(cell instanceof LexicalCell);
  assert.throws(() => cell.read(), ReferenceError);
  assert.throws(() => cell.assign(42, false), ReferenceError);
  const value = {};
  cell.initialize(value);
  assert.equal(cell.read(), value);
  assert.throws(() => cell.initialize({}), Error);
});

test('нестрогая запись возвращает RHS без изменения значения', () => {
  const cell = new FunctionNameCell('self');
  const value = {};
  cell.initialize(value);
  assert.equal(cell.assign(42, false), 42);
  assert.equal(cell.read(), value);
});

test('строгая запись выбрасывает TypeError без изменения значения', () => {
  const cell = new FunctionNameCell('self');
  const value = {};
  cell.initialize(value);
  assert.throws(() => cell.assign(42, true), TypeError);
  assert.equal(cell.read(), value);
  assert.throws(() => cell.write(42), TypeError);
});

test('проверяет имя и флаг строгости', () => {
  assert.throws(() => new FunctionNameCell(''), TypeError);
  const cell = new FunctionNameCell('self');
  cell.initialize(42);
  for (const strict of [undefined, null, 0, 'false', {}]) {
    assert.throws(() => cell.assign(10, strict), TypeError);
  }
  assert.equal(cell.read(), 42);
});

test('окружение создаёт именную ячейку без замены занятого слота', () => {
  const environment = new LexicalEnvironment();
  const cell = environment.createFunctionName(0, 'self');
  cell.initialize(42);
  assert.ok(cell instanceof FunctionNameCell);
  assert.equal(environment.getCell(0), cell);
  assert.throws(
    () => environment.createFunctionName(0, 'other'),
    /already exists/,
  );
  assert.equal(environment.getCell(0).read(), 42);
  assert.throws(() => environment.createFunctionName(-1, 'bad'), TypeError);
  assert.throws(() => environment.createFunctionName(1, ''), TypeError);
  assert.doesNotThrow(() => environment.createFunctionName(1, 'valid'));
});
