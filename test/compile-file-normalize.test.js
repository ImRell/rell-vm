import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Script, createContext } from 'node:vm';
import { compileFile } from '../src/cli/compile-file.js';
import { compileToAssembly } from '../src/compiler/compile-assembly.js';
async function fixture(t, source) {
  const directory = await mkdtemp(join(tmpdir(), 'rell-normalize-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const inputPath = join(directory, 'modern input.js'),
    outputPath = join(directory, 'build', 'output.js');
  await writeFile(inputPath, source, 'utf8');
  return { directory, inputPath, outputPath };
}
function run(source, environment = {}) {
  const values = [];
  const context = createContext(
    { capture: (value) => values.push(value), ...environment },
    { codeGeneration: { strings: false, wasm: false } },
  );
  new Script(source).runInContext(context, { timeout: 3000 });
  return values;
}
const cases = [
  [
    'default parameter',
    'function f(x=42){return x;}capture(f());capture(f(undefined));capture(f(null));capture(f(0));',
    [42, 42, null, 0],
  ],
  [
    'default side effects and preceding parameters',
    'let n=0;function f(a=++n,b=a+1){return a+b;}capture(f());capture(f(4));capture(n);',
    [3, 9, 1],
  ],
  [
    'parameter scope',
    'let x=9;function f(a=x){var x=1;return a;}capture(f());',
    [9],
  ],
  [
    'arrow rest spread and reduce',
    'const sum=(first=10,...rest)=>rest.reduce((a,b)=>a+b,first);const values=[2,3];capture(sum(undefined,...values));',
    [15],
  ],
  [
    'destructured default parameter',
    'function f({x=7}={},[a,b]=[1,2]){return x+a+b;}capture(f());capture(f({x:10},[3,4]));',
    [10, 17],
  ],
  [
    'destructuring templates shorthand',
    'const object={name:"VM",count:2};const {name,count}=object;const item={name,count};capture(`${item.name}:${item.count}`);',
    ['VM:2'],
  ],
  [
    'class getter static inheritance',
    'class A{constructor(x=7){this.x=x;}get value(){return this.x;}static kind(){return "A";}}class B extends A{constructor(x){super(x);}read(){return super.value+1;}}const b=new B();capture(b.read());capture(B.kind());capture(b instanceof A);capture(b instanceof B);',
    [8, 'A', true, true],
  ],
  [
    'class default constructor',
    'class A{constructor(a){this.x=a;}}class B extends A{}capture(new B(42).x);',
    [42],
  ],
  [
    'arrow lexical this',
    'const o={x:42,read(){return (()=>this.x)();}};capture(o.read());',
    [42],
  ],
  [
    'iteration closures',
    'const readers=[];for(let i=0;i<3;i++)readers.push(()=>i);capture(readers.map(f=>f()).join(","));',
    ['0,1,2'],
  ],
  ['for-of array', 'let n=0;for(const x of [1,2,3])n+=x;capture(n);', [6]],
  [
    'for-of Set',
    'let n=0;for(const x of new Set([1,2,3]))n+=x;capture(n);',
    [6],
  ],
  [
    'constructor spread',
    'class C{constructor(a,b){this.x=a+b;}}const values=[40,2];capture(new C(...values).x);',
    [42],
  ],
  [
    'optional chaining and nullish',
    'const o={x:0};capture(o?.x??7);capture(null?.x??7);',
    [0, 7],
  ],
  [
    'object rest spread',
    'const o={x:1,y:2};const {x,...rest}=o;capture(x);capture({...rest,z:3}.y);',
    [1, 2],
  ],
  [
    'generator iteration',
    'function* values(){yield 40;yield 2;}let n=0;for(const x of values())n+=x;capture(n);',
    [42],
  ],
];
for (const minify of [false, true])
  for (const [name, source, expected] of cases)
    test(`${minify ? 'minified' : 'normal'} compileFile normalizes ${name}`, async (t) => {
      assert.deepEqual(run(source), expected, 'native fixture must be valid');
      const paths = await fixture(t, source);
      const result = await compileFile({ ...paths, minify });
      const output = await readFile(paths.outputPath, 'utf8');
      assert.deepEqual(run(output), expected);
      assert.equal(result.bytes, Buffer.byteLength(output));
      assert.equal(
        await readFile(paths.inputPath, 'utf8'),
        source,
        'input is never rewritten',
      );
    });
test('AssignmentPattern at line 63 is normalized before compiler', async (t) => {
  const source =
    '// padding\n'.repeat(62) +
    'function example(value = 42){return value;}capture(example());';
  assert.throws(
    () => compileToAssembly(source),
    /63:.*Unsupported parameter: AssignmentPattern/,
  );
  const paths = await fixture(t, source);
  await compileFile(paths);
  assert.deepEqual(run(await readFile(paths.outputPath, 'utf8')), [42]);
});
test('normalization and packaging do not execute default initializers or input', async (t) => {
  const source =
      'function f(x=missingSideEffect()){return x;}throw new Error("runtime only");',
    paths = await fixture(t, source);
  await compileFile(paths);
  const output = await readFile(paths.outputPath, 'utf8');
  assert.throws(
    () => run(output),
    (e) => e.name === 'Error' && e.message === 'runtime only',
  );
});
test('Babel project configs are never loaded', async (t) => {
  const paths = await fixture(t, 'const f=(x=42)=>x;capture(f());');
  await writeFile(join(paths.directory, '.babelrc'), '{invalid-json', 'utf8');
  await writeFile(
    join(paths.directory, 'babel.config.cjs'),
    'throw new Error("must not load config");',
    'utf8',
  );
  await compileFile(paths);
  assert.deepEqual(run(await readFile(paths.outputPath, 'utf8')), [42]);
});
for (const [name, source, pattern] of [
  ['syntax error', 'function f(x = ){}', /modern input\.js.*Unexpected token/s],
  ['VM unsupported with', 'with({}){}', /Unsupported statement: WithStatement/],
])
  test('no output or build directory on ' + name, async (t) => {
    const paths = await fixture(t, source);
    await assert.rejects(compileFile(paths), pattern);
    await assert.rejects(stat(join(paths.directory, 'build')), {
      code: 'ENOENT',
    });
  });
test('compileFile normalizes input with BigInt extension', async (t) => {
  const paths = await fixture(t, 'capture(1n);');
  await compileFile(paths);
  assert.deepEqual(run(await readFile(paths.outputPath, 'utf8')), [1n]);
});
test('raw VM mode retains BigInt extension', async (t) => {
  const paths = await fixture(t, 'const n=6n;capture(n+1n===7n);');
  await compileFile({ ...paths, normalize: false });
  assert.deepEqual(run(await readFile(paths.outputPath, 'utf8')), [true]);
});
test('raw VM mode does not silently transpile default parameters', async (t) => {
  const paths = await fixture(t, 'function f(x=7){}');
  await assert.rejects(
    compileFile({ ...paths, normalize: false }),
    /Unsupported parameter: AssignmentPattern/,
  );
  await assert.rejects(stat(join(paths.directory, 'build')), {
    code: 'ENOENT',
  });
});
for (const normalize of [null, 1, 'yes', {}])
  test(
    'validate normalize option ' + String(normalize),
    async () =>
      await assert.rejects(
        compileFile({
          inputPath: 'not-read.js',
          outputPath: 'not-created.js',
          normalize,
        }),
        /normalize must be a boolean/,
      ),
  );
for (const minify of [false, true])
  test(`${minify ? 'minified' : 'normal'} normalized async + generator runs in VM`, async (t) => {
    const source =
      'function* values(){yield 40;yield 2;}async function f(){const it=values();const a=await Promise.resolve(it.next().value);return a+it.next().value;}f().then(capture).then(done,failed);';
    const paths = await fixture(t, source);
    await compileFile({ ...paths, minify });
    const output = await readFile(paths.outputPath, 'utf8'),
      values = [];
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('async timeout')), 3000);
      try {
        run(output, {
          capture: (v) => values.push(v),
          done() {
            clearTimeout(timer);
            resolve();
          },
          failed(e) {
            clearTimeout(timer);
            reject(e);
          },
        });
      } catch (e) {
        clearTimeout(timer);
        reject(e);
      }
    });
    assert.deepEqual(values, [42]);
  });
