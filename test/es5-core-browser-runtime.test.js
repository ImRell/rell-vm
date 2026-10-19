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
  test(`${mode}: большой ES5 пример совпадает с native и повторяется без утечки`, async () => {
    const source = await fs.readFile(
      new URL('./fixtures/es5-core.source.txt', import.meta.url),
      'utf8',
    );
    const expected = [],
      actual = [];
    vm.runInNewContext(source, {
      console: {
        log(v) {
          expected.push(v);
        },
      },
    });
    const code = await bundle(source, minify);
    const sandbox = {
        console: {
          log(v) {
            actual.push(v);
          },
        },
      },
      context = vm.createContext(sandbox);
    vm.runInContext(code, context);
    assert.deepEqual(actual, expected);
    for (const name of ['hash', 'value', 'bits', 'object', 'index', 'result'])
      assert.equal(Object.hasOwn(sandbox, name), false);
    vm.runInContext(code, context);
    assert.deepEqual(actual, [...expected, ...expected]);
  });
  test(`${mode}: VM conversion, switch, regex и delete работают вместе`, async () => {
    const source =
      'var o={x:1,valueOf:function(){switch(this.x){case 1:return 7;default:throw "bad";}}};console.log(o|2);console.log(/a/g.test("a"));console.log(delete o.x);console.log(typeof notFound);';
    const code = await bundle(source, minify),
      values = [];
    vm.runInNewContext(code, {
      console: {
        log(v) {
          values.push(v);
        },
      },
    });
    assert.deepEqual(values, [7, true, true, 'undefined']);
  });
  test(`${mode}: throw через conversion сохраняет идентичность внешнего значения`, async () => {
    const error = { marker: 1 },
      code = await bundle(
        'var o={valueOf:function(){throw error;}};o+1;',
        minify,
      );
    assert.throws(
      () => vm.runInNewContext(code, { error }),
      (e) => e === error,
    );
  });
  test(`${mode}: упаковка не исполняет case tests и сохраняет строковые литералы`, async () => {
    const value = '";globalThis.injected=true;//\n雪',
      source = `switch(produce()){case ${JSON.stringify(value)}:console.log(${JSON.stringify(value)});break;default:throw "bad";}`;
    const code = await bundle(source, minify),
      events = [];
    assert.deepEqual(events, []);
    const sandbox = {
      produce() {
        events.push('produce');
        return value;
      },
      console: {
        log(v) {
          events.push(v);
        },
      },
    };
    vm.runInNewContext(code, sandbox);
    assert.deepEqual(events, ['produce', value]);
    assert.equal(Object.hasOwn(sandbox, 'injected'), false);
  });
  test(`${mode}: общий лимит останавливает цикл conversion внутри switch`, async () => {
    const code = await bundle(
      'var o={valueOf:function(){while(true){}}};switch(o+1){default:break;}',
      minify,
      ', {maxSteps:100}',
    );
    assert.throws(
      () => vm.runInNewContext(code, {}, { timeout: 1000 }),
      /Instruction limit exceeded: 100/,
    );
  });
  test(`${mode}: literal RegExp не зависит от подмены global RegExp и lexical shadowing`, async () => {
    // Even an external replacement installed BEFORE loading the bundle must
    // not replace the intrinsic used by a RegExp literal.
    const code = await bundle(
        'var RegExp=0;console.log(/ab/i.test("AB"));',
        minify,
      ),
      values = [];
    vm.runInNewContext(code, {
      RegExp() {
        throw Error('Global RegExp must not construct a literal');
      },
      console: {
        log(v) {
          values.push(v);
        },
      },
    });
    assert.deepEqual(values, [true]);
  });
}
