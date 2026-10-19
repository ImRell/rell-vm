import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { compileToAssembly } from '../src/compiler/compile-assembly.js';
import { executeAssembly } from '../src/runtime/execute-assembly.js';

function outcome(source, factory = () => ({}), native = false) {
  const values = [],
    events = [];
  const environment = Object.defineProperties(
    {
      Object,
      Array,
      undefined,
      NaN,
      capture(value) {
        values.push(value);
      },
    },
    Object.getOwnPropertyDescriptors(factory(events)),
  );
  let error;
  try {
    if (native) vm.runInNewContext(source, environment, { timeout: 1000 });
    else
      executeAssembly(compileToAssembly(source), {
        environment,
        maxSteps: 100000,
      });
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

test('for-in var перебирает ключи и сохраняет последнее значение', () => {
  assert.deepEqual(
    compare('for(var k in {a:1,b:2}){capture(k);}capture(k);').values,
    ['a', 'b', 'b'],
  );
});
test('пустой объект не присваивает ключ существующему let', () => {
  assert.deepEqual(
    compare('let k="initial";for(k in {}){capture(k);}capture(k);').values,
    ['initial'],
  );
});
test('var поднят даже при пустом и недостижимом цикле', () => {
  assert.deepEqual(
    compare(
      'capture(k);if(false){for(var k in {a:1}){}}for(var empty in {}){}capture(empty);',
    ).values,
    [undefined, undefined],
  );
});
test('RHS вычисляется один раз, до присваивания ключа', () => {
  const factory = (events) => ({
    source() {
      events.push('rhs');
      return { a: 1, b: 2 };
    },
  });
  assert.deepEqual(
    compare('var k="before";for(k in source()){capture(k);}', factory).events,
    ['rhs'],
  );
});
test('переименование переменной источника не меняет перечисляемый объект', () => {
  assert.deepEqual(
    compare('var o={a:1,b:2};for(var k in o){capture(k);o={z:1};}').values,
    ['a', 'b'],
  );
});
test('порядок ключей, прототипы, неперечисляемые и символьные ключи', () => {
  const factory = () => {
    const object = Object.assign(Object.create({ p: 1 }), {
      b: 2,
      3: 3,
      1: 1,
      [Symbol('s')]: 5,
    });
    Object.defineProperty(object, 'hidden', { value: 1 });
    return { object };
  };
  assert.deepEqual(compare('for(var k in object)capture(k);', factory).values, [
    '1',
    '3',
    'b',
    'p',
  ]);
});
test('неперечисляемое свойство затеняет одноимённое свойство прототипа', () => {
  const factory = () => {
    const object = Object.create({ a: 1, b: 2 });
    Object.defineProperty(object, 'a', { value: 9 });
    return { object };
  };
  assert.deepEqual(compare('for(var k in object)capture(k);', factory).values, [
    'b',
  ]);
});
test('геттер значения не вызывается при перечислении', () => {
  const factory = (events) => ({
    object: {
      get a() {
        events.push('get');
        return 1;
      },
    },
  });
  assert.deepEqual(
    compare('for(var k in object)capture(k);', factory).events,
    [],
  );
});
test('геттер значения выполняется только при явном чтении', () => {
  const factory = (events) => ({
    object: {
      get a() {
        events.push('get');
        return 4;
      },
    },
  });
  assert.deepEqual(
    compare('for(var k in object)capture(object[k]);', factory),
    { values: [4], events: ['get'], error: undefined },
  );
});
test('null и undefined пропускают тело без ошибки', () => {
  assert.deepEqual(
    compare(
      'var k="old";for(k in null)capture("bad");for(k in undefined)capture("bad");capture(k);',
    ).values,
    ['old'],
  );
});
test('строка перечисляет индексы, массив пропускает дыры', () => {
  assert.deepEqual(
    compare('for(var k in "hi")capture(k);for(k in [,1,,3])capture(k);').values,
    ['0', '1', '1', '3'],
  );
});
test('числа, boolean, BigInt, Symbol не создают итераций', () => {
  for (const value of [1, true, 2n, Symbol('s')])
    assert.deepEqual(
      compare('for(var k in value)capture(k);', () => ({ value })).values,
      [],
    );
});
test('break не посещает следующие ключи', () => {
  assert.deepEqual(
    compare('for(var k in {a:1,b:2}){capture(k);break;}capture(k);').values,
    ['a', 'a'],
  );
});
test('continue переходит к следующему ключу', () => {
  assert.deepEqual(
    compare('for(var k in {a:1,b:2,c:3}){if(k==="b")continue;capture(k);}')
      .values,
    ['a', 'c'],
  );
});
test('вложенные for-in имеют независимые состояния', () => {
  assert.deepEqual(
    compare('for(var a in {x:1,y:2})for(var b in {p:1,q:2})capture(a+b);')
      .values,
    ['xp', 'xq', 'yp', 'yq'],
  );
});
test('break внутреннего for-in не завершает внешний цикл', () => {
  assert.deepEqual(
    compare(
      'for(var a in {x:1,y:2}){for(var b in {p:1,q:2}){capture(a+b);break;}capture(a);}',
    ).values,
    ['xp', 'x', 'yp', 'y'],
  );
});
test('continue внутреннего for-in не затрагивает внешний', () => {
  assert.deepEqual(
    compare(
      'for(var a in {x:1,y:2}){for(var b in {p:1,q:2}){if(b==="p")continue;capture(a+b);}capture(a);}',
    ).values,
    ['xq', 'x', 'yq', 'y'],
  );
});
test('for-in комбинируется с for и do-while', () => {
  assert.deepEqual(
    compare(
      'for(var i=0;i<2;i++){for(var k in {a:1,b:2}){var n=0;do{n++;if(n<2)continue;capture(i+k+n);}while(n<2);}}',
    ).values,
    ['0a2', '0b2', '1a2', '1b2'],
  );
});
test('после внутреннего цикла восстанавливаются break и continue внешнего', () => {
  assert.deepEqual(
    compare(
      'var n=0;while(n<3){n++;for(var k in {a:1}){break;}if(n<3)continue;capture(n);break;}',
    ).values,
    [3],
  );
});
test('break снимает lexical-блоки, оставляя внешнее окружение', () => {
  assert.deepEqual(
    compare(
      'let outer=10;for(var k in {a:1}){{let outer=20;break;}}capture(outer);',
    ).values,
    [10],
  );
});
test('continue снимает lexical-блоки перед следующей итерацией', () => {
  assert.deepEqual(
    compare(
      'let outer=10;for(var k in {a:1,b:2}){{let outer=k;capture(outer);continue;}}capture(outer);',
    ).values,
    ['a', 'b', 10],
  );
});
test('новый блок каждой итерации создаёт отдельные захваченные ячейки', () => {
  assert.deepEqual(
    compare(
      'var readers=[];var i=0;for(var k in {a:1,b:2}){let copy=k;readers[i++]=function(){return copy;};continue;}capture(readers[0]());capture(readers[1]());',
    ).values,
    ['a', 'b'],
  );
});
test('var в цикле остаётся общей ячейкой для замыканий', () => {
  assert.deepEqual(
    compare(
      'var readers=[];var i=0;for(var k in {a:1,b:2}){readers[i++]=function(){return k;};}capture(readers[0]());capture(readers[1]());',
    ).values,
    ['b', 'b'],
  );
});
test('return из тела не продолжает перечисление', () => {
  assert.deepEqual(
    compare(
      'function f(){for(var k in {a:1,b:2}){let value=k;return value;}return "empty";}capture(f());capture(f());',
    ).values,
    ['a', 'a'],
  );
});
test('рекурсивные вызовы не разделяют временные local-слоты', () => {
  assert.deepEqual(
    compare(
      'function f(n){var s="";for(var k in {a:1,b:2}){s+=k;if(n>0)s+=f(n-1);}return s;}capture(f(1));',
    ).values,
    ['aabbab'],
  );
});
test('присваивание существующей привязке внешнего замыкания', () => {
  assert.deepEqual(
    compare('var k="old";function f(){for(k in {a:1,b:2}){}}f();capture(k);')
      .values,
    ['b'],
  );
});
test('TDZ назначения проверяется только при наличии ключа', () => {
  assert.equal(compare('for(k in {a:1}){}let k;').error, 'ReferenceError');
  assert.equal(compare('for(k in {}){}let k;').error, undefined);
});
test('TDZ чтения RHS сохраняется', () => {
  assert.equal(
    compare('for(var k in object){}let object;').error,
    'ReferenceError',
  );
});
test('const назначения запрещает запись, пустой цикл её не делает', () => {
  assert.equal(compare('const k="old";for(k in {a:1}){}').error, 'TypeError');
  assert.deepEqual(compare('const k="old";for(k in {}){}capture(k);').values, [
    'old',
  ]);
});
test('имя named function expression сохраняет sloppy/strict правила записи', () => {
  assert.deepEqual(
    compare(
      'var f=function name(){for(name in {a:1}){}return name===f;};capture(f());',
    ).values,
    [true],
  );
  assert.equal(
    compare('var f=function name(){"use strict";for(name in {a:1}){}};f();')
      .error,
    'TypeError',
  );
});
test('member-цель вычисляется заново для каждого ключа', () => {
  const factory = (events) => {
    const target = {
      set value(v) {
        events.push('set:' + v);
      },
    };
    return {
      base() {
        events.push('base');
        return target;
      },
      key() {
        events.push('key');
        return 'value';
      },
      rhs() {
        events.push('rhs');
        return { a: 1, b: 2 };
      },
    };
  };
  assert.deepEqual(
    compare('for(base()[key()] in rhs()){capture("body");}', factory).events,
    ['rhs', 'base', 'key', 'set:a', 'base', 'key', 'set:b'],
  );
});
test('пустой RHS не вычисляет member-цель', () => {
  const factory = (events) => ({
    base() {
      events.push('bad');
      throw Error('base');
    },
  });
  assert.deepEqual(
    compare('for(base().x in {})capture("bad");', factory).events,
    [],
  );
});
test('member-цель допускает изменение объекта и computed key из тела', () => {
  assert.deepEqual(
    compare(
      'var objects=[{},{}];var i=0;for(objects[i++].key in {a:1,b:2}){}capture(objects[0].key);capture(objects[1].key);capture(i);',
    ).values,
    ['a', 'b', 2],
  );
});
test('member-запись не читает старое значение', () => {
  const factory = (events) => ({
    target: {
      get x() {
        throw Error('read');
      },
      set x(v) {
        events.push(v);
      },
    },
  });
  assert.deepEqual(compare('for(target.x in {a:1,b:2}){}', factory).events, [
    'a',
    'b',
  ]);
});
test('строгая запись в readonly target вызывает TypeError, sloppy игнорирует', () => {
  const factory = () => ({ target: Object.freeze({ x: 0 }) });
  assert.equal(
    compare('"use strict";for(target.x in {a:1}){}', factory).error,
    'TypeError',
  );
  assert.deepEqual(
    compare('for(target.x in {a:1}){}capture(target.x);', factory).values,
    [0],
  );
});
test('null member-цель вычисляет ключ до ошибки записи', () => {
  const factory = (events) => ({
    key() {
      events.push('key');
      return 'x';
    },
  });
  const result = compare('for(null[key()] in {a:1}){}', factory);
  assert.equal(result.error, 'TypeError');
  assert.deepEqual(result.events, ['key']);
});
test('VM setter может выполнить вложенный цикл и вернуться к внешнему', () => {
  assert.deepEqual(
    compare(
      'var target={set x(v){for(var inner in {z:1})capture(v+inner);}};for(target.x in {a:1,b:2})capture("body");',
    ).values,
    ['az', 'body', 'bz', 'body'],
  );
});
test('legacy var initializer выполняется до RHS даже для пустого объекта', () => {
  const factory = (events) => ({
    init() {
      events.push('init');
      return 'seed';
    },
    rhs() {
      events.push('rhs');
      return {};
    },
  });
  const result = compare(
    'for(var k=init() in rhs())capture("bad");capture(k);',
    factory,
  );
  assert.deepEqual(result.events, ['init', 'rhs']);
  assert.deepEqual(result.values, ['seed']);
});
test('удаление ещё не посещённого свойства видно следующей итерации', () => {
  const factory = () => {
    const object = { a: 1, b: 2, c: 3 };
    return {
      object,
      remove() {
        delete object.b;
      },
    };
  };
  assert.deepEqual(
    compare('for(var k in object){capture(k);if(k==="a")remove();}', factory)
      .values,
    ['a', 'c'],
  );
});
test('изменения enumerable и прототипа повторяют native поведение движка', () => {
  const factory = () => {
    const prototype = { p: 1, q: 2 },
      object = Object.assign(Object.create(prototype), { a: 1, b: 2 });
    return {
      object,
      mutate() {
        Object.defineProperty(object, 'b', { enumerable: false });
        delete prototype.q;
        object.newKey = 1;
      },
    };
  };
  compare('for(var k in object){capture(k);if(k==="a")mutate();}', factory);
});
test('исключение перечисления Proxy сохраняется без подмены', () => {
  const error = Error('enumeration'),
    object = new Proxy(
      {},
      {
        ownKeys() {
          throw error;
        },
      },
    );
  assert.throws(
    () =>
      executeAssembly(compileToAssembly('for(var k in object){}'), {
        environment: { object },
      }),
    (e) => e === error,
  );
});
test('исключение RHS не запускает тело', () => {
  const factory = (events) => ({
    rhs() {
      events.push('rhs');
      throw RangeError('rhs');
    },
  });
  assert.deepEqual(compare('for(var k in rhs())capture("bad");', factory), {
    values: [],
    events: ['rhs'],
    error: 'RangeError',
  });
});
test('бесконечное тело for-in останавливается общим лимитом', () => {
  assert.throws(
    () =>
      executeAssembly(compileToAssembly('for(var k in {a:1})while(true){}'), {
        maxSteps: 100,
      }),
    /Instruction limit exceeded: 100/,
  );
});
test('компиляция не вычисляет RHS и возвращает текст новых инструкций', () => {
  const text = compileToAssembly('for(var k in mustNotRun()){}');
  assert.equal(typeof text, 'string');
  assert.match(text, /js\.for_in\.create/);
  assert.match(text, /js\.for_in\.next/);
});
test('повторные запуски изолированы и не создают глобальные var', () => {
  const environment = {
      capture(v) {
        values.push(v);
      },
    },
    values = [];
  const text = compileToAssembly('for(var k in {a:1,b:2})capture(k);');
  executeAssembly(text, { environment });
  executeAssembly(text, { environment });
  assert.deepEqual(values, ['a', 'b', 'a', 'b']);
  assert.equal(Object.hasOwn(environment, 'k'), false);
});
test('for-in let/const пока явно требуют нормализации', () => {
  for (const source of ['for(let k in {}){}', 'for(const k in {}){}'])
    assert.throws(
      () => compileToAssembly(source),
      /Lexical for-in bindings require normalization/,
    );
});
test('неразрешённая цель не становится неявной глобальной переменной', () => {
  assert.throws(
    () => compileToAssembly('for(unknown in {}){}'),
    /Assignment to unresolved identifier/,
  );
});
test('for-of и destructuring пока отклоняются даже в недостижимом коде', () => {
  for (const source of [
    'for(var k of []){}',
    'for(var [k] in {}){}',
    'for(({k}) in {}){}',
    'outer:for(var k of [])break outer;',
    'if(false){for(var k of []){}}',
  ])
    assert.throws(() => compileToAssembly(source), SyntaxError);
});
test('ошибка for-in сохраняет файл, строку и столбец', () => {
  assert.throws(
    () =>
      compileToAssembly('\nfor(let k in {}){}', { filename: 'enumerate.js' }),
    /enumerate\.js:2:5: Lexical for-in bindings/,
  );
});
test('неподдерживаемый код тела проверяется даже для пустого RHS', () => {
  assert.throws(
    () => compileToAssembly('for(var k in {}){x => x;}'),
    /Unsupported expression: ArrowFunctionExpression/,
  );
});
