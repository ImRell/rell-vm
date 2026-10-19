import test from 'node:test';
import assert from 'node:assert/strict';

import { parseAssembly } from '../src/assembly/parse.js';
import { AssemblyBuilder } from '../src/compiler/assembly-builder.js';
import { executeAssembly } from '../src/runtime/execute-assembly.js';

test('вызывает функцию и сохраняет порядок аргументов', () => {
  const result = executeAssembly(`
    js.const undefined
    js.global.get "subtract"
    js.const 10
    js.const 3
    js.call 2
    return
  `, {
    environment: {
      subtract(left, right) {
        return left - right;
      },
    },
  });

  assert.equal(result, 7);
});

test('поддерживает вызов без аргументов', () => {
  const result = executeAssembly(`
    js.const undefined
    js.global.get "answer"
    js.call 0
    return
  `, {
    environment: {
      answer() {
        return 42;
      },
    },
  });

  assert.equal(result, 42);
});

test('метод получает исходный объект как this', () => {
  const object = {
    base: 40,

    add(value) {
      assert.equal(this, object);
      return this.base + value;
    },
  };

  const result = executeAssembly(`
    js.global.get "object"
    dup
    js.const "add"
    js.prop.get
    js.const 2
    js.call 1
    return
  `, {
    environment: { object },
  });

  assert.equal(result, 42);
});

test('обычный вызов передаёт undefined строгой функции', () => {
  function inspectThis() {
    return this;
  }

  const result = executeAssembly(`
    js.const undefined
    js.global.get "inspectThis"
    js.call 0
    return
  `, {
    environment: { inspectThis },
  });

  // Функции этого ESM-файла выполняются в строгом режиме.
  assert.equal(result, undefined);
});

test('получает метод до вычисления аргументов', () => {
  const events = [];

  const object = {
    get method() {
      events.push('method');

      return function (value) {
        assert.equal(this, object);
        events.push('call');
        return value;
      };
    },
  };

  const environment = {
    object,

    get argument() {
      events.push('argument');
      return 42;
    },
  };

  const result = executeAssembly(`
    js.global.get "object"
    dup
    js.const "method"
    js.prop.get
    js.global.get "argument"
    js.call 1
    return
  `, { environment });

  assert.equal(result, 42);
  assert.deepEqual(events, ['method', 'argument', 'call']);
});

test('аргументы вычисляются до ошибки вызова не-функции', () => {
  let reads = 0;

  const environment = {
    notCallable: 42,

    get argument() {
      reads++;
      return 10;
    },
  };

  assert.throws(
    () => executeAssembly(`
      js.const undefined
      js.global.get "notCallable"
      js.global.get "argument"
      js.call 1
      return
    `, { environment }),
    TypeError,
  );

  assert.equal(reads, 1);
});

test('исключение вызываемой функции распространяется без подмены', () => {
  const expectedError = new Error('Function failed');

  const environment = {
    fail() {
      throw expectedError;
    },
  };

  assert.throws(
    () => executeAssembly(`
      js.const undefined
      js.global.get "fail"
      js.call 0
      return
    `, { environment }),
    (error) => error === expectedError,
  );
});

test('вызов снимает только свои значения со стека', () => {
  const result = executeAssembly(`
    js.const 100

    js.const undefined
    js.global.get "identity"
    js.const 42
    js.call 1

    js.add
    return
  `, {
    environment: {
      identity(value) {
        return value;
      },
    },
  });

  assert.equal(result, 142);
});

test('проверяет количество аргументов и доступные значения стека', () => {
  for (const count of ['-1', '1.5', '9007199254740992']) {
    assert.throws(
      () => parseAssembly(`js.call ${count}`),
      /Invalid argument count/,
    );
  }

  assert.throws(
    () => executeAssembly('js.call 0'),
    /Stack underflow for js.call/,
  );

  assert.throws(
    () => executeAssembly(`
      js.const undefined
      js.global.get "fn"
      js.call 1
      halt
    `, {
      environment: { fn() {} },
    }),
    /Stack underflow for js.call arguments/,
  );
});

test('генератор поддерживает вызовы и проверяет count', () => {
  const builder = new AssemblyBuilder();

  builder.emit('js.const', undefined);
  builder.emit('js.global.get', 'answer');
  builder.emit('js.call', 0);
  builder.emit('return');

  assert.equal(
    executeAssembly(builder.build(), {
      environment: {
        answer() {
          return 42;
        },
      },
    }),
    42,
  );

  assert.throws(
    () => builder.emit('js.call', -1),
    /Argument count must be a non-negative safe integer/,
  );
});