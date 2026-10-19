import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Script, createContext } from 'node:vm';
import { parseArguments, HELP_TEXT } from '../src/cli/parse-arguments.js';
const exec = promisify(execFile),
  cli = fileURLToPath(new URL('../bin/jsvm.js', import.meta.url));
async function fixture(t, source) {
  const dir = await mkdtemp(join(tmpdir(), 'rell-cli-normalize-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(join(dir, 'input file.js'), source);
  return dir;
}
async function run(args, cwd) {
  try {
    const result = await exec(process.execPath, [cli, ...args], {
      cwd,
      timeout: 20000,
      encoding: 'utf8',
    });
    return { code: 0, ...result };
  } catch (e) {
    if (typeof e.code !== 'number') throw e;
    return { code: e.code, stdout: e.stdout, stderr: e.stderr };
  }
}
function evaluate(code) {
  const values = [];
  new Script(code).runInContext(
    createContext(
      { capture: (v) => values.push(v) },
      { codeGeneration: { strings: false, wasm: false } },
    ),
    { timeout: 3000 },
  );
  return values;
}
for (const minify of [false, true])
  test(`CLI default parameters + class + arrow, minify=${minify}`, async (t) => {
    const source =
        'class C{constructor(x=40){this.x=x;}add(step=2){return (()=>this.x+step)();}}capture(new C().add());',
      dir = await fixture(t, source);
    const args = [
        'input file.js',
        '--output',
        'build files/output.js',
        ...(minify ? ['--minify'] : []),
      ],
      result = await run(args, dir);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /Built:/);
    assert.equal(result.stderr, '');
    assert.deepEqual(
      evaluate(await readFile(join(dir, 'build files/output.js'), 'utf8')),
      [42],
    );
  });
test('CLI --no-normalize explicitly supports raw BigInt', async (t) => {
  const dir = await fixture(t, 'const n=6n;capture(n===6n);');
  const result = await run(
    ['input file.js', '-o', 'output.js', '--no-normalize'],
    dir,
  );
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(evaluate(await readFile(join(dir, 'output.js'), 'utf8')), [
    true,
  ]);
});
test('CLI default strict ES5 path rejects BigInt instead of silently bypassing normalization', async (t) => {
  const dir = await fixture(t, 'capture(6n);');
  const result = await run(['input file.js', '-o', 'output.js'], dir);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /Normalization produced non-ES5 syntax/);
  await assert.rejects(stat(join(dir, 'output.js')), { code: 'ENOENT' });
});
test('CLI --no-normalize keeps AssignmentPattern unsupported', async (t) => {
  const dir = await fixture(t, 'function f(x=7){}');
  const result = await run(
    ['input file.js', '-o', 'output.js', '--no-normalize'],
    dir,
  );
  assert.equal(result.code, 1);
  assert.match(result.stderr, /Unsupported parameter: AssignmentPattern/);
  await assert.rejects(stat(join(dir, 'output.js')), { code: 'ENOENT' });
});
test('CLI syntax error names original input and creates no nested output', async (t) => {
  const dir = await fixture(t, 'function f(x = ){}'),
    result = await run(['input file.js', '-o', 'build/output.js'], dir);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /input file\.js/);
  assert.match(result.stderr, /Unexpected token/);
  await assert.rejects(stat(join(dir, 'build')), { code: 'ENOENT' });
});
test('CLI normalized builds retain wx no-overwrite guarantee', async (t) => {
  const dir = await fixture(t, 'const f=(x=42)=>x;capture(f());');
  await writeFile(join(dir, 'output.js'), 'keep');
  const result = await run(['input file.js', '-o', 'output.js'], dir);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /output path already exists/);
  assert.equal(await readFile(join(dir, 'output.js'), 'utf8'), 'keep');
});
test('parse --no-normalize anywhere and retain minify', () => {
  for (const args of [
    ['--no-normalize', 'input.js', '-o', 'out.js'],
    ['input.js', '-o', 'out.js', '--minify', '--no-normalize'],
  ]) {
    const options = parseArguments(args);
    assert.equal(options.normalize, false);
    assert.equal(options.minify, true);
  }
  assert.match(HELP_TEXT, /--no-normalize/);
});
test('reject repeated --no-normalize', () =>
  assert.throws(
    () =>
      parseArguments([
        'input.js',
        '-o',
        'out.js',
        '--no-normalize',
        '--no-normalize',
      ]),
    /must not be repeated/,
  ));
test('delimiter protects filename --no-normalize from option interpretation', () => {
  assert.equal(
    parseArguments(['-o', 'out.js', '--', '--no-normalize']).normalize,
    true,
  );
  assert.equal(
    parseArguments(['-o', 'out.js', '--', '--no-normalize']).inputPath,
    '--no-normalize',
  );
});
