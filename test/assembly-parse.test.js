import test from 'node:test';
import assert from 'node:assert/strict';

import { ASSEMBLY_VERSION } from '../src/assembly/instructions.js';
import { parseAssembly } from '../src/assembly/parse.js';

test('разбирает инструкции с текстовыми именами и позициями', () => {
  const program = parseAssembly('\n  js.const 42\nreturn');

  assert.equal(program.version, ASSEMBLY_VERSION);

  assert.deepEqual(program.instructions, [
    {
      op: 'js.const',
      args: [42],
      line: 2,
      column: 3,
    },
    {
      op: 'return',
      args: [],
      line: 3,
      column: 1,
    },
  ]);
});

test('преобразует литералы без потери специальных значений', () => {
  const cases = [
    ['undefined', undefined],
    ['null', null],
    ['true', true],
    ['false', false],
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['-Infinity', -Infinity],
    ['0', 0],
    ['-0', -0],
    ['1.25', 1.25],
    ['-1e3', -1000],
    ['123n', 123n],
    ['-123n', -123n],
    ['"hello world"', 'hello world'],
    ['"null"', 'null'],
  ];

  for (const [source, expected] of cases) {
    const program = parseAssembly(`js.const ${source}\nreturn`);
    const actual = program.instructions[0].args[0];

    assert.ok(Object.is(actual, expected), source);
  }
});

test('разбирает аргументы создания лексической ячейки', () => {
  const program = parseAssembly(
    'js.lex.create 2 "value" const\nhalt',
  );

  assert.deepEqual(
    program.instructions[0].args,
    [2, 'value', 'const'],
  );
});

test('разрешает переходы вперёд и назад', () => {
  const program = parseAssembly(`
    label start
    js.const false
    jump_if_false finish
    jump start
    label finish
    halt
  `);

  assert.equal(program.instructions.length, 4);
  assert.equal(program.instructions[1].target, 3);
  assert.equal(program.instructions[2].target, 0);

  assert.deepEqual(program.instructions[1].args, ['finish']);
});

test('несколько меток могут указывать на одну инструкцию', () => {
  const program = parseAssembly(`
    jump first
    jump second
    label first
    label second
    halt
  `);

  assert.equal(program.instructions[0].target, 2);
  assert.equal(program.instructions[1].target, 2);
});

test('отклоняет неизвестные инструкции и неверное число аргументов', () => {
  const cases = [
    ['unknown.op', /Unknown instruction: unknown.op/],
    ['toString', /Unknown instruction: toString/],
    ['"halt"', /Expected instruction name/],
    ['js.const', /js.const expects 1 arguments/],
    ['halt 42', /halt expects 0 arguments/],
  ];

  for (const [source, expected] of cases) {
    assert.throws(() => parseAssembly(source), expected);
  }
});

test('проверяет слоты, имена переменных и вид объявления', () => {
  const cases = [
    ['local.get -1', /Invalid slot/],
    ['local.get 1.5', /Invalid slot/],
    ['local.get 01', /Invalid slot/],
    ['local.get 9007199254740992', /Invalid slot/],
    ['local.get "0"', /Expected slot, received string/],
    ['js.lex.create 0 value let', /Expected non-empty quoted name/],
    ['js.lex.create 0 "" let', /Expected non-empty quoted name/],
    ['js.lex.create 0 "value" var', /Invalid binding kind/],
  ];

  for (const [source, expected] of cases) {
    assert.throws(() => parseAssembly(source), expected);
  }
});

test('отклоняет неизвестные, повторные и некорректные метки', () => {
  const cases = [
    ['jump missing\nhalt', /Unknown label: missing/],
    ['label same\nlabel same\nhalt', /Duplicate label: same/],
    ['label 123\nhalt', /Invalid label name/],
    ['jump "finish"\nhalt', /Expected label, received string/],
    [
      'jump finish\nlabel finish',
      /Label does not point to an instruction: finish/,
    ],
  ];

  for (const [source, expected] of cases) {
    assert.throws(() => parseAssembly(source), expected);
  }
});

test('отклоняет неподдерживаемые литералы и числовое переполнение', () => {
  for (const value of ['unknown', '0xff', '01', '.5', '1_000', '123abc']) {
    assert.throws(
      () => parseAssembly(`js.const ${value}`),
      /Invalid literal/,
    );
  }

  assert.throws(
    () => parseAssembly('js.const 1e999'),
    /Numeric literal overflow/,
  );
});

test('отклоняет программу без исполняемых инструкций', () => {
  for (const source of ['', ' \n\t', 'label unused']) {
    assert.throws(
      () => parseAssembly(source),
      /must contain at least one instruction/,
    );
  }
});

test('ошибки содержат позицию и программа не выполняется при разборе', () => {
  assert.throws(
    () => parseAssembly('\n  unknown'),
    {
      name: 'SyntaxError',
      message: 'Assembly 2:3: Unknown instruction: unknown',
    },
  );

  // При исполнении ADD выбросил бы TypeError.
  assert.doesNotThrow(() => {
    parseAssembly('js.const 1n\njs.const 1\njs.add\nreturn');
  });
});

test('подготовленная программа защищена от изменений', () => {
  const program = parseAssembly('js.const 42\nreturn');

  assert.ok(Object.isFrozen(program));
  assert.ok(Object.isFrozen(program.instructions));
  assert.ok(Object.isFrozen(program.instructions[0]));
  assert.ok(Object.isFrozen(program.instructions[0].args));

  assert.throws(() => {
    program.instructions[0].op = 'halt';
  }, TypeError);

  assert.throws(() => {
    program.instructions[0].args[0] = 99;
  }, TypeError);
});