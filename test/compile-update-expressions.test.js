import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { compileToAssembly } from '../src/compiler/compile-assembly.js';
import { executeAssembly } from './es5-test-helpers.js';

function outcome(source, factory = () => ({}), native = false, options = {}) {
  const values = [],
    events = [];
  const environment = {
    Object,
    Array,
    Symbol,
    NaN,
    Infinity,
    undefined,
    ...factory(events),
    capture(v) {
      values.push(v);
    },
  };
  let error;
  try {
    if (native) vm.runInNewContext(source, environment);
    else
      executeAssembly(compileToAssembly(source), { ...options, environment });
  } catch (e) {
    error = e.name;
  }
  return { values, events, error };
}
function compare(source, factory) {
  const actual = outcome(source, factory),
    expected = outcome(source, factory, true);
  assert.deepEqual(actual, expected);
  return actual;
}

test('prefix/postfix ++ for let preserves old and new values', () => {
  assert.deepEqual(
    compare('let x=10;capture(x++);capture(x);capture(++x);capture(x);').values,
    [10, 11, 12, 12],
  );
});
test('prefix/postfix -- for var', () => {
  assert.deepEqual(
    compare('var x=10;capture(x--);capture(x);capture(--x);capture(x);').values,
    [10, 9, 8, 8],
  );
});
test('string is converted to Number, postfix returns Number', () => {
  assert.deepEqual(
    compare('var x="10";capture(x++);capture(x);x="20";capture(--x);').values,
    [10, 11, 19],
  );
});
test('boolean null undefined and non-numeric string', () => {
  compare(
    'var a=true,b=false,c=null,d=undefined,e="bad";capture(a++);capture(b--);capture(++c);capture(d++);capture(e--);capture(a);capture(b);',
  );
});
test('Number NaN Infinity and large numbers', () => {
  compare(
    'var a=NaN,b=Infinity,c=-Infinity,d=1e30;capture(a++);capture(--b);capture(c--);capture(d++);capture(d);',
  );
});
test('negative zero is preserved in postfix result', () => {
  compare(
    'var x=-0;capture(Object.is(x++,-0));capture(x);x=-0;capture(Object.is(x--,-0));capture(x);',
  );
});
test('BigInt preserves type and precision', () => {
  compare(
    'var x=900719925474099312345n;capture(x++);capture(x);capture(--x);capture(x--);capture(x);',
  );
});
test('multiple updates in arithmetic evaluate from left to right', () => {
  assert.deepEqual(
    compare(
      'var x=1;capture(100+x+++x++);capture(x);capture(++x+x--);capture(x);',
    ).values,
    [103, 3, 8, 3],
  );
});
test('update result can be assigned to another variable', () => {
  compare(
    'var x=10;var old=x++;var next=--x;capture(old);capture(next);capture(x);',
  );
});
test('nearest lexical binding is updated', () => {
  compare('var x=10;{let x=20;capture(x++);capture(x);}capture(x);');
});
test('closure mutates captured binding', () => {
  compare(
    'function make(){var x=10;return function(){return x++;};}var f=make();capture(f());capture(f());',
  );
});
test('parameter and mapped arguments are linked on update', () => {
  compare(
    'function f(a){capture(a++);capture(arguments[0]);capture(++arguments[0]);return a;}capture(f(10));',
  );
});
test('strict arguments is independent of parameter', () => {
  compare(
    'function f(a){"use strict";capture(a++);capture(arguments[0]);capture(++arguments[0]);return a;}capture(f(10));',
  );
});
test('duplicate parameters update correct arguments index', () => {
  compare(
    'function f(a,a){capture(a++);capture(arguments[0]);capture(arguments[1]);arguments[0]++;capture(a);}f(10,20);',
  );
});
test('TDZ is checked before value conversion', () => {
  for (const source of [
    'x++;let x;',
    '--x;const x=10;',
    'let x=x++;',
    '{x++;let x=42;}',
  ])
    assert.equal(compare(source, () => ({ x: 100 })).error, 'ReferenceError');
});
test('const is checked only on executed branch', () => {
  for (const source of ['const x=10;x++;', 'const x=10;--x;'])
    assert.equal(compare(source).error, 'TypeError');
  compare('const x=10;if(false){x++;}capture(x);');
});
test('const converts value first, then rejects assignment', () => {
  const factory = (events) => ({
    value: {
      valueOf() {
        events.push('convert');
        return 10;
      },
    },
  });
  assert.deepEqual(compare('const x=value;x++;', factory), {
    values: [],
    events: ['convert'],
    error: 'TypeError',
  });
});
test('sloppy self name of function expression ignores write', () => {
  compare('var f=function self(){capture(self++);capture(self===f);};f();');
});
test('strict self name of function forbids update', () => {
  assert.equal(
    compare('var f=function self(){"use strict";self++;};f();').error,
    'TypeError',
  );
});
test('static and computed properties', () => {
  compare(
    'var o={x:"10"};var key="x";capture(o.x++);capture(o[key]);capture(--o[key]);',
  );
});
test('array index and length', () => {
  compare(
    'var a=[1,2];capture(a[0]++);capture(++a.length);capture(a.length);capture(Object.keys(a).join(","));',
  );
});
test('invalid decrement of array length throws RangeError', () => {
  assert.equal(compare('var a=[];a.length--;').error, 'RangeError');
});
test('nonexistent property becomes NaN', () => {
  compare('var o={};capture(o.x++);capture(o.x);');
});
test('getter/setter receive proper this and update result', () => {
  compare(
    'var o={v:10,get x(){capture(this===o);return this.v;},set x(n){capture(n);this.v=n;}};capture(o.x++);capture(++o.x);capture(o.v);',
  );
});
test('getter and setter execute exactly once', () => {
  compare(
    'var reads=0,writes=0;var o={get x(){reads++;return "10";},set x(v){writes++;}};capture(o.x++);capture(reads);capture(writes);',
  );
});
test('setter return does not replace update result', () => {
  compare(
    'var o={get x(){return 10;},set x(v){return 999;}};capture(o.x++);capture(++o.x);',
  );
});
test('getter-only update respects strictness', () => {
  compare(
    'var o={get x(){return "10";}};capture(o.x++);capture(++o.x);capture(o.x);',
  );
  assert.equal(
    compare('"use strict";var o={get x(){return "10";}};o.x++;').error,
    'TypeError',
  );
});
test('readonly property updates only logically in sloppy', () => {
  const factory = () => ({ o: Object.freeze({ x: '10' }) });
  compare('capture(o.x++);capture(++o.x);capture(o.x);', factory);
  assert.equal(compare('"use strict";o.x++;', factory).error, 'TypeError');
});
test('primitive receiver and nullish base', () => {
  compare('var s="abc";capture(s.length++);capture(s.length);');
  assert.equal(
    compare('"use strict";var s="abc";s.length++;').error,
    'TypeError',
  );
  for (const source of ['var o=null;o.x++;', 'var o=undefined;++o.x;'])
    assert.equal(compare(source).error, 'TypeError');
});
test('object and key expression evaluate once', () => {
  const factory = (events) => {
    const o = { x: 10 };
    return {
      base() {
        events.push('base');
        return o;
      },
      key() {
        events.push('key');
        return 'x';
      },
    };
  };
  assert.deepEqual(compare('capture(base()[key()]++);', factory).events, [
    'base',
    'key',
  ]);
});
test('raw key is converted separately during get and set', () => {
  const factory = (events) => ({
    o: {
      get x() {
        events.push('get');
        return {
          valueOf() {
            events.push('number');
            return 10;
          },
        };
      },
      set x(v) {
        events.push('set:' + v);
      },
    },
    key: {
      [Symbol.toPrimitive](hint) {
        events.push('key:' + hint);
        return 'x';
      },
    },
  });
  assert.deepEqual(compare('capture(o[key]++);', factory).events, [
    'key:string',
    'get',
    'number',
    'key:string',
    'set:11',
  ]);
});
test('repeated key conversion can write to another property', () => {
  const factory = () => {
    let n = 0;
    return {
      o: { x: 10, y: 20 },
      key: {
        [Symbol.toPrimitive]() {
          return n++ === 0 ? 'x' : 'y';
        },
      },
    };
  };
  assert.deepEqual(
    compare('capture(o[key]++);capture(o.x);capture(o.y);', factory).values,
    [10, 10, 11],
  );
});
test('null base does not convert key', () => {
  const factory = (events) => ({
    key: {
      [Symbol.toPrimitive]() {
        events.push('key');
        return 'x';
      },
    },
  });
  assert.deepEqual(compare('var o=null;o[key]++;', factory), {
    values: [],
    events: [],
    error: 'TypeError',
  });
});
test('Symbol value throws before setter and repeated key coercion', () => {
  const factory = (events) => ({
    o: {
      get x() {
        events.push('get');
        return Symbol();
      },
      set x(v) {
        events.push('set');
      },
    },
    key: {
      toString() {
        events.push('key');
        return 'x';
      },
    },
  });
  assert.deepEqual(compare('o[key]++;', factory), {
    values: [],
    events: ['key', 'get'],
    error: 'TypeError',
  });
});
test('symbol key and symbol-valued property are distinguished', () => {
  compare(
    'var key=Symbol();var o={};o[key]=10;capture(o[key]++);capture(o[key]);',
  );
});
test('VM valueOf is used on ++/-- with proper receiver', () => {
  compare(
    'var value={n:10,valueOf:function(){capture(this===value);return this.n;}};var x=value;capture(x++);capture(x);',
  );
});
test('VM valueOf and fallback toString are called in correct order', () => {
  compare(
    'var x={valueOf:function(){capture(1);return {};},toString:function(){capture(2);return "10";}};capture(x++);capture(x);',
  );
});
test('VM Symbol.toPrimitive receives number hint', () => {
  compare(
    'var x={};x[Symbol.toPrimitive]=function(hint){capture(hint);return 10n;};capture(x++);capture(x);',
  );
});
test('getter conversion method is invoked and returns VM function', () => {
  compare(
    'var x={get valueOf(){capture("get method");return function(){capture("convert");return "10";};}};capture(x++);capture(x);',
  );
});
test('VM key.toString works for read write and updates', () => {
  compare(
    'var n=0;var key={toString:function(){n++;return "x";}};var o={x:10};capture(o[key]);capture(o[key]=20);capture(o[key]++);capture(o.x);capture(n);',
  );
});
test('VM key and value can convert with different hints', () => {
  compare(
    'var key={};key[Symbol.toPrimitive]=function(hint){capture(hint);return "x";};var value={};value[Symbol.toPrimitive]=function(hint){capture(hint);return 10;};var o={x:value};capture(o[key]++);',
  );
});
test('compound assignment preserves previous VM key coercion order', () => {
  compare(
    'var key={toString:function(){capture("key");return "x";}};var o={x:10};function rhs(){capture("rhs");return 2;}capture(o[key]+=rhs());',
  );
});
test('Proxy receives converted value and original receiver', () => {
  const factory = (events) => {
    let o;
    o = new Proxy(
      { x: '10' },
      {
        get(t, k, r) {
          events.push('get:' + k);
          return Reflect.get(t, k, r);
        },
        set(t, k, v, r) {
          events.push([k, v, r === o]);
          return Reflect.set(t, k, v, r);
        },
      },
    );
    return { o };
  };
  compare('capture(o.x++);', factory);
});
test('Proxy false set: sloppy returns result, strict throws', () => {
  const factory = () => ({
    o: new Proxy(
      { x: 10 },
      {
        set() {
          return false;
        },
      },
    ),
  });
  compare('capture(++o.x);capture(o.x);', factory);
  assert.equal(compare('"use strict";o.x++;', factory).error, 'TypeError');
});
test('postfix newline ASI does not turn into postfix update', () => {
  compare('var x=1;x\n++x;capture(x);');
});
test('while supports i++ and --i', () => {
  compare(
    'var i=0,sum=0;while(i<3){sum+=i++;}capture(sum);while(i>0){--i;}capture(i);',
  );
});
test('unexecuted logical and conditional branches do not update', () => {
  compare('var x=10;false&&x++;true||++x;false?x++:0;capture(x);');
});
test('compilation does not invoke conversion methods', () => {
  const result = compileToAssembly(
    'var x={valueOf:function(){missing();}};x++;',
  );
  assert.ok(typeof result === 'string' || result instanceof String);
});
test('unresolved update target is rejected explicitly', () => {
  assert.throws(
    () => compileToAssembly('external++;'),
    /Update of unresolved identifier/,
  );
});
test('unsupported operators are not enabled accidentally', () => {
  for (const source of ['var x=1;x **=2;', 'var x=1;x ||=2;', 'with({}){}'])
    assert.throws(() => compileToAssembly(source), SyntaxError);
});
