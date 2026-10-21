import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { compileToAssembly } from '../src/compiler/compile-assembly.js';
import { executeAssembly } from './es5-test-helpers.js';
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
test('comma returns only the last value', () => {
  assert.deepEqual(compare('capture((1,2,3));'), [3]);
});
test('comma evaluates side effects from left to right', () => {
  assert.deepEqual(
    compare('var n=0;capture((capture(n++),capture(n++),n++));capture(n);'),
    [0, 1, 2, 3],
  );
});
test('nested comma preserves outer arithmetic stack', () => {
  assert.deepEqual(
    compare('var n=0;capture(100+(n++,(n++,n++)));capture(n);'),
    [102, 3],
  );
});
test('comma in return preserves result of last expression', () => {
  compare('function f(){var x=1;return (x++,x*2);}capture(f());');
});
test('comma does not preserve object reference for method call', () => {
  compare(
    'var o={method:function(){"use strict";return this;}};capture((0,o.method)());',
  );
});
test('comma evaluates callee before arguments', () => {
  compare(
    'var o={get method(){capture("get");return function(v){"use strict";capture(this);capture(v);};}};function arg(){capture("arg");return 42;}(capture("first"),o.method)(arg());',
  );
});
test('comma in logical branch preserves short-circuiting', () => {
  compare(
    'var n=0;false&&(n++,n++);true||(n++,n++);capture(n);capture(true&&(n++,42));capture(n);',
  );
});
test('comma in conditional executes only selected branch', () => {
  compare('var n=0;capture(true?(n++,42):(n++,99));capture(n);');
});
test('comma in computed property key', () => {
  compare(
    'var n=0;var o={x:10};capture(o[(n++,"x")]++);capture(n);capture(o.x);',
  );
});
test('comma in RHS returns precisely the last assigned value', () => {
  compare('var x=0,n=0;capture(x=(n++,42));capture(x);capture(n);');
});
test('comma supports functions, objects and arrays as values', () => {
  compare(
    'var o=(1,{x:42});capture(o.x);var a=(1,[2,3]);capture(a.join(","));var f=(1,function(){return 7;});capture(f());',
  );
});
test('error in intermediate expression prevents subsequent expressions', () => {
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
test('BigInt literal type is preserved across comma', () => {
  compare('capture((0,10n));');
});
test('compilation validates unsupported expressions even before the last one', () => {
  assert.throws(
    () => compileToAssembly('(x => x,42);'),
    /Unsupported expression: ArrowFunctionExpression/,
  );
});
test('sequence compilation does not evaluate source', () => {
  const result = compileToAssembly('(first(),second(),third());');
  assert.ok(typeof result === 'string' || result instanceof String);
});
