import test from 'node:test';
import assert from 'node:assert/strict';

import { AssemblyBuilder } from '../src/compiler/assembly-builder.js';
import { parseAssembly } from '../src/assembly/parse.js';
import { executeAssembly } from '../src/runtime/execute-assembly.js';

test('генерирует текст, исполняемый текстовой VM', () => {
  const builder = new AssemblyBuilder();

  builder.emit('js.const', 10);
  builder.emit('js.const', 3);
  builder.emit('js.sub');
  builder.emit('return');

  const source = builder.build();

  assert.equal(
    source,
    'js.const 10\njs.const 3\njs.sub\nreturn\n',
  );

  assert.equal(executeAssembly(source), 7);
});

test('сохраняет примитивные литералы без потерь', () => {
  const values = [
    undefined,
    null,
    true,
    false,
    0,
    -0,
    1.25,
    -100,
    1e30,
    NaN,
    Infinity,
    -Infinity,
    123n,
    -123n,
    'hello "world"\nПривет',
    '\u2028\u2029',
  ];

  for (const value of values) {
    const builder = new AssemblyBuilder();

    builder.emit('js.const', value);
    builder.emit('return');

    assert.ok(
      Object.is(executeAssembly(builder.build()), value),
    );
  }
});

test('генерирует именованные переходы вперёд и назад', () => {
  const builder = new AssemblyBuilder();
  const start = builder.createLabel();
  const finish = builder.createLabel();

  builder.markLabel(start);
  builder.emit('js.const', false);
  builder.emit('jump_if_false', finish);
  builder.emit('jump', start);

  builder.markLabel(finish);
  builder.emit('halt');

  const source = builder.build();

  assert.equal(source, [
    'label L0',
    'js.const false',
    'jump_if_false L1',
    'jump L0',
    'label L1',
    'halt',
    '',
  ].join('\n'));

  assert.equal(
    executeAssembly(source, { maxSteps: 10 }),
    undefined,
  );
});

test('генерирует объявление лексической переменной', () => {
  const builder = new AssemblyBuilder();

  builder.emit('js.lex.create', 0, 'value', 'const');
  builder.emit('js.const', 42);
  builder.emit('js.lex.init', 0);
  builder.emit('js.lex.get', 0);
  builder.emit('return');

  assert.equal(executeAssembly(builder.build()), 42);
});

test('запрещает чужие метки и повторную привязку', () => {
  const builder = new AssemblyBuilder();
  const other = new AssemblyBuilder();
  const own = builder.createLabel();
  const foreign = other.createLabel();

  assert.throws(
    () => builder.emit('jump', foreign),
    /Label must belong to this builder/,
  );

  assert.throws(
    () => builder.markLabel(foreign),
    /Label must belong to this builder/,
  );

  builder.markLabel(own);

  assert.throws(
    () => builder.markLabel(own),
    /Label is already marked/,
  );
});

test('build отклоняет неизвестную цель и метку после конца кода', () => {
  const unresolved = new AssemblyBuilder();
  const missing = unresolved.createLabel();

  unresolved.emit('jump', missing);

  assert.throws(
    () => unresolved.build(),
    /Unknown label: L0/,
  );

  const atEnd = new AssemblyBuilder();
  const end = atEnd.createLabel();

  atEnd.emit('jump', end);
  atEnd.markLabel(end);

  assert.throws(
    () => atEnd.build(),
    /Label does not point to an instruction: L0/,
  );

  atEnd.emit('halt');

  assert.doesNotThrow(() => atEnd.build());
});

test('отклоняет неверные инструкции и аргументы без изменения текста', () => {
  const builder = new AssemblyBuilder();

  const invalidCalls = [
    () => builder.emit('unknown'),
    () => builder.emit('js.const'),
    () => builder.emit('halt', 1),
    () => builder.emit('local.get', -1),
    () => builder.emit('local.get', '0'),
    () => builder.emit('js.lex.create', 0, '', 'let'),
    () => builder.emit('js.lex.create', 0, 'value', 'var'),
    () => builder.emit('jump', 'L0'),
  ];

  for (const call of invalidCalls) {
    assert.throws(call, TypeError);
  }

  builder.emit('halt');

  assert.equal(builder.build(), 'halt\n');
});

test('не разрешает объекты, функции и символы как литералы', () => {
  const builder = new AssemblyBuilder();

  for (const value of [{}, [], () => {}, Symbol('value')]) {
    assert.throws(
      () => builder.emit('js.const', value),
      /Only primitive non-symbol literals are supported/,
    );
  }
});

test('сборки возвращают независимые текстовые снимки', () => {
  const builder = new AssemblyBuilder();

  builder.emit('halt');

  const first = builder.build();

  builder.emit('js.const', 42);
  builder.emit('drop');

  const second = builder.build();

  assert.equal(first, 'halt\n');
  assert.equal(second, 'halt\njs.const 42\ndrop\n');

  assert.equal(parseAssembly(first).instructions.length, 1);
  assert.equal(parseAssembly(second).instructions.length, 3);
});

test('пустая сборка отклоняется, неиспользованная метка не мешает сборке', () => {
  const builder = new AssemblyBuilder();

  assert.throws(
    () => builder.build(),
    /must contain at least one instruction/,
  );

  builder.createLabel();
  builder.emit('halt');

  assert.equal(builder.build(), 'halt\n');
});