import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { compileToAssembly } from '../src/compiler/compile-assembly.js';
import { executeAssembly } from '../src/runtime/execute-assembly.js';

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

test('статические и вычисляемые записи возвращают RHS', () => {
  const result = compare(
    'capture(object.x = 42); capture(object[key] = 7); capture(object.x);',
    objectFactory,
  );
  assert.deepEqual(result.values, [42, 7, 7]);
});
test('цепочки присваиваний и внешний стек сохраняются', () => {
  assert.deepEqual(
    compare(
      'capture(100 + (object.x = object.y = 7));capture(object.x + object.y);',
      objectFactory,
    ).values,
    [107, 14],
  );
});
test('составные арифметические присваивания сохраняют результаты', () => {
  for (const op of ['+=', '-=', '*=', '/=', '%='])
    compare(`capture(object[key] ${op} 3); capture(object.x);`, objectFactory);
});
test('составная запись сохраняет string и BigInt семантику', () => {
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
test('простая запись вычисляет base и ключ один раз, RHS перед ToPropertyKey', () => {
  assert.deepEqual(
    compare('capture(base()[keyExpr()] = rhs());', observable).events,
    ['base', 'key-expr', 'rhs', 'convert-key', 'set:2'],
  );
});
test('составная запись читает до RHS и преобразует сырой ключ при get и set', () => {
  assert.deepEqual(
    compare('capture(base()[keyExpr()] += rhs());', observable).events,
    ['base', 'key-expr', 'convert-key', 'get', 'rhs', 'convert-key', 'set:12'],
  );
});
test('повторное преобразование ключа может выбрать другое свойство', () => {
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
test('старое значение читается до правой части', () => {
  assert.deepEqual(
    compare(
      'capture(object.x += (object.x = 3));capture(object.x);',
      objectFactory,
    ).values,
    [13, 13],
  );
});
test('преобразование старого значения в число выполняется после RHS', () => {
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
test('простая запись не вызывает getter', () => {
  assert.deepEqual(compare('object.x = 2;', observable).events, ['set:2']);
});
test('для null простая запись выполняет RHS, составная — нет', () => {
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
test('ошибка RHS предшествует ошибке записи в null', () => {
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
test('readonly и nonextensible учитывают строгий режим', () => {
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
test('строгость наследуется вложенными функциями', () => {
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
test('строгость вызывающего кода не меняет sloppy функцию', () => {
  compare(
    'function f(){object.x=2;return 7;}function g(){"use strict";return f();}capture(g());',
    () => ({ object: Object.freeze({ x: 1 }) }),
  );
});
test('запись в примитивы соответствует sloppy и strict режиму', () => {
  for (const base of [1, true, 'abc', 1n]) {
    compare('capture(object.x=42);', () => ({ object: base }));
    assert.equal(
      compare('"use strict";object.x=42;', () => ({ object: base })).error,
      'TypeError',
    );
  }
});
test('Proxy получает исходный receiver и результат RHS', () => {
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
test('mapped arguments обновляет параметры при простой и составной записи', () => {
  assert.deepEqual(
    compare(
      'function f(a){arguments[0]=20;capture(a);capture(arguments[0]+=2);return a;}capture(f(10));',
    ).values,
    [20, 22, 22],
  );
});
test('strict arguments не связан с параметром', () => {
  assert.deepEqual(
    compare(
      'function f(a){"use strict";arguments[0]+=2;capture(a);return arguments[0];}capture(f(10));',
    ).values,
    [10, 12],
  );
});
test('повторные параметры сохраняют правильное отображение arguments', () => {
  compare(
    'function f(a,a){arguments[0]=30;capture(a);arguments[1]+=2;capture(a);}f(10,20);',
  );
});
test('readonly arguments index разрывает mapping', () => {
  compare(
    'function f(a){lock(arguments);arguments[0]=20;a=30;capture(arguments[0]);capture(a);}f(10);',
    () => ({
      lock(args) {
        Object.defineProperty(args, '0', { writable: false });
      },
    }),
  );
});
test('записанная VM-функция вызывается как метод с правильным this', () => {
  assert.deepEqual(
    compare(
      'object.method=function(v){return this.x+v;};capture(object.method(5));',
      objectFactory,
    ).values,
    [15],
  );
});
test('результат присваивания сохраняет идентичность объекта', () => {
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
test('неподдерживаемые операторы и цели по-прежнему отклоняются', () => {
  for (const source of [
    'object.x **= 2;',
    'object.x ||= 2;',
    '[value] = object;',
    'unknown = 42;',
  ])
    assert.throws(() => compileToAssembly(source), SyntaxError);
});
