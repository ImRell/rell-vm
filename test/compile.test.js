import test from 'node:test';
import assert from 'node:assert/strict';

import { compileToAssembly } from '../src/compiler/compile-assembly.js';
import { executeAssembly } from './es5-test-helpers.js';

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

test('empty script compiles to halt', () => {
  const assembly = compileToAssembly('');

  assert.equal(String(assembly), 'halt\n');
  assert.equal(executeAssembly(assembly), undefined);
});

test('empty statements generate no code', () => {
  assert.equal(String(compileToAssembly(';;;')), 'halt\n');
});

test('expression compiles with result dropped', () => {
  const assembly = compileToAssembly('10 - 3;');

  assert.equal(
    String(assembly),
    ['js.const 10', 'js.const 3', 'js.sub', 'drop', 'halt', ''].join('\n'),
  );

  assert.equal(executeAssembly(assembly), undefined);
});

test('multiple expressions execute sequentially', () => {
  const assembly = compileToAssembly('1 + 2; 3 * 4;');

  assert.equal(
    String(assembly),
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

test('compiles primitive literals', () => {
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

test('preserves operator precedence and parentheses', () => {
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

test('compiles unary operations', () => {
  assert.equal(evaluateExpression('-5'), -5);
  assert.equal(evaluateExpression('!0'), true);
  assert.equal(evaluateExpression('!!1'), true);
  assert.ok(Object.is(evaluateExpression('-0'), -0));
});

test('compiles comparisons and preserves JS semantics', () => {
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

test('accepts use strict and ignores unknown directives', () => {
  assert.doesNotThrow(() => {
    compileToAssembly('"use strict"; 1 + 2;');
  });

  assert.doesNotThrow(() => compileToAssembly('"custom directive";'));
});

test('rejects unsupported constructs and operators', () => {
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

test('compilation error includes file, line and column', () => {
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

test('compilation does not evaluate arithmetic in source', () => {
  const assembly = compileToAssembly('1n + 1;');

  assert.throws(() => executeAssembly(assembly), TypeError);
});

test('&& returns value of one of the operands', () => {
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

test('|| returns value of one of the operands', () => {
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

test('logical operators skip unnecessary right-hand side', () => {
  assert.equal(evaluateExpression('false && (1n + 1)'), false);

  assert.equal(evaluateExpression('true || (1n + 1)'), true);
});

test('logical operators evaluate required right-hand side', () => {
  for (const source of ['true && (1n + 1)', 'false || (1n + 1)']) {
    assert.throws(() => evaluateExpression(source), TypeError);
  }
});

test('preserves precedence and nesting of logical expressions', () => {
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

test('ternary operator selects branch according to JavaScript rules', () => {
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

test('ternary operator evaluates only the selected branch', () => {
  assert.equal(evaluateExpression('true ? 42 : (1n + 1)'), 42);

  assert.equal(evaluateExpression('false ? (1n + 1) : 42'), 42);

  assert.throws(() => evaluateExpression('true ? (1n + 1) : 42'), TypeError);

  assert.throws(() => evaluateExpression('false ? 42 : (1n + 1)'), TypeError);
});

test('supports nested ternary and logical expressions', () => {
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

test('empty blocks generate no extra instructions', () => {
  const assembly = compileToAssembly('{} { {} ; }');

  assert.equal(String(assembly), 'halt\n');
  assert.equal(executeAssembly(assembly), undefined);
});

test('block compiles nested statements sequentially', () => {
  const assembly = compileToAssembly('{ 10; { 20; } }');

  assert.equal(
    String(assembly),
    ['js.const 10', 'drop', 'js.const 20', 'drop', 'halt', ''].join('\n'),
  );

  assert.equal(executeAssembly(assembly), undefined);
});

test('if without else generates jump to next instruction', () => {
  const assembly = compileToAssembly('if (false) 10; 20;');

  assert.equal(
    String(assembly),
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

test('if without else skips or executes body by condition', () => {
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

test('if / else executes only the selected branch', () => {
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

test('supports else if and nested conditions', () => {
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

test('supports empty branches and compound conditions', () => {
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

test('validates supported syntax even in unreachable branch', () => {
  assert.throws(
    () => compileToAssembly('if (false) { x => x; }'),
    /Unsupported expression: ArrowFunctionExpression/,
  );
  assert.throws(
    () => compileToAssembly('if (true) {} else { with ({}) { 1; } }'),
    /Unsupported statement: WithStatement/,
  );
});

test('previously prohibited declarations, calls and literals now execute', () => {
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
