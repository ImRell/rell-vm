import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { compileToAssembly } from '../src/compiler/compile-assembly.js';
import { executeAssembly } from '../src/runtime/execute-assembly.js';

function run(source, extra = {}, options = {}) {
  const values = [];
  executeAssembly(compileToAssembly(source), {
    ...options,
    environment: {
      Object,
      Array,
      Reflect,
      JSON,
      undefined,
      ...extra,
      capture(value) {
        values.push(value);
      },
    },
  });
  return values;
}
function compare(source, extra = {}) {
  const expected = [];
  vm.runInNewContext(source, {
    ...extra,
    capture(value) {
      expected.push(value);
    },
  });
  const actual = run(source, extra);
  assert.deepEqual(actual, expected);
  return actual;
}

test('пустые объект и массив создаются без внешних конструкторов', () => {
  let object, array;
  executeAssembly(compileToAssembly('capture({});capture([]);'), {
    environment: {
      capture(v) {
        if (Array.isArray(v)) array = v;
        else object = v;
      },
      Object: null,
      Array: null,
    },
  });
  assert.equal(Object.getPrototypeOf(object), Object.prototype);
  assert.ok(Array.isArray(array));
});
test('строковые, числовые и reserved word ключи', () => {
  assert.deepEqual(
    compare(
      'var o={name:"Rell", "with space":2, 1:3, default:4};capture(o.name);capture(o["with space"]);capture(o[1]);capture(o.default);',
    ),
    ['Rell', 2, 3, 4],
  );
});
test('nested object/array literals сохраняют значения', () => {
  compare(
    'var o={items:[1,{value:42}],nested:{flag:true}};capture(o.items[1].value);capture(o.nested.flag);',
  );
});
test('values вычисляются слева направо', () => {
  compare(
    'var n=0;function next(){n+=1;return n;}var o={a:next(),b:next(),c:[next(),next()]};capture(o.a);capture(o.b);capture(o.c[0]);capture(o.c[1]);',
  );
});
test('каждое вычисление литерала создаёт независимый экземпляр', () => {
  compare(
    'function make(){return {items:[]};}var a=make();var b=make();a.items.push(1);capture(a===b);capture(a.items===b.items);capture(b.items.length);',
  );
});
test('литералы внутри while создаются заново', () => {
  compare(
    'var first;var i=0;while(i<2){var o={value:i};if(i===0){first=o;}i+=1;}capture(first===o);capture(first.value);capture(o.value);',
  );
});
test('дырки отличаются от явного undefined', () => {
  compare(
    'var a=[,undefined,,3,];capture(a.length);capture(Object.keys(a).join(","));capture(Object.prototype.hasOwnProperty.call(a,0));capture(Object.prototype.hasOwnProperty.call(a,1));',
  );
});
test('trailing comma не создаёт лишний элемент', () => {
  compare(
    'capture([].length);capture([,].length);capture([,,].length);capture([1,].length);capture([1,,].length);',
  );
});
test('нативные методы массива push/pop/join работают', () => {
  compare(
    'var a=[1,2];capture(a.push(3));capture(a.pop());capture(a.join("-"));',
  );
});
test('запись индекса и length используют семантику массива', () => {
  compare(
    'var a=[1,2];a[4]=5;capture(a.length);a.length=1;capture(a[1]);capture(a.join(","));',
  );
});
test('повторные data ключи переопределяются с исходным порядком эффектов', () => {
  compare(
    'var n=0;function next(){n+=1;return n;}var o={x:next(),y:next(),x:next()};capture(o.x);capture(o.y);capture(Object.keys(o).join(","));',
  );
});
test('метод в ES5 записи получает объект как this', () => {
  compare(
    'var o={x:10,add:function(n){this.x+=n;return this.x;}};capture(o.add(5));capture(o.x);',
  );
});
test('data descriptors writable enumerable configurable', () => {
  compare(
    'var o={x:42};var d=Object.getOwnPropertyDescriptor(o,"x");capture(d.value);capture(d.writable);capture(d.enumerable);capture(d.configurable);',
  );
});
test('getter создаётся без выполнения тела', () => {
  compare(
    'var n=0;var o={get x(){n+=1;return 42;}};capture(n);capture(o.x);capture(n);',
  );
});
test('getter получает this и читает захваченную ячейку', () => {
  compare(
    'var outer=5;var o={base:10,get x(){return this.base+outer;}};capture(o.x);outer=7;capture(o.x);',
  );
});
test('setter получает this и присваиваемое значение', () => {
  compare(
    'var o={base:0,set x(v){this.base=v*2;}};capture(o.x=7);capture(o.base);',
  );
});
test('getter и setter объединяются независимо от порядка', () => {
  for (const properties of [
    'get x(){return this.value;},set x(v){this.value=v;}',
    'set x(v){this.value=v;},get x(){return this.value;}',
  ])
    compare(
      `var o={value:1,${properties}};capture(o.x);capture(o.x+=2);capture(o.value);`,
    );
});
test('повторный getter сохраняет setter и заменяет getter', () => {
  compare(
    'var o={value:0,get x(){return 1;},set x(v){this.value=v;},get x(){return 2;}};o.x=7;capture(o.x);capture(o.value);',
  );
});
test('data-property заменяет пару accessor без вызова getter', () => {
  compare(
    'var n=0;var o={get x(){n+=1;return 1;},set x(v){n+=1;},x:42};capture(n);capture(o.x);capture(Object.getOwnPropertyDescriptor(o,"x").get);',
  );
});
test('accessor заменяет data-property, не наследуя противоположный accessor', () => {
  compare(
    'var o={set x(v){capture(99);},x:42,get x(){return 7;}};capture(o.x);capture(Object.getOwnPropertyDescriptor(o,"x").set);',
  );
});
test('accessor descriptor имеет правильные флаги и arity', () => {
  compare(
    'var o={get x(){return 1;},set x(v){}};var d=Object.getOwnPropertyDescriptor(o,"x");capture(d.enumerable);capture(d.configurable);capture(d.get.length);capture(d.set.length);capture(d.value);',
  );
});
test('accessor обёртка доступна native descriptor API и call', () => {
  compare(
    'var o={x:10,get value(){return this.x;},set value(v){this.x=v;}};var d=Object.getOwnPropertyDescriptor(o,"value");capture(d.get.call({x:42}));d.set.call(o,7);capture(o.x);',
  );
});
test('унаследованный getter/setter получает фактический receiver', () => {
  compare(
    'var proto={get x(){return this.value;},set x(v){this.value=v;}};var o=Object.create(proto);o.x=42;capture(o.x);capture(proto.value);',
  );
});
test('Reflect.get/set передаёт заданный receiver', () => {
  compare(
    'var o={get x(){return this.value;},set x(v){this.value=v;}};var receiver={value:10};capture(Reflect.get(o,"x",receiver));Reflect.set(o,"x",42,receiver);capture(receiver.value);',
  );
});
test('getter-only запись игнорируется в sloppy и запрещена в strict', () => {
  compare('var o={get x(){return 1;}};capture(o.x=42);capture(o.x);');
  assert.throws(
    () => run('"use strict";var o={get x(){return 1;}};o.x=42;'),
    TypeError,
  );
});
test('setter-only чтение возвращает undefined', () => {
  compare('var o={set x(v){capture(v);}};capture(o.x);o.x=42;');
});
test('accessor имеет собственные arguments и может вызвать VM-функцию', () => {
  compare(
    'function twice(v){return v*2;}var o={get x(){capture(arguments.length);return twice(7);},set x(v){capture(arguments[0]);capture(arguments.length);}};capture(o.x);o.x=42;',
  );
});
test('getter может вернуть замыкание, сохраняя окружение', () => {
  compare(
    'function make(v){return {get f(){return function(n){v+=n;return v;};}};}var o=make(10);var f=o.f;capture(f(2));capture(f(3));',
  );
});
test('nested accessors возвращаются к правильному кадру', () => {
  compare(
    'var inner={get x(){return 2;}};var outer={get x(){return 10+inner.x;}};function f(){return 100+outer.x;}capture(f());',
  );
});
test('getter может возвратить объект и массив', () => {
  compare(
    'var o={get x(){return {items:[1,2]};}};capture(o.x.items.join(","));',
  );
});
test('создание литералов не вызывает унаследованные setter', () => {
  let calls = 0;
  const name = '__rell_literal_test__';
  Object.defineProperty(Object.prototype, name, {
    configurable: true,
    set(v) {
      calls++;
    },
  });
  try {
    assert.deepEqual(run(`var o={${name}:42};capture(o.${name});`), [42]);
    assert.equal(calls, 0);
  } finally {
    delete Object.prototype[name];
  }
});
test('литерал не зависит от внешних Object и Array', () => {
  assert.deepEqual(
    run('var a=[1,2];var o={x:3};capture(a[1]+o.x);', {
      Object: () => {
        assert.fail();
      },
      Array: () => {
        assert.fail();
      },
    }),
    [5],
  );
});
test('__proto__ literal setter соответствует современному parser/Node', () => {
  compare(
    'var proto={x:42};var o={__proto__:proto};capture(o.x);capture(Object.prototype.hasOwnProperty.call(o,"__proto__"));capture(Object.getPrototypeOf({__proto__:null}));capture(Object.getPrototypeOf({__proto__:7})===Object.prototype);',
  );
});
test('__proto__ getter — обычное own accessor свойство', () => {
  compare(
    'var o={get __proto__(){return 42;}};capture(o.__proto__);capture(Object.prototype.hasOwnProperty.call(o,"__proto__"));',
  );
});
test('ошибка элемента прекращает вычисление следующих элементов', () => {
  const error = {},
    events = [];
  assert.throws(
    () =>
      run('var a=[first(),bad(),last()];', {
        first() {
          events.push(1);
          return 1;
        },
        bad() {
          events.push(2);
          throw error;
        },
        last() {
          events.push(3);
        },
      }),
    (e) => e === error,
  );
  assert.deepEqual(events, [1, 2]);
});
test('ошибка property value прекращает вычисление литерала', () => {
  const error = {},
    events = [];
  assert.throws(
    () =>
      run('var o={x:bad(),y:last()};', {
        bad() {
          events.push(1);
          throw error;
        },
        last() {
          events.push(2);
        },
      }),
    (e) => e === error,
  );
  assert.deepEqual(events, [1]);
});
test('компиляция не вызывает элементы и тела аксессоров', () => {
  const text = compileToAssembly(
    'var o={x:missing(),get y(){unknown();}};var a=[other()];',
  );
  assert.equal(typeof text, 'string');
  assert.match(text, /js\.object\.create/);
  assert.match(text, /js\.array\.create/);
});
test('ES6 spread/shorthand/computed/method требуют нормализации', () => {
  for (const source of [
    'var a=[...values];',
    'var o={...other};',
    'var o={value};',
    'var o={[key]:42};',
    'var o={method(){return 1;}};',
  ])
    assert.throws(() => compileToAssembly(source), SyntaxError);
});
test('ошибка в accessor сохраняет файл и позицию', () => {
  assert.throws(
    () =>
      compileToAssembly('var o={get x(){\n  x => x;\n}};', {
        filename: 'literal.js',
      }),
    /literal\.js:2:3: Unsupported expression: ArrowFunctionExpression/,
  );
});

test('строгий getter сохраняет null и примитивный this при call', () => {
  compare(
    'var o={get x(){"use strict";return this;}};var get=Object.getOwnPropertyDescriptor(o,"x").get;capture(get.call(null));capture(get.call(7));',
  );
});
test('нестрогий getter упаковывает примитивный this', () => {
  compare(
    'var o={get x(){return Object.prototype.toString.call(this);}};var get=Object.getOwnPropertyDescriptor(o,"x").get;capture(get.call(7));',
  );
});
test('accessor strictness наследуется от содержащей функции', () => {
  compare(
    'function make(){"use strict";return {get x(){return this;}};}var o=make();var get=Object.getOwnPropertyDescriptor(o,"x").get;capture(get.call(7));',
  );
});
test('var внутри accessor не поднимается во внешний frame', () => {
  compare(
    'var x=10;var o={get value(){var x=42;return x;}};capture(o.value);capture(x);',
  );
});
test('accessors разных вызовов фабрики не разделяют ячейки', () => {
  compare(
    'function make(v){return {get x(){return v;},set x(n){v=n;}};}var a=make(10);var b=make(20);a.x=42;capture(a.x);capture(b.x);',
  );
});
test('accessor через native JSON.stringify сохраняет frame VM', () => {
  compare(
    'var n=0;var o={get x(){n+=1;return 42;}};capture(JSON.stringify(o));capture(n);',
  );
});
