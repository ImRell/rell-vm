import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createForInIterator,
  nextForInIterator,
} from '../src/runtime/for-in-iterator.js';
function keys(value, onKey = () => {}) {
  const token = createForInIterator(value),
    result = [];
  for (;;) {
    const next = nextForInIterator(token);
    if (next.done) return result;
    result.push(next.value);
    onKey(next.value);
  }
}
test('enumerates own and inherited string keys', () => {
  const object = Object.assign(Object.create({ inherited: 1 }), { a: 1, b: 2 });
  assert.deepEqual(keys(object), ['a', 'b', 'inherited']);
});
test('does not yield non-enumerable properties and symbols', () => {
  const object = { a: 1, [Symbol('s')]: 2 };
  Object.defineProperty(object, 'hidden', { value: 3 });
  assert.deepEqual(keys(object), ['a']);
});
test('own non-enumerable property shadows enumerable prototype property', () => {
  const object = Object.create({ hidden: 1, visible: 2 });
  Object.defineProperty(object, 'hidden', { value: 3 });
  assert.deepEqual(keys(object), ['visible']);
});
test('identical names across prototypes are yielded once', () => {
  const root = { same: 1, root: 1 };
  const object = Object.assign(Object.create(root), { same: 2, own: 2 });
  assert.deepEqual(keys(object), ['same', 'own', 'root']);
});
test('key enumeration does not invoke value getters', () => {
  const object = Object.create({
    get inherited() {
      throw Error('read');
    },
  });
  Object.defineProperty(object, 'own', {
    enumerable: true,
    get() {
      throw Error('read');
    },
  });
  assert.deepEqual(keys(object), ['own', 'inherited']);
});
test('null and undefined yield empty enumeration', () => {
  assert.deepEqual(keys(null), []);
  assert.deepEqual(keys(undefined), []);
});
test('primitives follow native for-in rules', () => {
  assert.deepEqual(keys('abc'), ['0', '1', '2']);
  for (const value of [0, 7, false, true, 1n, Symbol('s')])
    assert.deepEqual(keys(value), []);
});
test('array skips holes and length, but includes additional properties', () => {
  const value = [, 'one', , 'three'];
  value.extra = 5;
  assert.deepEqual(keys(value), ['1', '3', 'extra']);
});
test('integer-indexed keys use engine order', () => {
  assert.deepEqual(keys({ z: 1, 8: 1, 2: 1, a: 1 }), ['2', '8', 'z', 'a']);
});
test('deleted yet unvisited key is skipped', () => {
  const value = { a: 1, b: 2, c: 3 };
  assert.deepEqual(
    keys(value, (key) => {
      if (key === 'a') delete value.b;
    }),
    ['a', 'c'],
  );
});
test('prototype and enumerable mutations match native for-in', () => {
  function run(native) {
    const prototype = { p: 1, q: 2 },
      object = Object.assign(Object.create(prototype), { a: 1, b: 2 });
    const result = [];
    function mutate(key) {
      if (key === 'a') {
        object.newKey = 3;
        delete prototype.q;
        Object.defineProperty(object, 'b', { enumerable: false });
      }
    }
    if (native) {
      for (const key in object) {
        result.push(key);
        mutate(key);
      }
    } else result.push(...keys(object, mutate));
    return result;
  }
  assert.deepEqual(run(false), run(true));
});
test('Symbol.iterator is not accessed or used', () => {
  const object = {
    a: 1,
    get [Symbol.iterator]() {
      throw Error('iterator');
    },
  };
  assert.deepEqual(keys(object), ['a']);
});
test('creation is lazy, Proxy traps execute on next', () => {
  const events = [],
    object = new Proxy(
      { a: 1 },
      {
        ownKeys(target) {
          events.push('keys');
          return Reflect.ownKeys(target);
        },
      },
    );
  const token = createForInIterator(object);
  assert.deepEqual(events, []);
  assert.equal(nextForInIterator(token).value, 'a');
  assert.deepEqual(events, ['keys']);
});
test('Proxy exception preserves identity', () => {
  const error = Error('ownKeys');
  const token = createForInIterator(
    new Proxy(
      {},
      {
        ownKeys() {
          throw error;
        },
      },
    ),
  );
  assert.throws(
    () => nextForInIterator(token),
    (e) => e === error,
  );
});
test('token is opaque, states are independent, completion is stable', () => {
  const first = createForInIterator({ a: 1, b: 2 }),
    second = createForInIterator({ c: 3 });
  assert.equal(Object.isFrozen(first), true);
  assert.deepEqual(Reflect.ownKeys(first), []);
  assert.equal(nextForInIterator(first).value, 'a');
  assert.equal(nextForInIterator(second).value, 'c');
  assert.equal(nextForInIterator(first).value, 'b');
  for (let i = 0; i < 3; i++)
    assert.deepEqual(nextForInIterator(first), {
      value: undefined,
      done: true,
    });
});
test('rejects forged state instead of invoking foreign next', () => {
  for (const value of [
    null,
    undefined,
    1,
    'a',
    {},
    {
      next() {
        throw Error('called');
      },
    },
  ])
    assert.throws(
      () => nextForInIterator(value),
      /Expected a VM for-in iterator/,
    );
});
