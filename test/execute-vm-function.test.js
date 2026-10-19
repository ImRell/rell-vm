import test from 'node:test';
import assert from 'node:assert/strict';

import { executeAssembly } from '../src/runtime/execute-assembly.js';

import { VMFunction } from '../src/runtime/vm-function.js';

import { LexicalEnvironment } from '../src/runtime/lexical-environment.js';

function createFunction(source, options = {}) {
  return new VMFunction({
    source,
    capturedEnvironment: new LexicalEnvironment(),
    ...options,
  });
}

function callFunctionSource(name, argumentInstructions = []) {
  return [
    'js.const undefined',
    `js.global.get ${JSON.stringify(name)}`,
    ...argumentInstructions,
    `js.call ${argumentInstructions.length}`,
    'return',
    '',
  ].join('\n');
}

test('js.call вызывает VM-функцию и получает результат', () => {
  const answer = createFunction(['js.const 42', 'return', ''].join('\n'));

  const result = executeAssembly(callFunctionSource('answer'), {
    environment: { answer },
  });

  assert.equal(result, 42);
});

test('параметры получают аргументы в порядке объявления', () => {
  const subtract = createFunction(
    ['js.lex.get 0', 'js.lex.get 1', 'js.sub', 'return', ''].join('\n'),
    {
      parameters: ['left', 'right'],
    },
  );

  const result = executeAssembly(
    callFunctionSource('subtract', ['js.const 10', 'js.const 3']),
    {
      environment: { subtract },
    },
  );

  assert.equal(result, 7);
});

test('отсутствующий аргумент даёт undefined, лишние допускаются', () => {
  const second = createFunction('js.lex.get 1\nreturn\n', {
    parameters: ['first', 'second'],
  });

  assert.equal(
    executeAssembly(callFunctionSource('second', ['js.const 10']), {
      environment: { second },
    }),
    undefined,
  );

  assert.equal(
    executeAssembly(
      callFunctionSource('second', [
        'js.const 10',
        'js.const 20',
        'js.const 30',
      ]),
      {
        environment: { second },
      },
    ),
    20,
  );
});

test('последний повторный параметр определяет значение привязки', () => {
  const duplicate = createFunction('js.lex.get 0\nreturn\n', {
    parameters: ['value', 'value'],
    strict: false,
  });

  assert.equal(
    executeAssembly(
      callFunctionSource('duplicate', ['js.const 10', 'js.const 20']),
      {
        environment: { duplicate },
      },
    ),
    20,
  );

  // Второй параметр присутствует в объявлении,
  // но второй аргумент не передан.
  assert.equal(
    executeAssembly(callFunctionSource('duplicate', ['js.const 10']), {
      environment: { duplicate },
    }),
    undefined,
  );
});

test('возврат сохраняет стек вызывающего кадра', () => {
  const answer = createFunction('js.const 42\nreturn\n');

  const result = executeAssembly(
    [
      'js.const 100',
      'js.const undefined',
      'js.global.get "answer"',
      'js.call 0',
      'js.add',
      'return',
      '',
    ].join('\n'),
    {
      environment: { answer },
    },
  );

  assert.equal(result, 142);
});

test('вложенные VM-вызовы продолжают нужный кадр', () => {
  const inner = createFunction('js.const 40\nreturn\n');

  const outer = createFunction(
    [
      'js.const undefined',
      'js.global.get "inner"',
      'js.call 0',
      'js.const 2',
      'js.add',
      'return',
      '',
    ].join('\n'),
  );

  const result = executeAssembly(callFunctionSource('outer'), {
    environment: { inner, outer },
  });

  assert.equal(result, 42);
});

test('рекурсивные вызовы имеют независимые параметры и локальные ячейки', () => {
  const sum = createFunction(
    [
      // Сохраняем n в низкоуровневой ячейке этого кадра.
      'js.lex.get 0',
      'local.set 0',

      'js.lex.get 0',
      'js.const 0',
      'js.le',
      'jump_if_false recurse',

      'js.const 0',
      'return',

      'label recurse',

      'js.const undefined',
      'js.global.get "sum"',

      'js.lex.get 0',
      'js.const 1',
      'js.sub',

      'js.call 1',

      // После рекурсивного вызова должна сохраниться
      // локальная ячейка именно вызывающего кадра.
      'local.get 0',
      'js.add',
      'return',
      '',
    ].join('\n'),
    {
      parameters: ['n'],
    },
  );

  const result = executeAssembly(callFunctionSource('sum', ['js.const 10']), {
    environment: { sum },
  });

  assert.equal(result, 55);
});

test('VM-функция может вызвать внешнюю JS-функцию', () => {
  const calls = [];

  const fn = createFunction(
    [
      'js.const undefined',
      'js.global.get "record"',
      'js.const 42',
      'js.call 1',
      'return',
      '',
    ].join('\n'),
  );

  const result = executeAssembly(callFunctionSource('fn'), {
    environment: {
      fn,

      record(value) {
        calls.push(value);
        return value + 1;
      },
    },
  });

  assert.equal(result, 43);
  assert.deepEqual(calls, [42]);
});

test('halt внутри функции возвращает undefined вызывающему кадру', () => {
  const fn = createFunction('halt\n');

  const result = executeAssembly(
    [
      'js.const undefined',
      'js.global.get "fn"',
      'js.call 0',
      'drop',
      'js.const 42',
      'return',
      '',
    ].join('\n'),
    {
      environment: { fn },
    },
  );

  assert.equal(result, 42);
});

test('лимит инструкций общий для вызывающего и вызываемого кадров', () => {
  const fn = createFunction('js.const 42\nreturn\n');

  const source = callFunctionSource('fn');

  // Верхний уровень: const, global.get, call, return.
  // Тело функции: const, return.
  // Всего 6 инструкций.
  assert.equal(
    executeAssembly(source, {
      environment: { fn },
      maxSteps: 6,
    }),
    42,
  );

  assert.throws(
    () =>
      executeAssembly(source, {
        // Independent run requires a fresh API-created function: existing
        // wrappers intentionally retain their creation executor and budget.
        environment: { fn: createFunction('js.const 42\nreturn\n') },
        maxSteps: 5,
      }),
    /Instruction limit exceeded: 5/,
  );
});

test('бесконечная рекурсия останавливается общим лимитом VM', () => {
  const recurse = createFunction(
    [
      'js.const undefined',
      'js.global.get "recurse"',
      'js.call 0',
      'return',
      '',
    ].join('\n'),
  );

  assert.throws(
    () =>
      executeAssembly(callFunctionSource('recurse'), {
        environment: { recurse },
        maxSteps: 1000,
      }),
    /Instruction limit exceeded: 1000/,
  );
});

test('функция не получает доступ к слотам вызывающего кадра', () => {
  const fn = createFunction('js.lex.get 0\nreturn\n');

  assert.throws(
    () =>
      executeAssembly(
        [
          'js.lex.create 0 "callerValue" let',
          'js.const 42',
          'js.lex.init 0',

          'js.const undefined',
          'js.global.get "fn"',
          'js.call 0',
          'return',
          '',
        ].join('\n'),
        {
          environment: { fn },
        },
      ),
    /Lexical cell has not been created: 0/,
  );
});

test('ошибки внешней функции распространяются через VM-вызовы', () => {
  const expected = new Error('external failure');

  const fn = createFunction(
    [
      'js.const undefined',
      'js.global.get "explode"',
      'js.call 0',
      'return',
      '',
    ].join('\n'),
  );

  assert.throws(
    () =>
      executeAssembly(callFunctionSource('fn'), {
        environment: {
          fn,

          explode() {
            throw expected;
          },
        },
      }),
    (error) => error === expected,
  );
});

test('достижение конца тела функции без завершения является ошибкой', () => {
  const fn = createFunction('js.const 42\n');

  assert.throws(
    () =>
      executeAssembly(callFunctionSource('fn'), {
        environment: { fn },
      }),
    /Execution reached the end without halt or return/,
  );
});
