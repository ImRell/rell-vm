import test from 'node:test';
import assert from 'node:assert/strict';
import { compare } from './es5-test-helpers.js';
import { compileToAssembly } from '../src/compiler/compile-assembly.js';
import { executeAssembly } from '../src/runtime/execute-assembly.js';
import { parseAssembly } from '../src/assembly/parse.js';
import { AssemblyBuilder } from '../src/compiler/assembly-builder.js';

const regexCases = [
  [
    'test и exec',
    'var r=/a(b+)/i;capture(r.test("ABBB"));capture(r.exec("zABBy")[1]);',
    [true, 'BB'],
  ],
  [
    'g lastIndex',
    'var r=/a/g;capture(r.test("aba"));capture(r.lastIndex);capture(r.test("aba"));capture(r.lastIndex);capture(r.test("aba"));capture(r.lastIndex);',
    [true, 1, true, 3, false, 0],
  ],
  [
    'm флаг',
    'capture(/^b/m.test("a\\nb"));capture(/^b/.test("a\\nb"));',
    [true, false],
  ],
  [
    'свойства regex',
    'var r=/ab/gi;capture(r.source);capture(r.global);capture(r.ignoreCase);capture(r.multiline);',
    ['ab', true, true, false],
  ],
  [
    'fresh объект при повторном выполнении литерала',
    'function f(){return /a/g;}var a=f(),b=f();a.lastIndex=5;capture(a===b);capture(b.lastIndex);',
    [false, 0],
  ],
  [
    'fresh literal внутри цикла',
    'var first;for(var i=0;i<2;i++){var r=/x/g;if(i===0){first=r;r.lastIndex=9;}}capture(first===r);capture(r.lastIndex);',
    [false, 0],
  ],
  [
    'RegExp shadowing не меняет создание литерала',
    'var RegExp=42;capture(/a/.test("a"));',
    [true],
  ],
  [
    'regex methods this',
    'var r=/a/g;var f=r.test;capture(typeof f);capture(r.test("a"));',
    ['function', true],
  ],
  [
    'slash и unicode',
    'capture(/a\\/b/.test("a/b"));capture(/雪/.test("雪"));',
    [true, true],
  ],
  [
    'строковые native APIs c regex',
    'capture("a1b22".replace(/\\d+/g,"_"));capture("a,b;c".split(/[,;]/).join("|"));',
    ['a_b_', 'a|b|c'],
  ],
  [
    'regex в switch и typeof',
    'var r=/x/;switch(typeof r){case "object":capture(r.test("x"));break;default:throw "bad";}',
    [true],
  ],
  [
    'debugger как harmless instruction',
    'var x=1;debugger;x++;debugger;capture(x);',
    [2],
  ],
];
for (const [name, source, expected] of regexCases)
  test(name, () => assert.deepEqual(compare(source).values, expected));
test('RegExp assembly loader проверяет pattern и flags с позицией', () => {
  for (const [pattern, flags] of [
    ['[', ''],
    ['x', 'gg'],
    ['x', 's'],
    ['x', 'u'],
  ])
    assert.throws(
      () =>
        parseAssembly(
          `\njs.regexp.create ${JSON.stringify(pattern)} ${JSON.stringify(flags)}\nhalt`,
        ),
      /Assembly 2:1: Invalid RegExp literal/,
    );
});
test('RegExp builder проверяет до изменения текста', () => {
  const b = new AssemblyBuilder();
  b.emit('halt');
  const before = b.build();
  assert.throws(() => b.emit('js.regexp.create', '[', ''), SyntaxError);
  assert.equal(b.build(), before);
});
test('RegExp assembly возвращает новый объект при каждом запуске', () => {
  const text = 'js.regexp.create "a" "g"\nreturn';
  const a = executeAssembly(text),
    b = executeAssembly(text);
  assert.equal(a instanceof RegExp, true);
  assert.notEqual(a, b);
  a.lastIndex = 9;
  assert.equal(b.lastIndex, 0);
});
test('современные regex flags явно требуют нормализации', () => {
  for (const source of ['/a/s;', '/a/u;', '/a/y;'])
    assert.throws(() => compileToAssembly(source), /Only ES5 RegExp flags/);
});
test('некорректный regex исходника отклоняет JS parser', () => {
  assert.throws(() => compileToAssembly('/[/;'), SyntaxError);
});
test('пропущенный regex literal не создаёт побочных эффектов', () => {
  assert.deepEqual(compare('if(false){/a/g;}capture("ok");').values, ['ok']);
});
for (const value of [
  undefined,
  null,
  true,
  false,
  0,
  -0,
  42,
  NaN,
  'throw text',
  1n,
  Symbol('error'),
  { marker: 1 },
  Error('original'),
]) {
  test('throw сохраняет значение ' + String(value), () => {
    const text = compileToAssembly('function f(){throw value;}f();');
    let caught = false;
    try {
      executeAssembly(text, { environment: { value } });
    } catch (error) {
      caught = true;
      assert.equal(Object.is(error, value), true);
    }
    assert.equal(caught, true);
  });
}
test('throw из вложенной функции прерывает все последующие инструкции', () => {
  const result = compare(
    'function a(){b();capture("bad a");}function b(){capture("before");throw "stop";}a();capture("bad root");',
  );
  assert.deepEqual(result.values, ['before']);
  assert.equal(result.error, 'stop');
});
test('throw из VM getter не подменяется VM Error', () => {
  const value = { marker: 1 };
  assert.throws(
    () =>
      executeAssembly(compileToAssembly('var o={get x(){throw value;}};o.x;'), {
        environment: { value },
      }),
    (e) => e === value,
  );
});
test('throw из switch и loop не выполняет хвост тела', () => {
  const result = compare(
    'for(var i=0;i<3;i++){switch(i){case 1:throw "stop";default:capture(i);}capture("tail");}',
  );
  assert.deepEqual(result.values, [0, 'tail']);
  assert.equal(result.error, 'stop');
});
test('throw argument вычисляется один раз', () => {
  const factory = (events) => ({
    value() {
      events.push('argument');
      return 7;
    },
  });
  const result = compare('throw value();', factory);
  assert.deepEqual(result.events, ['argument']);
  assert.equal(result.error, 7);
});
test('невыбранная ветка не выполняет throw', () => {
  assert.deepEqual(compare('if(false)throw "bad";capture(1);').values, [1]);
});
test('with по-прежнему требует отдельной динамической модели', () => {
  for (const source of ['with({}){throw 1;}', 'with({}){}'])
    assert.throws(
      () => compileToAssembly(source),
      /Unsupported statement: WithStatement/,
    );
});
test('неподдержанный throw argument сохраняет позицию', () => {
  assert.throws(
    () => compileToAssembly('\nthrow x => x;', { filename: 'throw.js' }),
    /throw\.js:2:7: Unsupported expression: ArrowFunctionExpression/,
  );
});
