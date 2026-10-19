import test from 'node:test';
import assert from 'node:assert/strict';

import { AssemblyBuilder } from '../src/compiler/assembly-builder.js';
import { executeAssembly } from '../src/runtime/execute-assembly.js';

const READ_PROPERTY = [
  'js.global.get "object"',
  'js.global.get "key"',
  'js.prop.get',
  'return',
].join('\n');

function readProperty(object, key) {
  return executeAssembly(READ_PROPERTY, {
    environment: { object, key },
  });
}

test('читает собственное свойство объекта', () => {
  assert.equal(
    readProperty({ answer: 42 }, 'answer'),
    42,
  );
});

test('отсутствующее свойство возвращает undefined', () => {
  assert.equal(
    readProperty(Object.create(null), 'missing'),
    undefined,
  );
});

test('читает свойства прототипа', () => {
  const prototype = { answer: 42 };
  const object = Object.create(prototype);

  assert.equal(readProperty(object, 'answer'), 42);
});

test('поддерживает примитивные получатели', () => {
  assert.equal(readProperty('hello', 'length'), 5);
  assert.equal(readProperty('hello', 1), 'e');

  assert.equal(
    readProperty(42, 'toString'),
    Number.prototype.toString,
  );
});

test('поддерживает символьные ключи и преобразование ключа', () => {
  const symbol = Symbol('answer');
  const object = {
    [symbol]: 42,
    value: 10,
  };

  assert.equal(readProperty(object, symbol), 42);

  let conversions = 0;

  const key = {
    [Symbol.toPrimitive](hint) {
      assert.equal(hint, 'string');
      conversions++;
      return 'value';
    },
  };

  assert.equal(readProperty(object, key), 10);
  assert.equal(conversions, 1);
});

test('геттер свойства получает исходный объект как this', () => {
  let reads = 0;

  const object = {
    base: 40,

    get answer() {
      assert.equal(this, object);
      reads++;
      return this.base + 2;
    },
  };

  assert.equal(readProperty(object, 'answer'), 42);
  assert.equal(reads, 1);
});

test('сохраняет порядок вычисления объекта, ключа и чтения свойства', () => {
  const events = [];

  const object = {
    get answer() {
      events.push('property');
      return 42;
    },
  };

  const environment = {
    get object() {
      events.push('object');
      return object;
    },

    get key() {
      events.push('key');
      return 'answer';
    },
  };

  assert.equal(
    executeAssembly(READ_PROPERTY, { environment }),
    42,
  );

  assert.deepEqual(events, [
    'object',
    'key',
    'property',
  ]);
});

test('null, undefined и исключения геттеров сохраняют JS-поведение', () => {
  for (const object of [null, undefined]) {
    assert.throws(
      () => readProperty(object, 'value'),
      TypeError,
    );
  }

  const expectedError = new Error('Getter failed');

  const object = {
    get value() {
      throw expectedError;
    },
  };

  assert.throws(
    () => readProperty(object, 'value'),
    (error) => error === expectedError,
  );
});

test('чтение метода возвращает функцию без автоматического вызова', () => {
  let calls = 0;

  function method() {
    calls++;
  }

  assert.equal(
    readProperty({ method }, 'method'),
    method,
  );

  assert.equal(calls, 0);
});

test('генератор поддерживает инструкцию, runtime проверяет стек', () => {
  const builder = new AssemblyBuilder();

  builder.emit('js.const', 'hello');
  builder.emit('js.const', 'length');
  builder.emit('js.prop.get');
  builder.emit('return');

  assert.equal(executeAssembly(builder.build()), 5);

  for (const source of [
    'js.prop.get\nreturn',
    'js.const "length"\njs.prop.get\nreturn',
  ]) {
    assert.throws(
      () => executeAssembly(source),
      /Stack underflow for js.prop.get/,
    );
  }
});