import test from 'node:test';
import assert from 'node:assert/strict';
import { compare } from './es5-test-helpers.js';
import { compileToAssembly } from '../src/compiler/compile-assembly.js';
const cases = [
  [
    'block break',
    'outer:{capture(1);break outer;capture(2);}capture(3);',
    [1, 3],
  ],
  ['nested labels', 'a:b:{capture(1);break a;}capture(2);', [1, 2]],
  ['label may be reused', 'x:{break x;}x:{capture(7);break x;}', [7]],
  ['ordinary if label', 'x:if(true){capture(1);break x;}capture(2);', [1, 2]],
  [
    'outer for continue',
    'var n=0;outer:for(var i=0;i<3;i++){for(var j=0;j<3;j++){n++;continue outer;}}capture(n);capture(i);',
    [3, 3],
  ],
  [
    'outer for break',
    'var n=0;outer:for(var i=0;i<3;i++){for(var j=0;j<3;j++){n++;break outer;}}capture(n);capture(i);',
    [1, 0],
  ],
  [
    'multiple loop labels',
    'var n=0;a:b:for(var i=0;i<3;i++){n++;continue a;}capture(n);',
    [3],
  ],
  [
    'while continue',
    'var n=0;outer:while(n<3){n++;while(true){continue outer;}}capture(n);',
    [3],
  ],
  [
    'do continue reaches test',
    'var n=0;a:do{n++;while(true){continue a;}}while(n<3);capture(n);',
    [3],
  ],
  [
    'for-in outer continue',
    'var n=0;a:for(var k in {a:1,b:2}){while(true){n++;continue a;}}capture(n);',
    [2],
  ],
  [
    'for-in break cleanup',
    'a:for(var k in {a:1,b:2}){break a;}for(var j in {c:3})capture(j);',
    ['c'],
  ],
  [
    'switch labeled break',
    'x:switch(1){case 1:capture(1);break x;default:capture(2);}capture(3);',
    [1, 3],
  ],
  [
    'switch continue outer',
    'var n=0;a:for(var i=0;i<3;i++){switch(i){case 0:continue a;default:n++;}}capture(n);',
    [2],
  ],
  [
    'label scope restores',
    'let x=1;outer:{let x=2;{let y=3;break outer;}}capture(x);',
    [1],
  ],
  [
    'label break preserves closure',
    'var f;outer:{let x=7;f=function(){return x;};break outer;}capture(f());',
    [7],
  ],
  [
    'labeled break runs finally',
    'a:{try{break a;}finally{capture(1);}}capture(2);',
    [1, 2],
  ],
  [
    'labeled continue runs nested finally',
    'var n=0;a:for(var i=0;i<2;i++){try{try{n++;continue a;}finally{capture("i");}}finally{capture("o");}}capture(n);',
    ['i', 'o', 'i', 'o', 2],
  ],
  [
    'finally break overrides continue',
    'a:for(var i=0;i<3;i++){try{continue a;}finally{break a;}}capture(i);',
    [0],
  ],
  [
    'finally continue overrides break',
    'a:for(var i=0;i<2;i++){try{break a;}finally{continue a;}}capture(i);',
    [2],
  ],
  [
    'break inside finally preserves return',
    'function f(){try{return 7;}finally{x:{capture(1);break x;}capture(2);}}capture(f());',
    [1, 2, 7],
  ],
  [
    'label break overrides pending throw',
    'x:{try{throw 1;}finally{break x;}}capture(2);',
    [2],
  ],
  [
    'label separated from loop by block',
    'x:{for(var i=0;i<3;i++){break x;}}capture(i);',
    [0],
  ],
  [
    'try outside labeled loop remains active',
    'try{a:for(;;){break a;}throw 7;}catch(e){capture(e);}',
    [7],
  ],
  [
    'inner loop does not run outer finally early',
    'try{a:for(var i=0;i<2;i++){continue a;}capture(1);}finally{capture(2);}',
    [1, 2],
  ],
];
for (const [name, source, values] of cases)
  test(name, () => assert.deepEqual(compare(source).values, values));
for (const source of [
  'a:{continue a;}',
  'a:{while(true){continue a;}}',
  'break missing;',
  'a:a:while(false){}',
  'a:while(true){function f(){break a;}}',
  'a:while(true){function f(){continue a;}}',
])
  test('invalid label: ' + source, () =>
    assert.throws(() => compileToAssembly(source), SyntaxError),
  );
