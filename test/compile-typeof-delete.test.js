import test from 'node:test';
import assert from 'node:assert/strict';
import { compileToAssembly } from '../src/compiler/compile-assembly.js';
import { executeAssembly } from './es5-test-helpers.js';
import { compare } from './es5-test-helpers.js';

test('typeof all primitives, native and VM functions', () => {
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
test('typeof unknown identifier returns undefined without ReferenceError', () => {
  assert.deepEqual(compare('capture(typeof missing);').values, ['undefined']);
});
test('typeof does not suppress TDZ of lexical binding', () => {
  assert.equal(
    compare('capture(typeof x);let x;').error.name,
    'ReferenceError',
  );
});
test('typeof var before declaration returns undefined', () => {
  assert.deepEqual(
    compare('capture(typeof x);var x=1;capture(typeof x);').values,
    ['undefined', 'number'],
  );
});
test('typeof reads current external value and getter each time', () => {
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
test('typeof does not suppress ReferenceError thrown by getter', () => {
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
test('typeof MemberExpression is not a safe access on null', () => {
  assert.equal(
    compare('capture(typeof missing.x);').error.name,
    'ReferenceError',
  );
  assert.equal(compare('capture(typeof null.x);').error.name, 'TypeError');
});
test('typeof lexical function shadows outer identifier', () => {
  assert.deepEqual(
    compare('function f(){}capture(typeof f);', () => ({ f: 42 })).values,
    ['function'],
  );
});
test('void evaluates argument once, returns undefined and preserves errors', () => {
  const result = compare(
    'var x=0;capture(void(x++));capture(x);capture(void function(){});',
  );
  assert.deepEqual(result.values, [undefined, 1, undefined]);
  assert.equal(compare('void missing();').error.name, 'ReferenceError');
});
const deletes = [
  [
    'own configurable property',
    'var o={x:1};capture(delete o.x);capture("x" in o);',
    [true, false],
  ],
  ['missing property', 'capture(delete ({}).missing);', [true]],
  [
    'inherited property is not deleted from prototype',
    'var p={x:1};var o={__proto__:p};capture(delete o.x);capture(o.x);capture(p.x);',
    [true, 1, 1],
  ],
  [
    'array preserves length and acquires hole',
    'var a=[1,2];capture(delete a[0]);capture(a.length);capture(0 in a);capture(a[1]);',
    [true, 2, false, 2],
  ],
  [
    'sloppy readonly property returns false',
    'capture(delete "hi"[0]);capture(delete "hi".length);',
    [false, false],
  ],
  [
    'primitive without property returns true',
    'capture(delete (42).x);capture(delete true.x);',
    [true, true],
  ],
  [
    'non-reference expression evaluates and returns true',
    'var x=1;capture(delete (x+2));capture(delete (x=4));capture(x);',
    [true, true, 4],
  ],
  [
    'local variable is not deleted',
    'var x=1;capture(delete x);capture(x);',
    [false, 1],
  ],
  [
    'parameter is not deleted',
    'function f(x){return delete x;}capture(f(1));',
    [false],
  ],
  [
    'VM function name is not deleted',
    'var f=function name(){return delete name;};capture(f());',
    [false],
  ],
  [
    'delete lexical TDZ does not read binding',
    'capture(delete x);let x;',
    [false],
  ],
  [
    'comma drops reference before delete',
    'var o={x:1};capture(delete (0,o.x));capture(o.x);',
    [true, 1],
  ],
  [
    'delete of function call result executes call',
    'function f(){capture("call");return 1;}capture(delete f());',
    ['call', true],
  ],
];
for (const [name, source, expected] of deletes)
  test('delete: ' + name, () => {
    assert.deepEqual(compare(source).values, expected);
  });
test('delete strict nonconfigurable throws, sloppy returns false', () => {
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
test('strict delete identifier is rejected by parser', () => {
  assert.throws(
    () => compileToAssembly('"use strict";var x=1;delete x;'),
    SyntaxError,
  );
});
test('delete does not invoke getter of deleted property', () => {
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
test('delete evaluates base, key and conversion in correct order', () => {
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
test('delete null evaluates key expression, but not key coercion', () => {
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
test('delete works with VM function key conversion', () => {
  assert.deepEqual(
    compare(
      'var o={x:1};var key={toString:function(){capture("key");return "x";}};capture(delete o[key]);capture(o.x);',
    ).values,
    ['key', true, undefined],
  );
});
test('delete Proxy trap receives original key, strict respects false', () => {
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
test('delete preserves Proxy exceptions and invariants', () => {
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
test('delete of external name deletes configurable own property of environment', () => {
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
test('delete of unknown external name returns true, inherited not deleted from prototype', () => {
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
test('compiler delete global does not invoke get trap of environment', () => {
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
test('delete arguments index breaks mapped binding', () => {
  assert.deepEqual(
    compare(
      'function f(a){capture(delete arguments[0]);a=9;capture(arguments[0]);capture(a);}f(1);',
    ).values,
    [true, undefined, 9],
  );
});
