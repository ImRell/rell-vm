import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { compileToAssembly } from '../src/compiler/compile-assembly.js';
import { executeAssembly } from './es5-test-helpers.js';

function outcome(source, factory = () => ({}), native = false) {
  const values = [],
    events = [];
  const environment = Object.defineProperties(
    {
      Object,
      Array,
      undefined,
      NaN,
      capture(value) {
        values.push(value);
      },
    },
    Object.getOwnPropertyDescriptors(factory(events)),
  );
  let error;
  try {
    if (native) vm.runInNewContext(source, environment, { timeout: 1000 });
    else
      executeAssembly(compileToAssembly(source), {
        environment,
        maxSteps: 100000,
      });
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

test('for-in var iterates keys and retains last value', () => {
  assert.deepEqual(
    compare('for(var k in {a:1,b:2}){capture(k);}capture(k);').values,
    ['a', 'b', 'b'],
  );
});
test('empty object does not assign key to existing let', () => {
  assert.deepEqual(
    compare('let k="initial";for(k in {}){capture(k);}capture(k);').values,
    ['initial'],
  );
});
test('var is hoisted even in empty and unreachable loop', () => {
  assert.deepEqual(
    compare(
      'capture(k);if(false){for(var k in {a:1}){}}for(var empty in {}){}capture(empty);',
    ).values,
    [undefined, undefined],
  );
});
test('RHS is evaluated once before key assignment', () => {
  const factory = (events) => ({
    source() {
      events.push('rhs');
      return { a: 1, b: 2 };
    },
  });
  assert.deepEqual(
    compare('var k="before";for(k in source()){capture(k);}', factory).events,
    ['rhs'],
  );
});
test('rebinding source variable does not change iterated object', () => {
  assert.deepEqual(
    compare('var o={a:1,b:2};for(var k in o){capture(k);o={z:1};}').values,
    ['a', 'b'],
  );
});
test('key order, prototypes, non-enumerable, and symbol keys', () => {
  const factory = () => {
    const object = Object.assign(Object.create({ p: 1 }), {
      b: 2,
      3: 3,
      1: 1,
      [Symbol('s')]: 5,
    });
    Object.defineProperty(object, 'hidden', { value: 1 });
    return { object };
  };
  assert.deepEqual(compare('for(var k in object)capture(k);', factory).values, [
    '1',
    '3',
    'b',
    'p',
  ]);
});
test('non-enumerable property shadows prototype property of same name', () => {
  const factory = () => {
    const object = Object.create({ a: 1, b: 2 });
    Object.defineProperty(object, 'a', { value: 9 });
    return { object };
  };
  assert.deepEqual(compare('for(var k in object)capture(k);', factory).values, [
    'b',
  ]);
});
test('property value getter is not invoked during enumeration', () => {
  const factory = (events) => ({
    object: {
      get a() {
        events.push('get');
        return 1;
      },
    },
  });
  assert.deepEqual(
    compare('for(var k in object)capture(k);', factory).events,
    [],
  );
});
test('property value getter executes only upon explicit access', () => {
  const factory = (events) => ({
    object: {
      get a() {
        events.push('get');
        return 4;
      },
    },
  });
  assert.deepEqual(
    compare('for(var k in object)capture(object[k]);', factory),
    { values: [4], events: ['get'], error: undefined },
  );
});
test('null and undefined skip body without error', () => {
  assert.deepEqual(
    compare(
      'var k="old";for(k in null)capture("bad");for(k in undefined)capture("bad");capture(k);',
    ).values,
    ['old'],
  );
});
test('string enumerates indices, array skips holes', () => {
  assert.deepEqual(
    compare('for(var k in "hi")capture(k);for(k in [,1,,3])capture(k);').values,
    ['0', '1', '1', '3'],
  );
});
test('numbers, boolean, BigInt, Symbol produce zero iterations', () => {
  for (const value of [1, true, 2n, Symbol('s')])
    assert.deepEqual(
      compare('for(var k in value)capture(k);', () => ({ value })).values,
      [],
    );
});
test('break does not visit subsequent keys', () => {
  assert.deepEqual(
    compare('for(var k in {a:1,b:2}){capture(k);break;}capture(k);').values,
    ['a', 'a'],
  );
});
test('continue advances to next key', () => {
  assert.deepEqual(
    compare('for(var k in {a:1,b:2,c:3}){if(k==="b")continue;capture(k);}')
      .values,
    ['a', 'c'],
  );
});
test('nested for-in loops have independent state', () => {
  assert.deepEqual(
    compare('for(var a in {x:1,y:2})for(var b in {p:1,q:2})capture(a+b);')
      .values,
    ['xp', 'xq', 'yp', 'yq'],
  );
});
test('inner for-in break does not terminate outer loop', () => {
  assert.deepEqual(
    compare(
      'for(var a in {x:1,y:2}){for(var b in {p:1,q:2}){capture(a+b);break;}capture(a);}',
    ).values,
    ['xp', 'x', 'yp', 'y'],
  );
});
test('inner for-in continue does not affect outer loop', () => {
  assert.deepEqual(
    compare(
      'for(var a in {x:1,y:2}){for(var b in {p:1,q:2}){if(b==="p")continue;capture(a+b);}capture(a);}',
    ).values,
    ['xq', 'x', 'yq', 'y'],
  );
});
test('for-in combines with for and do-while', () => {
  assert.deepEqual(
    compare(
      'for(var i=0;i<2;i++){for(var k in {a:1,b:2}){var n=0;do{n++;if(n<2)continue;capture(i+k+n);}while(n<2);}}',
    ).values,
    ['0a2', '0b2', '1a2', '1b2'],
  );
});
test('outer break and continue are restored after inner loop', () => {
  assert.deepEqual(
    compare(
      'var n=0;while(n<3){n++;for(var k in {a:1}){break;}if(n<3)continue;capture(n);break;}',
    ).values,
    [3],
  );
});
test('break pops lexical blocks leaving outer environment', () => {
  assert.deepEqual(
    compare(
      'let outer=10;for(var k in {a:1}){{let outer=20;break;}}capture(outer);',
    ).values,
    [10],
  );
});
test('continue pops lexical blocks before next iteration', () => {
  assert.deepEqual(
    compare(
      'let outer=10;for(var k in {a:1,b:2}){{let outer=k;capture(outer);continue;}}capture(outer);',
    ).values,
    ['a', 'b', 10],
  );
});
test('new block per iteration creates distinct captured cells', () => {
  assert.deepEqual(
    compare(
      'var readers=[];var i=0;for(var k in {a:1,b:2}){let copy=k;readers[i++]=function(){return copy;};continue;}capture(readers[0]());capture(readers[1]());',
    ).values,
    ['a', 'b'],
  );
});
test('var in loop remains shared cell across closures', () => {
  assert.deepEqual(
    compare(
      'var readers=[];var i=0;for(var k in {a:1,b:2}){readers[i++]=function(){return k;};}capture(readers[0]());capture(readers[1]());',
    ).values,
    ['b', 'b'],
  );
});
test('return from body does not continue enumeration', () => {
  assert.deepEqual(
    compare(
      'function f(){for(var k in {a:1,b:2}){let value=k;return value;}return "empty";}capture(f());capture(f());',
    ).values,
    ['a', 'a'],
  );
});
test('recursive calls do not share temporary local slots', () => {
  assert.deepEqual(
    compare(
      'function f(n){var s="";for(var k in {a:1,b:2}){s+=k;if(n>0)s+=f(n-1);}return s;}capture(f(1));',
    ).values,
    ['aabbab'],
  );
});
test('assignment to existing outer closure binding', () => {
  assert.deepEqual(
    compare('var k="old";function f(){for(k in {a:1,b:2}){}}f();capture(k);')
      .values,
    ['b'],
  );
});
test('target TDZ is checked only when key exists', () => {
  assert.equal(compare('for(k in {a:1}){}let k;').error, 'ReferenceError');
  assert.equal(compare('for(k in {}){}let k;').error, undefined);
});
test('RHS read TDZ is preserved', () => {
  assert.equal(
    compare('for(var k in object){}let object;').error,
    'ReferenceError',
  );
});
test('const target disallows write, empty loop does not write', () => {
  assert.equal(compare('const k="old";for(k in {a:1}){}').error, 'TypeError');
  assert.deepEqual(compare('const k="old";for(k in {}){}capture(k);').values, [
    'old',
  ]);
});
test('named function expression name preserves sloppy/strict write rules', () => {
  assert.deepEqual(
    compare(
      'var f=function name(){for(name in {a:1}){}return name===f;};capture(f());',
    ).values,
    [true],
  );
  assert.equal(
    compare('var f=function name(){"use strict";for(name in {a:1}){}};f();')
      .error,
    'TypeError',
  );
});
test('member target is evaluated afresh for each key', () => {
  const factory = (events) => {
    const target = {
      set value(v) {
        events.push('set:' + v);
      },
    };
    return {
      base() {
        events.push('base');
        return target;
      },
      key() {
        events.push('key');
        return 'value';
      },
      rhs() {
        events.push('rhs');
        return { a: 1, b: 2 };
      },
    };
  };
  assert.deepEqual(
    compare('for(base()[key()] in rhs()){capture("body");}', factory).events,
    ['rhs', 'base', 'key', 'set:a', 'base', 'key', 'set:b'],
  );
});
test('empty RHS does not evaluate member target', () => {
  const factory = (events) => ({
    base() {
      events.push('bad');
      throw Error('base');
    },
  });
  assert.deepEqual(
    compare('for(base().x in {})capture("bad");', factory).events,
    [],
  );
});
test('member target allows modifying object and computed key from body', () => {
  assert.deepEqual(
    compare(
      'var objects=[{},{}];var i=0;for(objects[i++].key in {a:1,b:2}){}capture(objects[0].key);capture(objects[1].key);capture(i);',
    ).values,
    ['a', 'b', 2],
  );
});
test('member write does not read old value', () => {
  const factory = (events) => ({
    target: {
      get x() {
        throw Error('read');
      },
      set x(v) {
        events.push(v);
      },
    },
  });
  assert.deepEqual(compare('for(target.x in {a:1,b:2}){}', factory).events, [
    'a',
    'b',
  ]);
});
test('strict write to readonly target throws TypeError, sloppy ignores', () => {
  const factory = () => ({ target: Object.freeze({ x: 0 }) });
  assert.equal(
    compare('"use strict";for(target.x in {a:1}){}', factory).error,
    'TypeError',
  );
  assert.deepEqual(
    compare('for(target.x in {a:1}){}capture(target.x);', factory).values,
    [0],
  );
});
test('null member target evaluates key before write error', () => {
  const factory = (events) => ({
    key() {
      events.push('key');
      return 'x';
    },
  });
  const result = compare('for(null[key()] in {a:1}){}', factory);
  assert.equal(result.error, 'TypeError');
  assert.deepEqual(result.events, ['key']);
});
test('VM setter can execute nested loop and return to outer', () => {
  assert.deepEqual(
    compare(
      'var target={set x(v){for(var inner in {z:1})capture(v+inner);}};for(target.x in {a:1,b:2})capture("body");',
    ).values,
    ['az', 'body', 'bz', 'body'],
  );
});
test('legacy var initializer runs before RHS even for empty object', () => {
  const factory = (events) => ({
    init() {
      events.push('init');
      return 'seed';
    },
    rhs() {
      events.push('rhs');
      return {};
    },
  });
  const result = compare(
    'for(var k=init() in rhs())capture("bad");capture(k);',
    factory,
  );
  assert.deepEqual(result.events, ['init', 'rhs']);
  assert.deepEqual(result.values, ['seed']);
});
test('deleting unvisited property is visible to subsequent iteration', () => {
  const factory = () => {
    const object = { a: 1, b: 2, c: 3 };
    return {
      object,
      remove() {
        delete object.b;
      },
    };
  };
  assert.deepEqual(
    compare('for(var k in object){capture(k);if(k==="a")remove();}', factory)
      .values,
    ['a', 'c'],
  );
});
test('enumerable and prototype mutations mirror native engine behavior', () => {
  const factory = () => {
    const prototype = { p: 1, q: 2 },
      object = Object.assign(Object.create(prototype), { a: 1, b: 2 });
    return {
      object,
      mutate() {
        Object.defineProperty(object, 'b', { enumerable: false });
        delete prototype.q;
        object.newKey = 1;
      },
    };
  };
  compare('for(var k in object){capture(k);if(k==="a")mutate();}', factory);
});
test('Proxy enumeration exception is preserved without replacement', () => {
  const error = Error('enumeration'),
    object = new Proxy(
      {},
      {
        ownKeys() {
          throw error;
        },
      },
    );
  assert.throws(
    () =>
      executeAssembly(compileToAssembly('for(var k in object){}'), {
        environment: { object },
      }),
    (e) => e === error,
  );
});
test('RHS exception does not enter body', () => {
  const factory = (events) => ({
    rhs() {
      events.push('rhs');
      throw RangeError('rhs');
    },
  });
  assert.deepEqual(compare('for(var k in rhs())capture("bad");', factory), {
    values: [],
    events: ['rhs'],
    error: 'RangeError',
  });
});
test('infinite for-in body stops at global step limit', () => {
  assert.throws(
    () =>
      executeAssembly(compileToAssembly('for(var k in {a:1})while(true){}'), {
        maxSteps: 100,
      }),
    /Instruction limit exceeded: 100/,
  );
});
test('compilation does not evaluate RHS and returns valid instructions', () => {
  const text = compileToAssembly('for(var k in mustNotRun()){}');
  assert.ok(typeof text === 'string' || text instanceof String);
  assert.match(String(text), /js\.for_in\.create/);
  assert.match(String(text), /js\.for_in\.next/);
});
test('repeated runs are isolated and do not create global vars', () => {
  const environment = {
      capture(v) {
        values.push(v);
      },
    },
    values = [];
  const text = compileToAssembly('for(var k in {a:1,b:2})capture(k);');
  executeAssembly(text, { environment });
  executeAssembly(text, { environment });
  assert.deepEqual(values, ['a', 'b', 'a', 'b']);
  assert.equal(Object.hasOwn(environment, 'k'), false);
});
test('for-in let/const currently require normalization', () => {
  for (const source of ['for(let k in {}){}', 'for(const k in {}){}'])
    assert.throws(
      () => compileToAssembly(source),
      /Lexical for-in bindings require normalization/,
    );
});
test('unresolved target does not become implicit global variable', () => {
  assert.throws(
    () => compileToAssembly('for(unknown in {}){}'),
    /Assignment to unresolved identifier/,
  );
});
test('for-of and destructuring are rejected even in unreachable code', () => {
  for (const source of [
    'for(var k of []){}',
    'for(var [k] in {}){}',
    'for(({k}) in {}){}',
    'outer:for(var k of [])break outer;',
    'if(false){for(var k of []){}}',
  ])
    assert.throws(() => compileToAssembly(source), SyntaxError);
});
test('for-in error preserves filename, line, and column', () => {
  assert.throws(
    () =>
      compileToAssembly('\nfor(let k in {}){}', { filename: 'enumerate.js' }),
    /enumerate\.js:2:5: Lexical for-in bindings/,
  );
});
test('unsupported body code is checked even for empty RHS', () => {
  assert.throws(
    () => compileToAssembly('for(var k in {}){x => x;}'),
    /Unsupported expression: ArrowFunctionExpression/,
  );
});
