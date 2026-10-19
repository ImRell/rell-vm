import test from 'node:test';
import assert from 'node:assert/strict';

import { parseSource } from '../src/compiler/parse.js';

test('возвращает AST обычного скрипта', () => {
  const ast = parseSource('const result = 10 - 3;');

  assert.equal(ast.type, 'File');
  assert.equal(ast.program.type, 'Program');
  assert.equal(ast.program.sourceType, 'script');
  assert.equal(ast.program.body.length, 1);

  const declaration = ast.program.body[0];

  assert.equal(declaration.type, 'VariableDeclaration');
  assert.equal(declaration.kind, 'const');

  const variable = declaration.declarations[0];

  assert.equal(variable.id.type, 'Identifier');
  assert.equal(variable.id.name, 'result');
  assert.equal(variable.init.type, 'BinaryExpression');
  assert.equal(variable.init.operator, '-');
  assert.equal(variable.init.left.value, 10);
  assert.equal(variable.init.right.value, 3);
});

test('принимает пустой исходный код', () => {
  const ast = parseSource('');

  assert.equal(ast.type, 'File');
  assert.equal(ast.program.body.length, 0);
});

test('сохраняет имя файла и положение узлов', () => {
  const ast = parseSource('\nconst value = 42;', {
    filename: 'example.js',
  });

  const declaration = ast.program.body[0];

  assert.equal(declaration.loc.filename, 'example.js');
  assert.equal(declaration.loc.start.line, 2);
  assert.equal(declaration.loc.start.column, 0);
});

test('использует input.js как имя файла по умолчанию', () => {
  const ast = parseSource('42;');

  assert.equal(ast.program.body[0].loc.filename, 'input.js');
});

test('отклоняет исходный код, не являющийся строкой', () => {
  for (const source of [undefined, null, 42, true, {}, []]) {
    assert.throws(
      () => parseSource(source),
      {
        name: 'TypeError',
        message: 'Source must be a string',
      },
    );
  }
});

test('отклоняет некорректное имя файла', () => {
  for (const filename of ['', null, 42, true, {}, []]) {
    assert.throws(
      () => parseSource('', { filename }),
      {
        name: 'TypeError',
        message: 'Filename must be a non-empty string',
      },
    );
  }
});

test('при синтаксической ошибке выбрасывает исключение с позицией', () => {
  assert.throws(
    () => parseSource('const = 1;'),
    (error) => {
      assert.ok(error instanceof SyntaxError);
      assert.equal(error.loc.line, 1);
      assert.equal(error.loc.column, 6);

      return true;
    },
  );
});

test('отклоняет import и export в режиме script', () => {
  const sources = [
    'import value from "./module.js";',
    'export const value = 42;',
  ];

  for (const source of sources) {
    assert.throws(
      () => parseSource(source),
      SyntaxError,
    );
  }
});

test('отклоняет return вне функции', () => {
  assert.throws(
    () => parseSource('return 42;'),
    SyntaxError,
  );
});

test('не прикрепляет комментарии к узлам', () => {
  const ast = parseSource('// comment\nconst value = 42;');
  const declaration = ast.program.body[0];

  assert.equal(declaration.leadingComments, undefined);
  assert.equal(declaration.trailingComments, undefined);
  assert.equal(declaration.innerComments, undefined);
});

test('разбор исходного кода не выполняет его', () => {
  // При исполнении этот код немедленно выбросил бы исключение.
  assert.doesNotThrow(() => {
    parseSource('throw new Error("Must not execute");');
  });
});

test('разбирает конструкции, ещё не поддержанные компилятором', () => {
  const ast = parseSource('async function example() { await task(); }');
  const declaration = ast.program.body[0];

  assert.equal(declaration.type, 'FunctionDeclaration');
  assert.equal(declaration.async, true);
});