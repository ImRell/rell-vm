import { LexicalEnvironment } from './lexical-environment.js';
import { VMFunction } from './vm-function.js';

const hasOwn = (object, key) =>
  Object.prototype.hasOwnProperty.call(object, key);

function throwRestrictedArgumentsProperty() {
  throw new TypeError('Access to restricted arguments property');
}
Object.freeze(throwRestrictedArgumentsProperty);

/**
 * ES5-style arguments object. Modern runtime Proxy supplies the exotic
 * indexed-property semantics; the input program still uses ES5 syntax.
 * Parameter cells are shared, not copied, including after the call returns.
 */
export function createArgumentsObject({
  args,
  parameters,
  parameterEnvironment,
  callee,
  strict,
} = {}) {
  if (!Array.isArray(args)) {
    throw new TypeError('Arguments must be an array');
  }
  if (
    !Array.isArray(parameters) ||
    Array.from(parameters).some(
      (name) => typeof name !== 'string' || name.length === 0,
    )
  ) {
    throw new TypeError('Parameters must be an array of non-empty strings');
  }
  if (!(parameterEnvironment instanceof LexicalEnvironment)) {
    throw new TypeError('Parameter environment must be a LexicalEnvironment');
  }
  if (typeof strict !== 'boolean') {
    throw new TypeError('Arguments strict flag must be a boolean');
  }
  if (typeof callee !== 'function' && !(callee instanceof VMFunction)) {
    throw new TypeError('Arguments callee must be a function or VMFunction');
  }

  const target = {};
  const mapping = new Map();

  for (let index = 0; index < args.length; index += 1) {
    Object.defineProperty(target, String(index), {
      value: args[index],
      writable: true,
      enumerable: true,
      configurable: true,
    });
  }

  Object.defineProperty(target, 'length', {
    value: args.length,
    writable: true,
    enumerable: false,
    configurable: true,
  });

  if (strict) {
    // ES5 specifies poison-pill own accessors for both names.
    // Modern native engines may omit the own "caller" property.
    for (const name of ['callee', 'caller']) {
      Object.defineProperty(target, name, {
        get: throwRestrictedArgumentsProperty,
        set: throwRestrictedArgumentsProperty,
        enumerable: false,
        configurable: false,
      });
    }
  } else {
    Object.defineProperty(target, 'callee', {
      value: callee,
      writable: true,
      enumerable: false,
      configurable: true,
    });

    const slots = new Map();
    for (const name of parameters) {
      if (!slots.has(name)) slots.set(name, slots.size);
    }

    const seen = new Set();
    for (let index = parameters.length - 1; index >= 0; index -= 1) {
      const name = parameters[index];
      if (seen.has(name)) continue;
      seen.add(name);

      // An absent last duplicate still prevents an earlier duplicate
      // from becoming mapped. Only actual arguments have indexed properties.
      if (index < args.length) {
        mapping.set(
          String(index),
          parameterEnvironment.getCell(slots.get(name)),
        );
      }
    }
  }

  return new Proxy(target, {
    get(object, key, receiver) {
      if (mapping.has(key)) return mapping.get(key).read();

      // Supply the ES5 Arguments brand to Object.prototype.toString.
      // No extra own symbol property is added to the ES5 property list.
      if (key === Symbol.toStringTag && !Reflect.has(object, key)) {
        return 'Arguments';
      }
      return Reflect.get(object, key, receiver);
    },

    getOwnPropertyDescriptor(object, key) {
      const descriptor = Reflect.getOwnPropertyDescriptor(object, key);
      if (descriptor !== undefined && mapping.has(key)) {
        return { ...descriptor, value: mapping.get(key).read() };
      }
      return descriptor;
    },

    defineProperty(object, key, descriptor) {
      const cell = mapping.get(key);
      const accessor = hasOwn(descriptor, 'get') || hasOwn(descriptor, 'set');
      let actualDescriptor = descriptor;

      // Making an index read-only snapshots the current parameter value,
      // not the stale value originally stored on the backing object.
      if (
        cell !== undefined &&
        !accessor &&
        descriptor.writable === false &&
        !hasOwn(descriptor, 'value')
      ) {
        actualDescriptor = { ...descriptor, value: cell.read() };
      }

      const succeeded = Reflect.defineProperty(object, key, actualDescriptor);
      if (!succeeded || cell === undefined) return succeeded;

      if (accessor) {
        mapping.delete(key);
      } else {
        if (hasOwn(descriptor, 'value')) cell.write(descriptor.value);
        if (descriptor.writable === false) mapping.delete(key);
      }
      return true;
    },

    deleteProperty(object, key) {
      const succeeded = Reflect.deleteProperty(object, key);
      if (succeeded) mapping.delete(key);
      return succeeded;
    },
  });
}
