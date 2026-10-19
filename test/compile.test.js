import test from 'node:test';
import assert from 'node:assert/strict';

import { compileToAssembly } from '../src/compiler/compile-assembly.js';
import { executeAssembly } from '../src/runtime/execute-assembly.js';

function evaluateExpression(source) {
  const assembly = compileToAssembly(`(${source});`);
  const suffix = 'drop\nhalt\n';

  assert.ok(
    assembly.endsWith(suffix),
    'Compiled expression must end with drop and halt',
  );

  return executeAssembly(`${assembly.slice(0, -suffix.length)}return\n`, {
    maxSteps: 10_000,
  });
}

test('пустой скрипт компилируется в halt', () => {
  const assembly = compileToAssembly('');

  assert.equal(assembly, 'halt\n');
  assert.equal(executeAssembly(assembly), undefined);
});

test('пустые инструкции не генерируют код', () => {
  assert.equal(compileToAssembly(';;;'), 'halt\n');
});

test('выражение компилируется с удалением результата', () => {
  const assembly = compileToAssembly('10 - 3;');

  assert.equal(
    assembly,
    ['js.const 10', 'js.const 3', 'js.sub', 'drop', 'halt', ''].join('\n'),
  );

  assert.equal(executeAssembly(assembly), undefined);
});

test('несколько выражений выполняются последовательно', () => {
  const assembly = compileToAssembly('1 + 2; 3 * 4;');

  assert.equal(
    assembly,
    [
      'js.const 1',
      'js.const 2',
      'js.add',
      'drop',
      'js.const 3',
      'js.const 4',
      'js.mul',
      'drop',
      'halt',
      '',
    ].join('\n'),
  );

  assert.equal(executeAssembly(assembly), undefined);
});

test('компилирует примитивные литералы', () => {
  const cases = [
    ['42', 42],
    ['"hello"', 'hello'],
    ['true', true],
    ['false', false],
    ['null', null],
    ['123n', 123n],
    ['0xffn', 255n],
  ];

  for (const [source, expected] of cases) {
    assert.equal(evaluateExpression(source), expected);
  }
});

test('сохраняет приоритет операций и скобки', () => {
  const cases = [
    ['2 + 3 * 4', 14],
    ['(2 + 3) * 4', 20],
    ['20 - 5 - 3', 12],
    ['20 / 5', 4],
    ['10 % 3', 1],
  ];

  for (const [source, expected] of cases) {
    assert.equal(evaluateExpression(source), expected);
  }
});

test('компилирует унарные операции', () => {
  assert.equal(evaluateExpression('-5'), -5);
  assert.equal(evaluateExpression('!0'), true);
  assert.equal(evaluateExpression('!!1'), true);
  assert.ok(Object.is(evaluateExpression('-0'), -0));
});

test('компилирует сравнения и сохраняет JS-семантику', () => {
  const cases = [
    ['1 === 1', true],
    ['1 === "1"', false],
    ['2 < 3', true],
    ['3 <= 3', true],
    ['4 > 3', true],
    ['3 >= 3', true],
    ['1 + "2"', '12'],
    ['2n + 3n', 5n],
  ];

  for (const [source, expected] of cases) {
    assert.equal(evaluateExpression(source), expected);
  }
});

test('принимает use strict и игнорирует неизвестные директивы', () => {
  assert.doesNotThrow(() => {
    compileToAssembly('"use strict"; 1 + 2;');
  });

  assert.doesNotThrow(() => compileToAssembly('"custom directive";'));
});

test('отклоняет неподдерживаемые конструкции и операторы', () => {
  const cases = [
    ['with ({}) { 1; }', /Unsupported statement: WithStatement/],
    ['class C {}', /Unsupported statement: ClassDeclaration/],
    ['null ?? 1;', /Unsupported logical operator/],
    ['2 ** 3;', /Unsupported binary operator/],
    ['x => x;', /Unsupported expression: ArrowFunctionExpression/],
    ['for (var x of []) {}', /Unsupported statement: ForOfStatement/],
  ];
  for (const [source, expected] of cases) {
    assert.throws(() => compileToAssembly(source), expected);
  }
});

test('ошибка компиляции содержит файл, строку и столбец', () => {
  assert.throws(
    () => {
      compileToAssembly('\n  x => x;', {
        filename: 'example.js',
      });
    },
    {
      name: 'SyntaxError',
      message:
        'example.js:2:3: Unsupported expression: ArrowFunctionExpression',
    },
  );
});

test('компиляция не выполняет арифметические операции исходника', () => {
  const assembly = compileToAssembly('1n + 1;');

  assert.throws(() => executeAssembly(assembly), TypeError);
});

test('&& возвращает значение одного из операндов', () => {
  const cases = [
    ['0 && 42', 0],
    ['"" && 42', ''],
    ['null && 42', null],
    ['false && 42', false],
    ['"left" && 42', 42],
    ['1 && "right"', 'right'],
  ];

  for (const [source, expected] of cases) {
    assert.equal(evaluateExpression(source), expected);
  }
});

test('|| возвращает значение одного из операндов', () => {
  const cases = [
    ['0 || 42', 42],
    ['"" || "fallback"', 'fallback'],
    ['null || 42', 42],
    ['false || 42', 42],
    ['"left" || 42', 'left'],
    ['1 || "right"', 1],
  ];

  for (const [source, expected] of cases) {
    assert.equal(evaluateExpression(source), expected);
  }
});

test('логические операторы пропускают ненужную правую часть', () => {
  assert.equal(evaluateExpression('false && (1n + 1)'), false);

  assert.equal(evaluateExpression('true || (1n + 1)'), true);
});

test('логические операторы выполняют необходимую правую часть', () => {
  for (const source of ['true && (1n + 1)', 'false || (1n + 1)']) {
    assert.throws(() => evaluateExpression(source), TypeError);
  }
});

test('сохраняет приоритет и вложенность логических выражений', () => {
  const cases = [
    ['0 || 2 && 3', 3],
    ['(0 || 2) && 3', 3],
    ['1 || 0 && 3', 1],
    ['(1 || 0) && 3', 3],
    ['0 || "" || "fallback"', 'fallback'],
    ['1 && 2 && 3', 3],
    ['(0 || 2) + (3 && 4)', 6],
  ];

  for (const [source, expected] of cases) {
    assert.equal(evaluateExpression(source), expected);
  }
});

test('тернарный оператор выбирает ветку по правилам JavaScript', () => {
  const cases = [
    ['true ? 10 : 20', 10],
    ['false ? 10 : 20', 20],
    ['0 ? 10 : 20', 20],
    ['"" ? 10 : 20', 20],
    ['null ? 10 : 20', 20],
    ['"text" ? 10 : 20', 10],
  ];

  for (const [source, expected] of cases) {
    assert.equal(evaluateExpression(source), expected);
  }
});

test('тернарный оператор выполняет только выбранную ветку', () => {
  assert.equal(evaluateExpression('true ? 42 : (1n + 1)'), 42);

  assert.equal(evaluateExpression('false ? (1n + 1) : 42'), 42);

  assert.throws(() => evaluateExpression('true ? (1n + 1) : 42'), TypeError);

  assert.throws(() => evaluateExpression('false ? 42 : (1n + 1)'), TypeError);
});

test('поддерживает вложенные тернарные и логические выражения', () => {
  const cases = [
    ['false ? 1 : true ? 2 : 3', 2],
    ['true ? false ? 1 : 2 : 3', 2],
    ['(0 || 5) ? 10 : 20', 10],
    ['(true ? 2 : 3) + 4', 6],
    ['false || (true ? 7 : 8)', 7],
  ];

  for (const [source, expected] of cases) {
    assert.equal(evaluateExpression(source), expected);
  }
});

test('пустые блоки не генерируют дополнительных инструкций', () => {
  const assembly = compileToAssembly('{} { {} ; }');

  assert.equal(assembly, 'halt\n');
  assert.equal(executeAssembly(assembly), undefined);
});

test('блок компилирует вложенные инструкции последовательно', () => {
  const assembly = compileToAssembly('{ 10; { 20; } }');

  assert.equal(
    assembly,
    ['js.const 10', 'drop', 'js.const 20', 'drop', 'halt', ''].join('\n'),
  );

  assert.equal(executeAssembly(assembly), undefined);
});

test('if без else генерирует переход к следующей инструкции', () => {
  const assembly = compileToAssembly('if (false) 10; 20;');

  assert.equal(
    assembly,
    [
      'js.const false',
      'jump_if_false L0',
      'js.const 10',
      'drop',
      'label L0',
      'js.const 20',
      'drop',
      'halt',
      '',
    ].join('\n'),
  );

  assert.equal(executeAssembly(assembly), undefined);
});

test('if без else пропускает или выполняет тело по условию', () => {
  const skippedConditions = ['false', '0', '""', 'null'];

  for (const condition of skippedConditions) {
    const assembly = compileToAssembly(`if (${condition}) { 1n + 1; }`);

    assert.equal(executeAssembly(assembly), undefined);
  }

  const executedConditions = ['true', '1', '"text"'];

  for (const condition of executedConditions) {
    assert.throws(() => {
      executeAssembly(compileToAssembly(`if (${condition}) { 1n + 1; }`));
    }, TypeError);
  }
});

test('if / else выполняет только выбранную ветку', () => {
  const sources = [
    'if (true) { 42; } else { 1n + 1; }',
    'if (false) { 1n + 1; } else { 42; }',
  ];

  for (const source of sources) {
    assert.equal(executeAssembly(compileToAssembly(source)), undefined);
  }

  const throwingSources = [
    'if (true) { 1n + 1; } else { 42; }',
    'if (false) { 42; } else { 1n + 1; }',
  ];

  for (const source of throwingSources) {
    assert.throws(() => executeAssembly(compileToAssembly(source)), TypeError);
  }
});

test('поддерживает else if и вложенные условия', () => {
  const sources = [
    `
      if (false) {
        1n + 1;
      } else if (true) {
        if (false) {
          1n + 1;
        } else {
          42;
        }
      } else {
        1n + 1;
      }
    `,
    `
      if (true)
        if (false)
          1n + 1;
        else
          42;
    `,
  ];

  for (const source of sources) {
    assert.equal(executeAssembly(compileToAssembly(source)), undefined);
  }
});

test('поддерживает пустые ветки и составные условия', () => {
  const sources = [
    'if (true) {} else {}',
    'if (false) ;',
    'if (true) ; else ;',
    'if (0 || 5) { 42; } else { 1n + 1; }',
    'if (true ? false : true) { 1n + 1; } else {}',
  ];

  for (const source of sources) {
    assert.equal(executeAssembly(compileToAssembly(source)), undefined);
  }
});

test('проверяет поддерживаемый синтаксис даже в недостижимой ветке', () => {
  assert.throws(
    () => compileToAssembly('if (false) { x => x; }'),
    /Unsupported expression: ArrowFunctionExpression/,
  );
  assert.throws(
    () => compileToAssembly('if (true) {} else { with ({}) { 1; } }'),
    /Unsupported statement: WithStatement/,
  );
});

test('ранее запрещённые объявления, вызовы и литералы теперь исполняются', () => {
  const values = [];
  const text = compileToAssembly(
    'var x = 10; function f(v) { return v + 2; } capture({values:[x,f(x)]}.values.join(","));',
  );
  executeAssembly(text, {
    environment: {
      capture(v) {
        values.push(v);
      },
    },
  });
  assert.deepEqual(values, ['10,12']);
  assert.throws(
    () => executeAssembly(compileToAssembly('missing;'), { environment: {} }),
    ReferenceError,
  );
});
