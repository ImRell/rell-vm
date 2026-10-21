import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { compileToAssembly } from '../src/compiler/compile-assembly.js';
import { executeAssembly } from './es5-test-helpers.js';
function compare(source, factory = () => ({})) {
  function outcome(native) {
    const values = [],
      events = [];
    let error;
    const environment = {
      Object,
      undefined,
      NaN,
      ...factory(events),
      capture(v) {
        values.push(v);
      },
    };
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
  const actual = outcome(false);
  assert.deepEqual(actual, outcome(true));
  return actual;
}
test('do while false executes body once', () => {
  assert.deepEqual(
    compare('var n=0;do{n++;}while(false);capture(n);').values,
    [1],
  );
});
test('do while repeats body until falsy condition', () => {
  compare('var i=0,sum=0;do{sum+=i++;}while(i<4);capture(sum);capture(i);');
});
test('body precedes each condition test', () => {
  const factory = (events) => {
    let n = 0;
    return {
      body() {
        events.push('body:' + n);
        n++;
      },
      condition() {
        events.push('test:' + n);
        return n < 2;
      },
    };
  };
  assert.deepEqual(compare('do{body();}while(condition());', factory).events, [
    'body:0',
    'test:1',
    'body:1',
    'test:2',
  ]);
});
test('continue jumps to condition, not to start of body', () => {
  compare('var i=0;do{i++;continue;}while(i<3);capture(i);');
});
test('continue on false condition terminates loop', () => {
  compare('var i=0;do{i++;continue;}while(false);capture(i);');
});
test('break skips condition', () => {
  compare('var i=0;do{i++;break;}while(missing());capture(i);');
});
test('do while without curly braces', () => {
  compare('var i=0;do i++;while(i<3);capture(i);');
});
test('do while with empty body', () => {
  compare('var i=0;do;while(i++<2);capture(i);');
});
test('condition uses truthiness', () => {
  for (const condition of ['false', '0', '""', 'null', 'undefined', 'NaN'])
    assert.deepEqual(
      compare(`var n=0;do{n++;}while(${condition});capture(n);`).values,
      [1],
    );
  for (const condition of ['true', '1', '"text"', '[]', '{}'])
    assert.deepEqual(
      compare(`var n=0;do{n++;if(n===2)break;}while(${condition});capture(n);`)
        .values,
      [2],
    );
});
test('body var is hoisted before first iteration', () => {
  compare('capture(value);do{var value=42;}while(false);capture(value);');
});
test('var from unreachable do while is also declared', () => {
  compare('if(false){do{var hidden=42;}while(false);}capture(hidden);');
});
test('return skips condition', () => {
  compare('function f(){do{return 42;}while(missing());}capture(f());');
});
test('exception in body skips condition and preserves identity', () => {
  const error = {},
    events = [];
  assert.throws(
    () =>
      executeAssembly(compileToAssembly('do{bad();}while(check());'), {
        environment: {
          bad() {
            throw error;
          },
          check() {
            events.push('test');
            return false;
          },
        },
      }),
    (e) => e === error,
  );
  assert.deepEqual(events, []);
});
test('exception in condition occurs after body', () => {
  const error = {},
    events = [];
  assert.throws(
    () =>
      executeAssembly(compileToAssembly('do{body();}while(bad());'), {
        environment: {
          body() {
            events.push('body');
          },
          bad() {
            throw error;
          },
        },
      }),
    (e) => e === error,
  );
  assert.deepEqual(events, ['body']);
});
test('comma in do condition evaluates all expressions', () => {
  compare(
    'var i=0,count=0;do{i++;}while(count++,i<3);capture(count);capture(i);',
  );
});
test('do while inside function works with arguments', () => {
  compare(
    'function f(a){do{arguments[0]++;}while(a<3);return a;}capture(f(0));',
  );
});
test('do while inside getter uses correct frame', () => {
  compare(
    'var o={get x(){var n=0;do{n++;}while(n<3);return n;}};capture(100+o.x);',
  );
});
test('infinite do while stops at global step limit', () => {
  for (const source of ['do{}while(true);', 'do{continue;}while(true);'])
    assert.throws(
      () => executeAssembly(compileToAssembly(source), { maxSteps: 100 }),
      /Instruction limit exceeded: 100/,
    );
});
test('condition syntax is checked even after unconditional break', () => {
  assert.throws(
    () => compileToAssembly('do{break;}while(x => x);'),
    /Unsupported expression: ArrowFunctionExpression/,
  );
});
test('compiling do while does not evaluate body or condition', () => {
  const result = compileToAssembly('do{missing();}while(other());');
  assert.ok(typeof result === 'string' || result instanceof String);
});
