import test from 'node:test';
import assert from 'node:assert/strict';
import { Script, createContext } from 'node:vm';
import { buildBrowserScript } from '../src/packer/build-browser-script.js';
import { compileToAssembly } from '../src/compiler/compile-assembly.js';

function run(code, extra = {}) {
  const output = [];
  const sandbox = { capture: (v) => output.push(v), ...extra };
  const context = createContext(sandbox, {
    codeGeneration: { strings: false, wasm: false },
  });
  new Script(code).runInContext(context, { timeout: 5000 });
  return { output, context };
}

test('on-demand decryption: child function bytecodes are encrypted envelopes until execution', async () => {
  let capturedFn;
  const source = `
    function parent(val) {
      function child(delta) {
        return val + delta;
      }
      return child;
    }
    save(parent(40));
  `;
  const code = await buildBrowserScript(compileToAssembly(source), {
    encryptProgram: true,
    exposeFunctionMetadata: true,
  });

  const { output } = run(code, { save: (fn) => (capturedFn = fn) });
  assert.ok(typeof capturedFn === 'function');
  assert.equal(capturedFn.source && capturedFn.source.v, 1);
  assert.ok(Array.isArray(capturedFn.source.k));
  assert.equal(capturedFn.source.k.length, 2);

  // Calling the function decrypts and caches in memory
  const result = capturedFn(2);
  assert.equal(result, 42);

  assert.ok(capturedFn.program && ArrayBuffer.isView(capturedFn.program.code));

  // Subsequent invocations use cached program
  const result2 = capturedFn(10);
  assert.equal(result2, 50);
});

test('on-demand decryption: distinct nested functions have independent keys and nonces', async () => {
  let fnA, fnB;
  const source = `
    function getFunctions() {
      function first() { return 1; }
      function second() { return 2; }
      return [first, second];
    }
    save(getFunctions());
  `;
  const code = await buildBrowserScript(compileToAssembly(source), {
    encryptProgram: true,
    exposeFunctionMetadata: true,
  });

  run(code, { save: ([a, b]) => { fnA = a; fnB = b; } });
  assert.ok(fnA.source.v === 1 && fnB.source.v === 1);
  assert.notEqual(fnA.source.n, fnB.source.n);
  assert.notEqual(fnA.source.k[0], fnB.source.k[0]);
  assert.equal(fnA(), 1);
  assert.equal(fnB(), 2);
});
