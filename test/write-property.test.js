import test from 'node:test';
import assert from 'node:assert/strict';
import { writeProperty } from '../src/runtime/write-property.js';

test('writes own properties and returns RHS', () => {
  const object = {},
    value = {},
    key = Symbol();
  assert.equal(writeProperty(object, 'x', value), value);
  assert.equal(object.x, value);
  writeProperty(object, key, 42, true);
  assert.equal(object[key], 42);
});

test('inherited writable properties are created on receiver', () => {
  const proto = { x: 1 },
    object = Object.create(proto);
  writeProperty(object, 'x', 2);
  assert.equal(object.x, 2);
  assert.equal(proto.x, 1);
  assert.ok(Object.hasOwn(object, 'x'));
});

test('setter receives original object and does not determine assignment result', () => {
  let receiver, received;
  const object = Object.create({
    set x(value) {
      receiver = this;
      received = value;
      return false;
    },
  });
  assert.equal(writeProperty(object, 'x', 42), 42);
  assert.equal(receiver, object);
  assert.equal(received, 42);
});

test('readonly and nonextensible: sloppy ignores rejection, strict throws', () => {
  for (const object of [
    Object.freeze({ x: 1 }),
    Object.preventExtensions({}),
  ]) {
    assert.equal(writeProperty(object, 'x', 2), 2);
    assert.throws(() => writeProperty(object, 'x', 2, true), TypeError);
  }
});

test('getter-only property does not call getter on write', () => {
  let reads = 0;
  const object = {
    get x() {
      reads++;
      return 1;
    },
  };
  writeProperty(object, 'x', 2);
  assert.throws(() => writeProperty(object, 'x', 2, true), TypeError);
  assert.equal(reads, 0);
});

test('preserves setter exception without replacement', () => {
  const error = {};
  const object = {
    set x(value) {
      throw error;
    },
  };
  assert.throws(
    () => writeProperty(object, 'x', 1),
    (e) => e === error,
  );
});

test('Proxy rejection respects strict, exceptions and invariants are preserved', () => {
  const rejected = new Proxy(
    {},
    {
      set() {
        return false;
      },
    },
  );
  assert.equal(writeProperty(rejected, 'x', 1), 1);
  assert.throws(() => writeProperty(rejected, 'x', 1, true), TypeError);
  const error = {};
  assert.throws(
    () =>
      writeProperty(
        new Proxy(
          {},
          {
            set() {
              throw error;
            },
          },
        ),
        'x',
        1,
      ),
    (e) => e === error,
  );
  const invariant = new Proxy(Object.freeze({ x: 1 }), {
    set() {
      return true;
    },
  });
  assert.throws(() => writeProperty(invariant, 'x', 2), TypeError);
});

test('primitives do not retain new properties, strict forbids write', () => {
  for (const base of [1, true, 'abc', 1n, Symbol()]) {
    assert.equal(writeProperty(base, 'missing', 42), 42);
    assert.throws(() => writeProperty(base, 'missing', 42, true), TypeError);
  }
  writeProperty('abc', 'length', 1);
  assert.throws(() => writeProperty('abc', '0', 'x', true), TypeError);
});

test('primitive prototype setter receives original primitive', () => {
  const key = Symbol();
  let receiver;
  Object.defineProperty(Number.prototype, key, {
    configurable: true,
    set(value) {
      receiver = this;
    },
  });
  try {
    writeProperty(7, key, 42, true);
    assert.equal(receiver, 7);
  } finally {
    delete Number.prototype[key];
  }
});

test('null and undefined are rejected before key conversion', () => {
  let conversions = 0;
  const key = {
    [Symbol.toPrimitive]() {
      conversions++;
      return 'x';
    },
  };
  for (const base of [null, undefined])
    assert.throws(() => writeProperty(base, key, 1), TypeError);
  assert.equal(conversions, 0);
});

test('key is converted once, rejection error does not re-convert it', () => {
  let conversions = 0;
  const key = {
    [Symbol.toPrimitive]() {
      conversions++;
      return 'x';
    },
  };
  assert.throws(
    () => writeProperty(Object.freeze({}), key, 1, true),
    TypeError,
  );
  assert.equal(conversions, 1);
  const error = {};
  assert.throws(
    () =>
      writeProperty(
        {},
        {
          [Symbol.toPrimitive]() {
            throw error;
          },
        },
        1,
      ),
    (e) => e === error,
  );
});

test('array length errors are not suppressed even in sloppy mode', () => {
  assert.throws(() => writeProperty([], 'length', -1), RangeError);
});

test('validates strict flag', () => {
  assert.throws(() => writeProperty({}, 'x', 1, 'false'), TypeError);
});
