import test from 'node:test';
import assert from 'node:assert/strict';
import { Script, createContext } from 'node:vm';

import { compileToAssembly } from '../src/compiler/compile-assembly.js';
import { buildBrowserScript } from '../src/packer/build-browser-script.js';

function runGeneratedScript(source, sandbox = {}) {
  const context = createContext(sandbox, {
    codeGeneration: {
      strings: false,
      wasm: false,
    },
  });

  return new Script(source).runInContext(context, {
    timeout: 1_000,
  });
}

test('упаковывает строку инструкций в самостоятельный скрипт', async () => {
  const source = await buildBrowserScript('js.const 42\ndrop\nhalt\n');

  assert.equal(typeof source, 'string');
  assert.ok(source.length > 0);

  assert.doesNotThrow(() => new Script(source));
  assert.doesNotThrow(() => runGeneratedScript(source));

  // По умолчанию исходный текст программы зашифрован.
  assert.ok(!source.includes('js.const 42'));
});

test('выходной скрипт исполняет вычисления и циклы', async () => {
  const assembly = compileToAssembly(`
    let index = 0;
    let sum = 0;

    while (index < 5) {
      index += 1;
      sum += index;
    }

    if (sum === 15) {
      sum;
    } else {
      1n + 1;
    }
  `);

  const source = await buildBrowserScript(assembly);

  assert.doesNotThrow(() => runGeneratedScript(source));
});

test('сборка не выполняет инструкции пользовательской программы', async () => {
  const assembly = compileToAssembly('1n + 1;');
  const source = await buildBrowserScript(assembly);

  assert.throws(
    () => runGeneratedScript(source),
    (error) => {
      assert.equal(error.name, 'TypeError');
      return true;
    },
  );
});

test('сборка сохраняет проверки TDZ и const', async () => {
  const cases = [
    ['value; let value;', 'ReferenceError'],
    ['const value = 10; value = 20;', 'TypeError'],
  ];

  for (const [input, expectedName] of cases) {
    const assembly = compileToAssembly(input);
    const source = await buildBrowserScript(assembly);

    assert.throws(
      () => runGeneratedScript(source),
      (error) => {
        assert.equal(error.name, expectedName);
        return true;
      },
    );
  }
});

test('runtime изолирован и допускает повторный запуск', async () => {
  const assembly = compileToAssembly('let value = 42; value += 1;');

  const source = await buildBrowserScript(assembly);
  const sandbox = {};

  const context = createContext(sandbox, {
    codeGeneration: {
      strings: false,
      wasm: false,
    },
  });

  const script = new Script(source);

  script.runInContext(context, { timeout: 1_000 });
  script.runInContext(context, { timeout: 1_000 });

  assert.deepEqual(Reflect.ownKeys(sandbox), []);
});

test('минификация сохраняет исполнение строковой программы', async () => {
  const assembly = compileToAssembly(`
    let value = 2n;
    value *= 3n;

    if (value === 6n) {
      value;
    } else {
      1n + 1;
    }
  `);

  for (const minify of [false, true]) {
    const source = await buildBrowserScript(assembly, { minify });

    assert.doesNotThrow(() => runGeneratedScript(source));
  }
});

test('отклоняет неверные параметры, числовой формат и ошибочный текст', async () => {
  await assert.rejects(
    buildBrowserScript('halt', { minify: 'yes' }),
    /minify must be a boolean/,
  );

  for (const value of [null, { code: [0] }, [0]]) {
    await assert.rejects(
      buildBrowserScript(value),
      /Assembly source must be a string/,
    );
  }

  await assert.rejects(
    buildBrowserScript('unknown.op'),
    /Unknown instruction: unknown.op/,
  );

  await assert.rejects(
    buildBrowserScript('jump missing\nhalt'),
    /Unknown label: missing/,
  );
});

test('упаковка сохраняет строковые литералы без исполнения их содержимого', async () => {
  const payload = '"); globalThis.injected = true; // </script>';
  const literal = JSON.stringify(payload);

  const assembly = [
    `js.const ${literal}`,
    `js.const ${literal}`,
    'js.strict_eq',
    'jump_if_false failure',
    'halt',
    'label failure',
    'js.const 1n',
    'js.const 1',
    'js.add',
    'halt',
  ].join('\n');

  const source = await buildBrowserScript(assembly);
  const sandbox = { injected: false };

  assert.doesNotThrow(() => runGeneratedScript(source, sandbox));
  assert.equal(sandbox.injected, false);
});
