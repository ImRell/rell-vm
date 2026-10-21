import { parseAssembly } from '../assembly/parse.js';
import { assembleTextToBytecode } from '../bytecode/assemble.js';
import { decodeBytecode } from '../bytecode/binary-serializer.js';
import { openProgramEnvelope } from './open-program.js';
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
    bytecode,
    source,
    capturedEnvironment,
    exposeMetadata = true,
    decodeString,
  } = {}) {
    const rawProgram = bytecode ?? source;
    let parsedParams = parameters;
    if (typeof parsedParams === 'string') {
      try {
        parsedParams = JSON.parse(parsedParams);
      } catch {}
    }
    if (
      (decodeString !== undefined && typeof decodeString !== 'function') ||
      typeof exposeMetadata !== 'boolean' ||
      typeof name !== 'string' ||
      !Array.isArray(parsedParams) ||
      typeof strict !== 'boolean' ||
      (!rawProgram ||
        (typeof rawProgram !== 'string' &&
          !(rawProgram instanceof String) &&
          !(rawProgram instanceof Uint8Array) &&
          !(rawProgram && rawProgram.code instanceof Uint8Array) &&
          !(rawProgram && rawProgram.v === 1 && Array.isArray(rawProgram.k)))) ||
      !(capturedEnvironment instanceof LexicalEnvironment)
    )
      throw new TypeError('Invalid VM function');
    const seen = new Set();
    for (const parameter of parsedParams) {
      if (typeof parameter !== 'string' || parameter.length === 0)
        throw new TypeError('Invalid parameter');
      if (strict && seen.has(parameter))
        throw new SyntaxError(
          `Duplicate parameter in strict function: ${parameter}`,
        );
      seen.add(parameter);
    }

    let program = null;
    const getProgram = () => {
      if (program !== null) return program;
      let raw = rawProgram;
      if (raw && raw.v === 1 && Array.isArray(raw.k)) {
        raw = openProgramEnvelope(raw);
      }
      if (raw instanceof Uint8Array) {
        program = decodeBytecode(raw, { decodeString });
      } else if (raw && raw.code instanceof Uint8Array) {
        program = raw;
      } else if (typeof raw === 'string' || raw instanceof String) {
        program = assembleTextToBytecode(String(raw), {
          decodeString,
          fuseOpcodes: false,
        });
      }
      if (decodeString && program && Array.isArray(program.constants)) {
        if (Object.isFrozen(program.constants)) {
          program.constants = [...program.constants];
        }
        for (let i = 0; i < program.constants.length; i++) {
          const val = program.constants[i];
          if (typeof val === 'string' && val.startsWith('@') && /^@[a-f0-9]{16}$/.test(val)) {
            Object.defineProperty(program.constants, i, {
              enumerable: true,
              configurable: true,
              get() {
                const decoded = decodeString(val);
                if (typeof decoded !== 'string') {
                  throw new TypeError('Decoded string reference must be a string');
                }
                return decoded;
              },
            });
          }
        }
      }
      return program;
    };

    const metadata = Object.freeze({
      parameters: Object.freeze([...parsedParams]),
      strict,
      source: rawProgram,
      get bytecode() {
        return getProgram();
      },
      get program() {
        return getProgram();
      },
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
