import test from 'node:test';
import assert from 'node:assert/strict';
import { compare } from './es5-test-helpers.js';
import { compileToAssembly } from '../src/compiler/compile-assembly.js';
import { executeAssembly } from './es5-test-helpers.js';
import { parseAssembly } from '../src/assembly/parse.js';
import { AssemblyBuilder } from '../src/compiler/assembly-builder.js';

const regexCases = [
  [
    'test and exec',
    'var r=/a(b+)/i;capture(r.test("ABBB"));capture(r.exec("zABBy")[1]);',
    [true, 'BB'],
  ],
  [
    'g lastIndex',
    'var r=/a/g;capture(r.test("aba"));capture(r.lastIndex);capture(r.test("aba"));capture(r.lastIndex);capture(r.test("aba"));capture(r.lastIndex);',
    [true, 1, true, 3, false, 0],
  ],
  [
    'm flag',
    'capture(/^b/m.test("a\\nb"));capture(/^b/.test("a\\nb"));',
    [true, false],
  ],
  [
    'regex properties',
    'var r=/ab/gi;capture(r.source);capture(r.global);capture(r.ignoreCase);capture(r.multiline);',
    ['ab', true, true, false],
  ],
  [
    'fresh object on repeated literal execution',
    'function f(){return /a/g;}var a=f(),b=f();a.lastIndex=5;capture(a===b);capture(b.lastIndex);',
    [false, 0],
  ],
  [
    'fresh literal inside loop',
    'var first;for(var i=0;i<2;i++){var r=/x/g;if(i===0){first=r;r.lastIndex=9;}}capture(first===r);capture(r.lastIndex);',
    [false, 0],
  ],
  [
    'RegExp shadowing does not alter literal creation',
    'var RegExp=42;capture(/a/.test("a"));',
    [true],
  ],
  [
    'regex methods this',
    'var r=/a/g;var f=r.test;capture(typeof f);capture(r.test("a"));',
    ['function', true],
  ],
  [
    'slash and unicode',
    'capture(/a\\/b/.test("a/b"));capture(/雪/.test("雪"));',
    [true, true],
  ],
  [
    'string native APIs with regex',
    'capture("a1b22".replace(/\\d+/g,"_"));capture("a,b;c".split(/[,;]/).join("|"));',
    ['a_b_', 'a|b|c'],
  ],
  [
    'regex in switch and typeof',
    'var r=/x/;switch(typeof r){case "object":capture(r.test("x"));break;default:throw "bad";}',
    [true],
  ],
  [
    'debugger as harmless instruction',
    'var x=1;debugger;x++;debugger;capture(x);',
    [2],
  ],
];
for (const [name, source, expected] of regexCases)
  test(name, () => assert.deepEqual(compare(source).values, expected));
test('RegExp assembly loader validates pattern and flags with position', () => {
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
test('RegExp builder validates before mutating text', () => {
  const b = new AssemblyBuilder();
  b.emit('halt');
  const before = b.build();
  assert.throws(() => b.emit('js.regexp.create', '[', ''), SyntaxError);
  assert.equal(b.build(), before);
});
test('RegExp assembly returns fresh object on each execution', () => {
  const text = 'js.regexp.create "a" "g"\nreturn';
  const a = executeAssembly(text),
    b = executeAssembly(text);
  assert.equal(a instanceof RegExp, true);
  assert.notEqual(a, b);
  a.lastIndex = 9;
  assert.equal(b.lastIndex, 0);
});
test('modern regex flags explicitly require normalization', () => {
  for (const source of ['/a/s;', '/a/u;', '/a/y;'])
    assert.throws(() => compileToAssembly(source), /Only ES5 RegExp flags/);
});
test('invalid regex in source is rejected by JS parser', () => {
  assert.throws(() => compileToAssembly('/[/;'), SyntaxError);
});
test('skipped regex literal creates no side effects', () => {
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
  test('throw preserves value ' + String(value), () => {
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
test('throw from nested function halts all subsequent instructions', () => {
  const result = compare(
    'function a(){b();capture("bad a");}function b(){capture("before");throw "stop";}a();capture("bad root");',
  );
  assert.deepEqual(result.values, ['before']);
  assert.equal(result.error, 'stop');
});
test('throw from VM getter is not substituted by VM Error', () => {
  const value = { marker: 1 };
  assert.throws(
    () =>
      executeAssembly(compileToAssembly('var o={get x(){throw value;}};o.x;'), {
        environment: { value },
      }),
    (e) => e === value,
  );
});
test('throw from switch and loop does not execute body tail', () => {
  const result = compare(
    'for(var i=0;i<3;i++){switch(i){case 1:throw "stop";default:capture(i);}capture("tail");}',
  );
  assert.deepEqual(result.values, [0, 'tail']);
  assert.equal(result.error, 'stop');
});
test('throw argument evaluates once', () => {
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
test('unselected branch does not execute throw', () => {
  assert.deepEqual(compare('if(false)throw "bad";capture(1);').values, [1]);
});
test('with still requires separate dynamic model', () => {
  for (const source of ['with({}){throw 1;}', 'with({}){}'])
    assert.throws(
      () => compileToAssembly(source),
      /Unsupported statement: WithStatement/,
    );
});
test('unsupported throw argument preserves position', () => {
  assert.throws(
    () => compileToAssembly('\nthrow x => x;', { filename: 'throw.js' }),
    /throw\.js:2:7: Unsupported expression: ArrowFunctionExpression/,
  );
});
