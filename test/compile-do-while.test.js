import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { compileToAssembly } from '../src/compiler/compile-assembly.js';
import { executeAssembly } from '../src/runtime/execute-assembly.js';
function compare(source, factory = () => ({})) {
  function outcome(native) {
    const values = [],
      events = [];
    let error;
    const environment = {
      Object,
      undefined,
      NaN,
      ...factory(events),
      capture(v) {
        values.push(v);
      },
    };
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
  const actual = outcome(false);
  assert.deepEqual(actual, outcome(true));
  return actual;
}
test('do while false исполняет тело один раз', () => {
  assert.deepEqual(
    compare('var n=0;do{n++;}while(false);capture(n);').values,
    [1],
  );
});
test('do while повторяет тело до ложного условия', () => {
  compare('var i=0,sum=0;do{sum+=i++;}while(i<4);capture(sum);capture(i);');
});
test('body предшествует каждому test', () => {
  const factory = (events) => {
    let n = 0;
    return {
      body() {
        events.push('body:' + n);
        n++;
      },
      condition() {
        events.push('test:' + n);
        return n < 2;
      },
    };
  };
  assert.deepEqual(compare('do{body();}while(condition());', factory).events, [
    'body:0',
    'test:1',
    'body:1',
    'test:2',
  ]);
});
test('continue переходит к условию, не к началу тела', () => {
  compare('var i=0;do{i++;continue;}while(i<3);capture(i);');
});
test('continue при ложном условии завершает цикл', () => {
  compare('var i=0;do{i++;continue;}while(false);capture(i);');
});
test('break пропускает условие', () => {
  compare('var i=0;do{i++;break;}while(missing());capture(i);');
});
test('do while без фигурных скобок', () => {
  compare('var i=0;do i++;while(i<3);capture(i);');
});
test('do while с пустым телом', () => {
  compare('var i=0;do;while(i++<2);capture(i);');
});
test('условие использует truthiness', () => {
  for (const condition of ['false', '0', '""', 'null', 'undefined', 'NaN'])
    assert.deepEqual(
      compare(`var n=0;do{n++;}while(${condition});capture(n);`).values,
      [1],
    );
  for (const condition of ['true', '1', '"text"', '[]', '{}'])
    assert.deepEqual(
      compare(`var n=0;do{n++;if(n===2)break;}while(${condition});capture(n);`)
        .values,
      [2],
    );
});
test('var body поднят до первой итерации', () => {
  compare('capture(value);do{var value=42;}while(false);capture(value);');
});
test('var из недостижимого do while тоже объявлен', () => {
  compare('if(false){do{var hidden=42;}while(false);}capture(hidden);');
});
test('возврат пропускает condition', () => {
  compare('function f(){do{return 42;}while(missing());}capture(f());');
});
test('исключение в body пропускает condition и сохраняет идентичность', () => {
  const error = {},
    events = [];
  assert.throws(
    () =>
      executeAssembly(compileToAssembly('do{bad();}while(check());'), {
        environment: {
          bad() {
            throw error;
          },
          check() {
            events.push('test');
            return false;
          },
        },
      }),
    (e) => e === error,
  );
  assert.deepEqual(events, []);
});
test('исключение в condition идёт после body', () => {
  const error = {},
    events = [];
  assert.throws(
    () =>
      executeAssembly(compileToAssembly('do{body();}while(bad());'), {
        environment: {
          body() {
            events.push('body');
          },
          bad() {
            throw error;
          },
        },
      }),
    (e) => e === error,
  );
  assert.deepEqual(events, ['body']);
});
test('comma в do condition выполняет все выражения', () => {
  compare(
    'var i=0,count=0;do{i++;}while(count++,i<3);capture(count);capture(i);',
  );
});
test('do while внутри функции может работать с arguments', () => {
  compare(
    'function f(a){do{arguments[0]++;}while(a<3);return a;}capture(f(0));',
  );
});
test('do while внутри getter использует правильный frame', () => {
  compare(
    'var o={get x(){var n=0;do{n++;}while(n<3);return n;}};capture(100+o.x);',
  );
});
test('бесконечный do while останавливается общим лимитом', () => {
  for (const source of ['do{}while(true);', 'do{continue;}while(true);'])
    assert.throws(
      () => executeAssembly(compileToAssembly(source), { maxSteps: 100 }),
      /Instruction limit exceeded: 100/,
    );
});
test('синтаксис condition проверяется даже после безусловного break', () => {
  assert.throws(
    () => compileToAssembly('do{break;}while(x => x);'),
    /Unsupported expression: ArrowFunctionExpression/,
  );
});
test('компиляция do while не выполняет body и condition', () => {
  assert.equal(
    typeof compileToAssembly('do{missing();}while(other());'),
    'string',
  );
});
