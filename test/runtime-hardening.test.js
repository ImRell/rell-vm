import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Script, createContext } from 'node:vm';
import { parse as parseJavaScript } from '@babel/parser';
import { execFile } from 'node:child_process';
import { promisify, stripVTControlCharacters } from 'node:util';
import { fileURLToPath } from 'node:url';
import { INSTRUCTIONS } from '../src/assembly/instructions.js';
import { compileToAssembly } from '../src/compiler/compile-assembly.js';
import { buildBrowserScript } from '../src/packer/build-browser-script.js';
import { compileFile } from '../src/cli/compile-file.js';
import { parseArguments, HELP_TEXT } from '../src/cli/parse-arguments.js';
import {
  INTERNAL_PROPERTIES,
  collectUsedOpcodes,
  specializeRuntimeSource,
  runtimePropertyOptions,
} from '../src/packer/runtime-hardening.js';
const exec = promisify(execFile),
  cli = fileURLToPath(new URL('../bin/jsvm.js', import.meta.url));
const dispatcher = await readFile(
  new URL('../src/runtime/execute-assembly.js', import.meta.url),
  'utf8',
);
const table = await readFile(
  new URL('../src/assembly/instructions.js', import.meta.url),
  'utf8',
);
function walk(root, fn) {
  const queue = [root];
  while (queue.length) {
    const n = queue.pop();
    fn(n);
    for (const v of Object.values(n)) {
      if (Array.isArray(v)) {
        for (const c of v) if (c && typeof c.type === 'string') queue.push(c);
      } else if (v && typeof v.type === 'string') queue.push(v);
    }
  }
}
function caseNames(source) {
  const result = new Set();
  walk(parseJavaScript(source, { sourceType: 'module' }), (n) => {
    if (
      n.type === 'SwitchStatement' &&
      n.discriminant.type === 'Identifier' &&
      n.discriminant.name === 'op'
    )
      for (const c of n.cases) if (c.test) result.add(c.test.value);
  });
  return [...result];
}
function run(code, extras = {}) {
  const output = [];
  new Script(code).runInContext(
    createContext(
      { capture: (v) => output.push(v), ...extras },
      { codeGeneration: { strings: false, wasm: false } },
    ),
    { timeout: 5000 },
  );
  return output;
}
async function fixture(t, source = 'capture(42);') {
  const dir = await mkdtemp(join(tmpdir(), 'rell-hardening-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const inputPath = join(dir, 'input.js'),
    outputPath = join(dir, 'build', 'out.js');
  await writeFile(inputPath, source);
  return { dir, inputPath, outputPath };
}

test('default switches enable VM property mangling, pruning and masked errors', () => {
  const o = parseArguments(['a.js', '-o', 'b.js']);
  for (const key of ['mangleProperties', 'pruneOpcodes', 'maskErrors'])
    assert.equal(o[key], true);
});
test('used-opcode scan includes nested and dead-branch function bodies', () => {
  const text = compileToAssembly(
    'if(false){var nested=function(x){return function(){throw /abc/;};};}capture(42);',
  );
  const used = collectUsedOpcodes(text);
  for (const op of [
    'js.function.create',
    'return',
    'throw',
    'js.regexp.create',
    'js.call',
    'js.const',
  ])
    assert.ok(used.has(op), op);
});
test('used-opcode collection validates malformed input', () => {
  for (const value of [null, 42, {}, []])
    assert.throws(() => collectUsedOpcodes(value), TypeError);
  assert.throws(() => collectUsedOpcodes('jump missing\nhalt'), SyntaxError);
});
for (const op of Object.keys(INSTRUCTIONS))
  test(
    'single-opcode specialization preserves its own case and removes every other handler: ' +
      op,
    () => {
      const source = specializeRuntimeSource(dispatcher, {
        filename: 'runtime/execute-assembly.js',
        usedOpcodes: new Set([op]),
        maskErrors: true,
      });
      assert.deepEqual(caseNames(source), [op]);
    },
  );
test('grouped fallthrough cases retain common body when only an early member survives', () => {
  const source = specializeRuntimeSource(dispatcher, {
    filename: 'runtime/execute-assembly.js',
    usedOpcodes: new Set(['js.add']),
    maskErrors: false,
  });
  assert.deepEqual(caseNames(source), ['js.add']);
  assert.match(source, /binaryOperation\(op,/);
});
test('instruction contract retains only used opcodes and their original schemas', () => {
  for (const used of [
    new Set(['halt']),
    new Set(['js.add', 'js.call', 'return']),
    new Set(Object.keys(INSTRUCTIONS)),
  ]) {
    const code = specializeRuntimeSource(table, {
      filename: 'assembly/instructions.js',
      usedOpcodes: used,
      maskErrors: false,
    });
    const result = new Script(
      code.replaceAll('export ', '') + ';INSTRUCTIONS;',
    ).runInNewContext();
    assert.deepEqual(
      Object.keys(result),
      Object.keys(INSTRUCTIONS).filter((op) => used.has(op)),
    );
    for (const op of used)
      assert.deepEqual(
        JSON.parse(JSON.stringify(result[op])),
        JSON.parse(JSON.stringify(INSTRUCTIONS[op])),
      );
  }
});
test('disabling hardening leaves runtime source byte-identical', () => {
  assert.equal(
    specializeRuntimeSource(dispatcher, {
      filename: 'runtime/execute-assembly.js',
      usedOpcodes: new Set(['halt']),
      pruneOpcodes: false,
      maskErrors: false,
    }),
    dispatcher,
  );
});
test('internal property allowlist excludes public and native ABI keys', () => {
  for (const key of [
    'name',
    'message',
    'value',
    'get',
    'set',
    'writable',
    'enumerable',
    'configurable',
    'length',
    'prototype',
    'constructor',
    'next',
    'done',
    'call',
    'apply',
    'bind',
    'toString',
    'then',
  ])
    assert.ok(!INTERNAL_PROPERTIES.includes(key), key);
  const options = runtimePropertyOptions(true);
  assert.ok(options.mangleProps.test('stack'));
  assert.ok(options.mangleProps.test('locals'));
  assert.equal(
    Object.keys(options.mangleCache).length,
    INTERNAL_PROPERTIES.length,
  );
  assert.equal(
    new Set(Object.values(options.mangleCache)).size,
    INTERNAL_PROPERTIES.length,
  );
  assert.deepEqual(runtimePropertyOptions(false), {});
});
test('default output has no readable VM stack/locals property names or diagnostic strings', async () => {
  const code = await buildBrowserScript(
    compileToAssembly('function add(x){return x+2;}capture(add(40));'),
  );
  for (const word of [
    'stack',
    'locals',
    'rootEnvironment',
    'capturedEnvironment',
    'Stack underflow',
    'Assignment to constant',
    'Instruction limit exceeded',
  ])
    assert.ok(!code.includes(word), word);
  assert.deepEqual(run(code), [42]);
});
test('unused dispatcher and table entries disappear from non-minified canonical bundle', async () => {
  const code = await buildBrowserScript('halt', {
    minify: false,
    encryptProgram: false,
    randomizeInstructions: false,
    mangleProperties: false,
  });
  const cases = caseNames(code);
  assert.deepEqual(cases, ['halt']);
  assert.ok(!code.includes('case "js.call"'));
  assert.ok(!code.includes('case "js.construct"'));
});
test('opcode pruning significantly shrinks a small-program distributable', async () => {
  const text = compileToAssembly('capture(42);'),
    small = await buildBrowserScript(text),
    full = await buildBrowserScript(text, { pruneOpcodes: false });
  assert.deepEqual(run(small), [42]);
  assert.deepEqual(run(full), [42]);
  assert.ok(
    small.length < full.length * 0.85,
    [small.length, full.length].join('/'),
  );
});
const propertyProgram =
  'var o={stack:1,locals:2,program:3,environment:4,source:5,parameters:6,args:7,read:8,write:9,parent:10,target:11};capture(Object.keys(o).join(","));capture(o.stack+o.locals+o.program);capture(JSON.stringify(o));';
for (const mangleProperties of [false, true])
  test(
    'public user properties and literal keys preserve values: ' +
      mangleProperties,
    async () => {
      assert.deepEqual(
        run(
          await buildBrowserScript(compileToAssembly(propertyProgram), {
            mangleProperties,
          }),
        ),
        run(propertyProgram),
      );
    },
  );
test('native Error stack, RegExp source and public descriptors are never mangled', async () => {
  const text =
    'var e=new Error("USER_MESSAGE");capture(typeof e.stack);capture(e.message);capture(/abc/i.source);var o={};Object.defineProperty(o,"stack",{value:42});capture(o.stack);capture(Object.getOwnPropertyDescriptor(o,"stack").writable);';
  assert.deepEqual(
    run(await buildBrowserScript(compileToAssembly(text))),
    run(text),
  );
});
for (const [source, errorType] of [
  ['let x=x;', 'ReferenceError'],
  ['const x=1;x=2;', 'TypeError'],
  ['missingExternal;', 'ReferenceError'],
])
  test(
    'VM-created error message masked but class preserved: ' + source,
    async () => {
      const code = await buildBrowserScript(compileToAssembly(source));
      assert.throws(
        () => run(code),
        (e) => e.name === errorType && e.message === '???',
      );
    },
  );
test('masking can be disabled for detailed diagnostics', async () => {
  const code = await buildBrowserScript(
    compileToAssembly('const SecretValue=1;SecretValue=2;'),
    { maskErrors: false, keepFunctionNames: true },
  );
  assert.throws(
    () => run(code),
    (e) =>
      e.name === 'TypeError' &&
      e.message.includes('Assignment to constant variable'),
  );
});
test('user-thrown values and user-created Errors are not masked', async () => {
  const text =
    'try{throw new Error("USER_MESSAGE");}catch(e){capture(e.message);}try{throw "USER_THROW";}catch(e){capture(e);}';
  assert.deepEqual(run(await buildBrowserScript(compileToAssembly(text))), [
    'USER_MESSAGE',
    'USER_THROW',
  ]);
});
test('external exception identity, name, message and custom properties survive', async () => {
  const error = new TypeError('HOST_MESSAGE');
  error.stack = 'HOST_STACK';
  error.locals = 42;
  let caught;
  const code = await buildBrowserScript(
    compileToAssembly('try{external();}catch(e){capture(e);}'),
  );
  const values = run(code, {
    external() {
      throw error;
    },
  });
  assert.equal(values[0], error);
  assert.equal(values[0].message, 'HOST_MESSAGE');
  assert.equal(values[0].stack, 'HOST_STACK');
  assert.equal(values[0].locals, 42);
});
test('masked errors still run catch/finally and preserve completion semantics', async () => {
  const text =
    'var trace="";try{const x=1;x=2;}catch(e){trace+=e.message;}finally{trace+="finally";}capture(trace);';
  assert.deepEqual(run(await buildBrowserScript(compileToAssembly(text))), [
    '???finally',
  ]);
});
test('bad bytecode still throws ??? rather than silently continuing', async () => {
  const code = await buildBrowserScript('drop\nhalt');
  assert.throws(
    () => run(code),
    (e) => e.name === 'Error' && e.message === '???',
  );
});
test('masking replaces constructors and fail arguments, not rethrows or arbitrary calls', () => {
  const source =
    'function fail(a,b){throw new Error(`VM ${a}: ${b}`);}function test(){fail(1,`secret ${2}`);throw externalError;}const own=new NativeTypeError("private message");const publicValue=external("public message");';
  const code = specializeRuntimeSource(source, {
    filename: 'runtime/test.js',
    usedOpcodes: new Set(),
    pruneOpcodes: false,
    maskErrors: true,
  });
  assert.ok(!code.includes('private message'));
  assert.ok(!code.includes('secret'));
  assert.ok(!code.includes('VM '));
  assert.match(code, /throw externalError/);
  assert.match(code, /external\("public message"\)/);
});
test('debug metadata option preserves canonical diagnostic property API', async () => {
  let fn;
  run(
    await buildBrowserScript(
      compileToAssembly('save(function named(a){return a+2;});'),
      { exposeFunctionMetadata: true },
    ),
    { save: (v) => (fn = v) },
  );
  for (const key of [
    'source',
    'parameters',
    'strict',
    'program',
    'capturedEnvironment',
  ])
    assert.ok(Object.hasOwn(fn, key), key);
  assert.ok(fn.program.instructions.length > 0);
  assert.equal(fn(40), 42);
});
const rich =
  'function factory(n){return function f(x){if(x<0)return f(0);try{for(var k in {a:1,b:2})n+=1;return n+x;}finally{n++;}};}var f=factory(38);capture(f(-1));capture(f(1));';
for (const mangleProperties of [false, true])
  for (const pruneOpcodes of [false, true])
    for (const maskErrors of [false, true])
      test(
        'hardening options compose ' +
          JSON.stringify({ mangleProperties, pruneOpcodes, maskErrors }),
        async () => {
          const code = await buildBrowserScript(compileToAssembly(rich), {
            mangleProperties,
            pruneOpcodes,
            maskErrors,
          });
          assert.deepEqual(run(code), run(rich));
        },
      );
for (const key of ['mangleProperties', 'pruneOpcodes', 'maskErrors'])
  for (const value of [null, 1, 'yes', {}])
    test(
      'new API option validates before IO: ' + key + ' ' + String(value),
      async () => {
        await assert.rejects(
          buildBrowserScript('halt', { [key]: value }),
          TypeError,
        );
        await assert.rejects(
          compileFile({
            inputPath: 'missing',
            outputPath: 'never',
            [key]: value,
          }),
          TypeError,
        );
      },
    );
for (const name of ['mangle-properties', 'prune-opcodes', 'mask-errors']) {
  test('CLI opt-outs work: ' + name, () => {
    const key = {
      'mangle-properties': 'mangleProperties',
      'prune-opcodes': 'pruneOpcodes',
      'mask-errors': 'maskErrors',
    }[name];
    assert.equal(
      parseArguments(['a.js', '-o', 'b.js', '--no-' + name])[key],
      false,
    );
    assert.match(HELP_TEXT, new RegExp('--no-' + name));
  });
  test('CLI rejects conflicts: ' + name, () =>
    assert.throws(
      () => parseArguments(['a.js', '-o', 'b.js', '--' + name, '--no-' + name]),
      /conflicts/,
    ),
  );
  test('CLI rejects duplicate opt-out: ' + name, () =>
    assert.throws(
      () =>
        parseArguments(['a.js', '-o', 'b.js', '--no-' + name, '--no-' + name]),
      /repeated/,
    ),
  );
}
test('CLI default protects internals and runs without new flags', async (t) => {
  const p = await fixture(t, 'console.log(42);');
  const { stdout } = await exec(process.execPath, [
    cli,
    p.inputPath,
    '-o',
    p.outputPath,
  ]);
  assert.match(stdout, /Built:/);
  const code = await readFile(p.outputPath, 'utf8');
  assert.ok(!code.includes('stack'));
  assert.ok(!code.includes('locals'));
  assert.equal(
    stripVTControlCharacters(
      (await exec(process.execPath, [p.outputPath])).stdout,
    ).trim(),
    '42',
  );
});
test('compileFile propagates debug switches to runtime', async (t) => {
  const p = await fixture(t, 'capture(42);');
  await compileFile({
    ...p,
    normalize: false,
    minify: false,
    encryptProgram: false,
    randomizeInstructions: false,
    mangleProperties: false,
    pruneOpcodes: false,
    maskErrors: false,
  });
  const code = await readFile(p.outputPath, 'utf8');
  assert.ok(code.includes('stack'));
  assert.ok(code.includes('Stack underflow'));
  assert.ok(caseNames(code).includes('js.construct'));
  assert.deepEqual(run(code), [42]);
});
test('invalid new option creates no output directory', async (t) => {
  const p = await fixture(t);
  await assert.rejects(compileFile({ ...p, maskErrors: 42 }), TypeError);
  await assert.rejects(stat(join(p.dir, 'build')), { code: 'ENOENT' });
});

test('full contract can coexist in one specialized bundle, including unreachable low-level opcodes', async () => {
  const rows = ['jump End'];
  for (const [op, definition] of Object.entries(INSTRUCTIONS)) {
    const args = definition.operands.map(
      (type) =>
        ({
          literal: '0',
          slot: '0',
          count: '0',
          name: '"name"',
          text: '"name"',
          parameters: '"[]"',
          boolean: 'false',
          bindingKind: 'let',
          label: 'End',
        })[type],
    );
    if (op === 'js.function.create' || op === 'js.function.named.create')
      args[3] = JSON.stringify('halt');
    if (op === 'js.try.enter') args[3] = 'true';
    if (op === 'js.regexp.create') {
      args[0] = '"x"';
      args[1] = '""';
    }
    assert.ok(args.every(Boolean), op);
    rows.push([op, ...args].join(' '));
  }
  rows.push('label End', 'halt');
  const text = rows.join('\n');
  assert.equal(collectUsedOpcodes(text).size, Object.keys(INSTRUCTIONS).length);
  assert.deepEqual(run(await buildBrowserScript(text)), []);
});
