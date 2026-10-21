import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { compileToAssembly } from '../src/compiler/compile-assembly.js';
import { assembleTextToBytecode } from '../src/bytecode/assemble.js';
import { executeBytecode } from '../src/runtime/execute-bytecode.js';
import { AssemblyBuilder } from '../src/compiler/assembly-builder.js';
import { parseAssembly } from '../src/assembly/parse.js';

function executeAssembly(source, options = {}) {
  return executeBytecode(assembleTextToBytecode(source), options);
}

function run(source, environment = {}) {
  const values = [];
  const external = Object.defineProperties(
    {
      capture(value) {
        values.push(value);
      },
    },
    Object.getOwnPropertyDescriptors(environment),
  );
  executeAssembly(compileToAssembly(source), { environment: external });
  return values;
}

function compareNative(source) {
  const expected = [];
  vm.runInNewContext(source, {
    capture(value) {
      expected.push(value);
    },
  });
  assert.deepEqual(run(source), expected);
}

test('recursion uses FunctionExpression self name', () => {
  compareNative(
    'var factorial = function calculate(n) { if (n <= 1) return 1; return n * calculate(n - 1); }; capture(factorial(5));',
  );
});

test('overwriting outer variable does not break recursion', () => {
  compareNative(
    'var factorial = function calculate(n) { if (n <= 1) return 1; return n * calculate(n - 1); }; var saved = factorial; factorial = 0; capture(saved(6));',
  );
});

test('self name returns same function object', () => {
  assert.deepEqual(
    run('var f = function self() { return self; }; capture(f() === f);'),
    [true],
  );
});

test('self name is inaccessible outside expression', () => {
  assert.throws(() => run('var f = function self() {}; capture(self);'), {
    name: 'ReferenceError',
    message: 'self is not defined',
  });
});

test('self name shadows outer variable without modifying it', () => {
  compareNative(
    'var self = 99; var f = function self() { return self; }; capture(f() === f); capture(self);',
  );
});

test('parameter can shadow self name', () => {
  compareNative(
    'var f = function self(self) { return self; }; capture(f(42));',
  );
});

test('local var shadows self name from beginning of invocation', () => {
  compareNative(
    'var f = function self() { capture(self); var self = 42; return self; }; capture(f());',
  );
});

test('local FunctionDeclaration can shadow self name', () => {
  compareNative(
    'var f = function self() { return self(); function self() { return 42; } }; capture(f());',
  );
});

test('nested closure preserves self name after return', () => {
  compareNative(
    'var f = function self() { return function() { return self; }; }; var read = f(); capture(read() === f);',
  );
});

test('distinct expression evaluations have distinct private environments', () => {
  compareNative(
    'function make() { return function self() { return self; }; } var a = make(); var b = make(); capture(a() === a); capture(b() === b); capture(a === b);',
  );
});

test('additional name environment does not break outer captures', () => {
  compareNative(
    'function make(value) { return function self(n) { if (n <= 0) return value; value += 1; return self(n - 1); }; } var f = make(10); capture(f(3)); capture(f(0));',
  );
});

test('expression inside block preserves block and outer captures', () => {
  compareNative(
    'var root = 10; var f; { let value = 20; f = function self(n) { if (n <= 0) return root + value; return self(n - 1); }; } capture(f(3));',
  );
});

test('sloppy assignment to self name ignores write', () => {
  compareNative(
    'var f = function self() { self = 42; return self; }; capture(f() === f);',
  );
});

test('ignored assignment returns evaluated RHS', () => {
  compareNative(
    'var f = function self() { capture(self = 42); return self; }; capture(f() === f);',
  );
});

test('sloppy compound assignment also does not modify binding', () => {
  compareNative(
    'var f = function self() { self -= 1; return self; }; capture(f() === f);',
  );
});

test('assigning to name does not mutate outer variable of same name', () => {
  compareNative(
    'var self = 99; var f = function self() { self = 42; return self; }; capture(f() === f); capture(self);',
  );
});

test('strict assignment throws TypeError', () => {
  assert.throws(
    () => run('var f = function self() { "use strict"; self = 42; }; f();'),
    TypeError,
  );
});

test('script strict mode is inherited by function expression', () => {
  assert.throws(
    () => run('"use strict"; var f = function self() { self = 42; }; f();'),
    TypeError,
  );
});

test('strictness is determined by assignment location in nested function', () => {
  assert.throws(
    () =>
      run(
        'var f = function self() { return function() { "use strict"; self = 42; }; }; var change = f(); change();',
      ),
    TypeError,
  );
  compareNative(
    'var f = function self() { return function() { self = 42; return self; }; }; var change = f(); capture(change() === f);',
  );
});

test('right-hand side evaluates before strict assignment error', () => {
  const calls = [];
  assert.throws(
    () =>
      run('var f = function self() { "use strict"; self = record(); }; f();', {
        record() {
          calls.push('rhs');
          return 42;
        },
      }),
    TypeError,
  );
  assert.deepEqual(calls, ['rhs']);
});

test('right-hand side exception is not replaced by name write error', () => {
  const expected = new Error('RHS failure');
  assert.throws(
    () =>
      run('var f = function self() { "use strict"; self = explode(); }; f();', {
        explode() {
          throw expected;
        },
      }),
    (error) => error === expected,
  );
});

test('skipped branch does not perform forbidden assignment', () => {
  compareNative(
    'var f = function self() { "use strict"; if (false) self = 42; return self; }; capture(f() === f);',
  );
});

test('local shadowing uses normal mutable binding', () => {
  compareNative(
    'var f = function self(self) { "use strict"; self = 42; return self; }; capture(f(10));',
  );
  compareNative(
    'var f = function self() { var self; self = 42; return self; }; capture(f());',
  );
});

test('block shadowing preserves TDZ and const semantics', () => {
  assert.throws(
    () =>
      run(
        'var f = function self() { { capture(self); let self = 42; } }; f();',
      ),
    ReferenceError,
  );
  assert.throws(
    () =>
      run('var f = function self() { { const self = 10; self = 42; } }; f();'),
    TypeError,
  );
});

test('name preserves standard this and call parameters', () => {
  assert.deepEqual(
    run(
      'var f = function self(value) { "use strict"; capture(this); return value; }; capture(f(42));',
    ),
    [undefined, 42],
  );
});

test('parser and generator support named.create', () => {
  const builder = new AssemblyBuilder();
  builder.emit(
    'js.function.named.create',
    'self',
    [],
    true,
    'js.env.get 1 0\nreturn\n',
  );
  builder.emit('return');
  const source = builder.build();
  const fn = executeAssembly(source);
  assert.equal(fn.name, 'self');
  assert.equal(fn.capturedEnvironment.getCell(0).read(), fn);
  assert.equal(
    parseAssembly(source).instructions[0].op,
    'js.function.named.create',
  );
  assert.throws(
    () => builder.emit('js.function.named.create', '', [], false, 'halt\n'),
    /non-empty name/,
  );
  assert.throws(
    () =>
      builder.emit(
        'js.function.named.create',
        'self',
        ['x', 'x'],
        true,
        'halt\n',
      ),
    /Duplicate parameter/,
  );
  assert.throws(
    () =>
      builder.emit('js.function.named.create', 'self', [], false, 'bad.op\n'),
    /Invalid function body/,
  );
  assert.equal(builder.build(), source);
});

test('name write instructions validate cell type and stack', () => {
  for (const op of ['js.name.set', 'js.name.tee']) {
    assert.throws(
      () => executeAssembly(`${op} 0 0 false\nhalt\n`),
      /Stack underflow/,
    );
    assert.throws(
      () =>
        executeAssembly(
          `js.lex.create 0 "value" let\njs.const 0\njs.lex.init 0\njs.const 42\n${op} 0 0 false\nhalt\n`,
        ),
      /Expected a function-name binding/,
    );
  }
});

test('error in body preserves source JS position', () => {
  assert.throws(
    () =>
      compileToAssembly('var f = function self() {\n  x => x;\n};', {
        filename: 'named.js',
      }),
    /named\.js:2:3: Unsupported expression: ArrowFunctionExpression/,
  );
});

test('js.name.set pops RHS while js.name.tee leaves it on stack', () => {
  for (const op of ['js.name.set', 'js.name.tee']) {
    const body =
      [
        'js.const 100',
        'js.const 42',
        `${op} 1 0 false`,
        op === 'js.name.tee' ? 'js.add' : '',
        'return',
        '',
      ]
        .filter((line) => line !== '')
        .join('\n') + '\n';
    const builder = new AssemblyBuilder();
    builder.emit('js.const', undefined);
    builder.emit('js.function.named.create', 'self', [], false, body);
    builder.emit('js.call', 0);
    builder.emit('return');
    assert.equal(
      executeAssembly(builder.build()),
      op === 'js.name.set' ? 100 : 142,
    );
  }
});

test('direct name write instructions respect strict mode', () => {
  for (const op of ['js.name.set', 'js.name.tee']) {
    const builder = new AssemblyBuilder();
    builder.emit('js.const', undefined);
    builder.emit(
      'js.function.named.create',
      'self',
      [],
      true,
      `js.const 42\n${op} 1 0 true\njs.const undefined\nreturn\n`,
    );
    builder.emit('js.call', 0);
    builder.emit('return');
    assert.throws(() => executeAssembly(builder.build()), TypeError);
  }
});
