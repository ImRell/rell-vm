import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { compileToAssembly } from '../src/compiler/compile-assembly.js';
import { executeAssembly } from '../src/runtime/execute-assembly.js';
import { AssemblyBuilder } from '../src/compiler/assembly-builder.js';
import { parseAssembly } from '../src/assembly/parse.js';

function run(source, environment = {}) {
  const values = [];
  const external = Object.defineProperties(
    {
      capture(value) {
        values.push(value);
      },
    },
    Object.getOwnPropertyDescriptors(environment),
  );
  executeAssembly(compileToAssembly(source), { environment: external });
  return values;
}

function compareNative(source) {
  const expected = [];
  vm.runInNewContext(source, {
    capture(value) {
      expected.push(value);
    },
  });
  assert.deepEqual(run(source), expected);
}

test('рекурсия использует собственное имя FunctionExpression', () => {
  compareNative(
    'var factorial = function calculate(n) { if (n <= 1) return 1; return n * calculate(n - 1); }; capture(factorial(5));',
  );
});

test('перезапись внешней переменной не ломает рекурсию', () => {
  compareNative(
    'var factorial = function calculate(n) { if (n <= 1) return 1; return n * calculate(n - 1); }; var saved = factorial; factorial = 0; capture(saved(6));',
  );
});

test('собственное имя возвращает тот же объект функции', () => {
  assert.deepEqual(
    run('var f = function self() { return self; }; capture(f() === f);'),
    [true],
  );
});

test('собственное имя недоступно снаружи выражения', () => {
  assert.throws(() => run('var f = function self() {}; capture(self);'), {
    name: 'ReferenceError',
    message: 'self is not defined',
  });
});

test('собственное имя затеняет внешнее, не изменяя его', () => {
  compareNative(
    'var self = 99; var f = function self() { return self; }; capture(f() === f); capture(self);',
  );
});

test('параметр может затенить собственное имя', () => {
  compareNative(
    'var f = function self(self) { return self; }; capture(f(42));',
  );
});

test('локальный var затеняет собственное имя с начала вызова', () => {
  compareNative(
    'var f = function self() { capture(self); var self = 42; return self; }; capture(f());',
  );
});

test('локальная FunctionDeclaration может затенить собственное имя', () => {
  compareNative(
    'var f = function self() { return self(); function self() { return 42; } }; capture(f());',
  );
});

test('вложенное замыкание сохраняет собственное имя после возврата', () => {
  compareNative(
    'var f = function self() { return function() { return self; }; }; var read = f(); capture(read() === f);',
  );
});

test('разные вычисления выражения имеют разные private-окружения', () => {
  compareNative(
    'function make() { return function self() { return self; }; } var a = make(); var b = make(); capture(a() === a); capture(b() === b); capture(a === b);',
  );
});

test('дополнительное окружение имени не ломает внешние захваты', () => {
  compareNative(
    'function make(value) { return function self(n) { if (n <= 0) return value; value += 1; return self(n - 1); }; } var f = make(10); capture(f(3)); capture(f(0));',
  );
});

test('выражение внутри блока сохраняет блочные и внешние захваты', () => {
  compareNative(
    'var root = 10; var f; { let value = 20; f = function self(n) { if (n <= 0) return root + value; return self(n - 1); }; } capture(f(3));',
  );
});

test('нестрогое присваивание собственному имени игнорирует запись', () => {
  compareNative(
    'var f = function self() { self = 42; return self; }; capture(f() === f);',
  );
});

test('игнорируемое присваивание возвращает вычисленный RHS', () => {
  compareNative(
    'var f = function self() { capture(self = 42); return self; }; capture(f() === f);',
  );
});

test('нестрогое составное присваивание также не меняет привязку', () => {
  compareNative(
    'var f = function self() { self -= 1; return self; }; capture(f() === f);',
  );
});

test('присваивание имени не меняет одноимённую внешнюю переменную', () => {
  compareNative(
    'var self = 99; var f = function self() { self = 42; return self; }; capture(f() === f); capture(self);',
  );
});

test('строгое присваивание выбрасывает TypeError', () => {
  assert.throws(
    () => run('var f = function self() { "use strict"; self = 42; }; f();'),
    TypeError,
  );
});

test('строгий режим скрипта наследуется выражением функции', () => {
  assert.throws(
    () => run('"use strict"; var f = function self() { self = 42; }; f();'),
    TypeError,
  );
});

test('строгость определяется местом присваивания во вложенной функции', () => {
  assert.throws(
    () =>
      run(
        'var f = function self() { return function() { "use strict"; self = 42; }; }; var change = f(); change();',
      ),
    TypeError,
  );
  compareNative(
    'var f = function self() { return function() { self = 42; return self; }; }; var change = f(); capture(change() === f);',
  );
});

test('правая часть выполняется до строгой ошибки присваивания', () => {
  const calls = [];
  assert.throws(
    () =>
      run('var f = function self() { "use strict"; self = record(); }; f();', {
        record() {
          calls.push('rhs');
          return 42;
        },
      }),
    TypeError,
  );
  assert.deepEqual(calls, ['rhs']);
});

test('исключение правой части не подменяется ошибкой записи имени', () => {
  const expected = new Error('RHS failure');
  assert.throws(
    () =>
      run('var f = function self() { "use strict"; self = explode(); }; f();', {
        explode() {
          throw expected;
        },
      }),
    (error) => error === expected,
  );
});

test('пропущенная ветка не выполняет запрещённое присваивание', () => {
  compareNative(
    'var f = function self() { "use strict"; if (false) self = 42; return self; }; capture(f() === f);',
  );
});

test('локальное затенение использует обычную изменяемую привязку', () => {
  compareNative(
    'var f = function self(self) { "use strict"; self = 42; return self; }; capture(f(10));',
  );
  compareNative(
    'var f = function self() { var self; self = 42; return self; }; capture(f());',
  );
});

test('блочное затенение сохраняет TDZ и семантику const', () => {
  assert.throws(
    () =>
      run(
        'var f = function self() { { capture(self); let self = 42; } }; f();',
      ),
    ReferenceError,
  );
  assert.throws(
    () =>
      run('var f = function self() { { const self = 10; self = 42; } }; f();'),
    TypeError,
  );
});

test('имя сохраняет обычные this и параметры вызова', () => {
  assert.deepEqual(
    run(
      'var f = function self(value) { "use strict"; capture(this); return value; }; capture(f(42));',
    ),
    [undefined, 42],
  );
});

test('парсер и генератор поддерживают named.create', () => {
  const builder = new AssemblyBuilder();
  builder.emit(
    'js.function.named.create',
    'self',
    [],
    true,
    'js.env.get 1 0\nreturn\n',
  );
  builder.emit('return');
  const source = builder.build();
  const fn = executeAssembly(source);
  assert.equal(fn.name, 'self');
  assert.equal(fn.capturedEnvironment.getCell(0).read(), fn);
  assert.equal(
    parseAssembly(source).instructions[0].op,
    'js.function.named.create',
  );
  assert.throws(
    () => builder.emit('js.function.named.create', '', [], false, 'halt\n'),
    /non-empty name/,
  );
  assert.throws(
    () =>
      builder.emit(
        'js.function.named.create',
        'self',
        ['x', 'x'],
        true,
        'halt\n',
      ),
    /Duplicate parameter/,
  );
  assert.throws(
    () =>
      builder.emit('js.function.named.create', 'self', [], false, 'bad.op\n'),
    /Invalid function body/,
  );
  assert.equal(builder.build(), source);
});

test('инструкции записи имени проверяют тип ячейки и стек', () => {
  for (const op of ['js.name.set', 'js.name.tee']) {
    assert.throws(
      () => executeAssembly(`${op} 0 0 false\nhalt\n`),
      /Stack underflow/,
    );
    assert.throws(
      () =>
        executeAssembly(
          `js.lex.create 0 "value" let\njs.const 0\njs.lex.init 0\njs.const 42\n${op} 0 0 false\nhalt\n`,
        ),
      /Expected a function-name binding/,
    );
  }
});

test('ошибка в теле сохраняет позицию исходного JS', () => {
  assert.throws(
    () =>
      compileToAssembly('var f = function self() {\n  x => x;\n};', {
        filename: 'named.js',
      }),
    /named\.js:2:3: Unsupported expression: ArrowFunctionExpression/,
  );
});

test('js.name.set снимает RHS, а js.name.tee оставляет его на стеке', () => {
  for (const op of ['js.name.set', 'js.name.tee']) {
    const body =
      [
        'js.const 100',
        'js.const 42',
        `${op} 1 0 false`,
        op === 'js.name.tee' ? 'js.add' : '',
        'return',
        '',
      ]
        .filter((line) => line !== '')
        .join('\n') + '\n';
    const builder = new AssemblyBuilder();
    builder.emit('js.const', undefined);
    builder.emit('js.function.named.create', 'self', [], false, body);
    builder.emit('js.call', 0);
    builder.emit('return');
    assert.equal(
      executeAssembly(builder.build()),
      op === 'js.name.set' ? 100 : 142,
    );
  }
});

test('прямые инструкции записи имени соблюдают строгий режим', () => {
  for (const op of ['js.name.set', 'js.name.tee']) {
    const builder = new AssemblyBuilder();
    builder.emit('js.const', undefined);
    builder.emit(
      'js.function.named.create',
      'self',
      [],
      true,
      `js.const 42\n${op} 1 0 true\njs.const undefined\nreturn\n`,
    );
    builder.emit('js.call', 0);
    builder.emit('return');
    assert.throws(() => executeAssembly(builder.build()), TypeError);
  }
});
