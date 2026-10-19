import test from 'node:test';
import assert from 'node:assert/strict';

import { tokenizeAssembly } from '../src/assembly/tokenize.js';

test('токенизирует инструкцию и сохраняет позиции аргументов', () => {
  assert.deepEqual(
    tokenizeAssembly('js.lex.create 0 "value" let'),
    [
      {
        line: 1,
        tokens: [
          { type: 'word', value: 'js.lex.create', column: 1 },
          { type: 'word', value: '0', column: 15 },
          { type: 'string', value: 'value', column: 17 },
          { type: 'word', value: 'let', column: 25 },
        ],
      },
    ],
  );
});

test('пропускает пустые строки, сохраняя исходные номера строк', () => {
  assert.deepEqual(
    tokenizeAssembly('\n \t\nhalt\n'),
    [
      {
        line: 3,
        tokens: [
          { type: 'word', value: 'halt', column: 1 },
        ],
      },
    ],
  );

  assert.deepEqual(tokenizeAssembly(''), []);
});

test('поддерживает LF, CRLF и CR', () => {
  for (const separator of ['\n', '\r\n', '\r']) {
    const result = tokenizeAssembly(
      `drop${separator}halt`,
    );

    assert.deepEqual(
      result.map((entry) => entry.line),
      [1, 2],
    );

    assert.equal(result[1].tokens[0].value, 'halt');
  }
});

test('считает пробелы и табуляции разделителями', () => {
  assert.deepEqual(
    tokenizeAssembly('\tjs.const\t 42  ')[0].tokens,
    [
      { type: 'word', value: 'js.const', column: 2 },
      { type: 'word', value: '42', column: 12 },
    ],
  );
});

test('сохраняет пробелы внутри строкового аргумента', () => {
  const result = tokenizeAssembly(
    'js.const "hello world"',
  );

  assert.equal(result[0].tokens.length, 2);
  assert.equal(result[0].tokens[1].type, 'string');
  assert.equal(result[0].tokens[1].value, 'hello world');
});

test('декодирует JSON-экранирование и Unicode', () => {
  const values = [
    '',
    'say "hello"',
    'back\\slash',
    'line\nbreak',
    'tab\tvalue',
    'Привет 🎃',
    '\u0000',
    '\u2028\u2029',
    '\ud800',
  ];

  for (const value of values) {
    const source = `js.const ${JSON.stringify(value)}`;
    const token = tokenizeAssembly(source)[0].tokens[1];

    assert.equal(token.type, 'string');
    assert.equal(token.value, value);
  }
});

test('различает строки и некавыченные аргументы', () => {
  const word = tokenizeAssembly('js.const null')[0].tokens[1];
  const string = tokenizeAssembly('js.const "null"')[0].tokens[1];

  assert.equal(word.type, 'word');
  assert.equal(word.value, 'null');

  assert.equal(string.type, 'string');
  assert.equal(string.value, 'null');
});

test('отклоняет незавершённую строку с её позицией', () => {
  assert.throws(
    () => tokenizeAssembly('\njs.const "unfinished'),
    {
      name: 'SyntaxError',
      message: 'Assembly 2:10: Unterminated string literal',
    },
  );

  assert.throws(
    () => tokenizeAssembly('js.const "unfinished\\'),
    /Unterminated string literal/,
  );
});

test('отклоняет неверные escape-последовательности и управляющие символы', () => {
  const sources = [
    String.raw`js.const "\q"`,
    String.raw`js.const "\uZZZZ"`,
    'js.const "raw\ttab"',
  ];

  for (const source of sources) {
    assert.throws(
      () => tokenizeAssembly(source),
      /Invalid JSON string literal/,
    );
  }

  assert.throws(
    () => tokenizeAssembly('halt\u0000'),
    /Unexpected control character/,
  );
});

test('требует разделители вокруг строковых токенов', () => {
  assert.throws(
    () => tokenizeAssembly('js.const "value"extra'),
    /Expected whitespace after string literal/,
  );

  assert.throws(
    () => tokenizeAssembly('js.const"value"'),
    /Expected whitespace before string literal/,
  );

  assert.throws(
    () => tokenizeAssembly('js.const "first""second"'),
    /Expected whitespace after string literal/,
  );
});

test('не проверяет имена инструкций и не исполняет содержимое строк', () => {
  const payload = 'throw new Error("must not execute")';
  const source = `unknown.op ${JSON.stringify(payload)}`;

  const result = tokenizeAssembly(source);

  assert.equal(result[0].tokens[0].value, 'unknown.op');
  assert.equal(result[0].tokens[1].value, payload);
});

test('отклоняет вход, не являющийся строкой', () => {
  for (const value of [undefined, null, 42, {}, []]) {
    assert.throws(
      () => tokenizeAssembly(value),
      {
        name: 'TypeError',
        message: 'Assembly source must be a string',
      },
    );
  }
});