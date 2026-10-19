import test from 'node:test';
import assert from 'node:assert/strict';
import { Script, createContext } from 'node:vm';
import {
  createInstructionAliases,
  relabelAssembly,
  rewriteRuntimeInstructions,
} from '../src/packer/randomize-instructions.js';
import { INSTRUCTIONS, DIRECTIVES } from '../src/assembly/instructions.js';
import { tokenizeAssembly } from '../src/assembly/tokenize.js';
import { compileToAssembly } from '../src/compiler/compile-assembly.js';
import { buildBrowserScript } from '../src/packer/build-browser-script.js';
import { parseArguments } from '../src/cli/parse-arguments.js';
const names = [...Object.keys(INSTRUCTIONS), ...Object.keys(DIRECTIVES)];
function run(code) {
  const values = [];
  new Script(code).runInContext(
    createContext(
      { capture: (v) => values.push(v) },
      { codeGeneration: { strings: false, wasm: false } },
    ),
    { timeout: 5000 },
  );
  return values;
}
test('fresh complete bijection contains no canonical opcode', () => {
  const a = createInstructionAliases(),
    b = createInstructionAliases();
  assert.equal(a.size, names.length);
  assert.equal(new Set(a.values()).size, names.length);
  assert.notDeepEqual(a, b);
  for (const name of names) {
    // The private dialect contract does not require a fixed prefix or length.
    assert.match(a.get(name), /^[A-Za-z_$][A-Za-z0-9_$]*$/);
    assert.ok(!names.includes(a.get(name)));
  }
});
test('relabeling preserves literal strings, parameter metadata and label operands', () => {
  const a = createInstructionAliases(),
    source =
      'js.const "js.function.create"\njump return\nlabel return\njs.const "return"\ndrop\nhalt';
  const text = relabelAssembly(source, a),
    rows = tokenizeAssembly(text);
  assert.equal(rows[0].tokens[1].value, 'js.function.create');
  assert.equal(rows[1].tokens[1].value, 'return');
  assert.equal(rows[2].tokens[1].value, 'return');
  assert.equal(rows[3].tokens[1].value, 'return');
  assert.equal(rows[0].tokens[0].value, a.get('js.const'));
  assert.equal(rows[2].tokens[0].value, a.get('label'));
});
test('all nested function bodies use the same build-local dialect', () => {
  const aliases = createInstructionAliases(),
    source = compileToAssembly(
      'function first(a){return function second(b){return a+b;};}capture(first(40)(2));',
    );
  const text = relabelAssembly(source, aliases);
  function inspect(body) {
    for (const row of tokenizeAssembly(body)) {
      const op = row.tokens[0].value;
      assert.ok([...aliases.values()].includes(op));
      if (
        op === aliases.get('js.function.create') ||
        op === aliases.get('js.function.named.create')
      )
        inspect(row.tokens[4].value);
    }
  }
  inspect(text);
  assert.ok(text.includes('first'));
  assert.ok(text.includes('second'));
});
test('runtime AST rewriting edits exact opcode strings and table keys, never keywords/comments/substrings', () => {
  const aliases = new Map([
    ['return', 'q_return'],
    ['halt', 'q_halt'],
    ['js.call', 'q_call'],
  ]);
  const source =
    '// js.call return\nexport const x={halt:"halt",return:"return"};export function f(){return "js.call";}const diagnostic="prefix js.call suffix";';
  const result = rewriteRuntimeInstructions(source, aliases, true);
  assert.match(result, /\/\/ js.call return/);
  assert.match(result, /return "q_call"/);
  assert.match(result, /"q_halt":"q_halt"/);
  assert.match(result, /"q_return":"q_return"/);
  assert.match(result, /prefix js.call suffix/);
  assert.doesNotThrow(() => new Script(result.replaceAll('export ', '')));
});
test('private dialect is also effective with encryption explicitly disabled', async () => {
  const code = await buildBrowserScript(
    compileToAssembly(
      'function PrivateFunction(x){return x+2;}capture(PrivateFunction(40));',
    ),
    { encryptProgram: false },
  );
  assert.deepEqual(run(code), [42]);
  for (const name of [
    'js.function.create',
    'js.function.named.create',
    'js.global.get',
    'js.call',
  ])
    assert.ok(!code.includes(name), name);
});
test('debug mode can restore canonical text instructions', async () => {
  const code = await buildBrowserScript('js.const 42\ndrop\nhalt', {
    encryptProgram: false,
    randomizeInstructions: false,
    minify: false,
  });
  assert.ok(code.includes('js.const 42'));
  assert.deepEqual(run(code), []);
});
test('user values equal to canonical opcodes keep their original meaning', async () => {
  const text =
    'var o={"return":"throw","halt":"js.call","label":"js.function.create"};capture(o["return"]);capture(o.halt);capture(o.label);capture("jump");';
  assert.deepEqual(
    run(await buildBrowserScript(compileToAssembly(text))),
    run(text),
  );
});
for (const value of [null, 1, 'yes', {}])
  test('validate randomizeInstructions ' + String(value), async () =>
    assert.rejects(
      buildBrowserScript('halt', { randomizeInstructions: value }),
      TypeError,
    ),
  );
test('new CLI default and explicit debug opt-out', () => {
  assert.equal(
    parseArguments(['a.js', '-o', 'b.js']).randomizeInstructions,
    true,
  );
  assert.equal(
    parseArguments(['a.js', '-o', 'b.js', '--no-randomize-instructions'])
      .randomizeInstructions,
    false,
  );
  assert.throws(
    () =>
      parseArguments([
        'a.js',
        '-o',
        'b.js',
        '--randomize-instructions',
        '--no-randomize-instructions',
      ]),
    /conflicts/,
  );
  assert.throws(
    () =>
      parseArguments([
        'a.js',
        '-o',
        'b.js',
        '--no-randomize-instructions',
        '--no-randomize-instructions',
      ]),
    /repeated/,
  );
});
const operators = [
  '+',
  '-',
  '*',
  '/',
  '%',
  '<<',
  '>>',
  '>>>',
  '&',
  '|',
  '^',
  '==',
  '!=',
  '===',
  '!==',
  '<',
  '<=',
  '>',
  '>=',
  'in',
  'instanceof',
];
for (const op of operators)
  test('private dialect binary operation ' + op, async () => {
    const expression =
      op === 'in'
        ? '"x" in {x:1}'
        : op === 'instanceof'
          ? '[] instanceof Array'
          : `42 ${op} 5`;
    const source = `capture(${expression});`;
    assert.deepEqual(
      run(await buildBrowserScript(compileToAssembly(source))),
      run(source),
    );
  });
for (const op of ['+', '-', '!', '~', 'typeof', 'void'])
  test('private dialect unary operation ' + op, async () => {
    const source = `capture(${op} 42);`;
    assert.deepEqual(
      run(await buildBrowserScript(compileToAssembly(source))),
      run(source),
    );
  });
for (const op of [
  '+=',
  '-=',
  '*=',
  '/=',
  '%=',
  '<<=',
  '>>=',
  '>>>=',
  '&=',
  '|=',
  '^=',
])
  test('private dialect property compound operation ' + op, async () => {
    const source = `var x={value:42};capture(x.value ${op} 5);capture(x.value);`;
    assert.deepEqual(
      run(await buildBrowserScript(compileToAssembly(source))),
      run(source),
    );
  });
for (const op of ['x.value++', '++x.value', 'x.value--', '--x.value'])
  test('private dialect property update ' + op, async () => {
    const source = `var x={value:42};capture(${op});capture(x.value);`;
    assert.deepEqual(
      run(await buildBrowserScript(compileToAssembly(source))),
      run(source),
    );
  });
test('strict error paths, delete and catch retain values with private dialect', async () => {
  const source =
    'function f(){"use strict";var o={};Object.defineProperty(o,"x",{value:42});try{delete o.x;}catch(e){capture(e.name);}try{o.x=1;}catch(e){capture(e.name);}return o.x;}capture(f());';
  assert.deepEqual(
    run(await buildBrowserScript(compileToAssembly(source))),
    run(source),
  );
});
test('async Babel callback retains private runtime after root frame exits', async (t) => {
  // No async syntax is compiled directly; the CLI normalization path is covered
  // separately. Here a Promise exercises a delayed native callback explicitly.
  let saved;
  const source =
    'Promise.resolve(40).then(function PrivateCallback(x){save(x+2);});';
  const code = await buildBrowserScript(compileToAssembly(source));
  new Script(code).runInContext(
    createContext(
      { Promise, save: (v) => (saved = v) },
      { codeGeneration: { strings: false, wasm: false } },
    ),
  );
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(saved, 42);
});
