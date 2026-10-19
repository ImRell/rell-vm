import { parseAssembly } from '../assembly/parse.js';
import { LexicalEnvironment } from './lexical-environment.js';
const records = new WeakMap();
const invokers = new WeakMap();
const define = Object.defineProperty;

/** Native-callable/constructable function backed by immutable VM metadata. */
export class VMFunction {
  static [Symbol.hasInstance](value) {
    return records.has(value);
  }
  constructor({
    name = '',
    parameters = [],
    strict = false,
    source,
    capturedEnvironment,
    exposeMetadata = true,
    decodeString,
  } = {}) {
    if (
      (decodeString !== undefined && typeof decodeString !== 'function') ||
      typeof exposeMetadata !== 'boolean' ||
      typeof name !== 'string' ||
      !Array.isArray(parameters) ||
      typeof strict !== 'boolean' ||
      typeof source !== 'string' ||
      !(capturedEnvironment instanceof LexicalEnvironment)
    )
      throw new TypeError('Invalid VM function');
    const seen = new Set();
    for (const parameter of parameters) {
      if (typeof parameter !== 'string' || parameter.length === 0)
        throw new TypeError('Invalid parameter');
      if (strict && seen.has(parameter))
        throw new SyntaxError(
          `Duplicate parameter in strict function: ${parameter}`,
        );
      seen.add(parameter);
    }
    const metadata = Object.freeze({
      parameters: Object.freeze([...parameters]),
      strict,
      source,
      program: parseAssembly(source, { decodeString }),
      capturedEnvironment,
    });
    // This is an ordinary strict native function (ES module): native new,
    // bind, call/apply and callback APIs can all invoke it. Its body is NOT
    // user source; it delegates to the original VM executor.
    const callable = function (...args) {
      const invoke = invokers.get(callable);
      if (invoke === undefined)
        throw new TypeError('VM function is not attached to an executor');
      return invoke(callable, this, args);
    };
    records.set(callable, metadata);
    define(callable, 'name', { value: name, configurable: true });
    define(callable, 'length', {
      value: parameters.length,
      configurable: true,
    });
    if (exposeMetadata) {
      for (const [key, value] of Object.entries(metadata))
        define(callable, key, { value });
    }
    return callable;
  }
}
export function getVMFunctionInvoker(fn) {
  return invokers.get(fn);
}
export function attachVMFunction(fn, invoke) {
  if (!records.has(fn) || typeof invoke !== 'function')
    throw new TypeError('Invalid VM function executor');
  // A function belongs to its creation executor/realm, not the latest caller.
  if (!invokers.has(fn)) invokers.set(fn, invoke);
  return fn;
}

// Internal runtime access does not depend on public/custom function properties.
export function getVMFunctionRecord(fn) {
  const record = records.get(fn);
  if (record === undefined) throw new TypeError('Not a VM function');
  return record;
}
