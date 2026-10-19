import test from 'node:test';
import assert from 'node:assert/strict';
import { compileToAssembly } from '../src/compiler/compile-assembly.js';
import { parseAssembly } from '../src/assembly/parse.js';
import { INSTRUCTIONS } from '../src/assembly/instructions.js';

// Analyse all reachable branches, including loop back-edges. Equal stack/scope
// heights at joins prove that expression results and lexical scopes do not leak
// across iterations. Function bodies are independent units, checked recursively.
function verify(source) {
  const { instructions } = parseAssembly(source);
  const states = new Map(),
    pending = [[0, 0, 0]];
  while (pending.length) {
    const [pc, height, scopeDepth] = pending.pop();
    assert.ok(
      pc >= 0 && pc < instructions.length,
      'target must be an instruction',
    );
    const existing = states.get(pc);
    if (existing) {
      assert.deepEqual(
        [height, scopeDepth],
        existing,
        `inconsistent stack/scope at pc ${pc}`,
      );
      continue;
    }
    states.set(pc, [height, scopeDepth]);
    const instruction = instructions[pc],
      { op, args } = instruction,
      definition = INSTRUCTIONS[op];
    assert.notEqual(
      op,
      'js.try.enter',
      'This CFG checker covers handler-free loop bodies only',
    );
    const pops =
      definition.pops +
      (op === 'js.call' || op === 'js.construct' ? args[0] : 0);
    assert.ok(height >= pops, `stack underflow at ${pc}: ${op}`);
    const nextHeight = height - pops + definition.pushes;
    const nextScope =
      scopeDepth +
      (op === 'js.scope.enter' ? 1 : op === 'js.scope.leave' ? -1 : 0) -
      (op === 'js.abrupt.jump' ? args[1] : 0);
    assert.ok(nextScope >= 0, 'scope underflow');
    if (op === 'js.function.create' || op === 'js.function.named.create')
      verify(args[3]);
    if (definition.flow === 'halt' || definition.flow === 'return') {
      assert.equal(nextHeight, 0, 'terminal operand stack must be empty');
      if (definition.flow === 'halt')
        assert.equal(nextScope, 0, 'script must restore root scope');
      continue;
    }
    if (definition.flow === 'jump' || definition.flow === 'branch')
      pending.push([instruction.target, nextHeight, nextScope]);
    if (definition.flow !== 'jump')
      pending.push([pc + 1, nextHeight, nextScope]);
  }
}
test('for back-edge не накапливает init/test/update результаты', () => {
  verify(
    compileToAssembly('var i,j;for(i=0,j=10;(i++,i<5);i++,j--){capture(i,j);}'),
  );
});
test('for continue/break восстанавливают operand stack и lexical scope', () => {
  verify(
    compileToAssembly(
      'for(var i=0;i<5;i++){let x=i;{const y=42;if(i===1)continue;if(i===3)break;capture(x,y);}}',
    ),
  );
});
test('do back-edge и continue не накапливают результаты', () => {
  verify(
    compileToAssembly(
      'var i=0;do{let x=i;i++;if(i===1)continue;capture(x);}while((capture(i),i<3));',
    ),
  );
});
test('вложенные три вида циклов соединяют consistent stack/scope heights', () => {
  verify(
    compileToAssembly(
      'var n=0;for(var i=0;i<3;i++){let x=i;do{const y=2;while(n<3){let z=1;n++;if(n===2)continue;break;}break;}while(true);if(i===1)continue;capture(x);}',
    ),
  );
});
test('пустые бесконечные for/do имеют корректные back-edge', () => {
  verify(compileToAssembly('for(;;);'));
  verify(compileToAssembly('do;while(true);'));
});
test('return удаляет function scope и не оставляет operand values', () => {
  verify(
    compileToAssembly(
      'function f(){for(var i=0;i<3;i++){let x=i;if(i===1)return (capture(x),x);}}capture(f());',
    ),
  );
});
