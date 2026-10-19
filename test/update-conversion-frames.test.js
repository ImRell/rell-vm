import test from 'node:test';
import assert from 'node:assert/strict';
import { compileToAssembly } from '../src/compiler/compile-assembly.js';
import { executeAssembly } from '../src/runtime/execute-assembly.js';

function run(source, environment = {}, maxSteps = Infinity) {
  return executeAssembly(compileToAssembly(source), { environment, maxSteps });
}
test('VM valueOf использует общий лимит шагов', () => {
  assert.throws(
    () => run('var x={valueOf:function(){while(true){}}};x++;', {}, 100),
    /Instruction limit exceeded: 100/,
  );
});
test('VM key.toString использует общий лимит для get/set/update', () => {
  for (const operation of ['o[key];', 'o[key]=1;', 'o[key]++;'])
    assert.throws(
      () =>
        run(
          'var key={toString:function(){while(true){}}};var o={};' + operation,
          {},
          100,
        ),
      /Instruction limit exceeded: 100/,
    );
});
test('обычная рекурсия из valueOf использует VM-кадры и общий бюджет', () => {
  assert.throws(
    () =>
      run(
        'function f(){return f();}var x={valueOf:function(){return f();}};x++;',
        {},
        100,
      ),
    /Instruction limit exceeded: 100/,
  );
});
test('host catch ошибки conversion не оставляет вложенные кадры', () => {
  const error = {},
    values = [];
  run(
    'var value={valueOf:function(){bad();}};var o={get x(){var n=value;return n++;},get safe(){return 42;}};capture(read(o));capture(o.safe);capture(100);',
    {
      bad() {
        throw error;
      },
      read(o) {
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
test('исключение valueOf сохраняет идентичность и предшествует const error', () => {
  const error = {};
  assert.throws(
    () =>
      run('const x={valueOf:function(){bad();}};x++;', {
        bad() {
          throw error;
        },
      }),
    (e) => e === error,
  );
});
test('ошибка первого key conversion предшествует getter', () => {
  const error = {};
  let reads = 0;
  const o = {
    get x() {
      reads++;
      return 10;
    },
  };
  assert.throws(
    () =>
      run('o[key]++;', {
        o,
        key: {
          toString() {
            throw error;
          },
        },
      }),
    (e) => e === error,
  );
  assert.equal(reads, 0);
});
test('ошибка второго key conversion происходит после number conversion и до setter', () => {
  const error = {},
    events = [];
  let n = 0;
  const key = {
    toString() {
      events.push('key');
      if (n++) throw error;
      return 'x';
    },
  };
  const o = {
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
      events.push('set');
    },
  };
  assert.throws(
    () => run('o[key]++;', { o, key }),
    (e) => e === error,
  );
  assert.deepEqual(events, ['key', 'get', 'number', 'key']);
});
test('ошибка setter не подменяется результатом postfix', () => {
  const error = {};
  assert.throws(
    () =>
      run('o.x++;', {
        o: {
          get x() {
            return 10;
          },
          set x(v) {
            throw error;
          },
        },
      }),
    (e) => e === error,
  );
});
test('conversion может изменить цель, но update пишет вычисленное новое значение', () => {
  const values = [];
  run(
    'var o={x:{valueOf:function(){o.x=100;return 10;}}};capture(o.x++);capture(o.x);',
    {
      capture(v) {
        values.push(v);
      },
    },
  );
  assert.deepEqual(values, [10, 11]);
});
test('вложенные VM conversion callbacks возвращаются к нужному стеку', () => {
  const values = [];
  run(
    'var inner={valueOf:function(){return 2;}};var outer={valueOf:function(){var x=inner;return 10+x++;}};var x=outer;capture(100+x++);capture(x);',
    {
      capture(v) {
        values.push(v);
      },
    },
  );
  assert.deepEqual(values, [112, 13]);
});
test('VM key Symbol.toPrimitive возвращает Symbol и сохраняет numeric hints', () => {
  const values = [];
  run(
    'var symbol=Symbol();var key={};key[Symbol.toPrimitive]=function(hint){capture(hint);return symbol;};var o={};o[key]=10;capture(o[key]++);capture(o[symbol]);',
    {
      Symbol,
      capture(v) {
        values.push(v);
      },
    },
  );
  assert.deepEqual(values, ['string', 'string', 'string', 10, 11]);
});
test('simple null write выполняет RHS, но не VM key conversion', () => {
  const values = [];
  assert.throws(
    () =>
      run(
        'var key={toString:function(){capture("key");return "x";}};function rhs(){capture("rhs");return 1;}var o=null;o[key]=rhs();',
        {
          capture(v) {
            values.push(v);
          },
        },
      ),
    TypeError,
  );
  assert.deepEqual(values, ['rhs']);
});
