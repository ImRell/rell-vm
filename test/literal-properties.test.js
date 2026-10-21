import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createArrayLiteral,
  defineLiteralData,
  defineLiteralAccessor,
  setLiteralPrototype,
} from '../src/runtime/literal-properties.js';

test('empty array has Array.prototype and writable length', () => {
  const array = createArrayLiteral(0);
  assert.ok(Array.isArray(array));
  assert.equal(Object.getPrototypeOf(array), Array.prototype);
  assert.deepEqual(Object.getOwnPropertyDescriptor(array, 'length'), {
    value: 0,
    writable: true,
    enumerable: false,
    configurable: false,
  });
});
test('setting length preserves holes without indexed properties', () => {
  const array = createArrayLiteral(3);
  assert.equal(array.length, 3);
  assert.deepEqual(Object.keys(array), []);
  assert.equal(Object.hasOwn(array, 0), false);
});
test('uint32 length is validated without allocating elements', () => {
  assert.equal(createArrayLiteral(0xffffffff).length, 0xffffffff);
  for (const value of [-1, 1.5, Infinity, 0x100000000, '3', null])
    assert.throws(() => createArrayLiteral(value), RangeError);
});
test('data definition creates standard own property', () => {
  const object = {},
    value = {};
  assert.equal(defineLiteralData(object, 'x', value), object);
  assert.deepEqual(Object.getOwnPropertyDescriptor(object, 'x'), {
    value,
    writable: true,
    enumerable: true,
    configurable: true,
  });
});
test('data definition does not invoke inherited setter', () => {
  let writes = 0;
  const object = Object.create({
    set x(value) {
      writes++;
    },
  });
  defineLiteralData(object, 'x', 42);
  assert.equal(writes, 0);
  assert.equal(object.x, 42);
});
test('data definition replaces accessor without invocation', () => {
  const object = {
    get x() {
      assert.fail('getter executed');
    },
  };
  defineLiteralData(object, 'x', 42);
  assert.equal(object.x, 42);
});
test('__proto__ as data key safely creates own property', () => {
  const object = {},
    value = {};
  defineLiteralData(object, '__proto__', value);
  assert.equal(Object.getPrototypeOf(object), Object.prototype);
  assert.equal(
    Object.getOwnPropertyDescriptor(object, '__proto__').value,
    value,
  );
});
test('getter and setter combine into single accessor descriptor', () => {
  const object = {};
  let value = 1;
  function get() {
    return value;
  }
  function set(v) {
    value = v;
  }
  defineLiteralAccessor(object, 'x', get, 'get');
  defineLiteralAccessor(object, 'x', set, 'set');
  assert.deepEqual(Object.getOwnPropertyDescriptor(object, 'x'), {
    get,
    set,
    enumerable: true,
    configurable: true,
  });
  object.x = 42;
  assert.equal(object.x, 42);
});
test('new getter preserves setter, data property resets pair', () => {
  const object = {};
  function set(value) {}
  defineLiteralAccessor(object, 'x', set, 'set');
  defineLiteralAccessor(object, 'x', () => 1, 'get');
  defineLiteralAccessor(object, 'x', () => 2, 'get');
  assert.equal(Object.getOwnPropertyDescriptor(object, 'x').set, set);
  defineLiteralData(object, 'x', 3);
  defineLiteralAccessor(object, 'x', () => 4, 'get');
  assert.equal(Object.getOwnPropertyDescriptor(object, 'x').set, undefined);
  assert.equal(object.x, 4);
});
test('accessor pair is taken only from own descriptor', () => {
  const proto = {
    set x(value) {
      assert.fail('inherited setter');
    },
  };
  const object = Object.create(proto);
  defineLiteralAccessor(object, 'x', () => 1, 'get');
  assert.equal(Object.getOwnPropertyDescriptor(object, 'x').set, undefined);
});
test('accessor key is converted exactly once', () => {
  let conversions = 0;
  const key = {
    [Symbol.toPrimitive]() {
      conversions++;
      return 'x';
    },
  };
  const object = {};
  defineLiteralAccessor(object, key, () => 42, 'get');
  assert.equal(conversions, 1);
  assert.equal(object.x, 42);
});
test('symbol keys support data and accessor', () => {
  const key = Symbol(),
    object = {};
  defineLiteralData(object, key, 1);
  defineLiteralAccessor(object, key, () => 2, 'get');
  assert.equal(object[key], 2);
});
test('accessor validates callable and kind', () => {
  assert.throws(() => defineLiteralAccessor({}, 'x', {}, 'get'), TypeError);
  assert.throws(
    () => defineLiteralAccessor({}, 'x', () => 1, 'other'),
    TypeError,
  );
});
test('prototype literal setter accepts null/objects and ignores primitives', () => {
  const object = {},
    proto = { x: 42 };
  assert.equal(setLiteralPrototype(object, proto), object);
  assert.equal(object.x, 42);
  for (const value of [1, 'x', undefined, true, Symbol()])
    setLiteralPrototype(object, value);
  assert.equal(Object.getPrototypeOf(object), proto);
  setLiteralPrototype(object, null);
  assert.equal(Object.getPrototypeOf(object), null);
});
