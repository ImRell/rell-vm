import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { compileToAssembly } from '../src/compiler/compile-assembly.js';
import { executeAssembly } from '../src/runtime/execute-assembly.js';
function compare(source) {
  const expected = [],
    actual = [];
  vm.runInNewContext(source, {
    capture(v) {
      expected.push(v);
    },
  });
  executeAssembly(compileToAssembly(source), {
    environment: {
      capture(v) {
        actual.push(v);
      },
    },
    maxSteps: 100000,
  });
  assert.deepEqual(actual, expected);
  return actual;
}
test('comma возвращает только последнее значение', () => {
  assert.deepEqual(compare('capture((1,2,3));'), [3]);
});
test('comma выполняет side effects слева направо', () => {
  assert.deepEqual(
    compare('var n=0;capture((capture(n++),capture(n++),n++));capture(n);'),
    [0, 1, 2, 3],
  );
});
test('nested comma сохраняет стек окружающей арифметики', () => {
  assert.deepEqual(
    compare('var n=0;capture(100+(n++,(n++,n++)));capture(n);'),
    [102, 3],
  );
});
test('comma в return сохраняет результат последнего выражения', () => {
  compare('function f(){var x=1;return (x++,x*2);}capture(f());');
});
test('comma не сохраняет reference объекта для вызова метода', () => {
  compare(
    'var o={method:function(){"use strict";return this;}};capture((0,o.method)());',
  );
});
test('comma получает callee до аргументов', () => {
  compare(
    'var o={get method(){capture("get");return function(v){"use strict";capture(this);capture(v);};}};function arg(){capture("arg");return 42;}(capture("first"),o.method)(arg());',
  );
});
test('comma в logical ветке сохраняет короткое замыкание', () => {
  compare(
    'var n=0;false&&(n++,n++);true||(n++,n++);capture(n);capture(true&&(n++,42));capture(n);',
  );
});
test('comma в conditional исполняет только выбранную ветку', () => {
  compare('var n=0;capture(true?(n++,42):(n++,99));capture(n);');
});
test('comma в вычисляемом ключе', () => {
  compare(
    'var n=0;var o={x:10};capture(o[(n++,"x")]++);capture(n);capture(o.x);',
  );
});
test('comma в RHS возвращает именно последнее присваиваемое значение', () => {
  compare('var x=0,n=0;capture(x=(n++,42));capture(x);capture(n);');
});
test('comma поддерживает функции, объекты и массивы как значения', () => {
  compare(
    'var o=(1,{x:42});capture(o.x);var a=(1,[2,3]);capture(a.join(","));var f=(1,function(){return 7;});capture(f());',
  );
});
test('ошибка среднего выражения не исполняет следующие', () => {
  const error = {},
    events = [];
  assert.throws(
    () =>
      executeAssembly(compileToAssembly('(first(),bad(),last());'), {
        environment: {
          first() {
            events.push(1);
          },
          bad() {
            events.push(2);
            throw error;
          },
          last() {
            events.push(3);
          },
        },
      }),
    (e) => e === error,
  );
  assert.deepEqual(events, [1, 2]);
});
test('тип литерала BigInt не теряется в comma', () => {
  compare('capture((0,10n));');
});
test('компиляция проверяет неподдерживаемые expression даже до последнего', () => {
  assert.throws(
    () => compileToAssembly('(x => x,42);'),
    /Unsupported expression: ArrowFunctionExpression/,
  );
});
test('компиляция sequence не выполняет исходник', () => {
  assert.equal(
    typeof compileToAssembly('(first(),second(),third());'),
    'string',
  );
});
