import test from 'node:test';
import assert from 'node:assert/strict';
import { compileToAssembly } from '../src/compiler/compile-assembly.js';
import { executeAssembly } from './es5-test-helpers.js';
import { compare } from './es5-test-helpers.js';
const cases = [
  ['empty switch', 'switch(10){}capture(42);', [42]],
  [
    'matching case',
    'switch(2){case 1:capture(1);break;case 2:capture(2);break;default:capture(3);}',
    [2],
  ],
  [
    'default when no match',
    'switch(9){case 1:capture(1);break;default:capture("default");}',
    ['default'],
  ],
  [
    'no default skips body',
    'switch(9){case 1:capture(1);}capture(2);',
    [2],
  ],
  [
    'fall-through between cases',
    'switch(1){case 1:capture(1);case 2:capture(2);case 3:capture(3);}',
    [1, 2, 3],
  ],
  [
    'fall-through through default',
    'switch(1){case 1:capture(1);default:capture(0);case 2:capture(2);}',
    [1, 0, 2],
  ],
  [
    'default at beginning does not prevent late match',
    'switch(2){default:capture(0);case 1:capture(1);break;case 2:capture(2);}',
    [2],
  ],
  [
    'default in middle when no match',
    'switch(9){case 1:capture(1);default:capture(0);case 2:capture(2);}',
    [0, 2],
  ],
  [
    'strict equality without coercion',
    'switch("1"){case 1:capture("bad");break;case "1":capture("ok");}',
    ['ok'],
  ],
  [
    'NaN does not match NaN',
    'switch(NaN){case NaN:capture("bad");break;default:capture("ok");}',
    ['ok'],
  ],
  ['-0 matches 0', 'switch(-0){case 0:capture("ok");}', ['ok']],
  [
    'case object compares identity',
    'var o={};switch(o){case {}:capture("bad");break;case o:capture("ok");}',
    ['ok'],
  ],
  [
    'empty cases merge branches',
    'switch(2){case 1:case 2:case 3:capture(42);break;}',
    [42],
  ],
  [
    'duplicate cases select the first',
    'switch(1){case 1:capture("first");break;case 1:capture("second");}',
    ['first'],
  ],
  [
    'var hoists from all cases',
    'capture(x);switch(0){case 1:var x=10;}capture(x);',
    [undefined, undefined],
  ],
  [
    'unselected var initializer does not execute',
    'var x=4;switch(0){case 1:var x=bad();}capture(x);',
    [4],
  ],
  [
    'return from case returns function result',
    'function f(n){switch(n){case 1:return 7;default:return 9;}}capture(f(1));capture(f(8));',
    [7, 9],
  ],
  [
    'nested switch break targets nearest switch',
    'switch(1){case 1:switch(2){case 2:capture(2);break;}capture(1);break;default:capture(0);}',
    [2, 1],
  ],
  [
    'switch inside for, continue targets for',
    'for(var i=0;i<4;i++){switch(i){case 1:continue;case 2:capture("two");break;default:capture(i);}capture("tail");}',
    [0, 'tail', 'two', 'tail', 3, 'tail'],
  ],
  [
    'switch break does not terminate while',
    'var n=0;while(n<2){switch(n++){case 0:break;default:capture(1);}capture(n);}',
    [1, 1, 2],
  ],
  [
    'loop break inside case does not terminate switch',
    'switch(1){case 1:while(true){capture(2);break;}capture(3);break;}',
    [2, 3],
  ],
  [
    'after nested loop break again terminates switch',
    'switch(1){case 1:for(var i=0;i<1;i++){}break;default:capture("bad");}capture("ok");',
    ['ok'],
  ],
  [
    'outer break restored after switch',
    'for(var i=0;i<3;i++){switch(i){default:break;}capture(i);break;}',
    [0],
  ],
  [
    'recursive switches do not share local slots',
    'function f(n){switch(n){case 0:return 1;case 1:return f(0)+2;default:return f(1)+4;}}capture(f(2));',
    [7],
  ],
  [
    'coexists with for-in without temp slot conflicts',
    'for(var k in {a:1,b:2})switch(k){case "a":capture(k);continue;default:capture(k);break;}capture(k);',
    ['a', 'b', 'b'],
  ],
  [
    'lexical declarations across cases share same scope',
    'switch(1){case 1:let x=42;case 2:capture(x);break;}',
    [42],
  ],
  [
    'discriminant sees outer name before entering lexical scope',
    'let x=1;switch(x){case 1:let x=2;capture(x);}capture(x);',
    [2, 1],
  ],
  [
    'break exits nested lexical block and switch',
    'let x=1;switch(2){case 2:let x=2;{let y=3;break;}}capture(x);',
    [1],
  ],
  [
    'continue pops switch lexical scope before for update',
    'let outer=10;for(var i=0;i<2;i++){switch(i){case 0:let local=20;continue;default:capture(outer);}}capture(outer);',
    [10, 10],
  ],
  [
    'closure retains case binding after break',
    'var f;switch(1){case 1:let x=42;f=function(){return x;};break;}capture(f());',
    [42],
  ],
  [
    'new switch creates new lexical environment',
    'var a=[];for(var i=0;i<2;i++){switch(i){default:let x=i;a[i]=function(){return x;};}}capture(a[0]());capture(a[1]());',
    [0, 1],
  ],
  [
    'switch without block braces in do-while body',
    'var n=0;do switch(n++){case 0:continue;default:break;}while(n<2);capture(n);',
    [2],
  ],
  [
    'case with throw does not fall through',
    'switch(1){case 1:throw "stop";case 2:capture("bad");}',
    [],
  ],
  [
    'debugger inside case does not alter control flow',
    'switch(1){case 1:debugger;capture(42);break;}',
    [42],
  ],
];
for (const [name, source, expected] of cases)
  test(name, () => {
    assert.deepEqual(compare(source).values, expected);
  });

test('discriminant evaluates once, case tests only up to first match', () => {
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
test('default is selected only after testing cases below it', () => {
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
test('case tests share TDZ of entire case block', () => {
  assert.equal(
    compare('let x=1;switch(1){case x:break;default:let x=2;}').error.name,
    'ReferenceError',
  );
});
test('jumping directly to later case does not initialize preceding let', () => {
  assert.equal(
    compare('switch(2){case 1:let x=42;case 2:capture(x);}').error.name,
    'ReferenceError',
  );
});
test('case expression does not invoke valueOf on discriminant', () => {
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
test('case expression error preserves original exception', () => {
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
test('step limit is shared across switch and VM calls in case tests', () => {
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
test('unreachable case still validates unsupported syntax', () => {
  assert.throws(
    () => compileToAssembly('switch(0){case 1:x => x;}'),
    /Unsupported expression: ArrowFunctionExpression/,
  );
});
test('Annex B functions in case are explicitly rejected', () => {
  assert.throws(
    () => compileToAssembly('switch(1){case 1:function f(){}}'),
    /Block-level function declarations/,
  );
});
test('switch errors preserve filename and position', () => {
  assert.throws(
    () =>
      compileToAssembly('switch(1){\ncase 1: x => x;}', {
        filename: 'switch.js',
      }),
    /switch\.js:2:9: Unsupported expression/,
  );
});
