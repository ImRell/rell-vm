import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { compileToAssembly } from '../src/compiler/compile-assembly.js';
import { assembleTextToBytecode } from '../src/bytecode/assemble.js';
import { executeBytecode } from '../src/runtime/execute-bytecode.js';

const helpers = {
  Object,
  Reflect,
  Array,
  setIndex(object, key, value) {
    object[key] = value;
  },
  descriptor(value) {
    return { value };
  },
  readOnlyDescriptor() {
    return { writable: false };
  },
  accessorDescriptor() {
    return {
      get() {
        return 7;
      },
      configurable: true,
    };
  },
};

function run(source, extra = {}) {
  const values = [];
  executeBytecode(assembleTextToBytecode(compileToAssembly(source)), {
    environment: Object.defineProperties(
      {
        ...helpers,
        capture(value) {
          values.push(value);
        },
      },
      Object.getOwnPropertyDescriptors(extra),
    ),
  });
  return values;
}

function compareNative(source) {
  const expected = [];
  vm.runInNewContext(source, {
    ...helpers,
    capture(value) {
      expected.push(value);
    },
  });
  assert.deepEqual(run(source), expected);
}

test('arguments contains passed arguments and actual length', () => {
  compareNative(
    'function f(a) { capture(arguments.length); capture(arguments[0]); capture(arguments[1]); capture(arguments[9]); } f(10,20); f();',
  );
});

test('parameter mutation changes mapped arguments', () => {
  compareNative(
    'function f(a) { a = 42; return arguments[0]; } capture(f(10));',
  );
});

test('index mutation from external JS updates parameter', () => {
  compareNative(
    'function f(a) { setIndex(arguments,0,42); return a; } capture(f(10));',
  );
});

test('strict arguments is independent of parameters in both directions', () => {
  compareNative(
    'function f(a,b) { "use strict"; a=42; setIndex(arguments,1,99); capture(arguments[0]); capture(b); capture(arguments[1]); } f(10,20);',
  );
});

test('strictness of arguments is inherited from outer code', () => {
  compareNative(
    '"use strict"; function f(a) { a=42; return arguments[0]; } capture(f(10));',
  );
});

test('duplicate parameters are mapped only to last occurrence', () => {
  compareNative(
    'function f(a,a) { a=42; capture(arguments[0]); capture(arguments[1]); setIndex(arguments,0,100); capture(a); setIndex(arguments,1,200); capture(a); } f(10,20);',
  );
});

test('early duplicate is not mapped when last argument is missing', () => {
  compareNative(
    'function f(a,a) { capture(a); a=42; capture(arguments[0]); setIndex(arguments,0,100); capture(a); } f(10);',
  );
});

test('unpassed argument does not become mapped after parameter assignment', () => {
  compareNative(
    'function f(a) { a=42; capture(arguments.length); capture(arguments[0]); capture(Object.prototype.hasOwnProperty.call(arguments,"0")); } f();',
  );
});

test('repeated var arguments does not reset object', () => {
  compareNative(
    'function f(a) { var arguments; a=42; return arguments[0]; } capture(f(10));',
  );
});

test('var arguments initializer and normal assignment replace binding', () => {
  compareNative(
    'function first() { var arguments=42; return arguments; } function second() { arguments=7; return arguments; } capture(first()); capture(second());',
  );
});

test('parameter named arguments suppresses implicit object', () => {
  compareNative('function f(arguments) { return arguments; } capture(f(42));');
});

test('hoisted function named arguments suppresses implicit object', () => {
  compareNative(
    'function f() { return arguments(); function arguments() { return 42; } } capture(f());',
  );
});

test('lexical arguments in function body has TDZ and shadows implicit binding', () => {
  compareNative(
    'function f() { let arguments=42; return arguments; } capture(f(10));',
  );
  assert.throws(
    () => run('function f() { capture(arguments); let arguments=42; } f(10);'),
    ReferenceError,
  );
});

test('nested function has its own arguments', () => {
  compareNative(
    'function outer(a) { function inner() { return arguments.length; } capture(arguments.length); return inner(1,2,3); } capture(outer(10));',
  );
});

test('arguments shadows outer variable of the same name', () => {
  compareNative(
    'var arguments=99; function f() { return arguments.length; } capture(f(1,2)); capture(arguments);',
  );
});

test('returned arguments retains live link to cell', () => {
  let saved;
  assert.deepEqual(
    run(
      'function f(a) { save(function(){a+=1;}); return arguments; } var args=f(10); change(); capture(args[0]); change(); capture(args[0]);',
      {
        save(fn) {
          saved = fn;
        },
        get change() {
          return saved;
        },
      },
    ),
    [11, 12],
  );
});

test('distinct calls have independent arguments objects', () => {
  compareNative(
    'function f(a) { return arguments; } var first=f(10); var second=f(20); setIndex(first,0,42); capture(first[0]); capture(second[0]); capture(first===second);',
  );
});

test('sloppy arguments.callee supports recursive VM call', () => {
  compareNative(
    'var f=function(n) { if(n<=1) return 1; return n*arguments.callee(n-1); }; capture(f(5));',
  );
});

test('FunctionExpression name arguments is shadowed by implicit object', () => {
  compareNative(
    'var f=function arguments() { return arguments.length; }; capture(f(1,2,3));',
  );
});

test('strict callee throws, including via nested expression', () => {
  assert.throws(
    () => run('function f(){"use strict"; return arguments.callee;} f();'),
    TypeError,
  );
});

test('defineProperty modifies parameter and writable false unmaps', () => {
  compareNative(
    'function f(a) { Object.defineProperty(arguments,"0",descriptor(42)); capture(a); Object.defineProperty(arguments,"0",readOnlyDescriptor()); a=99; capture(arguments[0]); capture(a); } f(10);',
  );
});

test('index deletion and accessor unmap', () => {
  compareNative(
    'function f(a) { Reflect.deleteProperty(arguments,"0"); setIndex(arguments,0,42); capture(a); capture(arguments[0]); } f(10);',
  );
  compareNative(
    'function f(a) { Object.defineProperty(arguments,"0",accessorDescriptor()); a=42; capture(arguments[0]); capture(a); } f(10);',
  );
});

test('Object.freeze preserves actual parameter before unmapping', () => {
  compareNative(
    'function f(a) { a=42; Object.freeze(arguments); a=99; return arguments[0]; } capture(f(10));',
  );
});

test('arguments works with slice.call and Arguments brand', () => {
  compareNative(
    'function f(){ capture(Array.prototype.slice.call(arguments)); capture(Object.prototype.toString.call(arguments)); } f(10,20);',
  );
});

test('block-scoped arguments does not replace function-wide object', () => {
  compareNative(
    'function f(a){ {let arguments=99;capture(arguments);} return arguments[0]; } capture(f(10));',
  );
});

test('implicit arguments is preserved on return from nested blocks', () => {
  compareNative(
    'function f(a){while(true){{return arguments[0];}}} capture(f(42));',
  );
});

test('direct assignment to arguments[0] updates parameter', () => {
  compareNative('function f(a){arguments[0]=42;return a;}capture(f(10));');
});

test('hoisted function with parameter name is reflected in mapped arguments', () => {
  compareNative(
    'function f(a){function a(){return 42;} return arguments[0]();} capture(f(10));',
  );
  compareNative(
    'function f(a,a){function a(){return 42;} capture(arguments[0]); return arguments[1]();} capture(f(10,20));',
  );
});

test('outer alias to arguments is accessible to closure after return', () => {
  compareNative(
    'function make(a){var saved=arguments;return function(){a+=1;return saved[0];};} var f=make(10);capture(f());capture(f());',
  );
});
