import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { compileToAssembly } from '../src/compiler/compile-assembly.js';
import { executeAssembly } from './es5-test-helpers.js';
function compare(source) {
  const expected = [],
    actual = [];
  vm.runInNewContext(
    source,
    {
      capture(v) {
        expected.push(v);
      },
    },
    { timeout: 1000 },
  );
  executeAssembly(compileToAssembly(source), {
    environment: {
      capture(v) {
        actual.push(v);
      },
    },
    maxSteps: 100000,
  });
  assert.deepEqual(actual, expected);
  return actual;
}
test('for continue pops nested lexical blocks before update', () => {
  compare(
    'var seen=[];for(var i=0;i<3;i++){let x=i;{const y=x+1;seen.push(y);continue;}}capture(i);capture(seen.join(","));',
  );
});
test('for break restores outer environment', () => {
  compare(
    'let x=100;for(var i=0;i<3;i++){let x=20;{const y=30;break;}}capture(x);capture(i);',
  );
});
test('do continue pops lexical blocks before test', () => {
  compare(
    'var i=0;let x=100;do{let x=20;{const y=30;i++;continue;}}while(i<3);capture(x);capture(i);',
  );
});
test('do break restores outer environment', () => {
  compare('let x=100;do{let x=20;{const y=30;break;}}while(false);capture(x);');
});
test('for condition and update do not see body lexical binding', () => {
  compare(
    'let x=10;for(var i=0;x<13;x++,i++){let x=100;capture(x);}capture(x);capture(i);',
  );
});
test('do condition does not see body lexical binding', () => {
  compare('let x=0;do{let x=100;capture(x);}while(++x<2);capture(x);');
});
test('continue creates new bindings in for body, preserved closures are not overwritten', () => {
  compare(
    'var functions=[];for(var i=0;i<3;i++){let value=i;functions.push(function(){return value;});continue;}capture(functions[0]());capture(functions[1]());capture(functions[2]());',
  );
});
test('continue creates new bindings in do while body', () => {
  compare(
    'var functions=[],i=0;do{let value=i;functions.push(function(){return value;});i++;continue;}while(i<3);capture(functions[0]());capture(functions[1]());capture(functions[2]());',
  );
});
test('break does not destroy captured environment', () => {
  compare(
    'var saved;for(;;){let value=42;saved=function(){return ++value;};break;}capture(saved());capture(saved());',
  );
});
test('return from lexical blocks removes entire frame', () => {
  compare(
    'function f(){for(;;){let x=10;{const y=20;return function(){return x+y;};}}}var get=f();capture(get());',
  );
});
test('nested for: break/continue targets only the nearest loop', () => {
  compare(
    'var seen=[];for(var i=0;i<3;i++){for(var j=0;j<4;j++){if(j===1)continue;if(j===3)break;seen.push(i*10+j);}}capture(seen.join(","));capture(i);capture(j);',
  );
});
test('nested do while loops have independent targets', () => {
  compare(
    'var i=0,seen=[];do{var j=0;do{j++;if(j===1)continue;if(j===3)break;seen.push(i*10+j);}while(j<4);i++;}while(i<3);capture(seen.join(","));',
  );
});
test('for enclosing do: outer continue jumps to for update', () => {
  compare(
    'var count=0;for(var i=0;i<3;i++){do{count++;break;}while(false);continue;}capture(count);capture(i);',
  );
});
test('do enclosing for: outer continue jumps to do condition', () => {
  compare(
    'var count=0;do{for(var j=0;j<2;j++){count++;}continue;}while(count<6);capture(count);capture(j);',
  );
});
test('while enclosing for and do restores previous loop context', () => {
  compare(
    'var i=0,total=0;while(i<3){i++;for(var j=0;j<2;j++){total++;}do{total++;break;}while(false);if(i===2)continue;total+=10;}capture(total);',
  );
});
test('for/do enclosing while restores previous context', () => {
  compare(
    'var count=0;for(var i=0;i<3;i++){var j=0;while(j<2){j++;if(j===1)continue;count++;}continue;}var n=0;do{while(true){count++;break;}n++;continue;}while(n<2);capture(count);',
  );
});
test('inner break does not exit lexical block of outer loop', () => {
  compare(
    'var seen=[];for(var i=0;i<2;i++){let x=i;do{let y=42;break;}while(false);seen.push(x);}capture(seen.join(","));',
  );
});
test('continue after nested loop pops only current blocks', () => {
  compare(
    'let root=100;for(var i=0;i<2;i++){let x=i;{const y=42;do{let z=7;break;}while(false);continue;}}capture(root);capture(i);',
  );
});
test('loop body preserves TDZ for its lexical binding', () => {
  for (const source of [
    'for(var i=0;i<1;i++){capture(x);let x=42;}',
    'do{capture(x);let x=42;}while(false);',
  ])
    assert.throws(
      () =>
        executeAssembly(compileToAssembly(source), {
          environment: { capture() {}, x: 100 },
        }),
      ReferenceError,
    );
});
test('function expression does not inherit loop context for break/continue', () => {
  for (const source of [
    'for(;;){var f=function(){break;};break;}',
    'do{var f=function(){continue;};break;}while(false);',
  ])
    assert.throws(() => compileToAssembly(source), SyntaxError);
});

test('for inside outer lexical block preserves proper env depths', () => {
  compare(
    'var total=0;{let limit=3;for(var i=0;i<limit;i++){let value=i;if(i===1)continue;total+=value;}capture(limit);}capture(total);capture(i);',
  );
});
test('do inside outer lexical block preserves environment for condition', () => {
  compare(
    'var total=0;{let limit=3;do{let value=total;total++;continue;}while(total<limit);capture(limit);}capture(total);',
  );
});
test('for expression can update let declared outside header', () => {
  compare(
    '{let i=0;for(;i<3;i++){let x=i;if(i===1)continue;capture(x);}capture(i);}',
  );
});
test('break exits loop body but not enclosing lexical block', () => {
  compare(
    '{let outer=42;for(;;){let inner=10;break;}capture(outer);do{let inner=20;break;}while(false);capture(outer);}',
  );
});
test('body lexical binding is inaccessible from update and do condition', () => {
  for (const source of [
    'for(var i=0;i<1;capture(hidden)){let hidden=42;i++;}',
    'do{let hidden=42;}while(hidden);',
  ])
    assert.throws(
      () =>
        executeAssembly(compileToAssembly(source), {
          environment: { capture() {} },
        }),
      ReferenceError,
    );
});
