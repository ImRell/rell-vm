import test from 'node:test';
import assert from 'node:assert/strict';
import { compileToAssembly } from '../src/compiler/compile-assembly.js';
import { executeAssembly } from '../src/runtime/execute-assembly.js';
import { compare } from './es5-test-helpers.js';
const cases = [
  ['пустой switch', 'switch(10){}capture(42);', [42]],
  [
    'совпавший case',
    'switch(2){case 1:capture(1);break;case 2:capture(2);break;default:capture(3);}',
    [2],
  ],
  [
    'default при отсутствии совпадения',
    'switch(9){case 1:capture(1);break;default:capture("default");}',
    ['default'],
  ],
  [
    'без default пропускает тело',
    'switch(9){case 1:capture(1);}capture(2);',
    [2],
  ],
  [
    'fall-through между case',
    'switch(1){case 1:capture(1);case 2:capture(2);case 3:capture(3);}',
    [1, 2, 3],
  ],
  [
    'fall-through через default',
    'switch(1){case 1:capture(1);default:capture(0);case 2:capture(2);}',
    [1, 0, 2],
  ],
  [
    'default в начале не мешает позднему совпадению',
    'switch(2){default:capture(0);case 1:capture(1);break;case 2:capture(2);}',
    [2],
  ],
  [
    'default в середине при отсутствии совпадения',
    'switch(9){case 1:capture(1);default:capture(0);case 2:capture(2);}',
    [0, 2],
  ],
  [
    'строгое сравнение без coercion',
    'switch("1"){case 1:capture("bad");break;case "1":capture("ok");}',
    ['ok'],
  ],
  [
    'NaN не совпадает с NaN',
    'switch(NaN){case NaN:capture("bad");break;default:capture("ok");}',
    ['ok'],
  ],
  ['-0 совпадает с 0', 'switch(-0){case 0:capture("ok");}', ['ok']],
  [
    'case object сравнивает идентичность',
    'var o={};switch(o){case {}:capture("bad");break;case o:capture("ok");}',
    ['ok'],
  ],
  [
    'пустые case объединяют ветки',
    'switch(2){case 1:case 2:case 3:capture(42);break;}',
    [42],
  ],
  [
    'повторные case выбирают первый',
    'switch(1){case 1:capture("first");break;case 1:capture("second");}',
    ['first'],
  ],
  [
    'var поднимается из всех case',
    'capture(x);switch(0){case 1:var x=10;}capture(x);',
    [undefined, undefined],
  ],
  [
    'невыбранный initializer var не выполняется',
    'var x=4;switch(0){case 1:var x=bad();}capture(x);',
    [4],
  ],
  [
    'return из case возвращает результат функции',
    'function f(n){switch(n){case 1:return 7;default:return 9;}}capture(f(1));capture(f(8));',
    [7, 9],
  ],
  [
    'вложенный switch break относится к ближайшему switch',
    'switch(1){case 1:switch(2){case 2:capture(2);break;}capture(1);break;default:capture(0);}',
    [2, 1],
  ],
  [
    'switch внутри for, continue относится к for',
    'for(var i=0;i<4;i++){switch(i){case 1:continue;case 2:capture("two");break;default:capture(i);}capture("tail");}',
    [0, 'tail', 'two', 'tail', 3, 'tail'],
  ],
  [
    'break switch не завершает while',
    'var n=0;while(n<2){switch(n++){case 0:break;default:capture(1);}capture(n);}',
    [1, 1, 2],
  ],
  [
    'break цикла внутри case не завершает switch',
    'switch(1){case 1:while(true){capture(2);break;}capture(3);break;}',
    [2, 3],
  ],
  [
    'после вложенного цикла break снова завершает switch',
    'switch(1){case 1:for(var i=0;i<1;i++){}break;default:capture("bad");}capture("ok");',
    ['ok'],
  ],
  [
    'после switch восстанавливается внешний break',
    'for(var i=0;i<3;i++){switch(i){default:break;}capture(i);break;}',
    [0],
  ],
  [
    'рекурсивные switch не делят local-слоты',
    'function f(n){switch(n){case 0:return 1;case 1:return f(0)+2;default:return f(1)+4;}}capture(f(2));',
    [7],
  ],
  [
    'совмещается с for-in без конфликтов временных слотов',
    'for(var k in {a:1,b:2})switch(k){case "a":capture(k);continue;default:capture(k);break;}capture(k);',
    ['a', 'b', 'b'],
  ],
  [
    'лексические объявления case разделяют одну область',
    'switch(1){case 1:let x=42;case 2:capture(x);break;}',
    [42],
  ],
  [
    'discriminant видит внешнее имя до входа в lexical scope',
    'let x=1;switch(x){case 1:let x=2;capture(x);}capture(x);',
    [2, 1],
  ],
  [
    'break выходит из вложенного lexical блока и switch',
    'let x=1;switch(2){case 2:let x=2;{let y=3;break;}}capture(x);',
    [1],
  ],
  [
    'continue снимает lexical scope switch перед for update',
    'let outer=10;for(var i=0;i<2;i++){switch(i){case 0:let local=20;continue;default:capture(outer);}}capture(outer);',
    [10, 10],
  ],
  [
    'замыкание удерживает case-ячейку после break',
    'var f;switch(1){case 1:let x=42;f=function(){return x;};break;}capture(f());',
    [42],
  ],
  [
    'новый switch создаёт новое lexical окружение',
    'var a=[];for(var i=0;i<2;i++){switch(i){default:let x=i;a[i]=function(){return x;};}}capture(a[0]());capture(a[1]());',
    [0, 1],
  ],
  [
    'switch без фигурных блоков в теле do-while',
    'var n=0;do switch(n++){case 0:continue;default:break;}while(n<2);capture(n);',
    [2],
  ],
  [
    'case с throw не выполняет fall-through',
    'switch(1){case 1:throw "stop";case 2:capture("bad");}',
    [],
  ],
  [
    'debugger внутри case не меняет управление',
    'switch(1){case 1:debugger;capture(42);break;}',
    [42],
  ],
];
for (const [name, source, expected] of cases)
  test(name, () => {
    assert.deepEqual(compare(source).values, expected);
  });

test('discriminant вычисляется один раз, case tests только до первого match', () => {
  const factory = (events) => ({
    value() {
      events.push('value');
      return 2;
    },
    key(v) {
      events.push('key:' + v);
      return v;
    },
  });
  assert.deepEqual(
    compare(
      'switch(value()){case key(1):break;case key(2):capture(2);case key(3):capture(3);}',
      factory,
    ).events,
    ['value', 'key:1', 'key:2'],
  );
});
test('default выбирается только после проверок case после него', () => {
  const factory = (events) => ({
    key(v) {
      events.push(v);
      return v;
    },
  });
  assert.deepEqual(
    compare(
      'switch(9){case key(1):break;default:capture(0);break;case key(2):break;}',
      factory,
    ).events,
    [1, 2],
  );
});
test('case tests разделяют TDZ всего case block', () => {
  assert.equal(
    compare('let x=1;switch(1){case x:break;default:let x=2;}').error.name,
    'ReferenceError',
  );
});
test('переход сразу к позднему case не инициализирует предыдущий let', () => {
  assert.equal(
    compare('switch(2){case 1:let x=42;case 2:capture(x);}').error.name,
    'ReferenceError',
  );
});
test('case expression не вызывает valueOf discriminant', () => {
  const factory = (events) => ({
    object: {
      valueOf() {
        events.push('coerce');
        return 1;
      },
    },
  });
  const result = compare(
    'switch(object){case 1:capture("bad");break;default:capture("ok");}',
    factory,
  );
  assert.deepEqual(result.values, ['ok']);
  assert.deepEqual(result.events, []);
});
test('ошибка case expression сохраняет исходное исключение', () => {
  const error = Error('case');
  assert.throws(
    () =>
      executeAssembly(compileToAssembly('switch(1){case bad():break;}'), {
        environment: {
          bad() {
            throw error;
          },
        },
      }),
    (e) => e === error,
  );
});
test('лимит общий для switch и VM-вызовов case tests', () => {
  assert.throws(
    () =>
      executeAssembly(
        compileToAssembly(
          'function f(){while(true){}}switch(1){case f():break;}',
        ),
        { maxSteps: 100 },
      ),
    /Instruction limit exceeded: 100/,
  );
});
test('недостижимый case всё равно проверяет неподдержанный синтаксис', () => {
  assert.throws(
    () => compileToAssembly('switch(0){case 1:x => x;}'),
    /Unsupported expression: ArrowFunctionExpression/,
  );
});
test('Annex B функции в case пока отклоняются явно', () => {
  assert.throws(
    () => compileToAssembly('switch(1){case 1:function f(){}}'),
    /Block-level function declarations/,
  );
});
test('ошибки switch сохраняют filename и позицию', () => {
  assert.throws(
    () =>
      compileToAssembly('switch(1){\ncase 1: x => x;}', {
        filename: 'switch.js',
      }),
    /switch\.js:2:9: Unsupported expression/,
  );
});
