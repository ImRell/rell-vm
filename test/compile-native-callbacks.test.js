import test from 'node:test';
import assert from 'node:assert/strict';
import { compare } from './es5-test-helpers.js';
import { compileToAssembly } from '../src/compiler/compile-assembly.js';
import { executeAssembly } from '../src/runtime/execute-assembly.js';
const cases = [
  [
    'call strict this',
    'function f(a){"use strict";capture(this);return a+1;}capture(f.call(null,7));',
    [null, 8],
  ],
  [
    'call sloppy receiver',
    'var object={x:7};function f(a){return this.x+a;}capture(f.call(object,2));',
    [9],
  ],
  [
    'apply array-like',
    'function f(a,b){return a+b+arguments.length;}capture(f.apply(null,{0:2,1:3,length:2}));',
    [7],
  ],
  [
    'apply null argument list',
    'function f(){return arguments.length;}capture(f.apply(null,null));capture(f.apply(null,undefined));',
    [0, 0],
  ],
  [
    'bind partial args and receiver',
    'function f(a,b){return this.x+a+b;}var g=f.bind({x:1},2);capture(g(3));capture(g.call({x:99},4));',
    [6, 7],
  ],
  [
    'bound function length and name',
    'function f(a,b,c){}var g=f.bind(null,1);capture(g.length);capture(typeof g);',
    [2, 'function'],
  ],
  [
    'map native callback',
    'capture([1,2,3].map(function(v,i){return v+i;}).join(","));',
    ['1,3,5'],
  ],
  [
    'filter native callback',
    'capture([1,2,3].filter(function(v){return v>1;}).join(","));',
    ['2,3'],
  ],
  [
    'reduce native callback',
    'capture([1,2,3].reduce(function(a,b){return a+b;},10));',
    [16],
  ],
  [
    'reduceRight native callback',
    'capture([1,2,3].reduceRight(function(a,b){return a+":"+b;},"x"));',
    ['x:3:2:1'],
  ],
  [
    'forEach thisArg + source identity',
    'var a=[1,2];a.forEach(function(v,i,source){capture(this.x+v+i);capture(source===a);},{x:10});',
    [11, true, 13, true],
  ],
  [
    'every and some short circuit',
    'capture([1,2,3].every(function(v){capture(v);return v<2;}));capture([1,2,3].some(function(v){capture(v);return v===2;}));',
    [1, 2, false, 1, 2, true],
  ],
  [
    'sort comparator',
    'capture([3,1,2].sort(function(a,b){return a-b;}).join(","));',
    ['1,2,3'],
  ],
  [
    'replace callback',
    'capture("a1b22".replace(/\\d+/g,function(v,offset){return "["+v+":"+offset+"]";}));',
    ['a[1:1]b[22:3]'],
  ],
  [
    'JSON reviver',
    `var o=JSON.parse('{"x":2}',function(k,v){return k==="x"?v*3:v;});capture(o.x);`,
    [6],
  ],
  [
    'JSON replacer',
    'capture(JSON.stringify({a:1,b:2},function(k,v){return k==="b"?undefined:v;}));',
    ['{"a":1}'],
  ],
  [
    'nested native callbacks return correct stack',
    'capture([1,2].map(function(v){return [10,20].map(function(n){return n+v;}).join("-");}).join("|"));',
    ['11-21|12-22'],
  ],
  [
    'native callback calls own VM recursive function',
    'function f(n){return n<2?1:n*f(n-1);}capture([3,4].map(f).join(","));',
    ['6,24'],
  ],
  [
    'callback catches error and resumes native loop',
    'capture([1,2].map(function(v){try{if(v===1)throw 7;return v;}catch(e){return e;}}).join(","));',
    ['7,2'],
  ],
  [
    'native defineProperty uses VM getter/setter without wrapper identity loss',
    'var get=function(){return this.x;};var set=function(v){this.x=v;};var o={x:1};Object.defineProperty(o,"value",{get:get,set:set});capture(Object.getOwnPropertyDescriptor(o,"value").get===get);o.value=7;capture(o.value);',
    [true, 7],
  ],
  [
    'literal accessor identity remains native callable',
    'var o={get x(){return 7;}};var f=Object.getOwnPropertyDescriptor(o,"x").get;capture(typeof f);capture(f.call(o));',
    ['function', 7],
  ],
  [
    'Function.prototype methods can be borrowed',
    'function f(a,b){return this.x+a+b;}capture(Function.prototype.apply.call(f,{x:1},[2,3]));',
    [6],
  ],
  [
    'callback modifies captured var',
    'var sum=0;[1,2,3].forEach(function(v){sum+=v;});capture(sum);',
    [6],
  ],
  [
    'array holes skip callbacks',
    'var count=0;[,1,,3].forEach(function(){count++;});capture(count);',
    [2],
  ],
];
for (const [name, source, values] of cases)
  test(name, () => assert.deepEqual(compare(source).values, values));
test('callback can be retained and invoked after executeAssembly returns', () => {
  let callback;
  executeAssembly(
    compileToAssembly('var n=0;save(function(v){n+=v;return n;});'),
    {
      environment: {
        save(fn) {
          callback = fn;
        },
      },
    },
  );
  assert.equal(typeof callback, 'function');
  assert.equal(callback(2), 2);
  assert.equal(callback(3), 5);
});
test('native host can catch callback throw and resume suspended VM frame', () => {
  const values = [];
  executeAssembly(
    compileToAssembly(
      'var result=host(function(){throw error;});capture(result);capture(42);',
    ),
    {
      environment: {
        error: 7,
        host(fn) {
          try {
            fn();
          } catch (e) {
            assert.equal(e, 7);
          }
          return 9;
        },
        capture(v) {
          values.push(v);
        },
      },
    },
  );
  assert.deepEqual(values, [9, 42]);
});
test('native host can invoke callback multiple times after an error', () => {
  let callback;
  executeAssembly(
    compileToAssembly(
      'var n=0;save(function(){n++;if(n===1)throw 7;return n;});',
    ),
    {
      environment: {
        save(fn) {
          callback = fn;
        },
      },
    },
  );
  assert.throws(
    () => callback(),
    (e) => e === 7,
  );
  assert.equal(callback(), 2);
});
test('retained callback uses creation external environment', () => {
  let fn;
  executeAssembly(compileToAssembly('save(function(){return value;});'), {
    environment: {
      value: 7,
      save(v) {
        fn = v;
      },
    },
  });
  assert.equal(
    executeAssembly(compileToAssembly('returnValue(fn());'), {
      environment: {
        value: 99,
        fn,
        returnValue(v) {
          assert.equal(v, 7);
        },
      },
    }),
    undefined,
  );
});

test('native timer invokes retained VM callback after executeAssembly returns', async () => {
  const values = [];
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('callback timeout')), 1000);
    executeAssembly(
      compileToAssembly(
        'var n=7;setTimeout(function(){try{capture(++n);}finally{done();}},0);',
      ),
      {
        environment: {
          setTimeout,
          capture: (v) => values.push(v),
          done() {
            clearTimeout(timer);
            resolve();
          },
        },
      },
    );
  });
  assert.deepEqual(values, [8]);
});

test('ordinary user Error is catchable even if its text mentions budget', () => {
  const marker = new Error('Instruction limit exceeded: 100');
  const values = [];
  executeAssembly(
    compileToAssembly(
      'try{throw marker;}catch(e){capture(e===marker);}finally{capture(7);}',
    ),
    { environment: { marker, capture: (v) => values.push(v) } },
  );
  assert.deepEqual(values, [true, 7]);
});
