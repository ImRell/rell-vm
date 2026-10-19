import test from 'node:test';
import assert from 'node:assert/strict';
import { compileToAssembly } from '../src/compiler/compile-assembly.js';
import { executeAssembly } from '../src/runtime/execute-assembly.js';
import { compare } from './es5-test-helpers.js';

test('typeof всех примитивов, native и VM функций', () => {
  assert.deepEqual(
    compare(
      'capture(typeof undefined);capture(typeof null);capture(typeof 1);capture(typeof "x");capture(typeof true);capture(typeof {});capture(typeof []);capture(typeof Object);capture(typeof function(){});capture(typeof 1n);',
    ).values,
    [
      'undefined',
      'object',
      'number',
      'string',
      'boolean',
      'object',
      'object',
      'function',
      'function',
      'bigint',
    ],
  );
});
test('typeof неизвестного имени возвращает undefined без ReferenceError', () => {
  assert.deepEqual(compare('capture(typeof missing);').values, ['undefined']);
});
test('typeof не подавляет TDZ лексической привязки', () => {
  assert.equal(
    compare('capture(typeof x);let x;').error.name,
    'ReferenceError',
  );
});
test('typeof var до объявления равен undefined', () => {
  assert.deepEqual(
    compare('capture(typeof x);var x=1;capture(typeof x);').values,
    ['undefined', 'number'],
  );
});
test('typeof читает актуальное внешнее значение и геттер каждый раз', () => {
  const factory = (events) => {
    let n = 0;
    return {
      get x() {
        events.push('get');
        return n++ === 0 ? 1 : 'text';
      },
    };
  };
  assert.deepEqual(
    compare('capture(typeof x);capture(typeof x);', factory).values,
    ['number', 'string'],
  );
});
test('typeof не скрывает ReferenceError, брошенный геттером', () => {
  const error = ReferenceError('getter');
  assert.throws(
    () =>
      executeAssembly(compileToAssembly('typeof external;'), {
        environment: {
          get external() {
            throw error;
          },
        },
      }),
    (e) => e === error,
  );
});
test('typeof MemberExpression не является безопасным доступом к null', () => {
  assert.equal(
    compare('capture(typeof missing.x);').error.name,
    'ReferenceError',
  );
  assert.equal(compare('capture(typeof null.x);').error.name, 'TypeError');
});
test('typeof lexical function скрывает внешнее имя', () => {
  assert.deepEqual(
    compare('function f(){}capture(typeof f);', () => ({ f: 42 })).values,
    ['function'],
  );
});
test('void исполняет аргумент один раз, возвращает undefined и сохраняет ошибки', () => {
  const result = compare(
    'var x=0;capture(void(x++));capture(x);capture(void function(){});',
  );
  assert.deepEqual(result.values, [undefined, 1, undefined]);
  assert.equal(compare('void missing();').error.name, 'ReferenceError');
});
const deletes = [
  [
    'собственное configurable свойство',
    'var o={x:1};capture(delete o.x);capture("x" in o);',
    [true, false],
  ],
  ['отсутствующее свойство', 'capture(delete ({}).missing);', [true]],
  [
    'унаследованное свойство не удаляется из прототипа',
    'var p={x:1};var o={__proto__:p};capture(delete o.x);capture(o.x);capture(p.x);',
    [true, 1, 1],
  ],
  [
    'массив сохраняет length и получает дыру',
    'var a=[1,2];capture(delete a[0]);capture(a.length);capture(0 in a);capture(a[1]);',
    [true, 2, false, 2],
  ],
  [
    'sloppy readonly property возвращает false',
    'capture(delete "hi"[0]);capture(delete "hi".length);',
    [false, false],
  ],
  [
    'примитив без свойства возвращает true',
    'capture(delete (42).x);capture(delete true.x);',
    [true, true],
  ],
  [
    'не-reference выражение исполняется и возвращает true',
    'var x=1;capture(delete (x+2));capture(delete (x=4));capture(x);',
    [true, true, 4],
  ],
  [
    'локальная переменная не удаляется',
    'var x=1;capture(delete x);capture(x);',
    [false, 1],
  ],
  [
    'parameter не удаляется',
    'function f(x){return delete x;}capture(f(1));',
    [false],
  ],
  [
    'имя VM функции не удаляется',
    'var f=function name(){return delete name;};capture(f());',
    [false],
  ],
  [
    'delete lexical TDZ не читает привязку',
    'capture(delete x);let x;',
    [false],
  ],
  [
    'comma снимает reference перед delete',
    'var o={x:1};capture(delete (0,o.x));capture(o.x);',
    [true, 1],
  ],
  [
    'delete результата функции исполняет вызов',
    'function f(){capture("call");return 1;}capture(delete f());',
    ['call', true],
  ],
];
for (const [name, source, expected] of deletes)
  test('delete: ' + name, () => {
    assert.deepEqual(compare(source).values, expected);
  });
test('delete strict nonconfigurable бросает, sloppy возвращает false', () => {
  const factory = () => ({
    object: Object.defineProperty({}, 'x', { value: 1, configurable: false }),
  });
  assert.deepEqual(compare('capture(delete object.x);', factory).values, [
    false,
  ]);
  assert.equal(
    compare('"use strict";delete object.x;', factory).error.name,
    'TypeError',
  );
});
test('strict delete identifier отклоняет парсер', () => {
  assert.throws(
    () => compileToAssembly('"use strict";var x=1;delete x;'),
    SyntaxError,
  );
});
test('delete не вызывает getter удаляемого свойства', () => {
  const factory = (events) => ({
    object: {
      get x() {
        events.push('getter');
        return 1;
      },
    },
  });
  const result = compare('capture(delete object.x);', factory);
  assert.deepEqual(result.values, [true]);
  assert.deepEqual(result.events, []);
});
test('delete вычисляет base, key и conversion в правильном порядке', () => {
  const factory = (events) => ({
    base() {
      events.push('base');
      return { x: 1 };
    },
    key() {
      events.push('key');
      return {
        toString() {
          events.push('coerce');
          return 'x';
        },
      };
    },
  });
  assert.deepEqual(compare('capture(delete base()[key()]);', factory).events, [
    'base',
    'key',
    'coerce',
  ]);
});
test('delete null вычисляет key expression, но не key coercion', () => {
  const factory = (events) => ({
    key() {
      events.push('key');
      return {
        toString() {
          events.push('coerce');
          return 'x';
        },
      };
    },
  });
  const result = compare('delete null[key()];', factory);
  assert.equal(result.error.name, 'TypeError');
  assert.deepEqual(result.events, ['key']);
});
test('delete работает с VM-функцией преобразования ключа', () => {
  assert.deepEqual(
    compare(
      'var o={x:1};var key={toString:function(){capture("key");return "x";}};capture(delete o[key]);capture(o.x);',
    ).values,
    ['key', true, undefined],
  );
});
test('delete Proxy ловушка получает исходный key, strict учитывает false', () => {
  const factory = (events) => ({
    object: new Proxy(
      { x: 1 },
      {
        deleteProperty(target, key) {
          events.push(key);
          return false;
        },
      },
    ),
  });
  assert.deepEqual(compare('capture(delete object.x);', factory).values, [
    false,
  ]);
  assert.equal(
    compare('"use strict";delete object.x;', factory).error.name,
    'TypeError',
  );
});
test('delete сохраняет исключения Proxy и инварианты', () => {
  const error = Error('delete');
  const object = new Proxy(
    {},
    {
      deleteProperty() {
        throw error;
      },
    },
  );
  assert.throws(
    () =>
      executeAssembly(compileToAssembly('delete object.x;'), {
        environment: { object },
      }),
    (e) => e === error,
  );
});
test('delete внешнего имени удаляет configurable own property окружения', () => {
  const environment = { external: 42 };
  assert.equal(
    executeAssembly('js.global.delete "external"\nreturn', { environment }),
    true,
  );
  assert.equal(Object.hasOwn(environment, 'external'), false);
  assert.equal(
    executeAssembly('js.global.typeof "external"\nreturn', { environment }),
    'undefined',
  );
});
test('delete неизвестного внешнего имени true, inherited не удаляется из прототипа', () => {
  const environment = Object.create({ external: 1 });
  assert.equal(
    executeAssembly('js.global.delete "missing"\nreturn', { environment }),
    true,
  );
  assert.equal(
    executeAssembly('js.global.delete "external"\nreturn', { environment }),
    true,
  );
  assert.equal(environment.external, 1);
});
test('компилятор delete global не вызывает get-ловушку окружения', () => {
  let reads = 0;
  const environment = new Proxy(
    { external: 1 },
    {
      get(t, k, r) {
        reads++;
        return Reflect.get(t, k, r);
      },
    },
  );
  executeAssembly(compileToAssembly('delete external;'), { environment });
  assert.equal(reads, 0);
  assert.equal(Object.hasOwn(environment, 'external'), false);
});
test('delete arguments index разрывает mapped привязку', () => {
  assert.deepEqual(
    compare(
      'function f(a){capture(delete arguments[0]);a=9;capture(arguments[0]);capture(a);}f(1);',
    ).values,
    [true, undefined, 9],
  );
});
