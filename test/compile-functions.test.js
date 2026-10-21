import test from 'node:test';
import assert from 'node:assert/strict';
import { compileToAssembly } from '../src/compiler/compile-assembly.js';
import { executeAssembly } from './es5-test-helpers.js';

function run(source, environment = {}, options = {}) {
  const values = [];
  executeAssembly(compileToAssembly(source), {
    environment: Object.defineProperties(
      {
        capture(value) {
          values.push(value);
        },
      },
      Object.getOwnPropertyDescriptors(environment),
    ),
    ...options,
  });
  return values;
}

test('hoists function declaration before first reference', () => {
  assert.deepEqual(
    run('capture(sum(10, 3)); function sum(a, b) { return a + b; }'),
    [13],
  );
});

test('function without return and empty return both return undefined', () => {
  assert.deepEqual(
    run(
      'function first() {} function second() { return; } capture(first()); capture(second());',
    ),
    [undefined, undefined],
  );
});

test('return exits the entire frame from nested block', () => {
  assert.deepEqual(
    run('function f() { { { return 42; } } capture(100); } capture(f());'),
    [42],
  );
});

test('supports anonymous function expressions and immediate invocation', () => {
  assert.deepEqual(
    run(
      'var f = function(a) { return a * 2; }; capture(f(21)); capture((function() { return 7; })());',
    ),
    [42, 7],
  );
});

test('parameters and var are not reset by duplicate declaration', () => {
  assert.deepEqual(
    run('function f(value) { var value; return value; } capture(f(42));'),
    [42],
  );
});

test('duplicate parameters use the last occurrence', () => {
  assert.deepEqual(
    run(
      'function f(value, value) { return value; } capture(f(10, 20)); capture(f(10));',
    ),
    [20, undefined],
  );
});

test('hoisted function can replace a parameter with the same name', () => {
  assert.deepEqual(
    run(
      'function outer(value) { return value(); function value() { return 42; } } capture(outer(10));',
    ),
    [42],
  );
});

test('last function declaration wins, var without init does not reset it', () => {
  assert.deepEqual(
    run(
      'capture(f()); function f() { return 1; } var f; function f() { return 2; }',
    ),
    [2],
  );
});

test('function var does not leak into outer frame', () => {
  assert.deepEqual(
    run(
      'var value = 10; function f() { capture(value); var value = 20; return value; } capture(f()); capture(value);',
    ),
    [undefined, 20, 10],
  );
});

test('sibling function declarations are visible to each other for mutual recursion', () => {
  assert.deepEqual(
    run(
      'function even(n) { if (n === 0) return true; return odd(n - 1); } function odd(n) { if (n === 0) return false; return even(n - 1); } capture(even(10)); capture(odd(7));',
    ),
    [true, true],
  );
});

test('recursive frames preserve caller parameters', () => {
  assert.deepEqual(
    run(
      'function sum(n) { if (n <= 0) return 0; return sum(n - 1) + n; } capture(sum(10));',
    ),
    [55],
  );
});

test('factory returns mutable closure', () => {
  assert.deepEqual(
    run(
      'function make(value) { return function() { value += 1; return value; }; } var a = make(0); var b = make(100); capture(a()); capture(a()); capture(b());',
    ),
    [1, 2, 101],
  );
});

test('multiple closures from same call share binding', () => {
  let read;
  let write;
  assert.deepEqual(
    run(
      `
    function make() {
      var value = 10;
      saveRead(function() { return value; });
      saveWrite(function(next) { value = next; });
    }
    make(); invokeWrite(42); capture(invokeRead());
  `,
      {
        saveRead(fn) {
          read = fn;
        },
        saveWrite(fn) {
          write = fn;
        },
        // Return VMFunction to VM rather than invoking it via JS.
        get invokeRead() {
          return read;
        },
        get invokeWrite() {
          return write;
        },
      },
    ),
    [42],
  );
});

test('function captures block and retains it after exit', () => {
  assert.deepEqual(
    run(
      'var f; { let value = 42; f = function() { return value; }; } capture(f());',
    ),
    [42],
  );
});

test('functions from different iterations capture distinct block bindings', () => {
  assert.deepEqual(
    run(
      'var first; var second; var i = 0; while (i < 2) { let value = i; if (i === 0) first = function() { return value; }; else second = function() { return value; }; i += 1; } capture(first()); capture(second());',
    ),
    [0, 1],
  );
});

test('hoisted function sees TDZ of outer declaration later in source', () => {
  assert.throws(
    () =>
      run('capture(read()); let value = 42; function read() { return value; }'),
    ReferenceError,
  );
  assert.deepEqual(
    run('let value = 42; capture(read()); function read() { return value; }'),
    [42],
  );
});

test('const is checked on assignment through closure', () => {
  assert.throws(
    () => run('const value = 10; function change() { value = 20; } change();'),
    TypeError,
  );
  assert.deepEqual(
    run(
      'const value = 10; function change() { value = 20; } if (false) change(); capture(value);',
    ),
    [10],
  );
});

test('lexical capture is independent of call site environment', () => {
  assert.deepEqual(
    run(
      'var value = 10; function read() { return value; } { let value = 99; capture(read()); }',
    ),
    [10],
  );
});

test('var from function block belongs to its root', () => {
  assert.deepEqual(
    run(
      'function f() { if (false) { var value = 99; } capture(value); { value = 42; var value; } return value; } capture(f());',
    ),
    [undefined, 42],
  );
});

test('break and continue pop all exited blocks', () => {
  assert.deepEqual(
    run(`
    var i = 0; var total = 0;
    while (i < 5) {
      let current = i;
      i += 1;
      { let inner = current;
        if (inner === 1) continue;
        if (inner === 3) break;
        total += inner;
      }
    }
    capture(total); capture(i);
    { let after = 42; capture(after); }
  `),
    [2, 4, 42],
  );
});

test('nested loops restore outer loop context', () => {
  assert.deepEqual(
    run(
      'var i = 0; var total = 0; while (i < 3) { let outer = i; i += 1; while (true) { let inner = 10; total += inner; break; } if (outer === 1) continue; total += outer; } capture(total);',
    ),
    [32],
  );
});

test('var across iterations shares single binding, unlike let', () => {
  assert.deepEqual(
    run(
      'var first; var second; var i = 0; while (i < 2) { var value = i; if (i === 0) first = function() { return value; }; else second = function() { return value; }; i += 1; } capture(first()); capture(second());',
    ),
    [1, 1],
  );
});

test('standard strict call preserves undefined in this', () => {
  assert.deepEqual(
    run('function f() { "use strict"; return this; } capture(f());'),
    [undefined],
  );
});

test('outer code strictness is inherited by nested functions', () => {
  assert.deepEqual(
    run(
      '"use strict"; function f() { return function() { return this; }; } var g = f(); capture(g());',
    ),
    [undefined],
  );
});

test('method call passes object as this to VM function', () => {
  const object = { value: 42 };
  assert.deepEqual(
    run(
      'install(function() { return this.value; }); capture(object.method());',
      {
        object,
        install(fn) {
          object.method = fn;
        },
      },
    ),
    [42],
  );
});

test('compilation does not execute function body', () => {
  let calls = 0;
  const source = compileToAssembly('function f() { record(); }');
  executeAssembly(source, {
    environment: {
      record() {
        calls += 1;
      },
    },
  });
  assert.equal(calls, 0);
});

test('recursion uses shared instruction limit', () => {
  assert.throws(
    () => run('function f() { return f(); } f();', {}, { maxSteps: 1000 }),
    /Instruction limit exceeded: 1000/,
  );
});

test('unsupported function types are rejected explicitly', () => {
  for (const source of [
    '{ function f() {} }',
    'var f = (value) => value;',
    'async function f() {}',
    'function* f() {}',
    'function f(value = 42) { return value; }',
  ]) {
    assert.throws(() => compileToAssembly(source), SyntaxError);
  }
});

test('error inside function preserves filename and position', () => {
  assert.throws(
    () =>
      compileToAssembly('function f() {\n  x => x;\n}', {
        filename: 'functions.js',
      }),
    /functions\.js:2:3: Unsupported expression: ArrowFunctionExpression/,
  );
});

test('explicit arguments parameter does not shadow arguments of nested function', () => {
  assert.deepEqual(
    run('function f(arguments) { return arguments; } capture(f(42));'),
    [42],
  );
  assert.deepEqual(
    run(
      'var arguments = 42; function f() { return arguments.length; } capture(f(1, 2));',
    ),
    [2],
  );
  assert.deepEqual(
    run(
      'function outer(arguments) { return function() { return arguments.length; }; } var inner = outer(42); capture(inner(1, 2, 3));',
    ),
    [3],
  );
});

test('empty and transparent blocks do not create redundant environments', () => {
  assert.equal(String(compileToAssembly('{} { ; { } }')), 'halt\n');
  assert.deepEqual(compileToAssembly('{ 1 + 2; }').code, compileToAssembly('1 + 2;').code);
});
