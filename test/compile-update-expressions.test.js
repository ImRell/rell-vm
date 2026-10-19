import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { compileToAssembly } from '../src/compiler/compile-assembly.js';
import { executeAssembly } from '../src/runtime/execute-assembly.js';

function outcome(source, factory = () => ({}), native = false, options = {}) {
  const values = [],
    events = [];
  const environment = {
    Object,
    Array,
    Symbol,
    NaN,
    Infinity,
    undefined,
    ...factory(events),
    capture(v) {
      values.push(v);
    },
  };
  let error;
  try {
    if (native) vm.runInNewContext(source, environment);
    else
      executeAssembly(compileToAssembly(source), { ...options, environment });
  } catch (e) {
    error = e.name;
  }
  return { values, events, error };
}
function compare(source, factory) {
  const actual = outcome(source, factory),
    expected = outcome(source, factory, true);
  assert.deepEqual(actual, expected);
  return actual;
}

test('prefix/postfix ++ для let сохраняет старое и новое значения', () => {
  assert.deepEqual(
    compare('let x=10;capture(x++);capture(x);capture(++x);capture(x);').values,
    [10, 11, 12, 12],
  );
});
test('prefix/postfix -- для var', () => {
  assert.deepEqual(
    compare('var x=10;capture(x--);capture(x);capture(--x);capture(x);').values,
    [10, 9, 8, 8],
  );
});
test('строка превращается в Number, postfix возвращает Number', () => {
  assert.deepEqual(
    compare('var x="10";capture(x++);capture(x);x="20";capture(--x);').values,
    [10, 11, 19],
  );
});
test('boolean null undefined и нечисловая строка', () => {
  compare(
    'var a=true,b=false,c=null,d=undefined,e="bad";capture(a++);capture(b--);capture(++c);capture(d++);capture(e--);capture(a);capture(b);',
  );
});
test('Number NaN Infinity и большие числа', () => {
  compare(
    'var a=NaN,b=Infinity,c=-Infinity,d=1e30;capture(a++);capture(--b);capture(c--);capture(d++);capture(d);',
  );
});
test('отрицательный ноль сохраняется в postfix результате', () => {
  compare(
    'var x=-0;capture(Object.is(x++,-0));capture(x);x=-0;capture(Object.is(x--,-0));capture(x);',
  );
});
test('BigInt сохраняет тип и точность', () => {
  compare(
    'var x=900719925474099312345n;capture(x++);capture(x);capture(--x);capture(x--);capture(x);',
  );
});
test('несколько updates в арифметике выполняются слева направо', () => {
  assert.deepEqual(
    compare(
      'var x=1;capture(100+x+++x++);capture(x);capture(++x+x--);capture(x);',
    ).values,
    [103, 3, 8, 3],
  );
});
test('результат update можно присвоить другой переменной', () => {
  compare(
    'var x=10;var old=x++;var next=--x;capture(old);capture(next);capture(x);',
  );
});
test('обновляется ближайшая lexical-привязка', () => {
  compare('var x=10;{let x=20;capture(x++);capture(x);}capture(x);');
});
test('замыкание изменяет захваченную ячейку', () => {
  compare(
    'function make(){var x=10;return function(){return x++;};}var f=make();capture(f());capture(f());',
  );
});
test('параметр и mapped arguments связаны при update', () => {
  compare(
    'function f(a){capture(a++);capture(arguments[0]);capture(++arguments[0]);return a;}capture(f(10));',
  );
});
test('strict arguments независим от параметра', () => {
  compare(
    'function f(a){"use strict";capture(a++);capture(arguments[0]);capture(++arguments[0]);return a;}capture(f(10));',
  );
});
test('повторные параметры обновляют правильный arguments index', () => {
  compare(
    'function f(a,a){capture(a++);capture(arguments[0]);capture(arguments[1]);arguments[0]++;capture(a);}f(10,20);',
  );
});
test('TDZ проверяется до преобразования значения', () => {
  for (const source of [
    'x++;let x;',
    '--x;const x=10;',
    'let x=x++;',
    '{x++;let x=42;}',
  ])
    assert.equal(compare(source, () => ({ x: 100 })).error, 'ReferenceError');
});
test('const проверяется только на исполненной ветке', () => {
  for (const source of ['const x=10;x++;', 'const x=10;--x;'])
    assert.equal(compare(source).error, 'TypeError');
  compare('const x=10;if(false){x++;}capture(x);');
});
test('const сначала преобразует значение, затем отвергает запись', () => {
  const factory = (events) => ({
    value: {
      valueOf() {
        events.push('convert');
        return 10;
      },
    },
  });
  assert.deepEqual(compare('const x=value;x++;', factory), {
    values: [],
    events: ['convert'],
    error: 'TypeError',
  });
});
test('sloppy собственное имя function expression игнорирует запись', () => {
  compare('var f=function self(){capture(self++);capture(self===f);};f();');
});
test('strict собственное имя функции запрещает update', () => {
  assert.equal(
    compare('var f=function self(){"use strict";self++;};f();').error,
    'TypeError',
  );
});
test('статические и вычисляемые свойства', () => {
  compare(
    'var o={x:"10"};var key="x";capture(o.x++);capture(o[key]);capture(--o[key]);',
  );
});
test('array index и length', () => {
  compare(
    'var a=[1,2];capture(a[0]++);capture(++a.length);capture(a.length);capture(Object.keys(a).join(","));',
  );
});
test('невалидный decrement array length бросает RangeError', () => {
  assert.equal(compare('var a=[];a.length--;').error, 'RangeError');
});
test('несуществующее property становится NaN', () => {
  compare('var o={};capture(o.x++);capture(o.x);');
});
test('getter/setter получают правильный this и результат update', () => {
  compare(
    'var o={v:10,get x(){capture(this===o);return this.v;},set x(n){capture(n);this.v=n;}};capture(o.x++);capture(++o.x);capture(o.v);',
  );
});
test('getter и setter исполняются ровно один раз', () => {
  compare(
    'var reads=0,writes=0;var o={get x(){reads++;return "10";},set x(v){writes++;}};capture(o.x++);capture(reads);capture(writes);',
  );
});
test('setter return не заменяет результат update', () => {
  compare(
    'var o={get x(){return 10;},set x(v){return 999;}};capture(o.x++);capture(++o.x);',
  );
});
test('getter-only update учитывает strictness', () => {
  compare(
    'var o={get x(){return "10";}};capture(o.x++);capture(++o.x);capture(o.x);',
  );
  assert.equal(
    compare('"use strict";var o={get x(){return "10";}};o.x++;').error,
    'TypeError',
  );
});
test('readonly property обновляется только логически в sloppy', () => {
  const factory = () => ({ o: Object.freeze({ x: '10' }) });
  compare('capture(o.x++);capture(++o.x);capture(o.x);', factory);
  assert.equal(compare('"use strict";o.x++;', factory).error, 'TypeError');
});
test('примитивный receiver и nullish base', () => {
  compare('var s="abc";capture(s.length++);capture(s.length);');
  assert.equal(
    compare('"use strict";var s="abc";s.length++;').error,
    'TypeError',
  );
  for (const source of ['var o=null;o.x++;', 'var o=undefined;++o.x;'])
    assert.equal(compare(source).error, 'TypeError');
});
test('объект и key expression вычисляются один раз', () => {
  const factory = (events) => {
    const o = { x: 10 };
    return {
      base() {
        events.push('base');
        return o;
      },
      key() {
        events.push('key');
        return 'x';
      },
    };
  };
  assert.deepEqual(compare('capture(base()[key()]++);', factory).events, [
    'base',
    'key',
  ]);
});
test('сырой key преобразуется отдельно при get и set', () => {
  const factory = (events) => ({
    o: {
      get x() {
        events.push('get');
        return {
          valueOf() {
            events.push('number');
            return 10;
          },
        };
      },
      set x(v) {
        events.push('set:' + v);
      },
    },
    key: {
      [Symbol.toPrimitive](hint) {
        events.push('key:' + hint);
        return 'x';
      },
    },
  });
  assert.deepEqual(compare('capture(o[key]++);', factory).events, [
    'key:string',
    'get',
    'number',
    'key:string',
    'set:11',
  ]);
});
test('повторное преобразование key может записать в другое свойство', () => {
  const factory = () => {
    let n = 0;
    return {
      o: { x: 10, y: 20 },
      key: {
        [Symbol.toPrimitive]() {
          return n++ === 0 ? 'x' : 'y';
        },
      },
    };
  };
  assert.deepEqual(
    compare('capture(o[key]++);capture(o.x);capture(o.y);', factory).values,
    [10, 10, 11],
  );
});
test('null base не преобразует key', () => {
  const factory = (events) => ({
    key: {
      [Symbol.toPrimitive]() {
        events.push('key');
        return 'x';
      },
    },
  });
  assert.deepEqual(compare('var o=null;o[key]++;', factory), {
    values: [],
    events: [],
    error: 'TypeError',
  });
});
test('Symbol value бросает до setter и повторного key coercion', () => {
  const factory = (events) => ({
    o: {
      get x() {
        events.push('get');
        return Symbol();
      },
      set x(v) {
        events.push('set');
      },
    },
    key: {
      toString() {
        events.push('key');
        return 'x';
      },
    },
  });
  assert.deepEqual(compare('o[key]++;', factory), {
    values: [],
    events: ['key', 'get'],
    error: 'TypeError',
  });
});
test('symbol key и symbol-valued property различаются', () => {
  compare(
    'var key=Symbol();var o={};o[key]=10;capture(o[key]++);capture(o[key]);',
  );
});
test('VM valueOf используется при ++/-- с правильным receiver', () => {
  compare(
    'var value={n:10,valueOf:function(){capture(this===value);return this.n;}};var x=value;capture(x++);capture(x);',
  );
});
test('VM valueOf и fallback toString вызываются в нужном порядке', () => {
  compare(
    'var x={valueOf:function(){capture(1);return {};},toString:function(){capture(2);return "10";}};capture(x++);capture(x);',
  );
});
test('VM Symbol.toPrimitive получает number hint', () => {
  compare(
    'var x={};x[Symbol.toPrimitive]=function(hint){capture(hint);return 10n;};capture(x++);capture(x);',
  );
});
test('getter conversion method вызывается и возвращает VM-функцию', () => {
  compare(
    'var x={get valueOf(){capture("get method");return function(){capture("convert");return "10";};}};capture(x++);capture(x);',
  );
});
test('VM key.toString работает для чтения записи и updates', () => {
  compare(
    'var n=0;var key={toString:function(){n++;return "x";}};var o={x:10};capture(o[key]);capture(o[key]=20);capture(o[key]++);capture(o.x);capture(n);',
  );
});
test('VM ключ и значение могут преобразоваться с разными hints', () => {
  compare(
    'var key={};key[Symbol.toPrimitive]=function(hint){capture(hint);return "x";};var value={};value[Symbol.toPrimitive]=function(hint){capture(hint);return 10;};var o={x:value};capture(o[key]++);',
  );
});
test('составное присваивание сохраняет прежний порядок VM key coercion', () => {
  compare(
    'var key={toString:function(){capture("key");return "x";}};var o={x:10};function rhs(){capture("rhs");return 2;}capture(o[key]+=rhs());',
  );
});
test('Proxy получает converted value и исходный receiver', () => {
  const factory = (events) => {
    let o;
    o = new Proxy(
      { x: '10' },
      {
        get(t, k, r) {
          events.push('get:' + k);
          return Reflect.get(t, k, r);
        },
        set(t, k, v, r) {
          events.push([k, v, r === o]);
          return Reflect.set(t, k, v, r);
        },
      },
    );
    return { o };
  };
  compare('capture(o.x++);', factory);
});
test('Proxy false set: sloppy возвращает результат, strict бросает', () => {
  const factory = () => ({
    o: new Proxy(
      { x: 10 },
      {
        set() {
          return false;
        },
      },
    ),
  });
  compare('capture(++o.x);capture(o.x);', factory);
  assert.equal(compare('"use strict";o.x++;', factory).error, 'TypeError');
});
test('postfix newline ASI не превращается в postfix update', () => {
  compare('var x=1;x\n++x;capture(x);');
});
test('while поддерживает i++ и --i', () => {
  compare(
    'var i=0,sum=0;while(i<3){sum+=i++;}capture(sum);while(i>0){--i;}capture(i);',
  );
});
test('неисполненные logical и conditional ветки не обновляют', () => {
  compare('var x=10;false&&x++;true||++x;false?x++:0;capture(x);');
});
test('компиляция не вызывает conversion methods', () => {
  assert.equal(
    typeof compileToAssembly('var x={valueOf:function(){missing();}};x++;'),
    'string',
  );
});
test('неразрешённый update target отклоняется явно', () => {
  assert.throws(
    () => compileToAssembly('external++;'),
    /Update of unresolved identifier/,
  );
});
test('неподдерживаемые операторы не включаются случайно', () => {
  for (const source of ['var x=1;x **=2;', 'var x=1;x ||=2;', 'with({}){}'])
    assert.throws(() => compileToAssembly(source), SyntaxError);
});
