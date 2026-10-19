// Capture intrinsics: replacing global Object/Array must not affect literals.
const defineProperty = Object.defineProperty;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const setPrototypeOf = Object.setPrototypeOf;
const ownKeys = Reflect.ownKeys;
const isInteger = Number.isInteger;

export function createArrayLiteral(length) {
  if (!isInteger(length) || length < 0 || length > 0xffffffff) {
    throw new RangeError('Array literal length must be a uint32');
  }
  const array = [];
  defineProperty(array, 'length', { value: length });
  return array;
}

export function defineLiteralData(object, key, value) {
  defineProperty(object, key, {
    value,
    writable: true,
    enumerable: true,
    configurable: true,
  });
  return object;
}

// Keys emitted for ES5 object properties are already primitive strings/numbers.
// Convert an arbitrary assembly key only once, before descriptor lookup.
export function defineLiteralAccessor(object, key, accessor, kind) {
  if (kind !== 'get' && kind !== 'set')
    throw new TypeError('Invalid accessor kind');
  if (typeof accessor !== 'function')
    throw new TypeError('Accessor must be callable');
  // A temporary own property performs native ToPropertyKey (including Symbols).
  const temporary = { [key]: null };
  const propertyKey = ownKeys(temporary)[0];
  const previous = getOwnPropertyDescriptor(object, propertyKey);
  const descriptor = {
    get: previous && !('value' in previous) ? previous.get : undefined,
    set: previous && !('value' in previous) ? previous.set : undefined,
    enumerable: true,
    configurable: true,
  };
  descriptor[kind] = accessor;
  defineProperty(object, propertyKey, descriptor);
  return object;
}

export function setLiteralPrototype(object, prototype) {
  if (
    prototype === null ||
    typeof prototype === 'object' ||
    typeof prototype === 'function'
  ) {
    setPrototypeOf(object, prototype);
  }
  return object;
}
