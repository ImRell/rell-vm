import test from 'node:test';
import assert from 'node:assert/strict';

import { compileToAssembly } from '../src/compiler/compile-assembly.js';
import { executeAssembly } from '../src/runtime/execute-assembly.js';

const MAX_STEPS = 10_000;

function runScript(source) {
  return executeAssembly(compileToAssembly(source), {
    maxSteps: MAX_STEPS,
  });
}

function evaluateScript(source) {
  const assembly = compileToAssembly(source);
  const suffix = 'drop\nhalt\n';

  assert.ok(
    assembly.endsWith(suffix),
    'Test source must end with a top-level expression',
  );

  return executeAssembly(`${assembly.slice(0, -suffix.length)}return\n`, {
    maxSteps: MAX_STEPS,
  });
}

test('while с ложным условием не выполняет тело', () => {
  assert.equal(runScript('while (false) { 1n + 1; }'), undefined);
});

test('while повторяет тело до изменения условия', () => {
  assert.equal(
    evaluateScript(`
      let index = 0;

      while (index < 5) {
        index += 1;
      }

      index;
    `),
    5,
  );
});

test('while позволяет вычислить сумму последовательности', () => {
  assert.equal(
    evaluateScript(`
      let index = 1;
      let sum = 0;

      while (index <= 5) {
        sum += index;
        index += 1;
      }

      sum;
    `),
    15,
  );
});

test('while поддерживает тело без фигурных скобок', () => {
  assert.equal(
    evaluateScript(`
      let index = 0;
      while (index < 3) index += 1;
      index;
    `),
    3,
  );
});

test('условие while вычисляется перед каждой итерацией', () => {
  assert.equal(
    evaluateScript(`
      let remaining = 3;
      let iterations = 0;

      while (remaining -= 1) {
        iterations += 1;
      }

      iterations;
    `),
    2,
  );
});

test('вложенные циклы имеют независимые цели переходов', () => {
  assert.equal(
    evaluateScript(`
      let outer = 0;
      let count = 0;

      while (outer < 3) {
        let inner = 0;

        while (inner < 2) {
          count += 1;
          inner += 1;
        }

        outer += 1;
      }

      count;
    `),
    6,
  );
});

test('блок цикла создаёт новые ячейки при каждой итерации', () => {
  assert.equal(
    evaluateScript(`
      let index = 0;
      let sum = 0;

      while (index < 3) {
        const step = index + 1;
        let temporary;

        if (temporary === step) {
          1n + 1;
        }

        temporary = step;
        sum += temporary;
        index += 1;
      }

      sum;
    `),
    6,
  );
});

test('объявление внутри тела цикла сохраняет TDZ', () => {
  assert.throws(
    () => {
      runScript(`
        let value = 10;

        while (true) {
          value;
          let value = 20;
        }
      `);
    },
    {
      name: 'ReferenceError',
      message: "Cannot access 'value' before initialization",
    },
  );
});

test('условие while использует правила истинности JavaScript', () => {
  for (const condition of ['0', '""', 'null', 'false']) {
    assert.equal(runScript(`while (${condition}) { 1n + 1; }`), undefined);
  }

  assert.equal(
    evaluateScript(`
      let condition = "start";
      let count = 0;

      while (condition) {
        count += 1;
        condition = "";
      }

      count;
    `),
    1,
  );
});

test('break и continue разрешены внутри цикла', () => {
  assert.equal(
    runScript(`
      while (true) {
        break;
      }
    `),
    undefined,
  );

  assert.equal(
    runScript(`
      let index = 0;

      while (index < 3) {
        index += 1;
        continue;
      }
    `),
    undefined,
  );
});

test('break завершает цикл и пропускает оставшееся тело', () => {
  assert.equal(
    evaluateScript(`
      let index = 0;

      while (true) {
        index += 1;

        if (index === 3) {
          break;
        }

        if (index > 3) {
          1n + 1;
        }
      }

      index;
    `),
    3,
  );

  assert.equal(runScript('while (true) { break; 1n + 1; }'), undefined);
});

test('continue пропускает остаток тела и возвращается к условию', () => {
  assert.equal(
    evaluateScript(`
      let index = 0;
      let sum = 0;

      while (index < 5) {
        index += 1;

        if (index === 3) {
          continue;
        }

        sum += index;
      }

      sum;
    `),
    12,
  );
});

test('break завершает только ближайший цикл', () => {
  assert.equal(
    evaluateScript(`
      let outer = 0;
      let count = 0;

      while (outer < 3) {
        outer += 1;
        let inner = 0;

        while (inner < 5) {
          inner += 1;

          if (inner === 2) {
            break;
          }

          count += 1;
        }
      }

      count;
    `),
    3,
  );
});

test('continue относится только к ближайшему циклу', () => {
  assert.equal(
    evaluateScript(`
      let outer = 0;
      let count = 0;

      while (outer < 3) {
        outer += 1;
        let inner = 0;

        while (inner < 3) {
          inner += 1;

          if (inner === 2) {
            continue;
          }

          count += 1;
        }
      }

      count;
    `),
    6,
  );
});

test('после вложенного цикла восстанавливается внешний контекст', () => {
  assert.equal(
    evaluateScript(`
      let outer = 0;
      let count = 0;

      while (outer < 5) {
        outer += 1;

        while (true) {
          break;
        }

        if (outer === 2) {
          continue;
        }

        if (outer === 4) {
          break;
        }

        count += 1;
      }

      count;
    `),
    2,
  );
});

test('continue повторно создаёт ячейки блока на следующей итерации', () => {
  assert.equal(
    evaluateScript(`
      let index = 0;
      let sum = 0;

      while (index < 4) {
        const step = index;
        let temporary;

        index += 1;

        if (step === 1) {
          temporary = 99;
          continue;
        }

        if (temporary === 99) {
          1n + 1;
        }

        temporary = step;
        sum += temporary;
      }

      sum;
    `),
    5,
  );
});

test('метки поддерживают break и continue внешнего while', () => {
  assert.equal(
    evaluateScript('var n=0; outer:while(true){n++;break outer;}n;'),
    1,
  );
  assert.equal(
    evaluateScript(
      'var n=0; outer:while(n<3){n++;while(true){continue outer;}}n;',
    ),
    3,
  );
  assert.throws(
    () => compileToAssembly('outer:{while(true){continue outer;}}'),
    SyntaxError,
  );
});

test('бесконечный while останавливается тестовым лимитом', () => {
  assert.throws(
    () => runScript('while (true) {}'),
    /Instruction limit exceeded: 10000/,
  );
});
