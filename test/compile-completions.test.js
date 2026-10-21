import test from 'node:test';
import assert from 'node:assert/strict';
import { compare } from './es5-test-helpers.js';
import { compileToAssembly } from '../src/compiler/compile-assembly.js';
import { executeAssembly } from './es5-test-helpers.js';
const cases = [
  [
    'normal try skips catch',
    'try{capture(1);}catch(e){capture("bad");}capture(2);',
    [1, 2],
  ],
  [
    'catch exact primitive',
    'try{throw 7;}catch(e){capture(e);}capture(2);',
    [7, 2],
  ],
  [
    'normal finally',
    'try{capture(1);}finally{capture(2);}capture(3);',
    [1, 2, 3],
  ],
  [
    'catch then finally',
    'try{throw "x";}catch(e){capture(e);}finally{capture("f");}capture("end");',
    ['x', 'f', 'end'],
  ],
  [
    'finally before unhandled throw',
    'try{throw "x";}finally{capture("f");}capture("bad");',
    ['f'],
  ],
  [
    'finally after return',
    'function f(){try{return 7;}finally{capture("f");}}capture(f());',
    ['f', 7],
  ],
  [
    'finally overrides return',
    'function f(){try{return 7;}finally{return 9;}}capture(f());',
    [9],
  ],
  [
    'return expression computed before finally',
    'var x=1;function f(){try{return x;}finally{x=2;}}capture(f());capture(x);',
    [1, 2],
  ],
  [
    'return in catch runs finally',
    'function f(){try{throw 2;}catch(e){return e+1;}finally{capture("f");}}capture(f());',
    ['f', 3],
  ],
  [
    'finally return overrides throw',
    'function f(){try{throw 1;}finally{return 2;}}capture(f());',
    [2],
  ],
  [
    'finally throw overrides return',
    'function f(){try{return 1;}finally{throw 2;}}try{f();}catch(e){capture(e);}',
    [2],
  ],
  [
    'catch throw seen by outer catch',
    'try{try{throw 1;}catch(e){throw e+1;}finally{capture("f");}}catch(e){capture(e);}',
    ['f', 2],
  ],
  [
    'finally error not caught by same catch',
    'try{try{capture(1);}catch(e){capture("bad");}finally{throw 2;}}catch(e){capture(e);}',
    [1, 2],
  ],
  [
    'nested finally order',
    'function f(){try{try{return 1;}finally{capture("inner");}}finally{capture("outer");}}capture(f());',
    ['inner', 'outer', 1],
  ],
  [
    'catch receives runtime ReferenceError',
    'try{missing;}catch(e){capture(e.name);}',
    ['ReferenceError'],
  ],
  [
    'catch receives runtime TypeError',
    'try{null.x;}catch(e){capture(e.name);}',
    ['TypeError'],
  ],
  [
    'catch receives VM const error',
    'const x=1;try{x=2;}catch(e){capture(e.name);}capture(x);',
    ['TypeError', 1],
  ],
  [
    'catch receives TDZ error',
    'try{capture(x);let x;}catch(e){capture(e.name);}',
    ['ReferenceError'],
  ],
  [
    'caller catches nested VM throw',
    'function f(){g();}function g(){throw "x";}try{f();}catch(e){capture(e);}capture("end");',
    ['x', 'end'],
  ],
  [
    'caller operand stack restored',
    'function f(){throw 7;}try{capture(10+f());}catch(e){capture(e);}capture(20+2);',
    [7, 22],
  ],
  [
    'catch parameter scoped and mutable',
    'var e="outer";try{throw "inner";}catch(e){capture(e);e="changed";capture(e);}capture(e);',
    ['inner', 'changed', 'outer'],
  ],
  [
    'catch parameter shadows external',
    'try{throw 7;}catch(value){capture(value);}capture(value);',
    [7, 99],
    () => ({ value: 99 }),
  ],
  [
    'var hoisted from catch',
    'capture(x);try{}catch(e){var x=10;}capture(x);',
    [undefined, undefined],
  ],
  [
    'ES5 var initializer targets catch parameter',
    'var e=1;try{throw 2;}catch(e){var e=3;capture(e);}capture(e);',
    [3, 1],
  ],
  [
    'catch closure survives',
    'var f;try{throw 7;}catch(e){f=function(){return ++e;};}capture(f());capture(f());',
    [8, 9],
  ],
  [
    'finally has no catch parameter',
    'var e=1;try{throw 2;}catch(e){capture(e);}finally{capture(e);}',
    [2, 1],
  ],
  [
    'finally can catch own inner throw and preserve return',
    'function f(){try{return 7;}finally{try{throw 2;}catch(e){capture(e);}}}capture(f());',
    [2, 7],
  ],
  [
    'return from inner finally overrides outer try',
    'function f(){try{try{throw 1;}finally{return 2;}}finally{capture(3);}}capture(f());',
    [3, 2],
  ],
  [
    'break runs finally',
    'for(var i=0;i<3;i++){try{capture(i);break;}finally{capture("f");}}capture(i);',
    [0, 'f', 0],
  ],
  [
    'continue runs finally before update',
    'for(var i=0;i<2;i++){try{continue;}finally{capture(i);}}capture(i);',
    [0, 1, 2],
  ],
  [
    'inner loop break stays inside try',
    'try{for(var i=0;i<2;i++){break;}capture("body");}finally{capture("f");}',
    ['body', 'f'],
  ],
  [
    'switch break stays inside try',
    'try{switch(1){case 1:break;}capture("body");}finally{capture("f");}',
    ['body', 'f'],
  ],
  [
    'break inside finally overrides return',
    'function f(){while(true){try{return 1;}finally{break;}}return 2;}capture(f());',
    [2],
  ],
  [
    'continue inside finally overrides return',
    'function f(){for(var i=0;i<2;i++){try{return 1;}finally{continue;}}return 2;}capture(f());',
    [2],
  ],
  [
    'break inside finally-local loop preserves pending return',
    'function f(){try{return 7;}finally{while(true){break;}capture("f");}}capture(f());',
    ['f', 7],
  ],
  [
    'continue finally-local loop preserves pending throw',
    'try{try{throw 7;}finally{for(var i=0;i<2;i++){continue;}capture("f");}}catch(e){capture(e);}',
    ['f', 7],
  ],
  [
    'catch lexical blocks unwind before outer finally',
    'let x=1;try{try{let x=2;throw 7;}catch(e){let x=3;capture(x);throw e;}}catch(e){capture(x);}finally{capture(x);}',
    [3, 1, 1],
  ],
  [
    'continue unwinds catch and body lexical scopes',
    'let x=1;for(var i=0;i<2;i++){let x=2;try{throw 7;}catch(e){let y=e;continue;}finally{capture(x);}}capture(x);',
    [2, 2, 1],
  ],
  [
    'finally switch and for-in share correct contexts',
    'var s="";for(var k in {a:1,b:2}){try{switch(k){case "a":continue;default:break;}}finally{s+=k;}}capture(s);',
    ['ab'],
  ],
  [
    'constructor throws into catch',
    'function C(){throw "ctor";}try{new C();}catch(e){capture(e);}',
    ['ctor'],
  ],
  [
    'native callback throws into catch',
    'try{[1,2].map(function(v){if(v===2)throw 7;return v;});}catch(e){capture(e);}capture(9);',
    [7, 9],
  ],
  [
    'getter throws into catch',
    'var o={get x(){throw 7;}};try{o.x;}catch(e){capture(e);}',
    [7],
  ],
  [
    'conversion throws into catch',
    'var o={valueOf:function(){throw 7;}};try{o+1;}catch(e){capture(e);}',
    [7],
  ],
  [
    'native function throws and pending operands discarded',
    'try{capture(1+JSON.parse("bad"));}catch(e){capture(e.name);}capture(42);',
    ['SyntaxError', 42],
  ],
  [
    'normal catch finalizer lexical fresh',
    'var f;try{throw 7;}catch(e){let x=e;f=function(){return x;};}finally{let x=9;capture(x);}capture(f());',
    [9, 7],
  ],
  [
    'recursive catches do not share handler stacks',
    'function f(n){try{if(n>0)return f(n-1)+1;throw 7;}catch(e){return e;}finally{capture(n);}}capture(f(2));',
    [0, 1, 2, 9],
  ],
  [
    'break normal block label runs finally',
    'done:{try{capture(1);break done;}finally{capture(2);}capture("bad");}capture(3);',
    [1, 2, 3],
  ],
  [
    'labeled continue traverses nested finally',
    'outer:for(var i=0;i<2;i++){try{for(var j=0;j<2;j++){try{continue outer;}finally{capture("inner");}}}finally{capture("outer");}}',
    ['inner', 'outer', 'inner', 'outer'],
  ],
  [
    'finally labeled break overrides throw',
    'done:{try{throw 7;}finally{break done;}}capture("ok");',
    ['ok'],
  ],
  [
    'finally inner try throw caught overrides no pending state',
    'function f(){try{return 1;}finally{try{throw 2;}catch(e){capture(e);}finally{capture(3);}}}capture(f());',
    [2, 3, 1],
  ],
];
for (const [name, source, expected, factory] of cases)
  test(name, () => assert.deepEqual(compare(source, factory).values, expected));
for (const value of [
  undefined,
  null,
  false,
  0,
  NaN,
  '',
  7,
  'text',
  Symbol('x'),
  { x: 1 },
])
  test('catch preserves exact identity ' + String(value), () => {
    const values = [];
    executeAssembly(
      compileToAssembly('try{throw value;}catch(e){capture(e);}'),
      {
        environment: {
          value,
          capture(v) {
            values.push(v);
          },
        },
      },
    );
    assert.equal(values.length, 1);
    assert.equal(Object.is(values[0], value), true);
  });
test('hard instruction budget cannot be swallowed by catch/finally', () => {
  assert.throws(
    () =>
      executeAssembly(
        compileToAssembly('while(true){try{while(true){}}catch(e){}finally{}}'),
        { maxSteps: 100 },
      ),
    /Instruction limit exceeded: 100/,
  );
});
test('budget from native callback cannot be swallowed by VM catch', () => {
  assert.throws(
    () =>
      executeAssembly(
        compileToAssembly('try{[1].map(function(){while(true){}});}catch(e){}'),
        { maxSteps: 100 },
      ),
    /Instruction limit exceeded: 100/,
  );
});
test('handler does not catch compile errors or change later runs', () => {
  assert.throws(
    () => compileToAssembly('try{x=>x;}catch(e){}'),
    /ArrowFunctionExpression/,
  );
  for (let i = 0; i < 2; i++)
    assert.equal(executeAssembly('js.const 42\nreturn'), 42);
});
