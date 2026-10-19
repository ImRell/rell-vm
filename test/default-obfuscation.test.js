import test from 'node:test';
import assert from 'node:assert/strict';
import { Script, createContext } from 'node:vm';
import { mkdtemp, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { buildBrowserScript } from '../src/packer/build-browser-script.js';
import { compileFile } from '../src/cli/compile-file.js';
import { parseArguments, HELP_TEXT } from '../src/cli/parse-arguments.js';
import { compileToAssembly } from '../src/compiler/compile-assembly.js';
import { executeAssembly } from '../src/runtime/execute-assembly.js';
const exec = promisify(execFile),
  cli = fileURLToPath(new URL('../bin/jsvm.js', import.meta.url));
const secret = 'UNIQUE_ENCRYPTED_LITERAL_9eb814';
const source = `function PrivateFactory(PrivateParameter){var PrivateState=PrivateParameter;return function PrivateWorker(PrivateDelta){PrivateState+=PrivateDelta;return PrivateState;};}var PrivateClosure=PrivateFactory(40);capture(PrivateClosure(2));capture(${JSON.stringify(secret)});`;
const keys = [
  'parameters',
  'strict',
  'source',
  'program',
  'capturedEnvironment',
];
function run(code, extra = {}) {
  const output = [];
  const sandbox = { capture: (v) => output.push(v), ...extra };
  const context = createContext(sandbox, {
    codeGeneration: { strings: false, wasm: false },
  });
  new Script(code).runInContext(context, { timeout: 5000 });
  return { output, context };
}
async function fixture(t, text = source) {
  const dir = await mkdtemp(join(tmpdir(), 'rell-sealed-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const inputPath = join(dir, 'input.js'),
    outputPath = join(dir, 'build', 'out.js');
  await writeFile(inputPath, text);
  return { dir, inputPath, outputPath };
}
test('CLI defaults activate all layers without extra arguments', () => {
  const options = parseArguments(['in.js', '-o', 'out.js']);
  assert.equal(options.mangleNames, true);
  assert.equal(options.encryptProgram, true);
  assert.equal(options.minify, true);
  assert.equal(options.exposeFunctionMetadata, false);
  assert.equal(options.normalize, true);
  assert.match(HELP_TEXT, /ON by default/);
});
test('default packer encrypts literals, globals, property keys and ALL nested bodies on disk', async () => {
  const assembly = compileToAssembly(source),
    code = await buildBrowserScript(assembly);
  for (const text of [
    secret,
    'PrivateFactory',
    'PrivateParameter',
    'PrivateWorker',
    'PrivateState',
    'PrivateDelta',
    'js.global.get "capture"',
    assembly,
  ])
    assert.ok(!code.includes(text), text);
  assert.ok(!code.includes('js.function.create \\"'));
  assert.deepEqual(run(code).output, [42, secret]);
});
test('same input produces distinct working distributables', async () => {
  const a = await buildBrowserScript(compileToAssembly(source)),
    b = await buildBrowserScript(compileToAssembly(source));
  assert.notEqual(a, b);
  assert.deepEqual(run(a).output, run(b).output);
});
for (const minify of [false, true])
  for (const encryptProgram of [false, true])
    for (const mangleNames of [false, true]) {
      test(`all switches compose: minify=${minify},encrypt=${encryptProgram},mangle=${mangleNames}`, async () => {
        const code = await buildBrowserScript(compileToAssembly(source), {
          minify,
          encryptProgram,
          mangleNames,
          protectStrings: false,
        });
        assert.deepEqual(run(code).output, [42, secret]);
        assert.equal(code.includes(secret), !encryptProgram);
        assert.equal(
          code.includes('PrivateFactory'),
          !encryptProgram && !mangleNames,
        );
      });
    }
test('nested callbacks expose no VM program, instructions, environment or parameters', async () => {
  let callback;
  const code = await buildBrowserScript(
    compileToAssembly(
      'function PrivateFactory(PrivateState){return function PrivateWorker(PrivateDelta){PrivateState+=PrivateDelta;return PrivateState;};}save(PrivateFactory(40));',
    ),
  );
  run(code, { save: (fn) => (callback = fn) });
  for (const key of keys) {
    assert.equal(Object.hasOwn(callback, key), false);
    assert.equal(callback[key], undefined);
  }
  assert.equal(callback.length, 1);
  assert.equal(callback(2), 42);
  assert.equal(callback(1), 43);
  assert.ok(
    !Function.prototype.toString.call(callback).includes('PrivateState'),
  );
});
test('custom metadata-looking properties cannot replace private invocation state', async () => {
  const text =
    'function PrivateFunction(PrivateParameter){return PrivateParameter+2;}PrivateFunction.source="custom";PrivateFunction.program=null;PrivateFunction.parameters=[];PrivateFunction.strict=true;PrivateFunction.capturedEnvironment=null;capture(PrivateFunction(40));capture(PrivateFunction.source);';
  assert.deepEqual(
    run(await buildBrowserScript(compileToAssembly(text))).output,
    [42, 'custom'],
  );
});
test('reflection name opt-out works without requiring --mangle-names', async () => {
  const text =
    'function PrivateFunction(PrivateParameter){return PrivateParameter;}capture(PrivateFunction.name);capture(PrivateFunction(42));';
  assert.deepEqual(
    run(
      await buildBrowserScript(compileToAssembly(text), {
        keepFunctionNames: true,
      }),
    ).output,
    ['PrivateFunction', 42],
  );
  const options = parseArguments([
    'in.js',
    '-o',
    'out.js',
    '--keep-function-names',
  ]);
  assert.equal(options.mangleNames, true);
});
test('explicit metadata debug opt-out keeps prior diagnostics API', async () => {
  let fn;
  run(
    await buildBrowserScript(
      compileToAssembly(
        'save(function PrivateFunction(PrivateParameter){return PrivateParameter;});',
      ),
      { exposeFunctionMetadata: true },
    ),
    { save: (v) => (fn = v) },
  );
  for (const key of keys) assert.equal(Object.hasOwn(fn, key), true, key);
  assert.equal(fn(42), 42);
});
test('raw executor still offers optional readable diagnostic metadata', () => {
  for (const exposeFunctionMetadata of [false, true]) {
    let fn;
    executeAssembly(
      compileToAssembly('save(function PrivateFunction(x){return x;});'),
      { environment: { save: (v) => (fn = v) }, exposeFunctionMetadata },
    );
    assert.equal(Object.hasOwn(fn, 'program'), exposeFunctionMetadata);
    assert.equal(fn(42), 42);
  }
  assert.throws(
    () => executeAssembly('halt', { exposeFunctionMetadata: 1 }),
    TypeError,
  );
});
test('script reruns do not leak plaintext or loader globals', async () => {
  const code = await buildBrowserScript(
    compileToAssembly('var PrivateValue=42;capture(PrivateValue);'),
  );
  const values = [],
    sandbox = { capture: (v) => values.push(v) },
    context = createContext(sandbox, {
      codeGeneration: { strings: false, wasm: false },
    }),
    script = new Script(code);
  script.runInContext(context);
  script.runInContext(context);
  assert.deepEqual(values, [42, 42]);
  assert.deepEqual(Object.keys(sandbox), ['capture']);
});
test('string data survives NUL, quotes, surrogate code units, Unicode and script tags', async () => {
  for (const value of [
    '\u0000\ud800\udfff',
    '日本語 😀 Кириллица',
    '"\\\n\r\t</script>\u2028\u2029',
  ]) {
    const code = await buildBrowserScript(
      compileToAssembly('capture(' + JSON.stringify(value) + ');'),
    );
    assert.deepEqual(run(code).output, [value]);
    assert.ok(!code.includes('</script>'));
  }
});
test('packing still performs no execution and thrown values survive', async () => {
  const code = await buildBrowserScript(
    compileToAssembly('throw "runtime-only-secret";'),
  );
  assert.ok(!code.includes('runtime-only-secret'));
  assert.throws(
    () => run(code),
    (e) => e === 'runtime-only-secret',
  );
});
const semanticCases = [
  [
    'closures',
    'function factory(n){return function(step){n+=step;return n;};}var a=factory(1),b=factory(10);capture(a(2));capture(a(3));capture(b(2));',
  ],
  ['recursion', 'function f(n){return n?n*f(n-1):1;}capture(f(6));'],
  [
    'named expressions',
    'var f=function recurse(n){return n?recurse(n-1)+1:0;};capture(f(7));',
  ],
  [
    'mapped arguments',
    'function f(p){arguments[0]=7;capture(p);p=8;capture(arguments[0]);}f(1);',
  ],
  [
    'duplicate arguments',
    'function f(p,p){arguments[0]=3;capture(p);arguments[1]=4;capture(p);}f(1,2);',
  ],
  [
    'strict arguments',
    'function f(p){"use strict";arguments[0]=9;capture(p);capture(this===undefined);}f(1);',
  ],
  [
    'argument descriptors',
    'function f(p){Object.defineProperty(arguments,"0",{value:7,writable:false});p=9;capture(arguments[0]);capture(p);}f(1);',
  ],
  [
    'constructors',
    'function C(x){this.value=x;}C.prototype.read=function(){return this.value;};var x=new C(42);capture(x.read());capture(x instanceof C);',
  ],
  [
    'bind apply call',
    'function f(a,b){return this.value+a+b;}capture(f.call({value:1},2,3));capture(f.apply({value:1},[2,3]));capture(f.bind({value:1},2)(3));',
  ],
  [
    'native callbacks',
    'var offset=2;capture([1,2,3].map(function(x){return x+offset;}).join(","));',
  ],
  [
    'try finally completion',
    'function f(){try{return 1;}finally{return 42;}}capture(f());',
  ],
  [
    'catch closure',
    'var f;try{throw 42;}catch(e){f=function(){return e;};}capture(f());',
  ],
  [
    'labels and loops',
    'var x=0;outer:for(var i=0;i<4;i++){for(var j=0;j<4;j++){if(j===1)continue outer;x++;}}capture(x);',
  ],
  ['for in', 'var s="",o={a:1,b:2};for(var k in o)s+=k+o[k];capture(s);'],
  [
    'switch',
    'var x=2,r="";switch(x){case 1:r+="a";break;case 2:r+="b";default:r+="c";}capture(r);',
  ],
  [
    'getters setters',
    'var n=1,o={get value(){return n;},set value(v){n=v;}};o.value=42;capture(o.value);',
  ],
  ['regexp', 'capture(/a+/gi.test("BAAA"));capture("abc".replace(/b/,"X"));'],
  [
    'coercion',
    'var o={valueOf:function(){return 40;}};capture(o+2);capture(typeof missingName);',
  ],
  [
    'holes and deletes',
    'var a=[1,,3];capture(a.length);capture(1 in a);delete a[0];capture(0 in a);',
  ],
  [
    'finally on break',
    'var n=0;while(true){try{break;}finally{n=42;}}capture(n);',
  ],
];
for (const [name, text] of semanticCases)
  test('encrypted semantic regression: ' + name, async () => {
    const native = run(text).output,
      code = await buildBrowserScript(compileToAssembly(text));
    assert.deepEqual(run(code).output, native);
  });
for (const field of [
  'encryptProgram',
  'exposeFunctionMetadata',
  'randomizeInstructions',
])
  for (const value of [null, 1, 'yes', {}])
    test('new option validates ' + field + ' ' + String(value), async () => {
      const options = { [field]: value };
      await assert.rejects(buildBrowserScript('halt', options), TypeError);
      await assert.rejects(
        compileFile({
          inputPath: 'missing.js',
          outputPath: 'never.js',
          ...options,
        }),
        TypeError,
      );
    });
for (const flag of ['minify', 'mangle-names', 'encrypt-program'])
  test('CLI rejects conflicting ' + flag, () =>
    assert.throws(
      () =>
        parseArguments(['in.js', '-o', 'out.js', '--' + flag, '--no-' + flag]),
      /conflicts/,
    ),
  );
for (const flag of [
  'no-minify',
  'no-mangle-names',
  'no-encrypt-program',
  'encrypt-program',
  'expose-function-metadata',
])
  test('CLI rejects duplicate ' + flag, () =>
    assert.throws(
      () => parseArguments(['in.js', '-o', 'out.js', '--' + flag, '--' + flag]),
      /must not be repeated/,
    ),
  );
test('CLI debug flags explicitly disable each default layer', () => {
  const o = parseArguments([
    'in.js',
    '-o',
    'out.js',
    '--no-minify',
    '--no-mangle-names',
    '--no-encrypt-program',
    '--no-randomize-instructions',
    '--expose-function-metadata',
  ]);
  assert.equal(o.minify, false);
  assert.equal(o.mangleNames, false);
  assert.equal(o.encryptProgram, false);
  assert.equal(o.exposeFunctionMetadata, true);
});
test('real CLI defaults normalize ES6, encrypt all bodies and execute', async (t) => {
  const p = await fixture(
    t,
    'class PrivateClass{constructor(PrivateParameter=40){this.value=PrivateParameter;}read(){return (()=>this.value+2)();}}capture(new PrivateClass().read());capture(' +
      JSON.stringify(secret) +
      ');',
  );
  const result = await exec(process.execPath, [
    cli,
    p.inputPath,
    '-o',
    p.outputPath,
  ]);
  assert.match(result.stdout, /Built:/);
  const code = await readFile(p.outputPath, 'utf8');
  assert.deepEqual(run(code).output, [42, secret]);
  for (const s of ['PrivateClass', 'PrivateParameter', secret])
    assert.ok(!code.includes(s));
});
test('file API defaults encrypt and preserve source file', async (t) => {
  const p = await fixture(t);
  const info = await compileFile(p);
  const code = await readFile(p.outputPath, 'utf8');
  assert.equal(info.bytes, Buffer.byteLength(code));
  assert.equal(await readFile(p.inputPath, 'utf8'), source);
  assert.deepEqual(run(code).output, [42, secret]);
  assert.ok(!code.includes(secret));
});
test('real CLI debug mode produces readable local metadata on demand', async (t) => {
  const p = await fixture(t);
  await exec(process.execPath, [
    cli,
    p.inputPath,
    '-o',
    p.outputPath,
    '--no-minify',
    '--no-mangle-names',
    '--no-encrypt-program',
    '--no-randomize-instructions',
    '--no-protect-strings',
  ]);
  const code = await readFile(p.outputPath, 'utf8');
  assert.ok(code.includes('PrivateFactory'));
  assert.ok(code.includes(secret));
  assert.deepEqual(run(code).output, [42, secret]);
});
test('bad source creates no output directory with default protection', async (t) => {
  const p = await fixture(t, 'function (');
  await assert.rejects(compileFile(p), SyntaxError);
  await assert.rejects(stat(join(p.dir, 'build')), { code: 'ENOENT' });
});
