import test from 'node:test';
import assert from 'node:assert/strict';
import { Script, createContext } from 'node:vm';

import { parseAssembly } from '../src/assembly/parse.js';
import { AssemblyBuilder } from '../src/compiler/assembly-builder.js';
import { executeAssembly } from '../src/runtime/execute-assembly.js';
import { buildBrowserScript } from '../src/packer/build-browser-script.js';

test('парсер распознаёт инструкцию чтения внешнего имени', () => {
  const program = parseAssembly(
    'js.global.get "answer"\nreturn',
  );

  assert.equal(program.instructions[0].op, 'js.global.get');
  assert.deepEqual(program.instructions[0].args, ['answer']);
});

test('генератор и VM поддерживают чтение внешнего значения', () => {
  const builder = new AssemblyBuilder();

  builder.emit('js.global.get', 'answer');
  builder.emit('return');

  assert.equal(
    executeAssembly(builder.build(), {
      environment: { answer: 42 },
    }),
    42,
  );
});

test('внешнее значение можно использовать в вычислении', () => {
  const source = [
    'js.global.get "base"',
    'js.const 2',
    'js.add',
    'return',
  ].join('\n');

  assert.equal(
    executeAssembly(source, {
      environment: { base: 40 },
    }),
    42,
  );
});

test('отсутствующее имя выбрасывает ReferenceError при исполнении', () => {
  const source = 'js.global.get "missing"\nreturn';

  assert.throws(
    () => executeAssembly(source, {
      environment: Object.create(null),
    }),
    {
      name: 'ReferenceError',
      message: 'missing is not defined',
    },
  );
});

test('явное окружение не дополняется глобальными значениями Node.js', () => {
  assert.throws(
    () => executeAssembly('js.global.get "process"\nreturn', {
      environment: Object.create(null),
    }),
    {
      name: 'ReferenceError',
      message: 'process is not defined',
    },
  );
});

test('каждая инструкция читает внешнее значение заново', () => {
  let reads = 0;

  const environment = {
    get next() {
      reads++;
      return reads;
    },
  };

  const result = executeAssembly(`
    js.global.get "next"
    js.global.get "next"
    js.add
    return
  `, { environment });

  assert.equal(result, 3);
  assert.equal(reads, 2);
});

test('чтение неизвестного имени в пропущенной ветке не выполняется', () => {
  const source = [
    'jump finish',
    'js.global.get "missing"',
    'drop',
    'label finish',
    'halt',
  ].join('\n');

  assert.equal(
    executeAssembly(source, {
      environment: Object.create(null),
    }),
    undefined,
  );
});

test('проверяет окружение и аргумент инструкции', () => {
  for (const environment of [null, 42, 'text', true]) {
    assert.throws(
      () => executeAssembly('halt', { environment }),
      /External environment must be an object or function/,
    );
  }

  assert.throws(
    () => parseAssembly('js.global.get ""'),
    /Expected non-empty quoted name/,
  );

  assert.throws(
    () => parseAssembly('js.global.get answer'),
    /Expected non-empty quoted name/,
  );
});

test('упакованный скрипт читает globalThis места исполнения', async () => {
  const assembly = [
    'js.global.get "answer"',
    'js.const 42',
    'js.strict_eq',
    'jump_if_false failure',
    'halt',

    'label failure',
    'js.const 1n',
    'js.const 1',
    'js.add',
    'halt',
  ].join('\n');

  const output = await buildBrowserScript(assembly);

  const context = createContext(
    { answer: 42 },
    {
      codeGeneration: {
        strings: false,
        wasm: false,
      },
    },
  );

  assert.doesNotThrow(() => {
    new Script(output).runInContext(context, {
      timeout: 1_000,
    });
  });
});