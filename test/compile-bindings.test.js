import test from 'node:test';
import assert from 'node:assert/strict';
import { compileToAssembly } from '../src/compiler/compile-assembly.js';
import { executeAssembly } from '../src/runtime/execute-assembly.js';

function evaluateScript(source) {
  const lines = compileToAssembly(source).trim().split('\n');
  assert.deepEqual(lines.slice(-2), ['drop', 'halt']);
  return executeAssembly([...lines.slice(0, -2), 'return'].join('\n'), {
    environment: {},
  });
}
const run = (source) =>
  executeAssembly(compileToAssembly(source), { environment: {} });

test('компилирует объявление и чтение let', () =>
  assert.equal(evaluateScript('let value=42;value;'), 42));
test('компилирует объявление и чтение const', () =>
  assert.equal(evaluateScript('const value=42;value;'), 42));
test('let без инициализатора получает undefined', () =>
  assert.equal(evaluateScript('let value;value;'), undefined));
test('инициализаторы вычисляются в порядке объявления', () =>
  assert.equal(
    evaluateScript('let first=10,second=first+5;const result=second*2;result;'),
    30,
  ));
test('чтение до объявления выбрасывает ReferenceError при исполнении', () =>
  assert.throws(() => run('value;let value=42;'), ReferenceError));
test('переменная находится в TDZ внутри собственного инициализатора', () => {
  for (const source of [
    'let value=value;',
    'const value=value;',
    'let first=second,second=42;',
  ])
    assert.throws(() => run(source), ReferenceError);
});
test('внутреннее объявление затеняет внешнее с начала блока', () =>
  assert.throws(
    () => run('let value=10;{value;let value=20;}'),
    ReferenceError,
  ));
test('вложенный блок видит внешние переменные', () =>
  assert.equal(
    run('const value=42;{if(value===42){value+1;}else{1n+1;}}'),
    undefined,
  ));
test('затенение не изменяет внешнюю переменную', () =>
  assert.equal(
    evaluateScript(
      'let value=10;{const value=20;if(value===20){value;}else{1n+1;}}value;',
    ),
    10,
  ));
test('объявления не видны за пределами своего блока', () => {
  for (const source of [
    '{let hidden=42;}hidden;',
    '{let hidden=42;}{hidden;}',
  ]) {
    // Неизвестные имена теперь допустимы как внешние: ошибка возникает в VM.
    const text = compileToAssembly(source);
    assert.throws(
      () => executeAssembly(text, { environment: {} }),
      ReferenceError,
    );
  }
});
test('недостижимое чтение переменной в TDZ не выбрасывает исключение', () =>
  assert.equal(run('if(false){value;}let value=42;'), undefined));
test('var поддерживается, ненормализованная деструктуризация отклоняется', () => {
  assert.equal(evaluateScript('var value=42;value;'), 42);
  for (const source of [
    'let [value]=42;',
    'const {value}=42;',
    'var [value]=42;',
  ])
    assert.throws(() => compileToAssembly(source), SyntaxError);
});
test('простое присваивание изменяет let и возвращает значение', () => {
  assert.equal(evaluateScript('let value=10;value=20;value;'), 20);
  assert.equal(evaluateScript('let value;value=42;'), 42);
});
test('поддерживает цепочки присваиваний', () =>
  assert.equal(
    evaluateScript('let left;let right;left=right=7;left+right;'),
    14,
  ));
test('составные арифметические присваивания возвращают новое значение', () => {
  for (const [op, expected] of [
    ['+=', 13],
    ['-=', 7],
    ['*=', 30],
    ['/=', 10 / 3],
    ['%=', 1],
  ])
    assert.equal(evaluateScript(`let value=10;value ${op} 3;`), expected);
  assert.equal(evaluateScript('let value=10;value+=3;value;'), 13);
});
test('составное присваивание сохраняет JS-семантику значений', () => {
  assert.equal(evaluateScript('let value=1;value+="2";'), '12');
  assert.equal(evaluateScript('let value=2n;value*=3n;'), 6n);
});
test('составное присваивание читает старое значение до правой части', () => {
  assert.equal(evaluateScript('let value=10;value+=(value=3);'), 13);
  assert.equal(evaluateScript('let value=10;value-=(value=3);'), 7);
});
test('присваивание изменяет ближайшее доступное объявление', () => {
  assert.equal(evaluateScript('let value=10;{value=20;}value;'), 20);
  assert.equal(
    evaluateScript(
      'let value=10;{let value=20;value+=5;if(value===25){value;}else{1n+1;}}value;',
    ),
    10,
  );
});
test('присваивание проверяет TDZ при исполнении', () => {
  for (const source of [
    'value=42;let value;',
    'value+=1;let value;',
    'let value=(value=42);',
  ])
    assert.throws(() => run(source), ReferenceError);
});
test('присваивание в const выбрасывает ошибку только при выполнении', () => {
  for (const source of ['const value=10;value=20;', 'const value=10;value+=5;'])
    assert.throws(() => run(source), {
      name: 'TypeError',
      message: "Assignment to constant variable 'value'",
    });
  assert.equal(evaluateScript('const value=10;if(false){value=20;}value;'), 10);
});
test('порядок вычислений сохраняется при ошибках присваивания', () => {
  assert.throws(() => run('const value=10;value=other;let other;'), {
    name: 'ReferenceError',
    message: "Cannot access 'other' before initialization",
  });
  assert.throws(() => run('value+=(1n+1);let value;'), {
    name: 'ReferenceError',
    message: "Cannot access 'value' before initialization",
  });
});
test('отклоняет неподдерживаемые цели и операторы присваивания', () => {
  const cases = [
    ['unknown=42;', /Assignment to unresolved identifier/],
    ['[value]=source;', /Unsupported assignment target: ArrayPattern/],
    ['let value=2;value **=3;', /Unsupported assignment operator/],
    ['let value=0;value ||=3;', /Unsupported assignment operator/],
  ];
  for (const [source, error] of cases)
    assert.throws(() => compileToAssembly(source), error);
  // MemberExpression больше не является неподдерживаемой целью.
  const object = {};
  executeAssembly(compileToAssembly('object.value=42;'), {
    environment: { object },
  });
  assert.equal(object.value, 42);
});
