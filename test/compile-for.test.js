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
      capture(v) {
        values.push(v);
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

test('for var computes sum and leaves var available after loop', () => {
  assert.deepEqual(
    compare('var sum=0;for(var i=0;i<4;i++){sum+=i;}capture(sum);capture(i);')
      .values,
    [6, 4],
  );
});
test('for expression initializer executes once', () => {
  assert.deepEqual(
    compare('var i=99;for(i=0;i<3;i++){capture(i);}capture(i);').values,
    [0, 1, 2, 3],
  );
});
test('for initializer, test, body, update follow exact order', () => {
  const factory = (events) => {
    let i;
    return {
      init() {
        events.push('init');
        i = 0;
        return 0;
      },
      condition() {
        events.push('test:' + i);
        return i < 2;
      },
      body() {
        events.push('body:' + i);
      },
      update() {
        events.push('update:' + i);
        i++;
      },
    };
  };
  assert.deepEqual(
    compare('for(var unused=init();condition();update()){body();}', factory)
      .events,
    [
      'init',
      'test:0',
      'body:0',
      'update:0',
      'test:1',
      'body:1',
      'update:1',
      'test:2',
    ],
  );
});
test('false initial condition skips body and update', () => {
  const factory = (events) => ({
    init() {
      events.push('init');
    },
    body() {
      events.push('body');
    },
    update() {
      events.push('update');
    },
  });
  assert.deepEqual(
    compare('for(init();false;update()){body();}', factory).events,
    ['init'],
  );
});
test('continue executes update, break skips it', () => {
  assert.deepEqual(
    compare(
      'var sum=0;for(var i=0;i<5;i++){if(i===1)continue;if(i===3)break;sum+=i;}capture(sum);capture(i);',
    ).values,
    [2, 3],
  );
});
test('for without init', () => {
  compare('var i=0;for(;i<3;i++)capture(i);capture(i);');
});
test('for without test', () => {
  compare('for(var i=0;;i++){if(i===3)break;capture(i);}capture(i);');
});
test('for without update', () => {
  compare('for(var i=0;i<3;){capture(i++);}capture(i);');
});
test('for without all three parts', () => {
  compare('var i=0;for(;;){if(i===3)break;capture(i++);}capture(i);');
});
test('continue in for without update returns to test', () => {
  compare('var i=0;for(;i<4;){i++;if(i===2)continue;capture(i);}capture(i);');
});
test('multiple var declarations evaluate from left to right', () => {
  compare(
    'for(var first=10,second=first+2,index=0;index<1;index++){capture(first);capture(second);}capture(index);',
  );
});
test('comma in init and update executes from left to right', () => {
  compare(
    'var i,j;for(i=0,j=10;i<3;i++,j-=2){capture(i);capture(j);}capture(i);capture(j);',
  );
});
test('comma in test returns only the last value', () => {
  compare('var count=0;for(var i=0;(count++,i<3);i++){}capture(count);');
});
test('for supports empty body', () => {
  compare('for(var i=0;i<3;i++);capture(i);');
});
test('condition uses JavaScript truthiness', () => {
  for (const condition of ['false', '0', '""', 'null', 'undefined', 'NaN'])
    assert.deepEqual(
      compare(`var n=0;for(var i=0;${condition};i++){n++;break;}capture(n);`)
        .values,
      [0],
    );
  for (const condition of ['true', '1', '"text"', '[]', '{}'])
    assert.deepEqual(
      compare(`var n=0;for(var i=0;${condition};i++){n++;break;}capture(n);`)
        .values,
      [1],
    );
});
test('var from unreachable for is hoisted, initializer is not executed', () => {
  compare('capture(i);if(false){for(var i=bad();false;){} }capture(i);');
});
test('var in init and body belongs to function, not block', () => {
  compare(
    'function f(){capture(i);{for(var i=0;i<2;i++){var saved=i;}}capture(i);return saved;}capture(f());',
  );
});
test('var in for does not reset parameter without initializer', () => {
  compare('function f(i){for(var i;i<3;i++){}return i;}capture(f(2));');
});
test('initializer with same-name var sees hoisted undefined', () => {
  compare(
    'var external=99;function f(){for(var external=external;false;){}return external;}capture(f());',
  );
});
test('for var closures share a single mutable binding', () => {
  compare(
    'var functions=[];for(var i=0;i<3;i++){functions.push(function(){return i;});}capture(functions[0]());capture(functions[1]());capture(functions[2]());',
  );
});
test('return from for skips update and remainder of function', () => {
  compare(
    'var n=0;function f(){for(var i=0;i<3;n++,i++){return 42;}return 99;}capture(f());capture(n);',
  );
});
test('for works inside getter and VM conversion callback', () => {
  compare(
    'var o={get x(){var sum=0;for(var i=0;i<3;i++)sum+=i;return sum;}};capture(o.x);var value={valueOf:function(){var n=0;for(var j=0;j<2;j++)n++;return n;}};capture(value++);capture(value);',
  );
});
test('body can mutate loop variable before update/test', () => {
  compare(
    'var seen=[];for(var i=0;i<6;i++){seen.push(i);if(i===1)i=3;}capture(seen.join(","));capture(i);',
  );
});
test('initializer can evaluate arbitrary expression value', () => {
  compare('var i=0;for(({x:42});i<2;i++){capture(i);}');
});
test('update can return an object without accumulating it on stack', () => {
  compare('var i=0;for(;i<3;(i++,{})){capture(i);}capture(i);');
});
test('initializer/test/body/update exceptions preserve identity', () => {
  const error = {};
  for (const source of [
    'for(bad();false;){}',
    'for(;bad();){}',
    'for(;true;){bad();}',
    'for(var i=0;i<1;bad()){i++;}',
  ])
    assert.throws(
      () =>
        executeAssembly(compileToAssembly(source), {
          environment: {
            bad() {
              throw error;
            },
          },
        }),
      (e) => e === error,
    );
});
test('initializer error does not evaluate test and body', () => {
  const error = {},
    events = [];
  assert.throws(
    () =>
      executeAssembly(
        compileToAssembly('for(bad();check();update()){body();}'),
        {
          environment: {
            bad() {
              events.push('init');
              throw error;
            },
            check() {
              events.push('test');
              return false;
            },
            update() {
              events.push('update');
            },
            body() {
              events.push('body');
            },
          },
        },
      ),
    (e) => e === error,
  );
  assert.deepEqual(events, ['init']);
});
test('infinite for loop stops on VM step limit', () => {
  for (const source of [
    'for(;;){}',
    'for(;;);',
    'for(var i=0;;i++){continue;}',
  ])
    assert.throws(
      () => executeAssembly(compileToAssembly(source), { maxSteps: 100 }),
      /Instruction limit exceeded: 100/,
    );
});
test('compilation validates even unreachable init/test/update/body', () => {
  for (const source of [
    'if(false){for(x => x;false;){} }',
    'for(;false;x => x){}',
    'for(;false;){x => x;}',
  ])
    assert.throws(
      () => compileToAssembly(source),
      /Unsupported expression: ArrowFunctionExpression/,
    );
});
test('for compilation does not evaluate source calls', () => {
  const result = compileToAssembly('for(init();condition();update()){body();}');
  assert.ok(typeof result === 'string' || result instanceof String);
});
test('for let/const explicitly requires normalization', () => {
  for (const source of [
    'for(let i=0;i<2;i++){}',
    'for(const i=0;false;){}',
    'if(false){for(let i=0;;){break;}}',
  ])
    assert.throws(
      () => compileToAssembly(source),
      /Lexical for initializers require normalization/,
    );
});
test('for-of is not supported', () => {
  for (const source of [
    'for(var item of items){}',
    'outer:for(var k of []){break outer;}',
  ])
    assert.throws(() => compileToAssembly(source), SyntaxError);
});
test('for initializer error preserves filename and position', () => {
  assert.throws(
    () =>
      compileToAssembly('\nfor (let i=0;i<1;i++) {}', { filename: 'for.js' }),
    /for\.js:2:6: Lexical for initializers require normalization/,
  );
});
