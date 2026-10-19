import assert from 'node:assert/strict';
import vm from 'node:vm';
import { compileToAssembly } from '../src/compiler/compile-assembly.js';
import { executeAssembly } from '../src/runtime/execute-assembly.js';
export function outcome(source, factory = () => ({}), native = false) {
  const values = [],
    events = [];
  const environment = Object.defineProperties(
    {
      // Native vm literals belong to its own realm; use that realm's
      // builtins instead of injecting host Array/Object into it.
      ...(!native
        ? {
            Object,
            Function,
            Array,
            String,
            Number,
            Boolean,
            RegExp,
            Date,
            Error,
            TypeError,
            Symbol,
            undefined,
            NaN,
            Infinity,
            Math,
            JSON,
          }
        : {}),
      capture(value) {
        values.push(value);
      },
    },
    Object.getOwnPropertyDescriptors(factory(events)),
  );
  let error,
    thrown = false;
  try {
    if (native) vm.runInNewContext(source, environment, { timeout: 1000 });
    else
      executeAssembly(compileToAssembly(source), {
        environment,
        maxSteps: 200000,
      });
  } catch (e) {
    thrown = true;
    error =
      e !== null && (typeof e === 'object' || typeof e === 'function')
        ? { name: e.name }
        : e;
  }
  return { values, events, thrown, error };
}
export function compare(source, factory) {
  const actual = outcome(source, factory),
    expected = outcome(source, factory, true);
  assert.deepEqual(actual, expected);
  return actual;
}
