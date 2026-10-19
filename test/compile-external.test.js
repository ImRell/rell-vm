import test from 'node:test';
import assert from 'node:assert/strict';

import { compileToAssembly } from '../src/compiler/compile-assembly.js';
import { executeAssembly } from '../src/runtime/execute-assembly.js';

function run(source, environment) {
  return executeAssembly(compileToAssembly(source), {
    environment,
    maxSteps: 10_000,
  });
}

test('компилирует console.log с передачей аргументов и this', () => {
  const calls = [];

  const consoleObject = {
    log(...args) {
      assert.equal(this, consoleObject);
      calls.push(args);
    },
  };

  run('console.log("hello", 42);', {
    console: consoleObject,
  });

  assert.deepEqual(calls, [['hello', 42]]);
});

test('использует результат внешнего вызова в выражении', () => {
  const values = [];

  run('capture(Math.max(10, 20) + 2);', {
    Math,
    capture(value) {
      values.push(value);
    },
  });

  assert.deepEqual(values, [22]);
});

test('поддерживает вычисляемые и вложенные свойства', () => {
  const values = [];

  const object = {
    nested: {
      base: 40,

      add(value) {
        return this.base + value;
      },
    },
  };

  run('capture(object["nested"]["add"](2));', {
    object,
    capture(value) {
      values.push(value);
    },
  });

  assert.deepEqual(values, [42]);
});

test('лексическое имя имеет приоритет перед внешним', () => {
  const values = [];

  run(
    `
    let value = 10;
    capture(value);
  `,
    {
      value: 99,
      capture(value) {
        values.push(value);
      },
    },
  );

  assert.deepEqual(values, [10]);
});

test('TDZ не позволяет использовать одноимённое внешнее значение', () => {
  assert.throws(() => run('value; let value = 10;', { value: 99 }), {
    name: 'ReferenceError',
    message: "Cannot access 'value' before initialization",
  });
});

test('неизвестное внешнее имя вызывает ошибку только при исполнении', () => {
  const assembly = compileToAssembly('missing();');

  assert.throws(
    () =>
      executeAssembly(assembly, {
        environment: Object.create(null),
      }),
    {
      name: 'ReferenceError',
      message: 'missing is not defined',
    },
  );

  assert.doesNotThrow(() => {
    run('if (false) { missing(); }', Object.create(null));
  });
});

test('получает объект, ключ и метод до вычисления аргументов', () => {
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

  run('object[key](argument);', {
    get object() {
      events.push('object');
      return object;
    },

    get key() {
      events.push('key');
      return 'method';
    },

    get argument() {
      events.push('argument');
      return 42;
    },
  });

  assert.deepEqual(events, ['object', 'key', 'method', 'argument', 'call']);
});

test('извлечение метода в переменную не сохраняет this объекта', () => {
  const receivers = [];

  const object = {
    method() {
      receivers.push(this);
    },
  };

  run(
    `
    object.method();
    const extracted = object.method;
    extracted();
  `,
    { object },
  );

  assert.equal(receivers[0], object);
  assert.equal(receivers[1], undefined);
});

test('аргументы вычисляются слева направо до ошибки вызова', () => {
  const events = [];

  const environment = {
    notCallable: 42,

    first() {
      events.push('first');
      return 1;
    },

    second() {
      events.push('second');
      return 2;
    },
  };

  assert.throws(
    () => run('notCallable(first(), second());', environment),
    TypeError,
  );

  assert.deepEqual(events, ['first', 'second']);
});

test('отклоняет пока неподдерживаемые виды вызовов', () => {
  const cases = [
    ['eval("1 + 2");', /Direct eval calls are not supported/],
    ['fn(...args);', /Spread arguments are not supported/],
    ['fn?.();', /Unsupported expression: OptionalCallExpression/],
    [
      'new Date(...args);',
      /Spread constructor arguments require normalization/,
    ],
  ];

  for (const [source, expected] of cases) {
    assert.throws(() => compileToAssembly(source), expected);
  }
});
