import test from 'node:test';
import assert from 'node:assert/strict';
import { compileToAssembly } from '../src/compiler/compile-assembly.js';
import { executeAssembly } from '../src/runtime/execute-assembly.js';
function run(source, environment = {}, maxSteps = Infinity) {
  return executeAssembly(compileToAssembly(source), { environment, maxSteps });
}
test('исключение getter распространяется без подмены', () => {
  const error = {};
  assert.throws(
    () =>
      run('var o={get x(){bad();}};o.x;', {
        bad() {
          throw error;
        },
      }),
    (e) => e === error,
  );
});
test('host может поймать ошибку getter, затем VM продолжает правильный кадр', () => {
  const error = {},
    values = [];
  run(
    'var o={get x(){bad();},get y(){return 42;}};capture(readSafely(o));capture(o.y);capture(100);',
    {
      bad() {
        throw error;
      },
      readSafely(o) {
        try {
          return o.x;
        } catch (e) {
          assert.equal(e, error);
          return 7;
        }
      },
      capture(v) {
        values.push(v);
      },
    },
  );
  assert.deepEqual(values, [7, 42, 100]);
});
test('host может поймать ошибку setter без оставшихся кадров', () => {
  const error = {},
    values = [];
  run(
    'var o={set x(v){bad();},get y(){return 42;}};writeSafely(o);capture(o.y);',
    {
      bad() {
        throw error;
      },
      writeSafely(o) {
        try {
          o.x = 1;
        } catch (e) {
          assert.equal(e, error);
        }
      },
      capture(v) {
        values.push(v);
      },
    },
  );
  assert.deepEqual(values, [42]);
});
test('getter имеет общий лимит с основной программой', () => {
  assert.throws(
    () => run('var o={get x(){while(true){}}};o.x;', {}, 100),
    /Instruction limit exceeded: 100/,
  );
});
test('рекурсивная VM-функция внутри getter использует общий лимит', () => {
  assert.throws(
    () =>
      run(
        'function f(){return f();}var o={get x(){return f();}};o.x;',
        {},
        100,
      ),
    /Instruction limit exceeded: 100/,
  );
});
test('host не может сбросить бюджет повторными чтениями getter', () => {
  assert.throws(
    () =>
      run(
        'var o={get x(){return 1;}};read(o);',
        {
          read(o) {
            for (let i = 0; i < 1000; i++) o.x;
          },
        },
        100,
      ),
    /Instruction limit exceeded: 100/,
  );
});
test('accessor работает после возврата результата executeAssembly', () => {
  let saved;
  run(
    'function make(v){return {get x(){return v;},set x(n){v=n;}};}save(make(10));',
    {
      save(v) {
        saved = v;
      },
    },
  );
  assert.equal(saved.x, 10);
  saved.x = 42;
  assert.equal(saved.x, 42);
});
test('при завершении root с ошибкой сохранённый getter не видит старые кадры', () => {
  let saved;
  const error = {};
  assert.throws(
    () =>
      run('save({get x(){return 42;}});bad();', {
        save(v) {
          saved = v;
        },
        bad() {
          throw error;
        },
      }),
    (e) => e === error,
  );
  assert.equal(saved.x, 42);
});
test('reentrant host getter возвращается к приостановленному accessor', () => {
  const values = [];
  run(
    'var inner={get x(){return 2;}};var o={get x(){return 10+hostRead(inner);}};capture(100+o.x);',
    {
      hostRead(o) {
        return o.x;
      },
      capture(v) {
        values.push(v);
      },
    },
  );
  assert.deepEqual(values, [112]);
});
test('setter body result не заменяет результат присваивания', () => {
  const values = [];
  run('var o={set x(v){return 999;}};capture(o.x=42);', {
    capture(v) {
      values.push(v);
    },
  });
  assert.deepEqual(values, [42]);
});
