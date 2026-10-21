import test from 'node:test';
import assert from 'node:assert/strict';

import { Script, createContext } from 'node:vm';
import { parse } from 'acorn';

import { normalizeSource } from '../src/compiler/normalize-source.js';

function assertES5(source) {
  assert.doesNotThrow(() => {
    parse(source, {
      ecmaVersion: 5,
      sourceType: 'script',
    });
  });
}

function runJavaScript(source) {
  const context = createContext({}, {
    codeGeneration: {
      strings: false,
      wasm: false,
    },
  });

  return new Script(source).runInContext(context, {
    timeout: 1_000,
  });
}

function normalizeAndRun(source) {
  const normalized = normalizeSource(source);

  assertES5(normalized);

  return runJavaScript(normalized);
}

test('returns ES5 string and accepts empty source', () => {
  for (const source of ['', 'var value = 42; value;']) {
    const normalized = normalizeSource(source);

    assert.equal(typeof normalized, 'string');
    assertES5(normalized);
  }

  assert.equal(
    normalizeAndRun('var value = 42; value;'),
    42,
  );
});

test('transforms let, const and arrow functions', () => {
  const source = `
    const add = (left, right) => left + right;
    let result = add(10, 3);
    result;
  `;

  const normalized = normalizeSource(source);

  assertES5(normalized);
  assert.equal(runJavaScript(normalized), 13);
});

test('transforms template literals and destructuring', () => {
  const source = [
    'const object = { name: "VM", count: 2 };',
    'const { name, count } = object;',
    '`${name}:${count}`;',
  ].join('\n');

  assert.equal(normalizeAndRun(source), 'VM:2');
});

test('transforms default parameters, rest and call spread', () => {
  const source = `
    function sum(first = 10, ...rest) {
      return first + rest[0] + rest[1];
    }

    const values = [2, 3];
    sum(undefined, ...values);
  `;

  assert.equal(normalizeAndRun(source), 15);
});

test('transforms classes to ES5 syntax', () => {
  const source = `
    class Counter {
      constructor(value) {
        this.value = value;
      }

      add(step) {
        return this.value + step;
      }
    }

    const counter = new Counter(40);
    counter.add(2);
  `;

  assert.equal(normalizeAndRun(source), 42);
});

test('preserves lexical this of arrow function', () => {
  const source = `
    const object = {
      value: 42,

      read() {
        const arrow = () => this.value;
        return arrow();
      }
    };

    object.read();
  `;

  assert.equal(normalizeAndRun(source), 42);
});

test('preserves distinct let bindings across iterations', () => {
  const source = `
    const readers = [];

    for (let index = 0; index < 3; index++) {
      readers.push(() => index);
    }

    readers[0]() + readers[1]() + readers[2]();
  `;

  assert.equal(normalizeAndRun(source), 3);
});

test('transforms async and generators to ES5 syntax', async () => {
  const source = `
    function* values() {
      yield 40;
      yield 2;
    }

    async function calculate() {
      const iterator = values();
      const first = await Promise.resolve(iterator.next().value);
      return first + iterator.next().value;
    }

    calculate();
  `;

  const normalized = normalizeSource(source);

  assertES5(normalized);

  // Promise provides test JS environment.
  const result = await runJavaScript(normalized);

  assert.equal(result, 42);
});

test('normalization does not execute source and rejects invalid syntax', () => {
  assert.doesNotThrow(() => {
    normalizeSource('throw new Error("Must not execute");');
  });

  assert.throws(
    () => normalizeSource('const = 42;'),
    SyntaxError,
  );

  for (const source of [
    'import value from "./module.js";',
    'export const value = 42;',
  ]) {
    assert.throws(
      () => normalizeSource(source),
      SyntaxError,
    );
  }
});

test('validates source type and filename', () => {
  for (const source of [undefined, null, 42, {}, []]) {
    assert.throws(
      () => normalizeSource(source),
      {
        name: 'TypeError',
        message: 'Source must be a string',
      },
    );
  }

  for (const filename of ['', ' ', null, 42]) {
    assert.throws(
      () => normalizeSource('', { filename }),
      {
        name: 'TypeError',
        message: 'Filename must be a non-empty string',
      },
    );
  }
});