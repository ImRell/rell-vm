// Runtime may use modern JS: ES5 is the input language, not its implementation.
// Delegate enumeration to the host engine's native for-in. A snapshot from
// Object.keys/Reflect.ownKeys would lose prototype, shadowing and deletion rules.
// The generator suspends between keys: the VM still executes the loop body.
const states = new WeakMap();
const apply = Reflect.apply;
const generatorNext = Object.getPrototypeOf(enumerate()).next;
const freeze = Object.freeze;
const create = Object.create;

function* enumerate(value) {
  for (const key in value) yield key;
}

/** Creates an opaque enumeration token without reading property values. */
export function createForInIterator(value) {
  const token = freeze(create(null));
  states.set(token, enumerate(value));
  return token;
}

/** Returns { value: string|undefined, done: boolean }. Exhaustion is stable. */
export function nextForInIterator(token) {
  const iterator = states.get(token);
  if (iterator === undefined) {
    throw new TypeError('Expected a VM for-in iterator');
  }
  // Do not call an overridable iterator.next or consult Symbol.iterator.
  return apply(generatorNext, iterator, []);
}
