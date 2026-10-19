import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { compileToAssembly } from '../src/compiler/compile-assembly.js';
import { executeAssembly } from '../src/runtime/execute-assembly.js';

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
  executeAssembly(compileToAssembly(source), {
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

test('arguments содержит переданные аргументы и фактическую длину', () => {
  compareNative(
    'function f(a) { capture(arguments.length); capture(arguments[0]); capture(arguments[1]); capture(arguments[9]); } f(10,20); f();',
  );
});

test('изменение параметра меняет mapped arguments', () => {
  compareNative(
    'function f(a) { a = 42; return arguments[0]; } capture(f(10));',
  );
});

test('изменение индекса из внешнего JS обновляет параметр', () => {
  compareNative(
    'function f(a) { setIndex(arguments,0,42); return a; } capture(f(10));',
  );
});

test('strict arguments независим от параметров в обе стороны', () => {
  compareNative(
    'function f(a,b) { "use strict"; a=42; setIndex(arguments,1,99); capture(arguments[0]); capture(b); capture(arguments[1]); } f(10,20);',
  );
});

test('строгость arguments наследуется из внешнего кода', () => {
  compareNative(
    '"use strict"; function f(a) { a=42; return arguments[0]; } capture(f(10));',
  );
});

test('повторные параметры отображаются только последним вхождением', () => {
  compareNative(
    'function f(a,a) { a=42; capture(arguments[0]); capture(arguments[1]); setIndex(arguments,0,100); capture(a); setIndex(arguments,1,200); capture(a); } f(10,20);',
  );
});

test('ранний дубликат не связывается при отсутствии последнего аргумента', () => {
  compareNative(
    'function f(a,a) { capture(a); a=42; capture(arguments[0]); setIndex(arguments,0,100); capture(a); } f(10);',
  );
});

test('непереданный аргумент не становится mapped после присваивания параметру', () => {
  compareNative(
    'function f(a) { a=42; capture(arguments.length); capture(arguments[0]); capture(Object.prototype.hasOwnProperty.call(arguments,"0")); } f();',
  );
});

test('повторный var arguments не сбрасывает объект', () => {
  compareNative(
    'function f(a) { var arguments; a=42; return arguments[0]; } capture(f(10));',
  );
});

test('инициализатор var arguments и обычное присваивание заменяют привязку', () => {
  compareNative(
    'function first() { var arguments=42; return arguments; } function second() { arguments=7; return arguments; } capture(first()); capture(second());',
  );
});

test('параметр arguments подавляет неявный объект', () => {
  compareNative('function f(arguments) { return arguments; } capture(f(42));');
});

test('поднятая функция arguments подавляет неявный объект', () => {
  compareNative(
    'function f() { return arguments(); function arguments() { return 42; } } capture(f());',
  );
});

test('лексическое arguments в теле функции имеет TDZ и затеняет implicit binding', () => {
  compareNative(
    'function f() { let arguments=42; return arguments; } capture(f(10));',
  );
  assert.throws(
    () => run('function f() { capture(arguments); let arguments=42; } f(10);'),
    ReferenceError,
  );
});

test('вложенная функция имеет собственный arguments', () => {
  compareNative(
    'function outer(a) { function inner() { return arguments.length; } capture(arguments.length); return inner(1,2,3); } capture(outer(10));',
  );
});

test('arguments затеняет одноимённую внешнюю переменную', () => {
  compareNative(
    'var arguments=99; function f() { return arguments.length; } capture(f(1,2)); capture(arguments);',
  );
});

test('возвращённый arguments сохраняет живую связь с ячейкой', () => {
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

test('разные вызовы имеют независимые объекты arguments', () => {
  compareNative(
    'function f(a) { return arguments; } var first=f(10); var second=f(20); setIndex(first,0,42); capture(first[0]); capture(second[0]); capture(first===second);',
  );
});

test('нестрогий arguments.callee поддерживает рекурсивный VM-вызов', () => {
  compareNative(
    'var f=function(n) { if(n<=1) return 1; return n*arguments.callee(n-1); }; capture(f(5));',
  );
});

test('имя FunctionExpression arguments затеняется неявным объектом', () => {
  compareNative(
    'var f=function arguments() { return arguments.length; }; capture(f(1,2,3));',
  );
});

test('строгий callee запрещён, в том числе через вложенное выражение', () => {
  assert.throws(
    () => run('function f(){"use strict"; return arguments.callee;} f();'),
    TypeError,
  );
});

test('defineProperty изменяет параметр, а writable false разрывает связь', () => {
  compareNative(
    'function f(a) { Object.defineProperty(arguments,"0",descriptor(42)); capture(a); Object.defineProperty(arguments,"0",readOnlyDescriptor()); a=99; capture(arguments[0]); capture(a); } f(10);',
  );
});

test('удаление индекса и accessor разрывают отображение', () => {
  compareNative(
    'function f(a) { Reflect.deleteProperty(arguments,"0"); setIndex(arguments,0,42); capture(a); capture(arguments[0]); } f(10);',
  );
  compareNative(
    'function f(a) { Object.defineProperty(arguments,"0",accessorDescriptor()); a=42; capture(arguments[0]); capture(a); } f(10);',
  );
});

test('Object.freeze сохраняет актуальный параметр перед разрывом связи', () => {
  compareNative(
    'function f(a) { a=42; Object.freeze(arguments); a=99; return arguments[0]; } capture(f(10));',
  );
});

test('arguments работает с slice.call и Arguments brand', () => {
  compareNative(
    'function f(){ capture(Array.prototype.slice.call(arguments)); capture(Object.prototype.toString.call(arguments)); } f(10,20);',
  );
});

test('блочный arguments не заменяет объект всей функции', () => {
  compareNative(
    'function f(a){ {let arguments=99;capture(arguments);} return arguments[0]; } capture(f(10));',
  );
});

test('implicit arguments сохраняется при возврате из вложенных блоков', () => {
  compareNative(
    'function f(a){while(true){{return arguments[0];}}} capture(f(42));',
  );
});

test('прямое присваивание arguments[0] обновляет параметр', () => {
  compareNative('function f(a){arguments[0]=42;return a;}capture(f(10));');
});

test('поднятая функция с именем параметра отражается в mapped arguments', () => {
  compareNative(
    'function f(a){function a(){return 42;} return arguments[0]();} capture(f(10));',
  );
  compareNative(
    'function f(a,a){function a(){return 42;} capture(arguments[0]); return arguments[1]();} capture(f(10,20));',
  );
});

test('внешний alias arguments доступен замыканию после возврата', () => {
  compareNative(
    'function make(a){var saved=arguments;return function(){a+=1;return saved[0];};} var f=make(10);capture(f());capture(f());',
  );
});
