import test from 'node:test';
import assert from 'node:assert/strict';

import { Buffer } from 'node:buffer';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';

import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Script, createContext } from 'node:vm';

import { compileFile } from '../src/cli/compile-file.js';

async function createFixture(t, source = 'let value = 42; value;') {
  const directory = await mkdtemp(join(tmpdir(), 'rell-vm-'));

  t.after(async () => {
    await rm(directory, {
      recursive: true,
      force: true,
    });
  });

  const inputPath = join(directory, 'input.js');
  const outputPath = join(directory, 'output.js');

  await writeFile(inputPath, source, 'utf8');

  return {
    directory,
    inputPath,
    outputPath,
  };
}

function runOutput(source) {
  const context = createContext(
    {},
    {
      codeGeneration: {
        strings: false,
        wasm: false,
      },
    },
  );

  return new Script(source).runInContext(context, {
    timeout: 1_000,
  });
}

test('compiles file and returns result details', async (t) => {
  const { inputPath, outputPath } = await createFixture(t);

  const result = await compileFile({
    inputPath,
    outputPath,
  });

  const output = await readFile(outputPath, 'utf8');

  assert.equal(result.inputPath, inputPath);
  assert.equal(result.outputPath, outputPath);
  assert.equal(result.bytes, Buffer.byteLength(output, 'utf8'));
  assert.ok(result.bytes > 0);

  assert.doesNotThrow(() => runOutput(output));
});

test('creates nested output directories', async (t) => {
  const { directory, inputPath } = await createFixture(t);
  const outputPath = join(directory, 'build', 'browser', 'output.js');

  await compileFile({
    inputPath,
    outputPath,
    minify: true,
  });

  const output = await readFile(outputPath, 'utf8');

  assert.doesNotThrow(() => runOutput(output));
});

test('does not execute source program during compilation', async (t) => {
  const { inputPath, outputPath } = await createFixture(t, 'null.value;');

  await compileFile({
    inputPath,
    outputPath,
  });

  const output = await readFile(outputPath, 'utf8');

  assert.throws(
    () => runOutput(output),
    (error) => {
      assert.equal(error.name, 'TypeError');
      return true;
    },
  );
});

test('does not create output on compilation error', async (t) => {
  const { directory, inputPath } = await createFixture(
    t,
    'with ({}) { value; }',
  );

  const outputDirectory = join(directory, 'build');
  const outputPath = join(outputDirectory, 'output.js');

  await assert.rejects(
    compileFile({ inputPath, outputPath }),
    /Unsupported statement: WithStatement/,
  );

  await assert.rejects(stat(outputDirectory), { code: 'ENOENT' });
});

test('disallows matching input and output paths', async (t) => {
  const { inputPath } = await createFixture(t);
  const original = await readFile(inputPath, 'utf8');

  await assert.rejects(
    compileFile({
      inputPath,
      outputPath: inputPath,
    }),
    /Input and output paths must be different/,
  );

  assert.equal(await readFile(inputPath, 'utf8'), original);
});

test('overwrites existing output and truncates old content', async (t) => {
  const { inputPath, outputPath } = await createFixture(t, 'capture(42);');
  await writeFile(outputPath, '// STALE_API_OUTPUT\n'.repeat(10000), 'utf8');
  const result = await compileFile({ inputPath, outputPath });
  const output = await readFile(outputPath, 'utf8');
  assert.ok(!output.includes('STALE_API_OUTPUT'));
  assert.equal(result.bytes, Buffer.byteLength(output, 'utf8'));
  assert.equal(result.outputPath, outputPath);
  const values = [];
  new Script(output).runInContext(
    createContext(
      { capture: (v) => values.push(v) },
      { codeGeneration: { strings: false, wasm: false } },
    ),
    { timeout: 3000 },
  );
  assert.deepEqual(values, [42]);
  assert.equal(await readFile(inputPath, 'utf8'), 'capture(42);');
});

test('preserves existing output on compilation error', async (t) => {
  const { inputPath, outputPath } = await createFixture(t, 'with (object) {}');
  await writeFile(outputPath, 'KEEP_EXISTING_OUTPUT', 'utf8');
  await assert.rejects(
    compileFile({ inputPath, outputPath }),
    /Unsupported statement: WithStatement/,
  );
  assert.equal(await readFile(outputPath, 'utf8'), 'KEEP_EXISTING_OUTPUT');
});

test('rejects missing file and directory path instead of file', async (t) => {
  const { directory, outputPath } = await createFixture(t);

  await assert.rejects(
    compileFile({
      inputPath: join(directory, 'missing.js'),
      outputPath,
    }),
    { code: 'ENOENT' },
  );

  await assert.rejects(
    compileFile({
      inputPath: directory,
      outputPath,
    }),
    /Input path must point to a regular file/,
  );
});

test('validates paths and minification options', async () => {
  for (const value of ['', ' ', null, undefined, 42]) {
    await assert.rejects(
      compileFile({
        inputPath: value,
        outputPath: 'output.js',
      }),
      /Input path must be a non-empty string/,
    );

    await assert.rejects(
      compileFile({
        inputPath: 'input.js',
        outputPath: value,
      }),
      /Output path must be a non-empty string/,
    );
  }

  await assert.rejects(
    compileFile({
      inputPath: 'input.js',
      outputPath: 'output.js',
      minify: 'yes',
    }),
    /minify must be a boolean/,
  );
});
