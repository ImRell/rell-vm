import test from 'node:test';
import assert from 'node:assert/strict';
import { compileToAssembly } from '../src/compiler/compile-assembly.js';
import { executeAssembly } from '../src/runtime/execute-assembly.js';
import { parseAssembly } from '../src/assembly/parse.js';

function evaluate(source) {
  const text = compileToAssembly(source),
    suffix = 'drop\nhalt\n';
  assert.ok(text.endsWith(suffix));
  return executeAssembly(text.slice(0, -suffix.length) + 'return\n', {
    environment: {},
    maxSteps: 100000,
  });
}
test('компилятор возвращает текст инструкций, а не объект байткода', () => {
  const text = compileToAssembly('42;');
  assert.equal(typeof text, 'string');
  assert.match(text, /js\.const 42/);
  assert.equal(parseAssembly(text).instructions.length, 3);
  assert.throws(
    () => executeAssembly({ code: [1, 2, 3], constants: [] }),
    TypeError,
  );
});
test('компилирует литералы, арифметику и сравнения', () => {
  for (const [source, value] of [
    ['2+3*4;', 14],
    ['"a"+"b";', 'ab'],
    ['2n+3n;', 5n],
    ['3<=4;', true],
    ['!0;', true],
  ])
    assert.equal(evaluate(source), value);
});
test('компилирует переменные, присваивания и затенение', () => {
  assert.equal(evaluate('var x=10;{let x=20;x++;}x+=2;x;'), 12);
});
test('сохраняет TDZ, в том числе при затенении', () => {
  for (const source of ['x;let x=42;', 'let x=10;{x;let x=20;}'])
    assert.throws(
      () =>
        executeAssembly(compileToAssembly(source), { environment: { x: 100 } }),
      ReferenceError,
    );
});
test('проверяет const во время исполнения и сохраняет порядок ошибок', () => {
  assert.throws(
    () => executeAssembly(compileToAssembly('const x=10;x=20;')),
    TypeError,
  );
  assert.throws(
    () => executeAssembly(compileToAssembly('const x=10;x=other;let other;')),
    {
      name: 'ReferenceError',
      message: "Cannot access 'other' before initialization",
    },
  );
  assert.equal(evaluate('const x=10;if(false){x=20;}x;'), 10);
});
test('сохраняет короткое замыкание и выбор веток', () => {
  assert.equal(evaluate('false&&(1n+1);'), false);
  assert.equal(evaluate('true||(1n+1);'), true);
  assert.equal(evaluate('true?42:(1n+1);'), 42);
});
test('компилирует while/for/do и управление ими в именованные переходы', () => {
  const text = compileToAssembly(
    'var n=0;for(var i=0;i<3;i++){if(i===1)continue;n+=i;}do{n++;}while(n<4);while(true){break;}n;',
  );
  assert.match(text, /label L[0-9]+/);
  assert.match(text, /jump_if_false L[0-9]+/);
  assert.equal(
    evaluate(
      'var n=0;for(var i=0;i<3;i++){if(i===1)continue;n+=i;}do{n++;}while(n<4);while(true){break;}n;',
    ),
    4,
  );
});
test('неподдерживаемый синтаксис не пропускается', () => {
  for (const source of [
    'x => x;',
    'with({}){}',
    'for(var key of object){}',
    'for(let i=0;i<1;i++){}',
  ])
    assert.throws(() => compileToAssembly(source), SyntaxError);
});
test('ошибки компиляции сохраняют имя файла и позицию', () => {
  assert.throws(
    () => compileToAssembly('\n  x => x;', { filename: 'sample.js' }),
    /sample\.js:2:3: Unsupported expression: ArrowFunctionExpression/,
  );
});
test('компиляция генерирует инструкции, не выполняя выражения', () => {
  const text = compileToAssembly(
    'for(init();condition();update()){body();}do{other();}while(check());',
  );
  assert.equal(typeof text, 'string');
  assert.throws(() => executeAssembly(compileToAssembly('1n+1;')), TypeError);
});
