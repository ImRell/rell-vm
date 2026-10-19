import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { compileToAssembly } from '../src/compiler/compile-assembly.js';
async function bundle(source, minify, options = '') {
  const text = compileToAssembly(source);
  const result = await build({
    stdin: {
      contents: `import {executeAssembly} from './src/runtime/execute-assembly.js';executeAssembly(${JSON.stringify(text)}${options});`,
      resolveDir: fileURLToPath(new URL('..', import.meta.url)),
    },
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'iife',
    target: 'es2022',
    minify,
  });
  return result.outputFiles[0].text;
}
for (const minify of [false, true]) {
  const mode = minify ? 'minified' : 'normal';
  test(`${mode}: full example equals native and has no script-var leak`, async () => {
    const source = await fs.readFile(
      new URL('./fixtures/es5-completions.source.txt', import.meta.url),
      'utf8',
    );
    const expected = [],
      actual = [];
    vm.runInNewContext(source, { console: { log: (v) => expected.push(v) } });
    const code = await bundle(source, minify),
      sandbox = { console: { log: (v) => actual.push(v) } },
      context = vm.createContext(sandbox);
    vm.runInContext(code, context);
    assert.deepEqual(actual, expected);
    vm.runInContext(code, context);
    assert.deepEqual(actual, [...expected, ...expected]);
    for (const name of ['Counter', 'counter', 'guarded', 'i', 'j', 'advance'])
      assert.equal(Object.hasOwn(sandbox, name), false);
  });
  test(`${mode}: native map plus constructor plus finally`, async () => {
    const values = [],
      code = await bundle(
        'function C(x){this.x=x;}C.prototype.get=function(){try{return this.x;}finally{capture("f");}};capture([1,2].map(function(x){return new C(x).get();}).join(","));',
        minify,
      );
    vm.runInNewContext(code, { capture: (v) => values.push(v) });
    assert.deepEqual(values, ['f', 'f', '1,2']);
  });
  test(`${mode}: retained callbacks survive root executor exit`, async () => {
    let fn;
    const values = [],
      code = await bundle(
        'var n=0;save(function(){try{return ++n;}finally{capture(n);}});',
        minify,
      );
    vm.runInNewContext(code, {
      save: (f) => (fn = f),
      capture: (v) => values.push(v),
    });
    assert.equal(fn(), 1);
    assert.equal(fn(), 2);
    assert.deepEqual(values, [1, 2]);
  });
  test(`${mode}: exact exception crosses native callback and catch`, async () => {
    const marker = {},
      values = [],
      code = await bundle(
        'try{[1].map(function(){throw marker;});}catch(e){capture(e===marker);}finally{capture("f");}',
        minify,
      );
    vm.runInNewContext(code, { marker, capture: (v) => values.push(v) });
    assert.deepEqual(values, [true, 'f']);
  });
  test(`${mode}: getters keep function identity`, async () => {
    const values = [],
      code = await bundle(
        'var f=function(){return this.x;};var o={x:7};Object.defineProperty(o,"v",{get:f});capture(Object.getOwnPropertyDescriptor(o,"v").get===f);capture(o.v);',
        minify,
      );
    vm.runInNewContext(code, { capture: (v) => values.push(v) });
    assert.deepEqual(values, [true, 7]);
  });
  test(`${mode}: label unwinds all applicable finally blocks`, async () => {
    const values = [],
      code = await bundle(
        'a:for(;;){try{try{break a;}finally{capture(1);}}finally{capture(2);}}capture(3);',
        minify,
      );
    vm.runInNewContext(code, { capture: (v) => values.push(v) });
    assert.deepEqual(values, [1, 2, 3]);
  });
  test(`${mode}: hard budget cannot be swallowed by catch`, async () => {
    const values = [],
      code = await bundle(
        'try{while(true){try{for(;;){}}catch(e){}}}finally{capture("not-run-on-hard-stop");}',
        minify,
        ', {maxSteps:100}',
      );
    assert.throws(
      () =>
        vm.runInNewContext(
          code,
          { capture: (v) => values.push(v) },
          { timeout: 1000 },
        ),
      /Instruction limit exceeded: 100/,
    );
    assert.deepEqual(values, []);
  });
  test(`${mode}: text packaging never evaluates string contents`, async () => {
    const value = '";globalThis.injected=true;//\n雪';
    const code = await bundle(
        `try{throw ${JSON.stringify(value)};}catch(e){capture(e);}`,
        minify,
      ),
      values = [],
      sandbox = { capture: (v) => values.push(v) };
    assert.deepEqual(values, []);
    vm.runInNewContext(code, sandbox);
    assert.deepEqual(values, [value]);
    assert.equal(Object.hasOwn(sandbox, 'injected'), false);
  });
}
