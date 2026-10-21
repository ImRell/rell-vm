import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { compileToAssembly } from '../src/compiler/compile-assembly.js';
import { executeAssembly } from './es5-test-helpers.js';

function run(source, extra = {}, options = {}) {
  const values = [];
  executeAssembly(compileToAssembly(source), {
    ...options,
    environment: {
      Object,
      Array,
      Reflect,
      JSON,
      undefined,
      ...extra,
      capture(value) {
        values.push(value);
      },
    },
  });
  return values;
}
function compare(source, extra = {}) {
  const expected = [];
  vm.runInNewContext(source, {
    ...extra,
    capture(value) {
      expected.push(value);
    },
  });
  const actual = run(source, extra);
  assert.deepEqual(actual, expected);
  return actual;
}

test('empty object and array are created without external constructors', () => {
  let object, array;
  executeAssembly(compileToAssembly('capture({});capture([]);'), {
    environment: {
      capture(v) {
        if (Array.isArray(v)) array = v;
        else object = v;
      },
      Object: null,
      Array: null,
    },
  });
  assert.equal(Object.getPrototypeOf(object), Object.prototype);
  assert.ok(Array.isArray(array));
});
test('string, numeric and reserved word keys', () => {
  assert.deepEqual(
    compare(
      'var o={name:"Rell", "with space":2, 1:3, default:4};capture(o.name);capture(o["with space"]);capture(o[1]);capture(o.default);',
    ),
    ['Rell', 2, 3, 4],
  );
});
test('nested object/array literals preserve values', () => {
  compare(
    'var o={items:[1,{value:42}],nested:{flag:true}};capture(o.items[1].value);capture(o.nested.flag);',
  );
});
test('values evaluate from left to right', () => {
  compare(
    'var n=0;function next(){n+=1;return n;}var o={a:next(),b:next(),c:[next(),next()]};capture(o.a);capture(o.b);capture(o.c[0]);capture(o.c[1]);',
  );
});
test('each evaluation of a literal creates an independent instance', () => {
  compare(
    'function make(){return {items:[]};}var a=make();var b=make();a.items.push(1);capture(a===b);capture(a.items===b.items);capture(b.items.length);',
  );
});
test('literals inside while are created anew', () => {
  compare(
    'var first;var i=0;while(i<2){var o={value:i};if(i===0){first=o;}i+=1;}capture(first===o);capture(first.value);capture(o.value);',
  );
});
test('holes differ from explicit undefined', () => {
  compare(
    'var a=[,undefined,,3,];capture(a.length);capture(Object.keys(a).join(","));capture(Object.prototype.hasOwnProperty.call(a,0));capture(Object.prototype.hasOwnProperty.call(a,1));',
  );
});
test('trailing comma does not create extra element', () => {
  compare(
    'capture([].length);capture([,].length);capture([,,].length);capture([1,].length);capture([1,,].length);',
  );
});
test('native array methods push/pop/join work', () => {
  compare(
    'var a=[1,2];capture(a.push(3));capture(a.pop());capture(a.join("-"));',
  );
});
test('index write and length use array semantics', () => {
  compare(
    'var a=[1,2];a[4]=5;capture(a.length);a.length=1;capture(a[1]);capture(a.join(","));',
  );
});
test('duplicate data keys are overridden preserving initial effect order', () => {
  compare(
    'var n=0;function next(){n+=1;return n;}var o={x:next(),y:next(),x:next()};capture(o.x);capture(o.y);capture(Object.keys(o).join(","));',
  );
});
test('method in ES5 notation receives object as this', () => {
  compare(
    'var o={x:10,add:function(n){this.x+=n;return this.x;}};capture(o.add(5));capture(o.x);',
  );
});
test('data descriptors writable enumerable configurable', () => {
  compare(
    'var o={x:42};var d=Object.getOwnPropertyDescriptor(o,"x");capture(d.value);capture(d.writable);capture(d.enumerable);capture(d.configurable);',
  );
});
test('getter is created without executing body', () => {
  compare(
    'var n=0;var o={get x(){n+=1;return 42;}};capture(n);capture(o.x);capture(n);',
  );
});
test('getter receives this and reads captured binding', () => {
  compare(
    'var outer=5;var o={base:10,get x(){return this.base+outer;}};capture(o.x);outer=7;capture(o.x);',
  );
});
test('setter receives this and assigned value', () => {
  compare(
    'var o={base:0,set x(v){this.base=v*2;}};capture(o.x=7);capture(o.base);',
  );
});
test('getter and setter combine regardless of order', () => {
  for (const properties of [
    'get x(){return this.value;},set x(v){this.value=v;}',
    'set x(v){this.value=v;},get x(){return this.value;}',
  ])
    compare(
      `var o={value:1,${properties}};capture(o.x);capture(o.x+=2);capture(o.value);`,
    );
});
test('duplicate getter preserves setter and replaces getter', () => {
  compare(
    'var o={value:0,get x(){return 1;},set x(v){this.value=v;},get x(){return 2;}};o.x=7;capture(o.x);capture(o.value);',
  );
});
test('data property replaces accessor pair without calling getter', () => {
  compare(
    'var n=0;var o={get x(){n+=1;return 1;},set x(v){n+=1;},x:42};capture(n);capture(o.x);capture(Object.getOwnPropertyDescriptor(o,"x").get);',
  );
});
test('accessor replaces data property without inheriting opposite accessor', () => {
  compare(
    'var o={set x(v){capture(99);},x:42,get x(){return 7;}};capture(o.x);capture(Object.getOwnPropertyDescriptor(o,"x").set);',
  );
});
test('accessor descriptor has correct flags and arity', () => {
  compare(
    'var o={get x(){return 1;},set x(v){}};var d=Object.getOwnPropertyDescriptor(o,"x");capture(d.enumerable);capture(d.configurable);capture(d.get.length);capture(d.set.length);capture(d.value);',
  );
});
test('accessor wrapper is accessible to native descriptor API and call', () => {
  compare(
    'var o={x:10,get value(){return this.x;},set value(v){this.x=v;}};var d=Object.getOwnPropertyDescriptor(o,"value");capture(d.get.call({x:42}));d.set.call(o,7);capture(o.x);',
  );
});
test('inherited getter/setter receives actual receiver', () => {
  compare(
    'var proto={get x(){return this.value;},set x(v){this.value=v;}};var o=Object.create(proto);o.x=42;capture(o.x);capture(proto.value);',
  );
});
test('Reflect.get/set passes specified receiver', () => {
  compare(
    'var o={get x(){return this.value;},set x(v){this.value=v;}};var receiver={value:10};capture(Reflect.get(o,"x",receiver));Reflect.set(o,"x",42,receiver);capture(receiver.value);',
  );
});
test('getter-only write is ignored in sloppy and throws in strict', () => {
  compare('var o={get x(){return 1;}};capture(o.x=42);capture(o.x);');
  assert.throws(
    () => run('"use strict";var o={get x(){return 1;}};o.x=42;'),
    TypeError,
  );
});
test('setter-only read returns undefined', () => {
  compare('var o={set x(v){capture(v);}};capture(o.x);o.x=42;');
});
test('accessor has own arguments and can invoke VM function', () => {
  compare(
    'function twice(v){return v*2;}var o={get x(){capture(arguments.length);return twice(7);},set x(v){capture(arguments[0]);capture(arguments.length);}};capture(o.x);o.x=42;',
  );
});
test('getter can return closure preserving environment', () => {
  compare(
    'function make(v){return {get f(){return function(n){v+=n;return v;};}};}var o=make(10);var f=o.f;capture(f(2));capture(f(3));',
  );
});
test('nested accessors return to correct frame', () => {
  compare(
    'var inner={get x(){return 2;}};var outer={get x(){return 10+inner.x;}};function f(){return 100+outer.x;}capture(f());',
  );
});
test('getter can return object and array', () => {
  compare(
    'var o={get x(){return {items:[1,2]};}};capture(o.x.items.join(","));',
  );
});
test('literal creation does not invoke inherited setter', () => {
  let calls = 0;
  const name = '__rell_literal_test__';
  Object.defineProperty(Object.prototype, name, {
    configurable: true,
    set(v) {
      calls++;
    },
  });
  try {
    assert.deepEqual(run(`var o={${name}:42};capture(o.${name});`), [42]);
    assert.equal(calls, 0);
  } finally {
    delete Object.prototype[name];
  }
});
test('literal does not depend on external Object and Array', () => {
  assert.deepEqual(
    run('var a=[1,2];var o={x:3};capture(a[1]+o.x);', {
      Object: () => {
        assert.fail();
      },
      Array: () => {
        assert.fail();
      },
    }),
    [5],
  );
});
test('__proto__ literal setter matches modern parser/Node', () => {
  compare(
    'var proto={x:42};var o={__proto__:proto};capture(o.x);capture(Object.prototype.hasOwnProperty.call(o,"__proto__"));capture(Object.getPrototypeOf({__proto__:null}));capture(Object.getPrototypeOf({__proto__:7})===Object.prototype);',
  );
});
test('__proto__ getter is a standard own accessor property', () => {
  compare(
    'var o={get __proto__(){return 42;}};capture(o.__proto__);capture(Object.prototype.hasOwnProperty.call(o,"__proto__"));',
  );
});
test('element error stops evaluation of subsequent elements', () => {
  const error = {},
    events = [];
  assert.throws(
    () =>
      run('var a=[first(),bad(),last()];', {
        first() {
          events.push(1);
          return 1;
        },
        bad() {
          events.push(2);
          throw error;
        },
        last() {
          events.push(3);
        },
      }),
    (e) => e === error,
  );
  assert.deepEqual(events, [1, 2]);
});
test('property value error stops literal evaluation', () => {
  const error = {},
    events = [];
  assert.throws(
    () =>
      run('var o={x:bad(),y:last()};', {
        bad() {
          events.push(1);
          throw error;
        },
        last() {
          events.push(2);
        },
      }),
    (e) => e === error,
  );
  assert.deepEqual(events, [1]);
});
test('compilation does not evaluate elements and accessor bodies', () => {
  const text = compileToAssembly(
    'var o={x:missing(),get y(){unknown();}};var a=[other()];',
  );
  assert.ok(typeof text === 'string' || text instanceof String);
  assert.match(String(text), /js\.object\.create/);
  assert.match(String(text), /js\.array\.create/);
});
test('ES6 spread/shorthand/computed/method require normalization', () => {
  for (const source of [
    'var a=[...values];',
    'var o={...other};',
    'var o={value};',
    'var o={[key]:42};',
    'var o={method(){return 1;}};',
  ])
    assert.throws(() => compileToAssembly(source), SyntaxError);
});
test('error in accessor preserves filename and position', () => {
  assert.throws(
    () =>
      compileToAssembly('var o={get x(){\n  x => x;\n}};', {
        filename: 'literal.js',
      }),
    /literal\.js:2:3: Unsupported expression: ArrowFunctionExpression/,
  );
});

test('strict getter preserves null and primitive this on call', () => {
  compare(
    'var o={get x(){"use strict";return this;}};var get=Object.getOwnPropertyDescriptor(o,"x").get;capture(get.call(null));capture(get.call(7));',
  );
});
test('sloppy getter boxes primitive this', () => {
  compare(
    'var o={get x(){return Object.prototype.toString.call(this);}};var get=Object.getOwnPropertyDescriptor(o,"x").get;capture(get.call(7));',
  );
});
test('accessor strictness is inherited from enclosing function', () => {
  compare(
    'function make(){"use strict";return {get x(){return this;}};}var o=make();var get=Object.getOwnPropertyDescriptor(o,"x").get;capture(get.call(7));',
  );
});
test('var inside accessor does not hoist to outer frame', () => {
  compare(
    'var x=10;var o={get value(){var x=42;return x;}};capture(o.value);capture(x);',
  );
});
test('accessors from different factory invocations do not share bindings', () => {
  compare(
    'function make(v){return {get x(){return v;},set x(n){v=n;}};}var a=make(10);var b=make(20);a.x=42;capture(a.x);capture(b.x);',
  );
});
test('accessor via native JSON.stringify preserves VM frame', () => {
  compare(
    'var n=0;var o={get x(){n+=1;return 42;}};capture(JSON.stringify(o));capture(n);',
  );
});
