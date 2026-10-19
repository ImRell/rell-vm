import test from 'node:test';
import assert from 'node:assert/strict';
import {
  toNumeric,
  toPropertyKey,
  updateNumeric,
} from '../src/runtime/numeric-update.js';

test('ToNumeric преобразует примитивы и сохраняет BigInt', () => {
  for (const [value, expected] of [
    ['10', 10],
    ['', 0],
    [' 2 ', 2],
    [true, 1],
    [false, 0],
    [null, 0],
    [undefined, NaN],
    ['bad', NaN],
    [42n, 42n],
    [-0, -0],
  ])
    assert.ok(Object.is(toNumeric(value), expected));
});
test('++/-- совпадают с native для специальных числовых значений', () => {
  for (const value of [
    0,
    -0,
    NaN,
    Infinity,
    -Infinity,
    1.5,
    1e30,
    2n,
    -2n,
    '10',
    null,
    undefined,
    true,
  ]) {
    for (const increment of [false, true]) {
      let native = value;
      const oldValue = increment ? native++ : native--;
      const actual = updateNumeric(value, increment);
      assert.ok(Object.is(actual.oldValue, oldValue));
      assert.ok(Object.is(actual.newValue, native));
    }
  }
});
test('postfix возвращает числовое старое значение, не исходную строку', () => {
  assert.deepEqual(updateNumeric('10', true), { oldValue: 10, newValue: 11 });
});
test('postfix сохраняет -0 и меняет его на 1/-1', () => {
  for (const increment of [true, false]) {
    const result = updateNumeric(-0, increment);
    assert.ok(Object.is(result.oldValue, -0));
    assert.equal(result.newValue, increment ? 1 : -1);
  }
});
test('BigInt wrapper не превращается в Number', () => {
  assert.deepEqual(updateNumeric(Object(2n), true), {
    oldValue: 2n,
    newValue: 3n,
  });
});
test('Symbol и Symbol wrapper вызывают TypeError', () => {
  for (const value of [Symbol(), Object(Symbol())])
    assert.throws(() => toNumeric(value), TypeError);
});
test('числовой hint и исходный receiver передаются Symbol.toPrimitive', () => {
  const events = [];
  const object = {
    [Symbol.toPrimitive](hint) {
      events.push([hint, this === object]);
      return '7';
    },
  };
  assert.deepEqual(updateNumeric(object, true), { oldValue: 7, newValue: 8 });
  assert.deepEqual(events, [['number', true]]);
});
test('для number hint valueOf идёт раньше toString', () => {
  const events = [];
  const object = {
    valueOf() {
      events.push('valueOf');
      return {};
    },
    toString() {
      events.push('toString');
      return '8';
    },
  };
  assert.equal(toNumeric(object), 8);
  assert.deepEqual(events, ['valueOf', 'toString']);
});
test('второй метод не читается после успешного первого', () => {
  assert.equal(
    toNumeric({
      valueOf() {
        return 42;
      },
      get toString() {
        assert.fail('unnecessary get');
      },
    }),
    42,
  );
});
test('не-callable valueOf пропускается', () => {
  assert.equal(
    toNumeric({
      valueOf: 1,
      toString() {
        return '42';
      },
    }),
    42,
  );
});
test('null Symbol.toPrimitive использует обычный путь', () => {
  assert.equal(
    toNumeric({
      [Symbol.toPrimitive]: null,
      valueOf() {
        return 42;
      },
    }),
    42,
  );
});
test('не-callable Symbol.toPrimitive не пропускается', () => {
  assert.throws(
    () =>
      toNumeric({
        [Symbol.toPrimitive]: 42,
        valueOf() {
          return 1;
        },
      }),
    TypeError,
  );
});
test('объектный результат Symbol.toPrimitive — ошибка без fallback', () => {
  assert.throws(
    () =>
      toNumeric({
        [Symbol.toPrimitive]() {
          return {};
        },
        valueOf() {
          assert.fail();
        },
      }),
    TypeError,
  );
});
test('отсутствие примитивного результата вызывает TypeError', () => {
  assert.throws(
    () =>
      toNumeric({
        valueOf() {
          return {};
        },
        toString() {
          return {};
        },
      }),
    TypeError,
  );
  assert.throws(() => toNumeric(Object.create(null)), TypeError);
});
test('исключения getter и conversion method сохраняются', () => {
  const error = {};
  for (const value of [
    {
      get valueOf() {
        throw error;
      },
    },
    {
      valueOf() {
        throw error;
      },
    },
    {
      [Symbol.toPrimitive]() {
        throw error;
      },
    },
  ])
    assert.throws(
      () => toNumeric(value),
      (e) => e === error,
    );
});
test('getter valueOf вызывается один раз и возвращённый метод получает receiver', () => {
  let calls = 0;
  const object = {
    get valueOf() {
      calls++;
      return function () {
        assert.equal(this, object);
        return 10;
      };
    },
  };
  updateNumeric(object, true);
  assert.equal(calls, 1);
});
test('ToPropertyKey использует string hint и сохраняет Symbol', () => {
  const symbol = Symbol();
  assert.equal(toPropertyKey(symbol), symbol);
  const events = [];
  assert.equal(
    toPropertyKey({
      [Symbol.toPrimitive](hint) {
        events.push(hint);
        return 42;
      },
    }),
    '42',
  );
  assert.deepEqual(events, ['string']);
});
test('ToPropertyKey пробует toString раньше valueOf', () => {
  const events = [];
  const key = toPropertyKey({
    toString() {
      events.push('toString');
      return {};
    },
    valueOf() {
      events.push('valueOf');
      return 7;
    },
  });
  assert.equal(key, '7');
  assert.deepEqual(events, ['toString', 'valueOf']);
});
test('ToPropertyKey преобразует примитивы без повторного пользовательского вызова', () => {
  for (const [input, expected] of [
    [null, 'null'],
    [undefined, 'undefined'],
    [1n, '1'],
    [-0, '0'],
    [true, 'true'],
  ])
    assert.equal(toPropertyKey(input), expected);
});
test('направление update должно быть boolean', () => {
  assert.throws(() => updateNumeric(1, 1), TypeError);
});
