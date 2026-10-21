import test from 'node:test';
import assert from 'node:assert/strict';
import {
  toNumeric,
  toPropertyKey,
  updateNumeric,
} from '../src/runtime/numeric-update.js';

test('ToNumeric converts primitives and preserves BigInt', () => {
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
test('++/-- match native for special numeric values', () => {
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
test('postfix returns numeric old value, not original string', () => {
  assert.deepEqual(updateNumeric('10', true), { oldValue: 10, newValue: 11 });
});
test('postfix preserves -0 and changes it to 1/-1', () => {
  for (const increment of [true, false]) {
    const result = updateNumeric(-0, increment);
    assert.ok(Object.is(result.oldValue, -0));
    assert.equal(result.newValue, increment ? 1 : -1);
  }
});
test('BigInt wrapper is not converted to Number', () => {
  assert.deepEqual(updateNumeric(Object(2n), true), {
    oldValue: 2n,
    newValue: 3n,
  });
});
test('Symbol and Symbol wrapper throw TypeError', () => {
  for (const value of [Symbol(), Object(Symbol())])
    assert.throws(() => toNumeric(value), TypeError);
});
test('number hint and original receiver are passed to Symbol.toPrimitive', () => {
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
test('for number hint valueOf comes before toString', () => {
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
test('second method is not read after successful first', () => {
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
test('non-callable valueOf is skipped', () => {
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
test('null Symbol.toPrimitive uses normal path', () => {
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
test('non-callable Symbol.toPrimitive is not skipped', () => {
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
test('object result from Symbol.toPrimitive is error without fallback', () => {
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
test('absence of primitive result throws TypeError', () => {
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
test('getter and conversion method exceptions are preserved', () => {
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
test('getter valueOf is called once and returned method receives receiver', () => {
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
test('ToPropertyKey uses string hint and preserves Symbol', () => {
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
test('ToPropertyKey attempts toString before valueOf', () => {
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
test('ToPropertyKey converts primitives without repeated user call', () => {
  for (const [input, expected] of [
    [null, 'null'],
    [undefined, 'undefined'],
    [1n, '1'],
    [-0, '0'],
    [true, 'true'],
  ])
    assert.equal(toPropertyKey(input), expected);
});
test('update direction must be boolean', () => {
  assert.throws(() => updateNumeric(1, 1), TypeError);
});
