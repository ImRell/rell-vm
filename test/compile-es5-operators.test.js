import test from 'node:test';
import assert from 'node:assert/strict';
import { compileToAssembly } from '../src/compiler/compile-assembly.js';
import { executeAssembly } from '../src/runtime/execute-assembly.js';
import { compare } from './es5-test-helpers.js';
const cases = [
  [
    '==',
    'capture(1=="1");capture(null==undefined);capture(false=="0");capture(NaN==NaN);',
    [true, true, true, false],
  ],
  [
    '!=',
    'capture(1!="1");capture(null!=0);capture(false!="0");',
    [false, true, false],
  ],
  [
    '!==',
    'capture(1!=="1");capture(NaN!==NaN);capture(-0!==0);',
    [true, true, false],
  ],
  ['&', 'capture(6&3);capture(-1&255);capture(4294967297&3);', [2, 255, 1]],
  ['|', 'capture(4|3);capture(NaN|5);capture(1.9|2.9);', [7, 5, 3]],
  ['^', 'capture(6^3);capture(-1^255);', [5, -256]],
  ['<<', 'capture(1<<3);capture(1<<33);capture(1<<-1);', [8, 2, -2147483648]],
  ['>>', 'capture(-8>>2);capture(4294967295>>1);', [-2, -1]],
  [
    '>>>',
    'capture(-1>>>0);capture(-8>>>2);capture(1>>>33);',
    [4294967295, 1073741822, 0],
  ],
  [
    'unary +',
    'capture(+"42");capture(+null);capture(+undefined);capture(+true);',
    [42, 0, NaN, 1],
  ],
  ['unary ~', 'capture(~0);capture(~-1);capture(~"2");', [-1, 0, -3]],
  [
    'void',
    'capture(void 123);capture(void missingCall());',
    [undefined, undefined],
  ],
  [
    'in',
    'var o={__proto__:{p:1},x:undefined};capture("x" in o);capture("p" in o);capture("no" in o);',
    [true, true, false],
  ],
  [
    'instanceof native',
    'capture([] instanceof Array);capture({} instanceof Object);capture(1 instanceof Number);',
    [true, true, false],
  ],
  [
    'operator precedence',
    'capture(1+2<<2);capture(1|2&4);capture(4>>>1+1);capture(1=="1"&&2!=="2");',
    [12, 1, 1, true],
  ],
  [
    'short circuit',
    'capture(false&&(1==bad()));capture(true||(1&bad()));',
    [false, true],
  ],
];
for (const [name, source, expected] of cases)
  test('оператор ' + name, () => {
    const factory = (events) => ({
      missingCall() {
        events.push('call');
        return 7;
      },
    });
    assert.deepEqual(compare(source, factory).values, expected);
  });
for (const operator of ['&=', '|=', '^=', '<<=', '>>=', '>>>=']) {
  test('составное присваивание ' + operator + ' переменной', () => {
    compare(`var x=12;capture(x ${operator} 2);capture(x);`);
  });
  test(
    'составное присваивание ' +
      operator +
      ' свойства и порядок getter/RHS/setter',
    () => {
      const factory = (events) => {
        let value = 12;
        return {
          object: {
            get x() {
              events.push('get');
              return value;
            },
            set x(v) {
              events.push('set:' + v);
              value = v;
            },
          },
          rhs() {
            events.push('rhs');
            return 2;
          },
        };
      };
      compare(
        `capture(object.x ${operator} rhs());capture(object.x);`,
        factory,
      );
    },
  );
}
test('составное присваивание читает старое значение до RHS', () => {
  assert.deepEqual(
    compare('var x=8;capture(x<<=(x=2));capture(x);').values,
    [32, 32],
  );
});
test('составное присваивание const сохраняет runtime-ошибку', () => {
  assert.equal(compare('const x=4;x|=1;').error.name, 'TypeError');
});
test('составное присваивание TDZ проверяется до RHS', () => {
  assert.equal(compare('x&=bad();let x;').error.name, 'ReferenceError');
});
test('операции BigInt сохраняют расширение существующего формата', () => {
  compare(
    'capture(6n&3n);capture(2n<<3n);capture(~2n);capture(2n=="2");capture(2n===2);',
  );
});
test('>>> с BigInt, unary+ BigInt и смешанная арифметика бросают', () => {
  for (const expr of ['1n>>>0n', '+1n', '1n&1', '1n-1'])
    assert.equal(compare(`capture(${expr});`).error.name, 'TypeError');
});
test('Symbol не приводится к числу неявно', () => {
  for (const expr of ['+symbol', 'symbol|0', 'symbol+"x"', '-symbol'])
    assert.equal(
      compare(`capture(${expr});`, () => ({ symbol: Symbol('s') })).error.name,
      'TypeError',
    );
});
test('in принимает Symbol key без строкового преобразования', () => {
  compare('capture(key in object);', () => {
    const key = Symbol('x');
    return { key, object: { [key]: 1 } };
  });
});
test('in проверяет тип RHS до key coercion', () => {
  const factory = (events) => ({
    key: {
      toString() {
        events.push('key');
        return 'x';
      },
    },
  });
  const result = compare('capture(key in null);', factory);
  assert.equal(result.error.name, 'TypeError');
  assert.deepEqual(result.events, []);
});
test('in преобразует VM-ключ через string hint', () => {
  assert.deepEqual(
    compare(
      'var k={toString:function(){capture("key");return "x";}};capture(k in {x:1});',
    ).values,
    ['key', true],
  );
});
test('instanceof проверяет обычные внешние конструкторы и custom hasInstance', () => {
  compare('capture(object instanceof Constructor);', () => {
    function Constructor() {}
    return { Constructor, object: Object.create(Constructor.prototype) };
  });
  compare('capture(7 instanceof Constructor);', (events) => ({
    Constructor: {
      [Symbol.hasInstance](v) {
        events.push(v);
        return v === 7;
      },
    },
  }));
});
test('instanceof некорректного RHS сохраняет native TypeError', () => {
  for (const rhs of ['null', '1', '{}'])
    assert.equal(
      compare(`capture({} instanceof ${rhs});`).error.name,
      'TypeError',
    );
});
test('instanceof VM-конструктора использует его prototype', () => {
  const values = [];
  executeAssembly(
    compileToAssembly(
      'function C(){};var o=new C();capture(o instanceof C);capture({} instanceof C);C.prototype={};capture(o instanceof C);',
    ),
    {
      environment: {
        capture(v) {
          values.push(v);
        },
      },
    },
  );
  assert.deepEqual(values, [true, false, false]);
});
test('новые операторы не включают современный неподдержанный синтаксис', () => {
  for (const source of [
    'capture(2**3);',
    'var x=0;x||=1;',
    'capture(null??1);',
  ])
    assert.throws(() => compileToAssembly(source), SyntaxError);
});
test('операторы дают строку собственных инструкций', () => {
  const text = compileToAssembly('var x=1;x<<=2;capture(x!=2);capture(+x);');
  for (const op of ['js.shl', 'js.ne', 'js.pos']) assert.ok(text.includes(op));
});
