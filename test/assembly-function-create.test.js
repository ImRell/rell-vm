import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AssemblyBuilder,
} from '../src/compiler/assembly-builder.js';

import {
  parseAssembly,
} from '../src/assembly/parse.js';

import {
  executeAssembly,
} from '../src/runtime/execute-assembly.js';

import {
  VMFunction,
} from '../src/runtime/vm-function.js';

function functionInstruction({
  name = '',
  parameters = [],
  strict = false,
  body = 'js.const undefined\nreturn\n',
} = {}) {
  return [
    'js.function.create',
    JSON.stringify(name),
    JSON.stringify(JSON.stringify(parameters)),
    String(strict),
    JSON.stringify(body),
  ].join(' ');
}

function callCreatedFunction(
  description,
  argumentInstructions = [],
) {
  return [
    'js.const undefined',
    functionInstruction(description),
    ...argumentInstructions,
    `js.call ${argumentInstructions.length}`,
    'return',
    '',
  ].join('\n');
}

test('парсер распознаёт описание функции и замораживает параметры', () => {
  const body = 'js.lex.get 0\nreturn\n';

  const program = parseAssembly(
    functionInstruction({
      name: 'identity',
      parameters: ['value'],
      strict: true,
      body,
    }),
  );

  const instruction = program.instructions[0];

  assert.equal(instruction.op, 'js.function.create');

  assert.deepEqual(instruction.args, [
    'identity',
    ['value'],
    true,
    body,
  ]);

  assert.equal(Object.isFrozen(instruction.args), true);
  assert.equal(Object.isFrozen(instruction.args[1]), true);
});

test('текстовая инструкция создаёт VMFunction без внешнего значения', () => {
  const source = [
    functionInstruction({
      name: 'answer',
      body: 'js.const 42\nreturn\n',
    }),
    'return',
    '',
  ].join('\n');

  const fn = executeAssembly(source, {
    environment: {},
  });

  assert.ok(fn instanceof VMFunction);
  assert.equal(fn.name, 'answer');
  assert.equal(fn.length, 0);
  assert.equal(fn.source, 'js.const 42\nreturn\n');
});

test('созданная текстом функция вызывается и получает параметры', () => {
  const source = callCreatedFunction(
    {
      name: 'subtract',
      parameters: ['left', 'right'],
      strict: true,

      body: [
        'js.lex.get 0',
        'js.lex.get 1',
        'js.sub',
        'return',
        '',
      ].join('\n'),
    },
    [
      'js.const 10',
      'js.const 3',
    ],
  );

  assert.equal(
    executeAssembly(source, {
      environment: {},
    }),
    7,
  );
});

test('создание функции не исполняет её тело', () => {
  let calls = 0;

  const source = [
    functionInstruction({
      body: [
        'js.const undefined',
        'js.global.get "record"',
        'js.call 0',
        'return',
        '',
      ].join('\n'),
    }),
    'return',
    '',
  ].join('\n');

  const fn = executeAssembly(source, {
    environment: {
      record() {
        calls += 1;
      },
    },
  });

  assert.ok(fn instanceof VMFunction);
  assert.equal(calls, 0);
});

test('тело может создать и вызвать вложенную функцию', () => {
  const inner = functionInstruction({
    name: 'inner',
    body: 'js.const 42\nreturn\n',
  });

  const outerBody = [
    'js.const undefined',
    inner,
    'js.call 0',
    'return',
    '',
  ].join('\n');

  assert.equal(
    executeAssembly(
      callCreatedFunction({
        name: 'outer',
        body: outerBody,
      }),
      {
        environment: {},
      },
    ),
    42,
  );
});

test('метки внутри разных тел функций независимы', () => {
  const body = [
    'jump done',
    'js.const 100',
    'return',
    'label done',
    'js.const 21',
    'return',
    '',
  ].join('\n');

  const source = [
    'js.const undefined',
    functionInstruction({ name: 'first', body }),
    'js.call 0',

    'js.const undefined',
    functionInstruction({ name: 'second', body }),
    'js.call 0',

    'js.add',
    'return',
    '',
  ].join('\n');

  assert.equal(executeAssembly(source), 42);
});

test('js.this.get сохраняет строгий this без преобразований', () => {
  const receiver = { value: 42 };

  const source = [
    'js.global.get "receiver"',
    functionInstruction({
      strict: true,
      body: 'js.this.get\nreturn\n',
    }),
    'js.call 0',
    'return',
    '',
  ].join('\n');

  assert.equal(
    executeAssembly(source, {
      environment: { receiver },
    }),
    receiver,
  );

  assert.equal(
    executeAssembly(
      callCreatedFunction({
        strict: true,
        body: 'js.this.get\nreturn\n',
      }),
    ),
    undefined,
  );

  const primitiveSource = [
    'js.const 7',
    functionInstruction({
      strict: true,
      body: 'js.this.get\nreturn\n',
    }),
    'js.call 0',
    'return',
    '',
  ].join('\n');

  assert.equal(executeAssembly(primitiveSource), 7);
});

test('нестрогий this использует окружение или упаковывает примитив', () => {
  const environment = {};

  assert.equal(
    executeAssembly(
      callCreatedFunction({
        strict: false,
        body: 'js.this.get\nreturn\n',
      }),
      {
        environment,
      },
    ),
    environment,
  );

  const source = [
    'js.const 7',
    functionInstruction({
      strict: false,
      body: 'js.this.get\nreturn\n',
    }),
    'js.call 0',
    'return',
    '',
  ].join('\n');

  const result = executeAssembly(source);

  assert.ok(result instanceof Number);
  assert.equal(result.valueOf(), 7);
});

test('js.arg.get читает исходные аргументы, включая лишние', () => {
  assert.equal(
    executeAssembly(
      callCreatedFunction(
        {
          parameters: ['first'],
          body: 'js.arg.get 1\nreturn\n',
        },
        [
          'js.const 10',
          'js.const 42',
        ],
      ),
    ),
    42,
  );

  assert.equal(
    executeAssembly(
      callCreatedFunction({
        body: 'js.arg.get 10\nreturn\n',
      }),
    ),
    undefined,
  );

  // Изменение параметра не переписывает внутренний
  // снимок входных аргументов.
  assert.equal(
    executeAssembly(
      callCreatedFunction(
        {
          parameters: ['value'],

          body: [
            'js.const 100',
            'js.lex.set 0',
            'js.arg.get 0',
            'return',
            '',
          ].join('\n'),
        },
        ['js.const 42'],
      ),
    ),
    42,
  );
});

test('парсер отклоняет неверные параметры, флаг и тело функции', () => {
  for (const parameters of [
    'value',
    {},
    [42],
    [''],
    [null],
  ]) {
    assert.throws(
      () => parseAssembly(
        functionInstruction({ parameters }),
      ),
      SyntaxError,
    );
  }

  assert.throws(
    () => parseAssembly(
      'js.function.create "" "not JSON" false "halt\\n"',
    ),
    /Invalid JSON parameter list/,
  );

  assert.throws(
    () => parseAssembly(
      'js.function.create "" "[]" 1 "halt\\n"',
    ),
    /Invalid boolean/,
  );

  assert.throws(
    () => parseAssembly(
      functionInstruction({
        body: 'unknown.instruction\n',
      }),
    ),
    /Invalid function body/,
  );

  assert.throws(
    () => parseAssembly(
      functionInstruction({
        body: '',
      }),
    ),
    /Invalid function body/,
  );

  assert.throws(
    () => parseAssembly('js.arg.get -1\n'),
    SyntaxError,
  );
});

test('строгая функция запрещает повторные параметры при загрузке', () => {
  assert.throws(
    () => parseAssembly(
      functionInstruction({
        parameters: ['value', 'value'],
        strict: true,
      }),
    ),
    /Duplicate parameter in strict function/,
  );

  assert.doesNotThrow(
    () => parseAssembly(
      functionInstruction({
        parameters: ['value', 'value'],
        strict: false,
      }),
    ),
  );
});

test('генератор создаёт исполняемый текст и не меняется при ошибке', () => {
  const builder = new AssemblyBuilder();

  builder.emit('js.const', undefined);

  builder.emit(
    'js.function.create',
    'identity',
    ['value'],
    true,
    'js.lex.get 0\nreturn\n',
  );

  builder.emit('js.const', 42);
  builder.emit('js.call', 1);
  builder.emit('return');

  const source = builder.build();

  assert.equal(typeof source, 'string');
  assert.equal(executeAssembly(source), 42);

  assert.throws(
    () => builder.emit(
      'js.function.create',
      '',
      ['value', 'value'],
      true,
      'halt\n',
    ),
    /Duplicate parameter/,
  );

  assert.throws(
    () => builder.emit(
      'js.function.create',
      '',
      [],
      false,
      'unknown.instruction\n',
    ),
    /Invalid function body/,
  );

  assert.throws(
    () => builder.emit(
      'js.function.create',
      '',
      [undefined],
      false,
      'halt\n',
    ),
    TypeError,
  );

  assert.equal(builder.build(), source);

  const reader = new AssemblyBuilder();

  reader.emit('js.this.get');
  reader.emit('drop');
  reader.emit('js.arg.get', 0);
  reader.emit('return');

  assert.equal(executeAssembly(reader.build()), undefined);
});