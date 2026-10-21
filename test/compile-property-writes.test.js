import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { compileToAssembly } from '../src/compiler/compile-assembly.js';
import { executeAssembly } from './es5-test-helpers.js';

function outcome(source, factory = () => ({}), native = false) {
  const values = [],
    events = [];
  const environment = {
    ...factory(events),
    capture(value) {
      values.push(value);
    },
  };
  let error;
  try {
    if (native) vm.runInNewContext(source, environment);
    else executeAssembly(compileToAssembly(source), { environment });
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
const objectFactory = () => ({ object: { x: 10 }, key: 'x' });

test('static and computed property writes return RHS', () => {
  const result = compare(
    'capture(object.x = 42); capture(object[key] = 7); capture(object.x);',
    objectFactory,
  );
  assert.deepEqual(result.values, [42, 7, 7]);
});
test('assignment chains and outer stack are preserved', () => {
  assert.deepEqual(
    compare(
      'capture(100 + (object.x = object.y = 7));capture(object.x + object.y);',
      objectFactory,
    ).values,
    [107, 14],
  );
});
test('compound arithmetic assignments preserve results', () => {
  for (const op of ['+=', '-=', '*=', '/=', '%='])
    compare(`capture(object[key] ${op} 3); capture(object.x);`, objectFactory);
});
test('compound write preserves string and BigInt semantics', () => {
  assert.deepEqual(
    compare('capture(object.x += "2"); capture(big.x *= 3n);', () => ({
      object: { x: 1 },
      big: { x: 2n },
    })).values,
    ['12', 6n],
  );
});
function observable(events) {
  let value = 10;
  const object = {
    get x() {
      events.push('get');
      return value;
    },
    set x(v) {
      events.push('set:' + v);
      value = v;
    },
  };
  const key = {
    [Symbol.toPrimitive]() {
      events.push('convert-key');
      return 'x';
    },
  };
  return {
    object,
    key,
    base() {
      events.push('base');
      return object;
    },
    keyExpr() {
      events.push('key-expr');
      return key;
    },
    rhs() {
      events.push('rhs');
      return 2;
    },
  };
}
test('simple write evaluates base and key once, RHS before ToPropertyKey', () => {
  assert.deepEqual(
    compare('capture(base()[keyExpr()] = rhs());', observable).events,
    ['base', 'key-expr', 'rhs', 'convert-key', 'set:2'],
  );
});
test('compound write reads before RHS and converts raw key during get and set', () => {
  assert.deepEqual(
    compare('capture(base()[keyExpr()] += rhs());', observable).events,
    ['base', 'key-expr', 'convert-key', 'get', 'rhs', 'convert-key', 'set:12'],
  );
});
test('repeated key conversion can select different property', () => {
  const factory = () => {
    let n = 0;
    return {
      object: { x: 10, y: 20 },
      key: {
        [Symbol.toPrimitive]() {
          return n++ === 0 ? 'x' : 'y';
        },
      },
    };
  };
  assert.deepEqual(
    compare(
      'capture(object[key] += 2);capture(object.x);capture(object.y);',
      factory,
    ).values,
    [12, 10, 12],
  );
});
test('old value is read before right-hand side', () => {
  assert.deepEqual(
    compare(
      'capture(object.x += (object.x = 3));capture(object.x);',
      objectFactory,
    ).values,
    [13, 13],
  );
});
test('conversion of old value to number executes after RHS', () => {
  const factory = (events) => ({
    object: {
      x: {
        valueOf() {
          events.push('valueOf');
          return 10;
        },
      },
    },
    rhs() {
      events.push('rhs');
      return 2;
    },
  });
  assert.deepEqual(compare('capture(object.x += rhs());', factory).events, [
    'rhs',
    'valueOf',
  ]);
});
test('simple write does not invoke getter', () => {
  assert.deepEqual(compare('object.x = 2;', observable).events, ['set:2']);
});
test('for null simple write evaluates RHS, compound write does not', () => {
  const factory = (events) => ({
    object: null,
    keyExpr() {
      events.push('key-expr');
      return {
        [Symbol.toPrimitive]() {
          events.push('convert-key');
          return 'x';
        },
      };
    },
    rhs() {
      events.push('rhs');
      return 2;
    },
  });
  assert.deepEqual(compare('object[keyExpr()] = rhs();', factory), {
    values: [],
    events: ['key-expr', 'rhs'],
    error: 'TypeError',
  });
  assert.deepEqual(compare('object[keyExpr()] += rhs();', factory), {
    values: [],
    events: ['key-expr'],
    error: 'TypeError',
  });
});
test('RHS error precedes error on writing to null', () => {
  const error = {};
  assert.throws(
    () =>
      executeAssembly(compileToAssembly('object.x = rhs();'), {
        environment: {
          object: null,
          rhs() {
            throw error;
          },
        },
      }),
    (e) => e === error,
  );
});
test('readonly and nonextensible respect strict mode', () => {
  for (const factory of [
    () => ({ object: Object.freeze({ x: 1 }) }),
    () => ({ object: Object.preventExtensions({}) }),
  ]) {
    compare('capture(object.x = 2);capture(object.x);', factory);
    assert.equal(
      compare('"use strict";object.x = 2;', factory).error,
      'TypeError',
    );
  }
});
test('strictness is inherited by nested functions', () => {
  assert.equal(
    compare('"use strict";function f(){object.x=2;}f();', () => ({
      object: Object.freeze({ x: 1 }),
    })).error,
    'TypeError',
  );
  assert.equal(
    compare('function f(){"use strict";object.x=2;}f();', () => ({
      object: Object.freeze({ x: 1 }),
    })).error,
    'TypeError',
  );
});
test('caller strictness does not alter sloppy function', () => {
  compare(
    'function f(){object.x=2;return 7;}function g(){"use strict";return f();}capture(g());',
    () => ({ object: Object.freeze({ x: 1 }) }),
  );
});
test('writing to primitives matches sloppy and strict mode', () => {
  for (const base of [1, true, 'abc', 1n]) {
    compare('capture(object.x=42);', () => ({ object: base }));
    assert.equal(
      compare('"use strict";object.x=42;', () => ({ object: base })).error,
      'TypeError',
    );
  }
});
test('Proxy receives original receiver and RHS result', () => {
  const factory = (events) => {
    let object;
    object = new Proxy(
      {},
      {
        set(target, key, value, receiver) {
          events.push([key, value, receiver === object]);
          return false;
        },
      },
    );
    return { object };
  };
  compare('capture(object.x=42);', factory);
  assert.equal(
    compare('"use strict";object.x=42;', factory).error,
    'TypeError',
  );
});
test('mapped arguments updates parameters on simple and compound write', () => {
  assert.deepEqual(
    compare(
      'function f(a){arguments[0]=20;capture(a);capture(arguments[0]+=2);return a;}capture(f(10));',
    ).values,
    [20, 22, 22],
  );
});
test('strict arguments is unmapped from parameter', () => {
  assert.deepEqual(
    compare(
      'function f(a){"use strict";arguments[0]+=2;capture(a);return arguments[0];}capture(f(10));',
    ).values,
    [10, 12],
  );
});
test('duplicate parameters preserve correct arguments mapping', () => {
  compare(
    'function f(a,a){arguments[0]=30;capture(a);arguments[1]+=2;capture(a);}f(10,20);',
  );
});
test('readonly arguments index breaks mapping', () => {
  compare(
    'function f(a){lock(arguments);arguments[0]=20;a=30;capture(arguments[0]);capture(a);}f(10);',
    () => ({
      lock(args) {
        Object.defineProperty(args, '0', { writable: false });
      },
    }),
  );
});
test('written VM function is called as method with proper this', () => {
  assert.deepEqual(
    compare(
      'object.method=function(v){return this.x+v;};capture(object.method(5));',
      objectFactory,
    ).values,
    [15],
  );
});
test('assignment result preserves object identity', () => {
  const value = {},
    object = {};
  let received;
  executeAssembly(compileToAssembly('capture(object.x=value);'), {
    environment: {
      object,
      value,
      capture(v) {
        received = v;
      },
    },
  });
  assert.equal(received, value);
  assert.equal(object.x, value);
});
test('unsupported operators and targets are still rejected', () => {
  for (const source of [
    'object.x **= 2;',
    'object.x ||= 2;',
    '[value] = object;',
    'unknown = 42;',
  ])
    assert.throws(() => compileToAssembly(source), SyntaxError);
});
