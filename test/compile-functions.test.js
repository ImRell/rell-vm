import test from 'node:test';
import assert from 'node:assert/strict';
import { compileToAssembly } from '../src/compiler/compile-assembly.js';
import { executeAssembly } from '../src/runtime/execute-assembly.js';

function run(source, environment = {}, options = {}) {
  const values = [];
  executeAssembly(compileToAssembly(source), {
    environment: Object.defineProperties(
      {
        capture(value) {
          values.push(value);
        },
      },
      Object.getOwnPropertyDescriptors(environment),
    ),
    ...options,
  });
  return values;
}

test('поднимает объявление функции до первого обращения', () => {
  assert.deepEqual(
    run('capture(sum(10, 3)); function sum(a, b) { return a + b; }'),
    [13],
  );
});

test('функция без return и пустой return возвращают undefined', () => {
  assert.deepEqual(
    run(
      'function first() {} function second() { return; } capture(first()); capture(second());',
    ),
    [undefined, undefined],
  );
});

test('return завершает весь кадр из вложенного блока', () => {
  assert.deepEqual(
    run('function f() { { { return 42; } } capture(100); } capture(f());'),
    [42],
  );
});

test('поддерживает анонимные выражения функций и немедленный вызов', () => {
  assert.deepEqual(
    run(
      'var f = function(a) { return a * 2; }; capture(f(21)); capture((function() { return 7; })());',
    ),
    [42, 7],
  );
});

test('параметры и var не сбрасываются повторным объявлением', () => {
  assert.deepEqual(
    run('function f(value) { var value; return value; } capture(f(42));'),
    [42],
  );
});

test('повторные параметры используют последнее вхождение', () => {
  assert.deepEqual(
    run(
      'function f(value, value) { return value; } capture(f(10, 20)); capture(f(10));',
    ),
    [20, undefined],
  );
});

test('поднятая функция может заменить одноимённый параметр', () => {
  assert.deepEqual(
    run(
      'function outer(value) { return value(); function value() { return 42; } } capture(outer(10));',
    ),
    [42],
  );
});

test('последнее объявление функции побеждает, var без init не сбрасывает её', () => {
  assert.deepEqual(
    run(
      'capture(f()); function f() { return 1; } var f; function f() { return 2; }',
    ),
    [2],
  );
});

test('var функции не выходит во внешний кадр', () => {
  assert.deepEqual(
    run(
      'var value = 10; function f() { capture(value); var value = 20; return value; } capture(f()); capture(value);',
    ),
    [undefined, 20, 10],
  );
});

test('объявления соседних функций видны друг другу для рекурсии', () => {
  assert.deepEqual(
    run(
      'function even(n) { if (n === 0) return true; return odd(n - 1); } function odd(n) { if (n === 0) return false; return even(n - 1); } capture(even(10)); capture(odd(7));',
    ),
    [true, true],
  );
});

test('рекурсивные кадры сохраняют параметры вызывающего кода', () => {
  assert.deepEqual(
    run(
      'function sum(n) { if (n <= 0) return 0; return sum(n - 1) + n; } capture(sum(10));',
    ),
    [55],
  );
});

test('фабрика возвращает изменяемое замыкание', () => {
  assert.deepEqual(
    run(
      'function make(value) { return function() { value += 1; return value; }; } var a = make(0); var b = make(100); capture(a()); capture(a()); capture(b());',
    ),
    [1, 2, 101],
  );
});

test('несколько замыканий одного вызова разделяют ячейку', () => {
  let read;
  let write;
  assert.deepEqual(
    run(
      `
    function make() {
      var value = 10;
      saveRead(function() { return value; });
      saveWrite(function(next) { value = next; });
    }
    make(); invokeWrite(42); capture(invokeRead());
  `,
      {
        saveRead(fn) {
          read = fn;
        },
        saveWrite(fn) {
          write = fn;
        },
        // Возвращаем VMFunction в VM, а не вызываем её средствами JS.
        get invokeRead() {
          return read;
        },
        get invokeWrite() {
          return write;
        },
      },
    ),
    [42],
  );
});

test('функция захватывает блок и сохраняет его после выхода', () => {
  assert.deepEqual(
    run(
      'var f; { let value = 42; f = function() { return value; }; } capture(f());',
    ),
    [42],
  );
});

test('функции разных итераций захватывают разные блочные ячейки', () => {
  assert.deepEqual(
    run(
      'var first; var second; var i = 0; while (i < 2) { let value = i; if (i === 0) first = function() { return value; }; else second = function() { return value; }; i += 1; } capture(first()); capture(second());',
    ),
    [0, 1],
  );
});

test('поднятая функция видит TDZ внешнего объявления ниже по исходнику', () => {
  assert.throws(
    () =>
      run('capture(read()); let value = 42; function read() { return value; }'),
    ReferenceError,
  );
  assert.deepEqual(
    run('let value = 42; capture(read()); function read() { return value; }'),
    [42],
  );
});

test('const проверяется при присваивании через замыкание', () => {
  assert.throws(
    () => run('const value = 10; function change() { value = 20; } change();'),
    TypeError,
  );
  assert.deepEqual(
    run(
      'const value = 10; function change() { value = 20; } if (false) change(); capture(value);',
    ),
    [10],
  );
});

test('лексический захват не зависит от окружения места вызова', () => {
  assert.deepEqual(
    run(
      'var value = 10; function read() { return value; } { let value = 99; capture(read()); }',
    ),
    [10],
  );
});

test('var из блока функции принадлежит её корню', () => {
  assert.deepEqual(
    run(
      'function f() { if (false) { var value = 99; } capture(value); { value = 42; var value; } return value; } capture(f());',
    ),
    [undefined, 42],
  );
});

test('break и continue снимают все покидаемые блоки', () => {
  assert.deepEqual(
    run(`
    var i = 0; var total = 0;
    while (i < 5) {
      let current = i;
      i += 1;
      { let inner = current;
        if (inner === 1) continue;
        if (inner === 3) break;
        total += inner;
      }
    }
    capture(total); capture(i);
    { let after = 42; capture(after); }
  `),
    [2, 4, 42],
  );
});

test('вложенные циклы восстанавливают контекст внешнего цикла', () => {
  assert.deepEqual(
    run(
      'var i = 0; var total = 0; while (i < 3) { let outer = i; i += 1; while (true) { let inner = 10; total += inner; break; } if (outer === 1) continue; total += outer; } capture(total);',
    ),
    [32],
  );
});

test('var итераций разделяет одну ячейку, в отличие от let', () => {
  assert.deepEqual(
    run(
      'var first; var second; var i = 0; while (i < 2) { var value = i; if (i === 0) first = function() { return value; }; else second = function() { return value; }; i += 1; } capture(first()); capture(second());',
    ),
    [1, 1],
  );
});

test('обычный строгий вызов сохраняет undefined в this', () => {
  assert.deepEqual(
    run('function f() { "use strict"; return this; } capture(f());'),
    [undefined],
  );
});

test('строгость внешнего кода наследуется вложенными функциями', () => {
  assert.deepEqual(
    run(
      '"use strict"; function f() { return function() { return this; }; } var g = f(); capture(g());',
    ),
    [undefined],
  );
});

test('вызов метода передаёт объект в this VM-функции', () => {
  const object = { value: 42 };
  assert.deepEqual(
    run(
      'install(function() { return this.value; }); capture(object.method());',
      {
        object,
        install(fn) {
          object.method = fn;
        },
      },
    ),
    [42],
  );
});

test('компиляция не выполняет тело функции', () => {
  let calls = 0;
  const source = compileToAssembly('function f() { record(); }');
  executeAssembly(source, {
    environment: {
      record() {
        calls += 1;
      },
    },
  });
  assert.equal(calls, 0);
});

test('рекурсия использует общий лимит инструкций', () => {
  assert.throws(
    () => run('function f() { return f(); } f();', {}, { maxSteps: 1000 }),
    /Instruction limit exceeded: 1000/,
  );
});

test('неподдерживаемые виды функций отклоняются явно', () => {
  for (const source of [
    '{ function f() {} }',
    'var f = (value) => value;',
    'async function f() {}',
    'function* f() {}',
    'function f(value = 42) { return value; }',
  ]) {
    assert.throws(() => compileToAssembly(source), SyntaxError);
  }
});

test('ошибка внутри функции сохраняет имя файла и позицию', () => {
  assert.throws(
    () =>
      compileToAssembly('function f() {\n  x => x;\n}', {
        filename: 'functions.js',
      }),
    /functions\.js:2:3: Unsupported expression: ArrowFunctionExpression/,
  );
});

test('явный параметр arguments не подменяет arguments вложенной функции', () => {
  assert.deepEqual(
    run('function f(arguments) { return arguments; } capture(f(42));'),
    [42],
  );
  assert.deepEqual(
    run(
      'var arguments = 42; function f() { return arguments.length; } capture(f(1, 2));',
    ),
    [2],
  );
  assert.deepEqual(
    run(
      'function outer(arguments) { return function() { return arguments.length; }; } var inner = outer(42); capture(inner(1, 2, 3));',
    ),
    [3],
  );
});

test('пустые и прозрачные блоки не создают лишних окружений', () => {
  assert.equal(compileToAssembly('{} { ; { } }'), 'halt\n');
  assert.equal(compileToAssembly('{ 1 + 2; }'), compileToAssembly('1 + 2;'));
});
