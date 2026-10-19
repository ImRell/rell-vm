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
  const dir = await mkdtemp(join(tmpdir(), 'rell-mangle-cli-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(join(dir, 'input file.js'), source);
  return dir;
}
async function run(args, cwd) {
  try {
    const r = await exec(process.execPath, [cli, ...args], {
      cwd,
      timeout: 20000,
      encoding: 'utf8',
    });
    return { code: 0, ...r };
  } catch (e) {
    if (typeof e.code !== 'number') throw e;
    return { code: e.code, stdout: e.stdout, stderr: e.stderr };
  }
}
function values(code) {
  const result = [];
  new Script(code).runInContext(
    createContext(
      { capture: (v) => result.push(v) },
      { codeGeneration: { strings: false, wasm: false } },
    ),
    { timeout: 3000 },
  );
  return result;
}
for (const minify of [false, true])
  test(`CLI mangles default-parameter source, minify=${minify}`, async (t) => {
    const dir = await fixture(
      t,
      'function SecretCalculator(SecretParameter=40){const SecretInternalTotal=2;return SecretParameter+SecretInternalTotal;}capture(SecretCalculator());',
    );
    const result = await run(
      [
        'input file.js',
        '-o',
        'build files/output.js',
        '--mangle-names',
        ...(minify ? ['--minify'] : []),
      ],
      dir,
    );
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stderr, '');
    assert.match(result.stdout, /Built:/);
    const code = await readFile(join(dir, 'build files/output.js'), 'utf8');
    assert.deepEqual(values(code), [42]);
    for (const name of [
      'SecretCalculator',
      'SecretParameter',
      'SecretInternalTotal',
    ])
      assert.ok(!code.includes(name), name);
  });
test('CLI keep-function-names leaves reflection working', async (t) => {
  const dir = await fixture(
    t,
    'function SecretCalculator(SecretParameter=42){return SecretParameter;}capture(SecretCalculator.name);capture(SecretCalculator());',
  );
  const result = await run(
    [
      'input file.js',
      '-o',
      'out.js',
      '--mangle-names',
      '--keep-function-names',
    ],
    dir,
  );
  assert.equal(result.code, 0, result.stderr);
  const code = await readFile(join(dir, 'out.js'), 'utf8');
  assert.deepEqual(values(code), ['SecretCalculator', 42]);
  assert.ok(!code.includes('SecretParameter'));
});
test('CLI raw BigInt mode combines with mangling and minification', async (t) => {
  const dir = await fixture(
    t,
    'const SecretBigIntValue=40n;capture(SecretBigIntValue+2n===42n);',
  );
  const result = await run(
    [
      'input file.js',
      '-o',
      'out.js',
      '--no-normalize',
      '--mangle-names',
      '--minify',
    ],
    dir,
  );
  assert.equal(result.code, 0, result.stderr);
  const code = await readFile(join(dir, 'out.js'), 'utf8');
  assert.deepEqual(values(code), [true]);
  assert.ok(!code.includes('SecretBigIntValue'));
});
test('CLI default hides metadata', async (t) => {
  const dir = await fixture(
    t,
    'var SecretInternalTotal=42;capture(SecretInternalTotal);',
  );
  const result = await run(['input file.js', '-o', 'out.js'], dir);
  assert.equal(result.code, 0, result.stderr);
  assert.ok(
    !(await readFile(join(dir, 'out.js'), 'utf8')).includes(
      'SecretInternalTotal',
    ),
  );
});
test('CLI rejects keep-function-names with disabled mangling', async (t) => {
  const dir = await fixture(t, 'capture(42);');
  const result = await run(
    [
      'input file.js',
      '-o',
      'out.js',
      '--keep-function-names',
      '--no-mangle-names',
    ],
    dir,
  );
  assert.equal(result.code, 2);
  assert.match(result.stderr, /requires name mangling/);
  await assert.rejects(stat(join(dir, 'out.js')), { code: 'ENOENT' });
});
test('CLI mangled builds overwrite existing output', async (t) => {
  const source = 'var SecretInternalTotal=42;capture(SecretInternalTotal);';
  const dir = await fixture(t, source);
  await writeFile(join(dir, 'out.js'), 'STALE_MANGLED_OUTPUT');
  const result = await run(
    ['input file.js', '-o', 'out.js', '--mangle-names'],
    dir,
  );
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stderr, '');
  assert.match(result.stdout, /Built:/);
  const output = await readFile(join(dir, 'out.js'), 'utf8');
  assert.ok(!output.includes('STALE_MANGLED_OUTPUT'));
  assert.ok(!output.includes('SecretInternalTotal'));
  assert.deepEqual(values(output), [42]);
  assert.equal(await readFile(join(dir, 'input file.js'), 'utf8'), source);
});
test('parser forwards both new flags', () => {
  const options = parseArguments([
    'input.js',
    '-o',
    'out.js',
    '--mangle-names',
    '--keep-function-names',
    '--minify',
    '--no-normalize',
  ]);
  assert.equal(options.mangleNames, true);
  assert.equal(options.keepFunctionNames, true);
  assert.equal(options.minify, true);
  assert.equal(options.normalize, false);
  assert.match(HELP_TEXT, /--mangle-names/);
  assert.match(HELP_TEXT, /--keep-function-names/);
});
for (const flag of ['--mangle-names', '--keep-function-names'])
  test('parser rejects duplicate ' + flag, () =>
    assert.throws(
      () =>
        parseArguments([
          'input.js',
          '-o',
          'out.js',
          '--mangle-names',
          ...(flag === '--mangle-names' ? [] : ['--keep-function-names']),
          flag,
        ]),
      /must not be repeated/,
    ),
  );
test('delimiter preserves flag-looking input filename', () => {
  const options = parseArguments(['-o', 'out.js', '--', '--mangle-names']);
  assert.equal(options.inputPath, '--mangle-names');
  assert.equal(options.mangleNames, true);
});
