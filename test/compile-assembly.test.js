import test from 'node:test';
import assert from 'node:assert/strict';
import { compileToAssembly } from '../src/compiler/compile-assembly.js';
import { executeAssembly } from './es5-test-helpers.js';
import { parseAssembly } from '../src/assembly/parse.js';

function evaluate(source) {
  const text = compileToAssembly(source),
    suffix = 'drop\nhalt\n';
  assert.ok(text.endsWith(suffix));
  return executeAssembly(text.slice(0, -suffix.length) + 'return\n', {
    environment: {},
    maxSteps: 100000,
  });
}
test('compiler returns bytecode object', () => {
  const prog = compileToAssembly('42;');
  assert.ok(prog.code instanceof Uint8Array);
  assert.ok(Array.isArray(prog.constants));
  assert.equal(prog.constants[0], 42);
  assert.throws(
    () => executeAssembly({ code: [1, 2, 3], constants: [] }),
    TypeError,
  );
});
test('compiles literals, arithmetic, and comparisons', () => {
  for (const [source, value] of [
    ['2+3*4;', 14],
    ['"a"+"b";', 'ab'],
    ['2n+3n;', 5n],
    ['3<=4;', true],
    ['!0;', true],
  ])
    assert.equal(evaluate(source), value);
});
test('compiles variables, assignments, and shadowing', () => {
  assert.equal(evaluate('var x=10;{let x=20;x++;}x+=2;x;'), 12);
});
test('preserves TDZ, including in shadowed scopes', () => {
  for (const source of ['x;let x=42;', 'let x=10;{x;let x=20;}'])
    assert.throws(
      () =>
        executeAssembly(compileToAssembly(source), { environment: { x: 100 } }),
      ReferenceError,
    );
});
test('checks const at runtime and preserves error order', () => {
  assert.throws(
    () => executeAssembly(compileToAssembly('const x=10;x=20;')),
    TypeError,
  );
  assert.throws(
    () => executeAssembly(compileToAssembly('const x=10;x=other;let other;')),
    {
      name: 'ReferenceError',
      message: "Cannot access 'other' before initialization",
    },
  );
  assert.equal(evaluate('const x=10;if(false){x=20;}x;'), 10);
});
test('preserves short-circuiting and branch selection', () => {
  assert.equal(evaluate('false&&(1n+1);'), false);
  assert.equal(evaluate('true||(1n+1);'), true);
  assert.equal(evaluate('true?42:(1n+1);'), 42);
});
test('compiles while/for/do loops and control flow into branches', () => {
  const text = compileToAssembly(
    'var n=0;for(var i=0;i<3;i++){if(i===1)continue;n+=i;}do{n++;}while(n<4);while(true){break;}n;',
  );
  assert.match(String(text), /label L[0-9]+/);
  assert.match(String(text), /jump_if_false L[0-9]+/);
  assert.equal(
    evaluate(
      'var n=0;for(var i=0;i<3;i++){if(i===1)continue;n+=i;}do{n++;}while(n<4);while(true){break;}n;',
    ),
    4,
  );
});
test('unsupported syntax is rejected', () => {
  for (const source of [
    'x => x;',
    'with({}){}',
    'for(var key of object){}',
    'for(let i=0;i<1;i++){}',
  ])
    assert.throws(() => compileToAssembly(source), SyntaxError);
});
test('compilation errors preserve filename and position', () => {
  assert.throws(
    () => compileToAssembly('\n  x => x;', { filename: 'sample.js' }),
    /sample\.js:2:3: Unsupported expression: ArrowFunctionExpression/,
  );
});
test('compilation emits instructions without evaluating expressions', () => {
  const text = compileToAssembly(
    'for(init();condition();update()){body();}do{other();}while(check());',
  );
  assert.ok(text.code instanceof Uint8Array);
  assert.throws(() => executeAssembly(compileToAssembly('1n+1;')), TypeError);
});
