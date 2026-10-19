import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAssembly } from '../src/assembly/parse.js';
import { INSTRUCTIONS } from '../src/assembly/instructions.js';
import { AssemblyBuilder } from '../src/compiler/assembly-builder.js';
import { executeAssembly } from '../src/runtime/execute-assembly.js';
const tail = '\nlabel C\nnop\nlabel F\nnop\nlabel E\nhalt';
test('try labels are resolved and frozen', () => {
  const p = parseAssembly('js.try.enter C F E true true' + tail),
    i = p.instructions[0];
  assert.deepEqual(i.targets, [1, 2, 3]);
  assert.ok(Object.isFrozen(i.targets));
  assert.throws(() => i.targets.push(9), TypeError);
});
for (const source of [
  'js.try.enter C F E false false',
  'js.try.enter C F E 1 true',
  'js.try.enter Missing F E true false',
  'js.try.enter C Missing E false true',
  'js.try.enter C F Missing true false',
  'js.try.enter C F E true',
  'js.abrupt.jump C -1 0',
  'js.abrupt.jump C 0 -1',
  'js.construct -1',
  'js.construct 1.5',
  'js.construct 9007199254740992',
  'js.construct "1"',
  'js.try.leave 0',
  'js.catch.get 0',
  'js.finally.end 0',
])
  test('parser rejects ' + source, () =>
    assert.throws(() => parseAssembly(source + tail), SyntaxError),
  );
for (const source of [
  'js.try.leave',
  'js.catch.get',
  'js.finally.end',
  'js.abrupt.jump E 1 0',
  'js.abrupt.jump E 0 1',
])
  test('runtime protocol rejects ' + source, () =>
    assert.throws(() => executeAssembly(source + tail), Error),
  );
for (const source of ['js.construct 0', 'js.const 7\njs.construct 1'])
  test('constructor stack validation ' + source, () =>
    assert.throws(() => executeAssembly(source + '\nhalt'), /Stack underflow/),
  );
test('constructor non-callable error is TypeError', () =>
  assert.throws(
    () => executeAssembly('js.const 1\njs.construct 0\nhalt'),
    TypeError,
  ));
test('construct preserves stack below its arguments', () =>
  assert.equal(
    executeAssembly(
      'js.const 42\njs.global.get "Object"\njs.construct 0\ndrop\nreturn',
    ),
    42,
  ));
test('builder emits handler operands and named labels', () => {
  const b = new AssemblyBuilder(),
    c = b.createLabel(),
    f = b.createLabel(),
    e = b.createLabel();
  b.emit('js.try.enter', c, f, e, true, true);
  b.emit('js.const', 7);
  b.emit('throw');
  b.markLabel(c);
  b.emit('js.catch.get');
  b.emit('local.set', 0);
  b.emit('js.try.leave');
  b.markLabel(f);
  b.emit('js.finally.end');
  b.markLabel(e);
  b.emit('local.get', 0);
  b.emit('return');
  assert.equal(executeAssembly(b.build()), 7);
});
test('halt routes through finally', () =>
  assert.equal(
    executeAssembly(
      'js.try.enter C F E false true\nhalt\nlabel C\nnop\nlabel F\njs.const 7\nreturn\nlabel E\nhalt',
    ),
    7,
  ));
test('handler labels cannot point beyond code', () =>
  assert.throws(
    () =>
      parseAssembly(
        'js.try.enter C F E true true\nlabel C\nnop\nlabel F\nhalt\nlabel E',
      ),
    SyntaxError,
  ));
test('new instruction descriptors are frozen', () => {
  for (const op of [
    'js.construct',
    'js.try.enter',
    'js.try.leave',
    'js.catch.get',
    'js.finally.end',
    'js.abrupt.jump',
  ]) {
    assert.ok(Object.isFrozen(INSTRUCTIONS[op]));
    assert.ok(Object.isFrozen(INSTRUCTIONS[op].operands));
  }
});
