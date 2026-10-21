import test from 'node:test';
import assert from 'node:assert/strict';
import { compileToAssembly } from '../src/compiler/compile-assembly.js';
import { executeAssembly } from './es5-test-helpers.js';

function evaluateScript(source) {
  const lines = compileToAssembly(source).trim().split('\n');
  assert.deepEqual(lines.slice(-2), ['drop', 'halt']);
  return executeAssembly([...lines.slice(0, -2), 'return'].join('\n'), {
    environment: {},
  });
}
const run = (source) =>
  executeAssembly(compileToAssembly(source), { environment: {} });

test('compiles declaration and reading of let', () =>
  assert.equal(evaluateScript('let value=42;value;'), 42));
test('compiles declaration and reading of const', () =>
  assert.equal(evaluateScript('const value=42;value;'), 42));
test('let without initializer receives undefined', () =>
  assert.equal(evaluateScript('let value;value;'), undefined));
test('initializers are evaluated in declaration order', () =>
  assert.equal(
    evaluateScript('let first=10,second=first+5;const result=second*2;result;'),
    30,
  ));
test('reading before declaration throws ReferenceError at runtime', () =>
  assert.throws(() => run('value;let value=42;'), ReferenceError));
test('variable is in TDZ within its own initializer', () => {
  for (const source of [
    'let value=value;',
    'const value=value;',
    'let first=second,second=42;',
  ])
    assert.throws(() => run(source), ReferenceError);
});
test('inner declaration shadows outer from the beginning of the block', () =>
  assert.throws(
    () => run('let value=10;{value;let value=20;}'),
    ReferenceError,
  ));
test('nested block sees outer variables', () =>
  assert.equal(
    run('const value=42;{if(value===42){value+1;}else{1n+1;}}'),
    undefined,
  ));
test('shadowing does not mutate outer variable', () =>
  assert.equal(
    evaluateScript(
      'let value=10;{const value=20;if(value===20){value;}else{1n+1;}}value;',
    ),
    10,
  ));
test('declarations are not visible outside their block', () => {
  for (const source of [
    '{let hidden=42;}hidden;',
    '{let hidden=42;}{hidden;}',
  ]) {
    // Unknown names are now valid as external; error occurs in VM.
    const text = compileToAssembly(source);
    assert.throws(
      () => executeAssembly(text, { environment: {} }),
      ReferenceError,
    );
  }
});
test('unreachable read of variable in TDZ does not throw', () =>
  assert.equal(run('if(false){value;}let value=42;'), undefined));
test('var is supported, unnormalized destructuring is rejected', () => {
  assert.equal(evaluateScript('var value=42;value;'), 42);
  for (const source of [
    'let [value]=42;',
    'const {value}=42;',
    'var [value]=42;',
  ])
    assert.throws(() => compileToAssembly(source), SyntaxError);
});
test('simple assignment mutates let and returns value', () => {
  assert.equal(evaluateScript('let value=10;value=20;value;'), 20);
  assert.equal(evaluateScript('let value;value=42;'), 42);
});
test('supports chained assignments', () =>
  assert.equal(
    evaluateScript('let left;let right;left=right=7;left+right;'),
    14,
  ));
test('compound arithmetic assignments return new value', () => {
  for (const [op, expected] of [
    ['+=', 13],
    ['-=', 7],
    ['*=', 30],
    ['/=', 10 / 3],
    ['%=', 1],
  ])
    assert.equal(evaluateScript(`let value=10;value ${op} 3;`), expected);
  assert.equal(evaluateScript('let value=10;value+=3;value;'), 13);
});
test('compound assignment preserves JS value semantics', () => {
  assert.equal(evaluateScript('let value=1;value+="2";'), '12');
  assert.equal(evaluateScript('let value=2n;value*=3n;'), 6n);
});
test('compound assignment reads old value before right-hand side', () => {
  assert.equal(evaluateScript('let value=10;value+=(value=3);'), 13);
  assert.equal(evaluateScript('let value=10;value-=(value=3);'), 7);
});
test('assignment modifies nearest accessible declaration', () => {
  assert.equal(evaluateScript('let value=10;{value=20;}value;'), 20);
  assert.equal(
    evaluateScript(
      'let value=10;{let value=20;value+=5;if(value===25){value;}else{1n+1;}}value;',
    ),
    10,
  );
});
test('assignment checks TDZ at runtime', () => {
  for (const source of [
    'value=42;let value;',
    'value+=1;let value;',
    'let value=(value=42);',
  ])
    assert.throws(() => run(source), ReferenceError);
});
test('assignment to const throws error only at runtime', () => {
  for (const source of ['const value=10;value=20;', 'const value=10;value+=5;'])
    assert.throws(() => run(source), {
      name: 'TypeError',
      message: "Assignment to constant variable 'value'",
    });
  assert.equal(evaluateScript('const value=10;if(false){value=20;}value;'), 10);
});
test('evaluation order is preserved on assignment errors', () => {
  assert.throws(() => run('const value=10;value=other;let other;'), {
    name: 'ReferenceError',
    message: "Cannot access 'other' before initialization",
  });
  assert.throws(() => run('value+=(1n+1);let value;'), {
    name: 'ReferenceError',
    message: "Cannot access 'value' before initialization",
  });
});
test('rejects unsupported assignment targets and operators', () => {
  const cases = [
    ['unknown=42;', /Assignment to unresolved identifier/],
    ['[value]=source;', /Unsupported assignment target: ArrayPattern/],
    ['let value=2;value **=3;', /Unsupported assignment operator/],
    ['let value=0;value ||=3;', /Unsupported assignment operator/],
  ];
  for (const [source, error] of cases)
    assert.throws(() => compileToAssembly(source), error);
  // MemberExpression is no longer an unsupported target.
  const object = {};
  executeAssembly(compileToAssembly('object.value=42;'), {
    environment: { object },
  });
  assert.equal(object.value, 42);
});
