import test from 'node:test';
import assert from 'node:assert/strict';
import { compare } from './es5-test-helpers.js';
const cases = [
  [
    'new VM function',
    'function C(x){this.x=x;}var o=new C(42);capture(o.x);capture(o instanceof C);',
    [42, true],
  ],
  [
    'prototype methods',
    'function C(x){this.x=x;}C.prototype.get=function(){return this.x;};var o=new C(7);capture(o.get());',
    [7],
  ],
  [
    'constructor own prototype constructor',
    'function C(){}capture(C.prototype.constructor===C);capture(new C().constructor===C);',
    [true, true],
  ],
  [
    'prototype assignment controls new objects',
    'function C(){}var old=new C();C.prototype={x:7};var o=new C();capture(o.x);capture(o instanceof C);capture(old instanceof C);',
    [7, true, false],
  ],
  [
    'primitive prototype falls back to Object.prototype',
    'function C(){}C.prototype=1;var o=new C();capture(Object.getPrototypeOf(o)===Object.prototype);',
    [true],
  ],
  [
    'return object replaces instance',
    'function C(){this.x=1;return {x:7};}var o=new C();capture(o.x);capture(o instanceof C);',
    [7, false],
  ],
  [
    'return function replaces instance',
    'function C(){return function(){return 7;};}var o=new C();capture(typeof o);capture(o());',
    ['function', 7],
  ],
  [
    'return primitives ignored by new',
    'function C(v){this.x=1;return v;}capture(new C(7).x);capture(new C(null).x);capture(new C(undefined).x);capture(new C("x").x);',
    [1, 1, 1, 1],
  ],
  [
    'constructor arguments and arguments object',
    'function C(a,b){this.result=a+b+arguments.length;}capture(new C(1,2,3).result);',
    [6],
  ],
  [
    'named constructor expression recursion',
    'var C=function Named(n){this.n=n;if(n>0)this.next=new Named(n-1);};capture(new C(2).next.next.n);',
    [0],
  ],
  [
    'strict constructor gets object this',
    'function C(){"use strict";this.x=7;capture(typeof this);}capture(new C().x);',
    ['object', 7],
  ],
  [
    'constructors close over live cells',
    'function make(n){return function C(){this.next=function(){return ++n;};};}var C=make(1),o=new C();capture(o.next());capture(o.next());',
    [2, 3],
  ],
  [
    'native Date Array RegExp Error',
    'capture(new Date(0).getTime());capture(new Array(3).length);capture(new RegExp("a","i").test("A"));capture(new TypeError("x").name);',
    [0, 3, true, 'TypeError'],
  ],
  [
    'native Object wrappers',
    'capture(new Number(7).valueOf());capture(new String("hi").length);capture(new Boolean(false).valueOf());',
    [7, 2, false],
  ],
  [
    'constructor member reference is not method this',
    'var holder={C:function(){this.x=7;}};var o=new holder.C();capture(o.x);capture(holder.x);',
    [7, undefined],
  ],
  [
    'constructor getter before arguments',
    'var o={get C(){capture("ctor");return function(v){capture(v);};}};new o.C((capture("arg"),7));',
    ['ctor', 'arg', 7],
  ],
  [
    'arguments evaluate before not-constructable error',
    'try{new (1)((capture("arg"),7));}catch(e){capture(e.name);}',
    ['arg', 'TypeError'],
  ],
  [
    'new does not invoke overwritten call/apply methods',
    'function C(v){this.x=v;}C.call=0;C.apply=0;capture(new C(7).x);',
    [7],
  ],
  [
    'Object.create inheritance pattern',
    'function A(x){this.x=x;}A.prototype.get=function(){return this.x;};function B(x){A.call(this,x);}B.prototype=Object.create(A.prototype);B.prototype.constructor=B;var b=new B(7);capture(b.get());capture(b instanceof A);capture(b instanceof B);',
    [7, true, true],
  ],
  [
    'instanceof bound constructor',
    'function C(){}var B=C.bind(null);var o=new B();capture(o instanceof C);capture(o instanceof B);',
    [true, true],
  ],
  [
    'bound constructor ignores bound receiver',
    'var receiver={};function C(a,b){this.x=a+b;}var B=C.bind(receiver,2);var o=new B(3);capture(o.x);capture(receiver.x);capture(o instanceof C);',
    [5, undefined, true],
  ],
  [
    'instanceof VM custom hasInstance',
    'var matcher={};matcher[Symbol.hasInstance]=function(value){return value===7;};capture(7 instanceof matcher);capture(8 instanceof matcher);',
    [true, false],
  ],
  [
    'new function expression',
    'capture(new (function(v){this.x=v;})(7).x);',
    [7],
  ],
  [
    'prototype nonenumerable constructor',
    'function C(){}capture(Object.getOwnPropertyDescriptor(C.prototype,"constructor").enumerable);capture(Object.getPrototypeOf(C)===Function.prototype);',
    [false, true],
  ],
  [
    'prototype primitive makes instanceof throw',
    'function C(){}C.prototype=7;try{capture({} instanceof C);}catch(e){capture(e.name);}',
    ['TypeError'],
  ],
  [
    'strict construction + finally return overrides',
    'function C(){try{this.x=1;return {x:2};}finally{return {x:3};}}capture(new C().x);',
    [3],
  ],
  [
    'constructor finally primitive return keeps allocated this',
    'function C(){try{this.x=7;return {x:2};}finally{return 0;}}capture(new C().x);',
    [7],
  ],
  [
    'constructor throw finally overrides with object',
    'function C(){try{throw 7;}finally{return {x:42};}}capture(new C().x);',
    [42],
  ],
  [
    'own function properties are writable',
    'function f(){}f.extra=7;capture(f.extra);capture(delete f.extra);capture(f.extra);',
    [7, true, undefined],
  ],
  [
    'Object.freeze VM function only freezes ordinary function object',
    'function f(){}Object.freeze(f);try{f.extra=7;}catch(e){}capture(f.extra);capture(typeof f);',
    [undefined, 'function'],
  ],
];
for (const [name, source, values] of cases)
  test(name, () => assert.deepEqual(compare(source).values, values));
