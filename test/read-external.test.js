import test from 'node:test';
import assert from 'node:assert/strict';

import { readExternal } from '../src/runtime/read-external.js';

test('читает значение из переданного окружения', () => {
  const consoleObject = {
    log() {},
  };

  const environment = {
    console: consoleObject,
    answer: 42,
  };

  assert.equal(readExternal('console', environment), consoleObject);
  assert.equal(readExternal('answer', environment), 42);
});

test('отсутствующее имя выбрасывает ReferenceError', () => {
  assert.throws(
    () => readExternal('missing', Object.create(null)),
    {
      name: 'ReferenceError',
      message: 'missing is not defined',
    },
  );
});

test('существующее значение undefined не считается отсутствующим именем', () => {
  const environment = Object.create(null);

  environment.value = undefined;

  assert.equal(
    readExternal('value', environment),
    undefined,
  );
});

test('читает актуальное значение при каждом обращении', () => {
  const environment = { value: 10 };

  assert.equal(readExternal('value', environment), 10);

  environment.value = 20;

  assert.equal(readExternal('value', environment), 20);
});

test('геттер вызывается при чтении с корректным получателем', () => {
  let reads = 0;

  const environment = {
    base: 40,

    get answer() {
      reads++;
      return this.base + 2;
    },

    get unused() {
      throw new Error('Unused getter must not execute');
    },
  };

  assert.equal(reads, 0);
  assert.equal(readExternal('answer', environment), 42);
  assert.equal(reads, 1);
});

test('поддерживает свойства прототипа окружения', () => {
  const prototype = { inherited: 42 };
  const environment = Object.create(prototype);

  assert.equal(
    readExternal('inherited', environment),
    42,
  );
});

test('не изменяет окружение и сохраняет исключения геттеров', () => {
  const environment = Object.freeze({ value: 42 });

  assert.equal(readExternal('value', environment), 42);
  assert.deepEqual(environment, { value: 42 });

  const expectedError = new Error('Getter failed');

  const throwingEnvironment = {
    get value() {
      throw expectedError;
    },
  };

  assert.throws(
    () => readExternal('value', throwingEnvironment),
    (error) => error === expectedError,
  );
});

test('проверяет аргументы и поддерживает объект-функцию', () => {
  for (const name of ['', null, undefined, 42]) {
    assert.throws(
      () => readExternal(name, {}),
      /External name must be a non-empty string/,
    );
  }

  for (const environment of [null, undefined, 42, 'text', true]) {
    assert.throws(
      () => readExternal('value', environment),
      /External environment must be an object or function/,
    );
  }

  function environment() {}

  environment.value = 42;

  assert.equal(readExternal('value', environment), 42);
});