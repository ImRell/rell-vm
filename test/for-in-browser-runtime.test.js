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
      contents: `import { executeAssembly } from './src/runtime/execute-assembly.js';executeAssembly(${JSON.stringify(text)}${options});`,
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
  test(`самостоятельный ${mode} runtime исполняет пример дважды без утечки var`, async () => {
    const example = await fs.readFile(
      new URL('../examples/for-in.js', import.meta.url),
      'utf8',
    );
    const code = await bundle(example, minify);
    const values = [],
      sandbox = {
        console: {
          log(value) {
            values.push(value);
          },
        },
      };
    const context = vm.createContext(sandbox);
    vm.runInContext(code, context);
    const expected = [
      'first:10',
      'second:20',
      'inherited:7',
      'unchanged',
      'a',
      'b',
      'y',
    ];
    assert.deepEqual(values, expected);
    assert.equal(Object.hasOwn(sandbox, 'key'), false);
    assert.equal(Object.hasOwn(sandbox, 'destination'), false);
    vm.runInContext(code, context);
    assert.deepEqual(values, [...expected, ...expected]);
  });
  test(`${mode}: setter VM, прототип и удаление ключа сохраняются в сборке`, async () => {
    const code = await bundle(
      'var target={set key(value){for(var nested in {z:1})console.log(value+nested);}};for(target.key in object){}',
      minify,
    );
    const values = [];
    const object = Object.assign(Object.create({ p: 1 }), { a: 1, b: 2, c: 3 });
    vm.runInNewContext(code, {
      object,
      console: {
        log(value) {
          values.push(value);
          if (value === 'az') delete object.b;
        },
      },
    });
    assert.deepEqual(values, ['az', 'cz', 'pz']);
  });
  test(`${mode}: упаковка не исполняет RHS, строка ключа не становится кодом`, async () => {
    const key = '"; globalThis.injected = true; //\n雪';
    const source = `for(var k in source()){console.log(k);}for(k in {${JSON.stringify(key)}:1})console.log(k);`;
    const code = await bundle(source, minify);
    const values = [],
      sandbox = {
        source() {
          values.push('rhs');
          return { a: 1 };
        },
        console: {
          log(v) {
            values.push(v);
          },
        },
      };
    assert.deepEqual(values, []);
    vm.runInNewContext(code, sandbox);
    assert.deepEqual(values, ['rhs', 'a', key]);
    assert.equal(Object.hasOwn(sandbox, 'injected'), false);
  });
  test(`${mode}: общий лимит продолжает работать внутри for-in`, async () => {
    const code = await bundle(
      'for(var key in {a:1})while(true){}',
      minify,
      ', { maxSteps: 100 }',
    );
    assert.throws(
      () => vm.runInNewContext(code, {}, { timeout: 1000 }),
      /Instruction limit exceeded: 100/,
    );
  });
}
