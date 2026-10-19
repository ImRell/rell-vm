import test from 'node:test';
import assert from 'node:assert/strict';

import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';

import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { Script, createContext } from 'node:vm';

const execFileAsync = promisify(execFile);

const CLI_PATH = fileURLToPath(new URL('../bin/jsvm.js', import.meta.url));

async function runCli(args, cwd) {
  try {
    const result = await execFileAsync(process.execPath, [CLI_PATH, ...args], {
      cwd,
      encoding: 'utf8',
      // Full parallel test runs can delay Babel and bundling on busy machines.
      timeout: 60_000,
      maxBuffer: 1024 * 1024,
    });

    return {
      code: 0,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  } catch (error) {
    // Ошибка запуска или таймаут — не обычный код завершения CLI.
    if (typeof error.code !== 'number') {
      throw error;
    }

    return {
      code: error.code,
      stdout: error.stdout,
      stderr: error.stderr,
    };
  }
}

async function createFixture(t, source = 'let value = 42; value;') {
  const directory = await mkdtemp(join(tmpdir(), 'rell-vm-cli-'));

  t.after(async () => {
    await rm(directory, {
      recursive: true,
      force: true,
    });
  });

  await writeFile(join(directory, 'input.js'), source, 'utf8');

  return directory;
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

test('CLI выводит справку и завершается с кодом 0', async () => {
  const result = await runCli(['--help'], tmpdir());

  assert.equal(result.code, 0);
  assert.ok(result.stdout.includes('Usage:'));
  assert.ok(result.stdout.includes('--output'));
  assert.equal(result.stderr, '');
});

test('CLI сообщает об ошибках аргументов с кодом 2', async () => {
  for (const args of [[], ['--unknown']]) {
    const result = await runCli(args, tmpdir());

    assert.equal(result.code, 2);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /Argument error:/);
    assert.match(result.stderr, /--help/);
  }
});

test('CLI собирает файл из другой рабочей директории', async (t) => {
  const directory = await createFixture(
    t,
    `
    let index = 0;
    let sum = 0;

    while (index < 5) {
      index += 1;
      sum += index;
    }

    if (sum === 15) {
      sum;
    } else {
      null.value;
    }
  `,
  );

  const result = await runCli(
    ['input.js', '--output', 'build/output.js'],
    directory,
  );

  assert.equal(result.code, 0);
  assert.equal(result.stderr, '');
  assert.match(result.stdout, /Built:/);

  const output = await readFile(join(directory, 'build', 'output.js'), 'utf8');

  assert.doesNotThrow(() => runOutput(output));
});

test('CLI поддерживает минификацию и пути с пробелами', async (t) => {
  const directory = await createFixture(t);

  await writeFile(
    join(directory, 'input file.js'),
    'const value = 6; value;',
    'utf8',
  );

  const result = await runCli(
    ['input file.js', '-o', 'build files/output file.js', '--minify'],
    directory,
  );

  assert.equal(result.code, 0);
  assert.equal(result.stderr, '');

  const output = await readFile(
    join(directory, 'build files', 'output file.js'),
    'utf8',
  );

  assert.doesNotThrow(() => runOutput(output));
});

test('CLI возвращает код 1 при отсутствии входного файла', async (t) => {
  const directory = await createFixture(t);

  const result = await runCli(['missing.js', '-o', 'output.js'], directory);

  assert.equal(result.code, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /Build error:/);

  await assert.rejects(stat(join(directory, 'output.js')), { code: 'ENOENT' });
});

test('CLI не создаёт output при неподдерживаемом синтаксисе', async (t) => {
  const directory = await createFixture(t, 'with ({}) { value; }');

  const result = await runCli(['input.js', '-o', 'output.js'], directory);

  assert.equal(result.code, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /Unsupported statement: WithStatement/);

  await assert.rejects(stat(join(directory, 'output.js')), { code: 'ENOENT' });
});

test('CLI не перезаписывает существующий output', async (t) => {
  const directory = await createFixture(t);
  const outputPath = join(directory, 'output.js');

  await writeFile(outputPath, 'keep this content', 'utf8');

  const result = await runCli(['input.js', '-o', 'output.js'], directory);

  assert.equal(result.code, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /output path already exists/);

  assert.equal(await readFile(outputPath, 'utf8'), 'keep this content');
});
