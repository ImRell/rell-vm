import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AssemblyBuilder,
} from '../src/compiler/assembly-builder.js';

import {
  parseAssembly,
} from '../src/assembly/parse.js';

import {
  executeAssembly,
} from '../src/runtime/execute-assembly.js';

function createFunction(body, parameters = []) {
  const builder = new AssemblyBuilder();

  builder.emit(
    'js.function.create',
    '',
    parameters,
    true,
    body,
  );

  return builder.build().trimEnd();
}

function callLocal(slot) {
  return [
    'js.const undefined',
    `local.get ${slot}`,
    'js.call 0',
  ].join('\n');
}

test('парсер и генератор поддерживают глубину и слот окружения', () => {
  const builder = new AssemblyBuilder();

  builder.emit('js.scope.enter');

  builder.emit('js.lex.create', 0, 'value', 'let');
  builder.emit('js.const', 42);
  builder.emit('js.lex.init', 0);

  builder.emit('js.env.get', 0, 0);
  builder.emit('js.scope.leave');
  builder.emit('return');

  const source = builder.build();

  const instruction = parseAssembly(source)
    .instructions
    .find(({ op }) => op === 'js.env.get');

  assert.deepEqual(instruction.args, [0, 0]);
  assert.equal(executeAssembly(source), 42);

  for (const source of [
    'js.env.get -1 0',
    'js.env.get 0 -1',
    'js.env.get 0.5 0',
    'js.env.get 0',
  ]) {
    assert.throws(
      () => parseAssembly(source),
      SyntaxError,
    );
  }

  assert.throws(
    () => builder.emit('js.env.get', -1, 0),
    TypeError,
  );
});

test('выход из блока восстанавливает внешнее окружение', () => {
  const source = [
    'js.lex.create 0 "value" let',
    'js.const 10',
    'js.lex.init 0',

    'js.scope.enter',

    'js.lex.create 0 "value" let',
    'js.const 20',
    'js.lex.init 0',

    'js.env.get 0 0',
    'local.set 0',

    'js.env.get 1 0',
    'local.set 1',

    'js.scope.leave',

    'local.get 0',
    'local.get 1',
    'js.add',
    'js.lex.get 0',
    'js.add',
    'return',
    '',
  ].join('\n');

  assert.equal(executeAssembly(source), 40);
});

test('замыкание читает ячейку после завершения создающего вызова', () => {
  const reader = createFunction(
    'js.env.get 1 0\nreturn\n',
  );

  const factory = createFunction(
    [
      reader,
      'return',
      '',
    ].join('\n'),
    ['value'],
  );

  const source = [
    'js.const undefined',
    factory,
    'js.const 42',
    'js.call 1',

    // Результат factory — функция, захватившая value.
    'local.set 0',

    callLocal(0),
    'return',
    '',
  ].join('\n');

  assert.equal(executeAssembly(source), 42);
});

test('замыкание изменяет захваченную ячейку между вызовами', () => {
  const increment = createFunction([
    'js.env.get 1 0',
    'js.const 1',
    'js.add',
    'js.env.tee 1 0',
    'return',
    '',
  ].join('\n'));

  const factory = createFunction(
    [
      increment,
      'return',
      '',
    ].join('\n'),
    ['counter'],
  );

  const source = [
    'js.const undefined',
    factory,
    'js.const 0',
    'js.call 1',
    'local.set 0',

    callLocal(0),
    'drop',

    callLocal(0),
    'return',
    '',
  ].join('\n');

  assert.equal(executeAssembly(source), 2);
});

test('отдельные вызовы фабрики создают независимые замыкания', () => {
  const increment = createFunction([
    'js.env.get 1 0',
    'js.const 1',
    'js.add',
    'js.env.tee 1 0',
    'return',
    '',
  ].join('\n'));

  const factory = createFunction(
    `${increment}\nreturn\n`,
    ['counter'],
  );

  const source = [
    factory,
    'local.set 0',

    'js.const undefined',
    'local.get 0',
    'js.const 0',
    'js.call 1',
    'local.set 1',

    'js.const undefined',
    'local.get 0',
    'js.const 100',
    'js.call 1',
    'local.set 2',

    callLocal(1),
    'drop',

    callLocal(1),

    callLocal(2),

    'js.add',
    'return',
    '',
  ].join('\n');

  // Первый счётчик: 1, 2.
  // Второй счётчик: 101.
  assert.equal(executeAssembly(source), 103);
});

test('две функции одного окружения разделяют одну ячейку', () => {
  const reader = createFunction(
    'js.env.get 1 0\nreturn\n',
  );

  const writer = createFunction([
    'js.const 42',
    'js.env.set 1 0',
    'js.const undefined',
    'return',
    '',
  ].join('\n'));

  const source = [
    'js.lex.create 0 "value" let',
    'js.const 10',
    'js.lex.init 0',

    reader,
    'local.set 0',

    writer,
    'local.set 1',

    callLocal(1),
    'drop',

    callLocal(0),
    'return',
    '',
  ].join('\n');

  assert.equal(executeAssembly(source), 42);
});

test('новый вход в блок не заменяет ячейку прежнего замыкания', () => {
  const reader = createFunction(
    'js.env.get 1 0\nreturn\n',
  );

  const source = [
    'js.scope.enter',

    'js.lex.create 0 "value" let',
    'js.const 10',
    'js.lex.init 0',

    reader,
    'local.set 0',

    'js.scope.leave',

    'js.scope.enter',

    'js.lex.create 0 "value" let',
    'js.const 20',
    'js.lex.init 0',

    reader,
    'local.set 1',

    'js.scope.leave',

    callLocal(0),
    callLocal(1),

    'js.add',
    'return',
    '',
  ].join('\n');

  assert.equal(executeAssembly(source), 30);
});

test('захваченная цепочка не зависит от окружения вызывающего кода', () => {
  const reader = createFunction(
    'js.env.get 1 0\nreturn\n',
  );

  const source = [
    'js.lex.create 0 "value" let',
    'js.const 10',
    'js.lex.init 0',

    reader,
    'local.set 0',

    // Вызываем функцию из блока с одноимённой ячейкой.
    'js.scope.enter',

    'js.lex.create 0 "value" let',
    'js.const 99',
    'js.lex.init 0',

    callLocal(0),

    'js.scope.leave',
    'return',
    '',
  ].join('\n');

  assert.equal(executeAssembly(source), 10);
});

test('явная глубина поддерживает несколько захваченных окружений', () => {
  const inner = createFunction(
    'js.env.get 2 0\nreturn\n',
  );

  const outer = createFunction(
    [
      inner,
      'return',
      '',
    ].join('\n'),
    ['value'],
  );

  const source = [
    'js.lex.create 0 "value" let',
    'js.const 42',
    'js.lex.init 0',

    'js.const undefined',
    outer,
    'js.const 99',
    'js.call 1',
    'local.set 0',

    callLocal(0),
    'return',
    '',
  ].join('\n');

  // Текущий кадр inner: depth 0.
  // Кадр outer: depth 1, value = 99.
  // Окружение скрипта: depth 2, value = 42.
  assert.equal(executeAssembly(source), 42);
});

test('доступ через замыкание сохраняет TDZ и запрет изменения const', () => {
  const reader = createFunction(
    'js.env.get 1 0\nreturn\n',
  );

  const tdzSource = [
    'js.lex.create 0 "value" let',

    'js.const undefined',
    reader,
    'js.call 0',
    'return',
    '',
  ].join('\n');

  assert.throws(
    () => executeAssembly(tdzSource),
    {
      name: 'ReferenceError',
      message: "Cannot access 'value' before initialization",
    },
  );

  for (const operation of ['js.env.set', 'js.env.tee']) {
    const writer = createFunction([
      'js.const 100',
      `${operation} 1 0`,
      'js.const undefined',
      'return',
      '',
    ].join('\n'));

    const constSource = [
      'js.lex.create 0 "value" const',
      'js.const 42',
      'js.lex.init 0',

      'js.const undefined',
      writer,
      'js.call 0',
      'return',
      '',
    ].join('\n');

    assert.throws(
      () => executeAssembly(constSource),
      {
        name: 'TypeError',
        message: "Assignment to constant variable 'value'",
      },
    );
  }
});

test('не ищет отсутствующий слот автоматически в родителях', () => {
  const reader = createFunction(
    'js.env.get 0 0\nreturn\n',
  );

  const source = [
    'js.lex.create 0 "outer" let',
    'js.const 42',
    'js.lex.init 0',

    'js.const undefined',
    reader,
    'js.call 0',
    'return',
    '',
  ].join('\n');

  assert.throws(
    () => executeAssembly(source),
    /Cannot resolve lexical cell at depth 0, slot 0/,
  );

  assert.throws(
    () => executeAssembly('js.env.get 1 0\nreturn\n'),
    /Cannot resolve lexical cell at depth 1, slot 0/,
  );
});

test('проверяет выход из корня, стек и общий лимит инструкций', () => {
  assert.throws(
    () => executeAssembly('js.scope.leave\nhalt\n'),
    /VM 1:1: Cannot leave the root environment/,
  );

  for (const operation of ['js.env.set', 'js.env.tee']) {
    assert.throws(
      () => executeAssembly(`${operation} 0 0\nhalt\n`),
      /Stack underflow/,
    );
  }

  const source = [
    'js.scope.enter',
    'js.scope.leave',
    'halt',
    '',
  ].join('\n');

  assert.equal(
    executeAssembly(source, { maxSteps: 3 }),
    undefined,
  );

  assert.throws(
    () => executeAssembly(source, { maxSteps: 2 }),
    /Instruction limit exceeded: 2/,
  );
});