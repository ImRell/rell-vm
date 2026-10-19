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

test('компилирует файл и возвращает сведения о результате', async (t) => {
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

test('создаёт вложенные директории output', async (t) => {
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

test('не выполняет исходную программу во время сборки', async (t) => {
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

test('не создаёт output при ошибке компиляции', async (t) => {
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

test('запрещает совпадающие входной и выходной пути', async (t) => {
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

test('не перезаписывает существующий output', async (t) => {
  const { inputPath, outputPath } = await createFixture(t);

  await writeFile(outputPath, 'existing content', 'utf8');

  await assert.rejects(compileFile({ inputPath, outputPath }), {
    code: 'EEXIST',
  });

  assert.equal(await readFile(outputPath, 'utf8'), 'existing content');
});

test('отклоняет отсутствующий файл и директорию вместо файла', async (t) => {
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

test('проверяет пути и параметр минификации', async () => {
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
