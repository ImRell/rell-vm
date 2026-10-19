import test from 'node:test';
import assert from 'node:assert/strict';
import { compare } from './es5-test-helpers.js';
import { compileToAssembly } from '../src/compiler/compile-assembly.js';
import { executeAssembly } from '../src/runtime/execute-assembly.js';

for (const operator of [
  '+',
  '-',
  '*',
  '/',
  '%',
  '<',
  '<=',
  '>',
  '>=',
  '&',
  '|',
  '^',
  '<<',
  '>>',
  '>>>',
  '==',
  '!=',
]) {
  test('VM valueOf в операторе ' + operator, () => {
    compare(
      `var left={valueOf:function(){capture('L');return 9;}};var right={valueOf:function(){capture('R');return 2;}};capture(left ${operator} right);`,
    );
  });
  test('native conversion и порядок исходных операндов ' + operator, () => {
    const factory = (events) => ({
      left: {
        valueOf() {
          events.push('L');
          return 9;
        },
      },
      right: {
        valueOf() {
          events.push('R');
          return 2;
        },
      },
    });
    compare(`capture(left ${operator} right);`, factory);
  });
}
for (const op of ['+', '-', '~'])
  test('VM conversion в unary ' + op, () => {
    assert.deepEqual(
      compare(
        `var o={valueOf:function(){capture('valueOf');return '7';}};capture(${op}o);`,
      ).values.slice(0, 1),
      ['valueOf'],
    );
  });
test('object/object == и != не вызывают conversion', () => {
  assert.deepEqual(
    compare(
      'var o={valueOf:function(){throw "bad";}};capture(o==o);capture(o!={});capture(o==null);capture(o==undefined);',
    ).values,
    [true, true, false, false],
  );
});
test('loose equality object/primitive вызывает VM valueOf с default hint', () => {
  assert.deepEqual(
    compare(
      'var o={valueOf:function(){capture("valueOf");return 2;}};capture(o=="2");capture("2"==o);capture(o==true);',
    ).values,
    ['valueOf', true, 'valueOf', true, 'valueOf', false],
  );
});
test('fallback VM toString выполняется после valueOf с object result', () => {
  assert.deepEqual(
    compare(
      'var o={valueOf:function(){capture("v");return {};},toString:function(){capture("s");return "6";}};capture(o*2);',
    ).values,
    ['v', 's', 12],
  );
});
test('VM valueOf/toString, возвращающие objects, дают TypeError', () => {
  assert.equal(
    compare(
      'var o={valueOf:function(){return {};},toString:function(){return {};}};capture(+o);',
    ).error.name,
    'TypeError',
  );
});
test('conversion может создать функцию и выполнить вложенный switch', () => {
  assert.deepEqual(
    compare(
      'var o={valueOf:function(){function f(n){switch(n){case 1:return 7;default:return 0;}}return f(1);}};capture(o+2);capture(3);',
    ).values,
    [9, 3],
  );
});
test('вложенные операции конверсии не повреждают стек вызывающего кадра', () => {
  assert.deepEqual(
    compare(
      'var inner={valueOf:function(){return 2;}};var outer={valueOf:function(){return inner*3;}};function f(a){return a+outer*4;}capture(f(100));',
    ).values,
    [124],
  );
});
test('операнды вычисляются до conversion, затем original left before right', () => {
  const factory = (events) => ({
    left() {
      events.push('eval L');
      return {
        valueOf() {
          events.push('conv L');
          return 3;
        },
      };
    },
    right() {
      events.push('eval R');
      return {
        valueOf() {
          events.push('conv R');
          return 2;
        },
      };
    },
  });
  assert.deepEqual(compare('capture(left()>right());', factory).events, [
    'eval L',
    'eval R',
    'conv L',
    'conv R',
  ]);
});
test('ошибка conversion слева не вызывает conversion справа', () => {
  const factory = (events) => ({
    left: {
      valueOf() {
        events.push('L');
        throw RangeError('bad');
      },
    },
    right: {
      valueOf() {
        events.push('R');
        return 2;
      },
    },
  });
  assert.deepEqual(compare('capture(left-right);', factory).events, ['L']);
});
test('Symbol.toPrimitive VM получает default/number/string hints', () => {
  assert.deepEqual(
    compare(
      'var o={};o[Symbol.toPrimitive]=function(hint){capture(hint);return 2;};capture(o+1);capture(o<3);capture(o|1);capture(o==2);capture(o in {2:true});',
    ).values,
    [
      'default',
      3,
      'number',
      true,
      'number',
      3,
      'default',
      true,
      'string',
      true,
    ],
  );
});
test('native Date сохраняет default string hint и числовое сравнение', () => {
  compare('capture(value+1);capture(value-1);capture(value<100);', () => ({
    value: new Date(0),
  }));
});
test('сравнения строк лексикографические, NaN не даёт ложных >=', () => {
  assert.deepEqual(
    compare('capture("10"<"2");capture(NaN<1);capture(NaN>=1);capture(1<=NaN);')
      .values,
    [true, false, false, false],
  );
});
test('bigint/string relational не превращает всё заранее в Number', () => {
  compare(
    'capture(9007199254740993n>"9007199254740992");capture(1n<"not-number");capture(1n=="1");',
  );
});
test('пользовательское исключение VM valueOf распространяется без замены', () => {
  const error = { marker: true };
  assert.throws(
    () =>
      executeAssembly(
        compileToAssembly('var o={valueOf:function(){throw error;}};o+1;'),
        { environment: { error } },
      ),
    (e) => e === error,
  );
});
test('общий лимит ограничивает циклы внутри conversion callbacks', () => {
  assert.throws(
    () =>
      executeAssembly(
        compileToAssembly('var o={valueOf:function(){while(true){}}};o+1;'),
        { maxSteps: 100 },
      ),
    /Instruction limit exceeded: 100/,
  );
});
test('повторный запуск после ошибки не использует старые frames', () => {
  const text = compileToAssembly('var o={valueOf:function(){throw 7;}};o*2;');
  for (let n = 0; n < 2; n++)
    assert.throws(
      () => executeAssembly(text),
      (e) => e === 7,
    );
  assert.equal(executeAssembly('js.const 42\nreturn'), 42);
});
