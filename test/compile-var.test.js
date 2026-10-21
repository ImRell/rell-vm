import test from 'node:test';
import assert from 'node:assert/strict';

import { compileToAssembly } from '../src/compiler/compile-assembly.js';
import { normalizeSource } from '../src/compiler/normalize-source.js';
import { executeAssembly } from './es5-test-helpers.js';

function evaluateScript(source, environment = Object.create(null)) {
  const assembly = compileToAssembly(source);
  const suffix = 'drop\nhalt\n';

  assert.ok(
    assembly.endsWith(suffix),
    'Test source must end with a top-level expression',
  );

  return executeAssembly(
    `${assembly.slice(0, -suffix.length)}return\n`,
    {
      environment,
      maxSteps: 10_000,
    },
  );
}

test('var is accessible before declaration with undefined value', () => {
  const values = [];

  evaluateScript(`
    capture(value);
    var value = 42;
    capture(value);
    value;
  `, {
    capture(value) {
      values.push(value);
    },
  });

  assert.deepEqual(values, [undefined, 42]);
});

test('var without initializer holds undefined', () => {
  assert.equal(
    evaluateScript('var value; value;'),
    undefined,
  );
});

test('var in unreachable branch is still declared', () => {
  assert.equal(
    evaluateScript(`
      if (false) {
        var value = 42;
      }

      value;
    `),
    undefined,
  );
});

test('duplicate declaration without initializer does not reset value', () => {
  assert.equal(
    evaluateScript(`
      var value = 42;
      var value;
      { var value; }
      value;
    `),
    42,
  );
});

test('assignment before declaration uses hoisted variable', () => {
  assert.equal(
    evaluateScript(`
      value = 10;
      var value;
      value;
    `),
    10,
  );
});

test('var inside block belongs to script scope', () => {
  assert.equal(
    evaluateScript(`
      {
        var value = 10;
      }

      {
        value += 5;
      }

      value;
    `),
    15,
  );
});

test('hoisted var shadows external name from start of script', () => {
  assert.equal(
    evaluateScript(`
      var snapshot = value;
      var value = 10;
      snapshot;
    `, {
      value: 99,
    }),
    undefined,
  );
});

test('block let can shadow outer var', () => {
  assert.equal(
    evaluateScript(`
      var value = 10;

      {
        let value = 20;
        value += 5;
      }

      value;
    `),
    10,
  );
});

test('var initializers execute sequentially in place', () => {
  assert.equal(
    evaluateScript(`
      var first = 10, second = first + 5;
      var first = second * 2;
      first;
    `),
    30,
  );
});

test('initializer in skipped branch is not called', () => {
  let calls = 0;

  assert.equal(
    evaluateScript(`
      if (false) {
        var value = produce();
      }

      value;
    `, {
      produce() {
        calls++;
        return 42;
      },
    }),
    undefined,
  );

  assert.equal(calls, 0);
});

test('initializer executes each time declaration is reached', () => {
  assert.equal(
    evaluateScript(`
      var index = 0;
      var sum = 0;

      while (index < 3) {
        var step = index + 1;
        sum += step;
        index += 1;
      }

      sum;
    `),
    6,
  );
});

test('executes simple Babel normalization output in ES5', () => {
  const normalized = normalizeSource(`
    const value = 10;
    let result = value + 2;
    result;
  `);

  assert.equal(evaluateScript(normalized), 12);
});