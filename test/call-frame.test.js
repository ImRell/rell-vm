import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CallFrame,
} from '../src/runtime/call-frame.js';

import {
  LexicalEnvironment,
} from '../src/runtime/lexical-environment.js';

test('новый кадр содержит независимое начальное состояние', () => {
  const frame = new CallFrame();

  assert.equal(frame.pc, 0);
  assert.deepEqual(frame.stack, []);

  assert.ok(frame.locals instanceof Map);
  assert.equal(frame.locals.size, 0);

  assert.deepEqual(frame.args, []);
  assert.equal(frame.thisArg, undefined);

  assert.ok(
    frame.rootEnvironment instanceof LexicalEnvironment,
  );

  assert.equal(
    frame.environment,
    frame.rootEnvironment,
  );

  assert.equal(frame.rootEnvironment.parent, null);
});

test('стек, локальные ячейки и позиция разных кадров независимы', () => {
  const first = new CallFrame();
  const second = new CallFrame();

  assert.notEqual(first.stack, second.stack);
  assert.notEqual(first.locals, second.locals);

  assert.notEqual(
    first.rootEnvironment,
    second.rootEnvironment,
  );

  first.pc = 12;
  first.stack.push(42);
  first.locals.set(0, 'first');

  assert.equal(second.pc, 0);
  assert.deepEqual(second.stack, []);
  assert.equal(second.locals.has(0), false);

  second.stack.push(100);
  second.locals.set(0, 'second');

  assert.deepEqual(first.stack, [42]);
  assert.deepEqual(second.stack, [100]);

  assert.equal(first.locals.get(0), 'first');
  assert.equal(second.locals.get(0), 'second');
});

test('кадр сохраняет независимый неизменяемый список аргументов', () => {
  const object = { value: 10 };
  const input = [1, undefined, object];

  const frame = new CallFrame({
    args: input,
  });

  assert.notEqual(frame.args, input);
  assert.deepEqual(frame.args, [1, undefined, object]);
  assert.equal(Object.isFrozen(frame.args), true);

  input[0] = 99;
  input.push(100);

  assert.deepEqual(frame.args, [1, undefined, object]);

  assert.throws(
    () => frame.args.push(4),
    TypeError,
  );

  assert.throws(
    () => {
      frame.args[0] = 5;
    },
    TypeError,
  );

  // Объекты передаются по ссылке, как при обычном вызове JS.
  assert.equal(frame.args[2], object);

  object.value = 20;

  assert.equal(frame.args[2].value, 20);
});

test('кадр сохраняет thisArg без преобразований', () => {
  const receiver = { name: 'receiver' };

  for (const thisArg of [
    undefined,
    null,
    false,
    0,
    'text',
    receiver,
  ]) {
    const frame = new CallFrame({ thisArg });

    assert.equal(frame.thisArg, thisArg);
  }
});

test('вызовы имеют собственные переменные и общее внешнее окружение', () => {
  const captured = new LexicalEnvironment();

  captured.create(0, 'shared', 'let').initialize(10);

  const first = new CallFrame({
    parentEnvironment: captured,
  });

  const second = new CallFrame({
    parentEnvironment: captured,
  });

  assert.equal(first.rootEnvironment.parent, captured);
  assert.equal(second.rootEnvironment.parent, captured);

  first.environment.create(0, 'local', 'let').initialize(1);
  second.environment.create(0, 'local', 'let').initialize(2);

  assert.equal(first.environment.getCell(0).read(), 1);
  assert.equal(second.environment.getCell(0).read(), 2);

  assert.equal(
    first.environment.getCell(0, 1),
    captured.getCell(0),
  );

  assert.equal(
    second.environment.getCell(0, 1),
    captured.getCell(0),
  );

  first.environment.getCell(0, 1).write(20);

  assert.equal(
    second.environment.getCell(0, 1).read(),
    20,
  );
});

test('вход и выход из блоков восстанавливают окружение кадра', () => {
  const frame = new CallFrame();
  const root = frame.rootEnvironment;

  root.create(0, 'value', 'let').initialize(10);

  const block = frame.enterScope();

  assert.equal(frame.environment, block);
  assert.equal(block.parent, root);

  block.create(0, 'value', 'let').initialize(20);

  const nested = frame.enterScope();

  assert.equal(frame.environment, nested);
  assert.equal(nested.parent, block);

  assert.equal(
    frame.environment.getCell(0, 1).read(),
    20,
  );

  assert.equal(frame.leaveScope(), block);
  assert.equal(frame.environment.getCell(0).read(), 20);

  assert.equal(frame.leaveScope(), root);
  assert.equal(frame.environment.getCell(0).read(), 10);
});

test('выход из блока не уничтожает захваченные ячейки', () => {
  const frame = new CallFrame();

  const firstBlock = frame.enterScope();

  firstBlock.create(0, 'value', 'let').initialize(10);

  // Моделируем вызов функции, захватившей этот блок.
  const capturedCall = new CallFrame({
    parentEnvironment: firstBlock,
  });

  frame.leaveScope();

  const secondBlock = frame.enterScope();

  secondBlock.create(0, 'value', 'let').initialize(20);

  assert.notEqual(firstBlock, secondBlock);

  assert.equal(
    capturedCall.environment.getCell(0, 1).read(),
    10,
  );

  assert.equal(frame.environment.getCell(0).read(), 20);

  capturedCall.environment.getCell(0, 1).write(15);

  assert.equal(firstBlock.getCell(0).read(), 15);
  assert.equal(secondBlock.getCell(0).read(), 20);
});

test('нельзя выйти за корневое окружение кадра', () => {
  const captured = new LexicalEnvironment();

  const frame = new CallFrame({
    parentEnvironment: captured,
  });

  assert.throws(
    () => frame.leaveScope(),
    /Cannot leave the root environment/,
  );

  assert.equal(
    frame.environment,
    frame.rootEnvironment,
  );

  frame.enterScope();
  frame.leaveScope();

  assert.throws(
    () => frame.leaveScope(),
    /Cannot leave the root environment/,
  );

  // Родитель замыкания не становится текущей областью вызова.
  assert.notEqual(frame.environment, captured);
});

test('проверяет родительское окружение и список аргументов', () => {
  for (const parentEnvironment of [
    {},
    [],
    0,
    'environment',
    () => {},
  ]) {
    assert.throws(
      () => new CallFrame({ parentEnvironment }),
      TypeError,
    );
  }

  for (const args of [
    null,
    {},
    1,
    'arguments',
    new Set([1, 2]),
  ]) {
    assert.throws(
      () => new CallFrame({ args }),
      TypeError,
    );
  }

  const parentEnvironment = new LexicalEnvironment();

  assert.doesNotThrow(
    () => new CallFrame({
      parentEnvironment,
      args: [1, 2],
    }),
  );
});