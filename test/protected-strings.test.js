import test from 'node:test';
import assert from 'node:assert/strict';
import { Script, createContext } from 'node:vm';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { protectAssemblyStrings } from '../src/packer/protect-strings.js';
import { createStringDecoder } from '../src/runtime/string-decoder.js';
import { openProgramEnvelope } from '../src/runtime/open-program.js';
import { sealProgram } from '../src/packer/seal-program.js';
import { parseAssembly } from '../src/assembly/parse.js';
import { executeAssembly } from '../src/runtime/execute-assembly.js';
import { compileToAssembly } from '../src/compiler/compile-assembly.js';
import { buildBrowserScript } from '../src/packer/build-browser-script.js';
import {
  createInstructionAliases,
  relabelAssembly,
} from '../src/packer/randomize-instructions.js';
import { compileFile } from '../src/cli/compile-file.js';
import { parseArguments, HELP_TEXT } from '../src/cli/parse-arguments.js';

const exec = promisify(execFile);
function prepare(source) {
  const packed = protectAssemblyStrings(source);
  return { ...packed, decodeString: createStringDecoder(packed.entries) };
}
function run(code, extra = {}) {
  const values = [];
  const context = createContext(
    { capture: (v) => values.push(v), ...extra },
    {
      codeGeneration: { strings: false, wasm: false },
    },
  );
  new Script(code).runInContext(context, { timeout: 10000 });
  return values;
}
async function fixture(t, source) {
  const dir = await mkdtemp(join(tmpdir(), 'rell-lazy-strings-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const inputPath = join(dir, 'input.js'),
    outputPath = join(dir, 'build', 'out.js');
  await writeFile(inputPath, source);
  return { inputPath, outputPath };
}

test('whole-envelope decryption leaves references, not plaintext string operands', () => {
  const original = compileToAssembly('console.log("LITERAL_MARKER_731");');
  const packed = prepare(original);
  const dumped = openProgramEnvelope(sealProgram(packed.program));
  for (const word of ['console', 'log', 'LITERAL_MARKER_731'])
    assert.ok(!dumped.includes(word), word);
  assert.match(dumped, /@[a-f0-9]{16}/);
  assert.ok(!dumped.includes('"'));
  const values = [];
  executeAssembly(dumped, {
    decodeString: packed.decodeString,
    environment: { console: { log: (v) => values.push(v) } },
  });
  assert.deepEqual(values, ['LITERAL_MARKER_731']);
});

test('loading and freezing a program never opens protected operands', () => {
  const p = prepare('js.const "LAZY_MARKER"\nreturn');
  let reads = 0;
  const parsed = parseAssembly(p.program, {
    decodeString(ref) {
      reads++;
      return p.decodeString(ref);
    },
  });
  assert.equal(reads, 0);
  const args = parsed.instructions[0].args;
  assert.ok(Object.isFrozen(parsed) && Object.isFrozen(args));
  const descriptor = Object.getOwnPropertyDescriptor(args, '0');
  assert.equal(typeof descriptor.get, 'function');
  assert.ok(!Object.hasOwn(descriptor, 'value'));
  assert.equal(args[0], 'LAZY_MARKER');
  assert.equal(args[0], 'LAZY_MARKER');
  assert.equal(reads, 2); // deliberately no decoded cache
});

for (const value of [
  '',
  'console',
  'log',
  'message',
  'name',
  '__proto__',
  '@0123456789abcdef',
  'let',
  'undefined',
  'js.const',
  'a b\t"\\\n\r\0',
  'Привет 🌍 漢字',
  '\ud800',
  '\udfff',
  '\u2028\u2029',
  '</script>',
  'x'.repeat(70000),
]) {
  test(
    'exact UTF-16 literal round trip: ' + JSON.stringify(value.slice(0, 30)),
    () => {
      const p = prepare('js.const ' + JSON.stringify(value) + '\nreturn');
      assert.equal(
        executeAssembly(p.program, { decodeString: p.decodeString }),
        value,
      );
    },
  );
}

test('non-string special values are not replaced by references', () => {
  for (const text of [
    'undefined',
    'null',
    'NaN',
    '-0',
    'Infinity',
    '-Infinity',
    'true',
    'false',
    '12n',
  ]) {
    const source = `js.const ${text}\nreturn`,
      p = prepare(source);
    assert.equal(p.program, source);
    assert.equal(p.entries.length, 0);
    assert.ok(
      Object.is(
        executeAssembly(p.program, { decodeString: p.decodeString }),
        executeAssembly(source),
      ),
    );
  }
});

test('equal strings share an encrypted record; builds get fresh references and keys', () => {
  const s = 'js.const "same"\ndrop\njs.const "same"\nreturn';
  const a = prepare(s),
    b = prepare(s);
  assert.equal(a.entries.length, 1);
  assert.equal(
    a.program.match(/@[a-f0-9]+/g)[0],
    a.program.match(/@[a-f0-9]+/g)[1],
  );
  assert.notEqual(a.program, b.program);
  assert.notDeepEqual(a.entries, b.entries);
});

test('nested function bodies decrypt only to protected text, not embedded clear strings', () => {
  const raw = compileToAssembly(
    'save(function outer(a){return function inner(b){return "NESTED_SECRET_629"+a+b;};});',
  );
  const p = prepare(raw);
  let opened = 0;
  const decodeString = (ref) => {
    opened++;
    return p.decodeString(ref);
  };
  parseAssembly(p.program, { decodeString });
  assert.equal(opened, 0);
  for (const [, envelope] of p.entries) {
    const text = openProgramEnvelope(envelope);
    if (text.includes('\n')) {
      assert.ok(!text.includes('NESTED_SECRET_629'));
      assert.ok(!text.includes('"'));
      assert.match(text, /@[a-f0-9]+/);
    }
  }
  let callback;
  executeAssembly(p.program, {
    decodeString,
    exposeFunctionMetadata: false,
    environment: {
      save: (fn) => {
        callback = fn;
      },
    },
  });
  assert.equal(callback(40)(2), 'NESTED_SECRET_629402');
  assert.equal(Object.hasOwn(callback, 'program'), false);
});

test('unreachable function bodies and string operands stay unopened', () => {
  const raw = compileToAssembly(
    'if(false){capture("UNUSED_093");var f=function(a){return "UNUSED_BODY_921";};}',
  );
  const p = prepare(raw),
    opened = [];
  executeAssembly(p.program, {
    decodeString(ref) {
      const v = p.decodeString(ref);
      opened.push(v);
      return v;
    },
  });
  assert.ok(
    !opened.some(
      (v) =>
        v.includes('UNUSED_093') ||
        v.includes('UNUSED_BODY_921') ||
        v.includes('\n'),
    ),
  );
});

test('decoder snapshots encrypted data and validates references', () => {
  const p = protectAssemblyStrings('js.const "snapshot"\nreturn');
  const decode = createStringDecoder(p.entries),
    ref = p.program.split(' ')[1].split('\n')[0];
  p.entries[0][1].t = '';
  assert.equal(decode(ref), 'snapshot');
  for (const value of ['@ffffffffffffffff', '@0', null, {}, '__proto__'])
    assert.throws(() => decode(value), TypeError);
  for (const bad of [
    null,
    {},
    [1],
    [['x', {}]],
    [
      ['0000000000000000', {}],
      ['0000000000000000', {}],
    ],
  ])
    assert.throws(() => createStringDecoder(bad), TypeError);
});

test('tampered record is authenticated on access, never pre-opened', () => {
  const p = protectAssemblyStrings('js.const "tamper target"\nreturn');
  p.entries[0][1].t = 'AAAAAAAAAAAAAAAAAAAAAA==';
  const decodeString = createStringDecoder(p.entries);
  assert.doesNotThrow(() => parseAssembly(p.program, { decodeString }));
  assert.throws(
    () => executeAssembly(p.program, { decodeString }),
    /Invalid encrypted VM program/,
  );
});

test('raw parser requires explicit decoder and restricts reference operand types', () => {
  assert.throws(
    () => parseAssembly('js.const @0123456789abcdef\nreturn'),
    SyntaxError,
  );
  assert.throws(() => parseAssembly('halt', { decodeString: true }), TypeError);
  const decodeString = () => 'x';
  for (const s of [
    'local.get @0123456789abcdef\nhalt',
    'jump @0123456789abcdef\nhalt',
    'js.const @bad\nhalt',
  ])
    assert.throws(() => parseAssembly(s, { decodeString }), SyntaxError);
  const p = parseAssembly('js.const @0123456789abcdef\nreturn', {
    decodeString: () => 42,
  });
  assert.throws(() => p.instructions[0].args[0], SyntaxError);
});

test('supports both randomized and canonical dialects', () => {
  const aliases = createInstructionAliases();
  const s = relabelAssembly(
    compileToAssembly('var f=function(a){return "secret"+a;};capture(f("x"));'),
    aliases,
  );
  const p = protectAssemblyStrings(s, aliases);
  assert.ok(!p.program.includes('secret'));
  assert.ok(!p.program.includes('capture'));
  assert.ok(!p.program.includes('"'));
  for (const [, envelope] of p.entries) {
    const value = openProgramEnvelope(envelope);
    if (value.includes('\n')) assert.ok(value.includes(aliases.get('return')));
  }
});

const rich = `function factory(n){return function f(delta){n+=delta;return n;};}
var fn=factory(39);capture(fn(3));capture(fn(1));
var object={message:"PROPERTY_SECRET_167",get name(){return "getter";}};
capture(object.message);capture(object.name);capture(/a+b/gi.test("AaB"));
try{throw new Error("USER_ERROR_843");}catch(e){capture(e.message);}finally{capture("FINALLY_829");}`;
for (const protectStrings of [false, true])
  for (const encryptProgram of [false, true])
    for (const randomizeInstructions of [false, true])
      test(`packed semantics compose strings=${protectStrings}, envelope=${encryptProgram}, dialect=${randomizeInstructions}`, async () => {
        const code = await buildBrowserScript(compileToAssembly(rich), {
          protectStrings,
          encryptProgram,
          randomizeInstructions,
        });
        assert.deepEqual(run(code), [
          42,
          43,
          'PROPERTY_SECRET_167',
          'getter',
          true,
          'USER_ERROR_843',
          'FINALLY_829',
        ]);
        assert.equal(
          code.includes('PROPERTY_SECRET_167'),
          !protectStrings && !encryptProgram,
        );
      });

test('protected globals preserve receiver, argument order and mutable lookups', async () => {
  const events = [];
  const object = {
    get method() {
      events.push('get');
      return function (arg) {
        events.push(this === object);
        return arg;
      };
    },
  };
  const code = await buildBrowserScript(
    compileToAssembly(
      'capture(obj.method(argument()));capture(changing);capture(changing);',
    ),
  );
  let n = 0;
  const env = {
    obj: object,
    argument: () => {
      events.push('arg');
      return 42;
    },
  };
  Object.defineProperty(env, 'changing', {
    enumerable: true,
    get() {
      return ++n;
    },
  });
  // Preserve getter when installing sandbox (object spread would evaluate it).
  const values = [];
  const context = createContext({
    capture: (v) => values.push(v),
    obj: object,
    argument: env.argument,
  });
  Object.defineProperty(context, 'changing', {
    get() {
      return ++n;
    },
  });
  new Script(code).runInContext(context, { timeout: 10000 });
  assert.deepEqual(values, [42, 1, 2]);
  assert.deepEqual(events, ['get', 'arg', true]);
});

test('repeat builds retain independent callback string decoders', async () => {
  const callbacks = [];
  for (const s of ['FIRST_SECRET_912', 'SECOND_SECRET_731']) {
    run(
      await buildBrowserScript(
        compileToAssembly(`save(function(){return ${JSON.stringify(s)};});`),
      ),
      { save: (fn) => callbacks.push(fn) },
    );
  }
  assert.equal(callbacks[0](), 'FIRST_SECRET_912');
  assert.equal(callbacks[1](), 'SECOND_SECRET_731');
  assert.equal(callbacks[0](), 'FIRST_SECRET_912');
});

test('string contents cannot become JS, HTML or assembly instructions', async () => {
  const value = '"; globalThis.injected=true; // </script>\njs.global.get evil';
  const code = await buildBrowserScript(
    compileToAssembly('capture(' + JSON.stringify(value) + ');'),
  );
  assert.ok(!code.includes('</script>'));
  let injected = false;
  assert.deepEqual(
    run(code, {
      get injected() {
        return injected;
      },
      evil() {
        throw new Error('must not execute');
      },
    }),
    [value],
  );
  assert.equal(injected, false);
});

test('function names, duplicate sloppy parameters and mapped arguments preserve semantics', async () => {
  const source =
    'function named(a,a){arguments[1]="replacement";return a;} capture(named("x","y")); capture(named.name);';
  assert.deepEqual(
    run(
      await buildBrowserScript(compileToAssembly(source), {
        keepFunctionNames: true,
      }),
    ),
    ['replacement', 'named'],
  );
});

test('CLI defaults enable protection and debugging opt-out is independent', () => {
  assert.equal(parseArguments(['a', '-o', 'b']).protectStrings, true);
  assert.equal(
    parseArguments(['a', '-o', 'b', '--no-encrypt-program']).protectStrings,
    true,
  );
  assert.equal(
    parseArguments(['a', '-o', 'b', '--no-protect-strings']).protectStrings,
    false,
  );
  assert.equal(
    parseArguments(['a', '-o', 'b', '--protect-strings']).protectStrings,
    true,
  );
  assert.match(HELP_TEXT, /--no-protect-strings/);
  assert.throws(
    () =>
      parseArguments([
        'a',
        '-o',
        'b',
        '--protect-strings',
        '--no-protect-strings',
      ]),
    /conflicts/,
  );
  for (const flag of ['--protect-strings', '--no-protect-strings'])
    assert.throws(
      () => parseArguments(['a', '-o', 'b', flag, flag]),
      /repeated/,
    );
});
for (const value of [null, 0, 1, 'true', {}, []])
  test('validate protectStrings type ' + JSON.stringify(value), async () => {
    await assert.rejects(
      buildBrowserScript('halt', { protectStrings: value }),
      /protectStrings must be a boolean/,
    );
    await assert.rejects(
      compileFile({
        inputPath: 'missing.js',
        outputPath: 'out.js',
        protectStrings: value,
      }),
      /protectStrings must be a boolean/,
    );
  });

test('real CLI protects strings even with outer envelope disabled', async (t) => {
  const p = await fixture(t, 'console.log("CLI_LAZY_SECRET_341");');
  await exec(
    process.execPath,
    [
      fileURLToPath(new URL('../bin/jsvm.js', import.meta.url)),
      p.inputPath,
      '-o',
      p.outputPath,
      '--no-encrypt-program',
    ],
    { timeout: 60000 },
  );
  const code = await readFile(p.outputPath, 'utf8');
  assert.ok(!code.includes('CLI_LAZY_SECRET_341'));
  const values = [];
  run(code, { console: { log: (v) => values.push(v) } });
  assert.deepEqual(values, ['CLI_LAZY_SECRET_341']);
});
test('compileFile can explicitly disable both encryption layers for debugging', async (t) => {
  const p = await fixture(t, 'capture("DEBUG_STRING_921");');
  await compileFile({
    ...p,
    normalize: false,
    encryptProgram: false,
    protectStrings: false,
    randomizeInstructions: false,
    minify: false,
  });
  const code = await readFile(p.outputPath, 'utf8');
  assert.ok(code.includes('DEBUG_STRING_921'));
  assert.deepEqual(run(code), ['DEBUG_STRING_921']);
});
test('bad protection option does not create output directories', async (t) => {
  const p = await fixture(t, 'capture(42);');
  await assert.rejects(compileFile({ ...p, protectStrings: 42 }), TypeError);
  await assert.rejects(stat(join(p.outputPath, '..')), { code: 'ENOENT' });
});
