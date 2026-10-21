import test from 'node:test';
import assert from 'node:assert/strict';
import { VMFunction, attachVMFunction } from '../src/runtime/vm-function.js';
import { LexicalEnvironment } from '../src/runtime/lexical-environment.js';
import { CallFrame } from '../src/runtime/call-frame.js';
import { assembleTextToBytecode } from '../src/bytecode/assemble.js';
import { executeBytecode } from '../src/runtime/execute-bytecode.js';
import { compileToAssembly } from '../src/compiler/compile-assembly.js';

function executeAssembly(source, options = {}) {
  return executeBytecode(assembleTextToBytecode(source), options);
}
function make(options = {}) {
  return new VMFunction({
    source: 'js.arg.get 0\nreturn',
    capturedEnvironment: new LexicalEnvironment(),
    ...options,
  });
}
test('VMFunction is a native callable with immutable metadata', () => {
  const parameters = ['x'],
    f = make({ name: 'test', parameters });
  parameters.push('y');
  assert.equal(typeof f, 'function');
  assert.ok(f instanceof Function);
  assert.ok(f instanceof VMFunction);
  assert.equal(f.name, 'test');
  assert.equal(f.length, 1);
  assert.deepEqual(f.parameters, ['x']);
  assert.ok(Object.isFrozen(f.parameters));
  assert.ok(Object.isFrozen(f.program));
  assert.throws(() => (f.source = 'halt'), TypeError);
  assert.throws(() => f.parameters.push('z'), TypeError);
  assert.equal(Object.isFrozen(f), false);
  f.extra = 7;
  assert.equal(f.extra, 7);
  assert.equal(f.prototype.constructor, f);
  assert.deepEqual(Object.keys(f), ['extra']);
});
test('unattached API-created function fails explicitly', () =>
  assert.throws(() => make()(), /not attached/));
test('first executor remains owner', () => {
  const f = make();
  attachVMFunction(f, () => 7);
  attachVMFunction(f, () => 9);
  assert.equal(f(), 7);
});
for (const bad of [null, {}, () => 0, 7])
  test('reject invalid VM attach ' + typeof bad, () =>
    assert.throws(() => attachVMFunction(bad, () => 0), TypeError),
  );
test('runtime activates external API-created VMFunction', () => {
  const f = make();
  assert.equal(
    executeAssembly(
      'js.const undefined\njs.global.get "f"\njs.const 7\njs.call 1\nreturn',
      { environment: { f } },
    ),
    7,
  );
  assert.equal(f(9), 9);
});
test('returned function native call/apply/new after root exit', () => {
  const f = executeAssembly(
    compileToAssembly('function C(x){this.x=x;return this;}C;').replace(
      /drop\nhalt\s*$/,
      'return',
    ),
  );
  const o = {};
  assert.equal(f.call(o, 7), o);
  assert.equal(o.x, 7);
  assert.equal(new f(9).x, 9);
  assert.ok(new f() instanceof f);
  assert.ok(new (f.bind(null, 11))() instanceof f);
});
test('retained function shares cumulative budget', () => {
  const f = executeAssembly(
    compileToAssembly('function f(){return 7;}f;').replace(
      /drop\nhalt\s*$/,
      'return',
    ),
    { maxSteps: 100 },
  );
  assert.equal(f(), 7);
  assert.throws(() => {
    for (let i = 0; i < 1000; i++) f();
  }, /Instruction limit exceeded/);
});
test('restoreEnvironment accepts owned root and descendants', () => {
  const f = new CallFrame(),
    root = f.rootEnvironment,
    child = f.enterScope();
  f.enterScope();
  f.restoreEnvironment(root);
  assert.equal(f.environment, root);
  f.restoreEnvironment(child);
  assert.equal(f.environment, child);
});
for (const value of [null, undefined, {}, new LexicalEnvironment()])
  test('restore rejects foreign environment ' + String(value), () => {
    const f = new CallFrame(),
      before = f.environment;
    assert.throws(() => f.restoreEnvironment(value), TypeError);
    assert.equal(f.environment, before);
  });
test('restore cannot enter captured parent or another frame', () => {
  const parent = new LexicalEnvironment(),
    a = new CallFrame({ parentEnvironment: parent }),
    b = new CallFrame({ parentEnvironment: parent });
  for (const e of [parent, b.rootEnvironment, b.enterScope()])
    assert.throws(() => a.restoreEnvironment(e), TypeError);
});
