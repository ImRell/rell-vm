import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Script, createContext } from 'node:vm';
import { compileToAssembly } from '../src/compiler/compile-assembly.js';
import { buildBrowserScript } from '../src/packer/build-browser-script.js';
import { compileFile } from '../src/cli/compile-file.js';
const source =
  'function SecretCalculator(SecretParameter){var SecretInternalTotal=SecretParameter+2;return function SecretReader(){return SecretInternalTotal;};}capture(SecretCalculator(40)());';
const secrets = [
  'SecretCalculator',
  'SecretParameter',
  'SecretInternalTotal',
  'SecretReader',
];
function run(code, environment = {}) {
  const values = [];
  new Script(code).runInContext(
    createContext(
      { capture: (v) => values.push(v), ...environment },
      { codeGeneration: { strings: false, wasm: false } },
    ),
    { timeout: 3000 },
  );
  return values;
}
async function fixture(t, text) {
  const dir = await mkdtemp(join(tmpdir(), 'rell-mangle-build-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const inputPath = join(dir, 'input.js'),
    outputPath = join(dir, 'build', 'output.js');
  await writeFile(inputPath, text);
  return { dir, inputPath, outputPath };
}
for (const minify of [false, true]) {
  test(`packer hides recursive metadata names, minify=${minify}`, async () => {
    const text = compileToAssembly(source),
      code = await buildBrowserScript(text, { mangleNames: true, minify });
    for (const name of secrets) assert.ok(!code.includes(name), name);
    assert.deepEqual(run(code), [42]);
    assert.ok(text.includes('SecretCalculator'));
  });
  test(`explicit readable debug output is supported, minify=${minify}`, async () => {
    const code = await buildBrowserScript(compileToAssembly(source), {
      minify,
      mangleNames: false,
      encryptProgram: false,
      protectStrings: false,
    });
    assert.ok(code.includes('SecretCalculator'));
    assert.deepEqual(run(code), [42]);
  });
  test(`keepFunctionNames preserves observable names, minify=${minify}`, async () => {
    const code = await buildBrowserScript(
      compileToAssembly(
        'function SecretCalculator(SecretParameter){var SecretInternalTotal=SecretParameter;return SecretInternalTotal;}capture(SecretCalculator.name);capture(SecretCalculator(42));',
      ),
      { mangleNames: true, keepFunctionNames: true, minify },
    );
    assert.deepEqual(run(code), ['SecretCalculator', 42]);
    assert.ok(!code.includes('SecretParameter'));
    assert.ok(!code.includes('SecretInternalTotal'));
  });
  test(`public property keys and original literal strings remain, minify=${minify}`, async () => {
    const code = await buildBrowserScript(
      compileToAssembly(
        'var SecretParameter=42;var PublicObject={SecretParameter:SecretParameter};capture(PublicObject.SecretParameter);capture("SecretParameter");',
      ),
      { mangleNames: true, minify },
    );
    assert.deepEqual(run(code), [42, 'SecretParameter']);
    assert.ok(!code.includes('SecretParameter'));
  });
  test(`native retained callback exposes only mangled metadata, minify=${minify}`, async () => {
    const code = await buildBrowserScript(
      compileToAssembly(
        'var SecretInternalTotal=35;save(function SecretReader(SecretParameter){return SecretInternalTotal+SecretParameter;});',
      ),
      { mangleNames: true, minify },
    );
    let callback;
    run(code, { save: (fn) => (callback = fn) });
    assert.equal(callback(7), 42);
    assert.ok(!secrets.includes(callback.name));
    assert.equal(callback.parameters, undefined);
    assert.equal(callback.source, undefined);
    assert.equal(callback.program, undefined);
    assert.equal(callback.capturedEnvironment, undefined);
  });
  for (const normalize of [false, true])
    test(`compileFile hides names: normalize=${normalize}, minify=${minify}`, async (t) => {
      const paths = await fixture(t, source);
      const result = await compileFile({
        ...paths,
        normalize,
        minify,
        mangleNames: true,
      });
      const code = await readFile(paths.outputPath, 'utf8');
      assert.deepEqual(run(code), [42]);
      for (const name of secrets) assert.ok(!code.includes(name), name);
      assert.equal(result.bytes, Buffer.byteLength(code));
      assert.equal(await readFile(paths.inputPath, 'utf8'), source);
    });
  test(`ES6 normalization before mangling, minify=${minify}`, async (t) => {
    const paths = await fixture(
      t,
      'class SecretCalculator{constructor(SecretParameter=40){this.value=SecretParameter;}read(){const SecretInternalTotal=2;return (()=>this.value+SecretInternalTotal)();}}capture(new SecretCalculator().read());',
    );
    await compileFile({ ...paths, minify, mangleNames: true });
    const code = await readFile(paths.outputPath, 'utf8');
    assert.deepEqual(run(code), [42]);
    for (const name of [
      'SecretCalculator',
      'SecretParameter',
      'SecretInternalTotal',
    ])
      assert.ok(!code.includes(name), name);
  });
}
for (const options of [
  { mangleNames: null },
  { mangleNames: 1 },
  { mangleNames: 'yes' },
  { keepFunctionNames: null },
  { keepFunctionNames: 'yes' },
  { keepFunctionNames: true, mangleNames: false },
]) {
  test(
    'packer rejects ' + JSON.stringify(options),
    async () =>
      await assert.rejects(buildBrowserScript('halt', options), TypeError),
  );
  test(
    'file API validates before input I/O ' + JSON.stringify(options),
    async () =>
      await assert.rejects(
        compileFile({
          inputPath: 'not-read.js',
          outputPath: 'not-created.js',
          ...options,
        }),
        TypeError,
      ),
  );
}
test('bad assembly with mangling is rejected before packaging', async () =>
  await assert.rejects(
    buildBrowserScript('jump Missing\nhalt', { mangleNames: true }),
    SyntaxError,
  ));
test('mangling never executes user throw at build time', async () => {
  const code = await buildBrowserScript(
    compileToAssembly('throw new Error("runtime only");'),
    { mangleNames: true },
  );
  assert.throws(
    () => run(code),
    (e) => e.message === 'runtime only',
  );
});
test('invalid option creates no output directory', async (t) => {
  const paths = await fixture(t, source);
  await assert.rejects(
    compileFile({ ...paths, mangleNames: true, keepFunctionNames: 1 }),
    TypeError,
  );
  await assert.rejects(stat(join(paths.dir, 'build')), { code: 'ENOENT' });
});
