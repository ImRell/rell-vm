import test from 'node:test';
import assert from 'node:assert/strict';
import { INSTRUCTIONS } from '../src/assembly/instructions.js';
import { parseAssembly } from '../src/assembly/parse.js';
import { AssemblyBuilder } from '../src/compiler/assembly-builder.js';
import { executeAssembly } from '../src/runtime/execute-assembly.js';

test('контракт описывает числовые и property update инструкции', () => {
  for (const op of ['js.to_numeric', 'js.inc', 'js.dec']) {
    assert.equal(INSTRUCTIONS[op].pops, 1);
    assert.equal(INSTRUCTIONS[op].pushes, 1);
  }
  for (const op of ['js.prop.inc', 'js.prop.dec']) {
    assert.equal(INSTRUCTIONS[op].pops, 2);
    assert.equal(INSTRUCTIONS[op].pushes, 1);
    assert.deepEqual(INSTRUCTIONS[op].operands, ['boolean', 'boolean']);
  }
});
test('js.to_numeric возвращает старое числовое значение', () => {
  assert.equal(executeAssembly('js.const "10"\njs.to_numeric\nreturn'), 10);
  assert.equal(executeAssembly('js.const 10n\njs.to_numeric\nreturn'), 10n);
});
test('inc и dec возвращают новое числовое значение', () => {
  assert.equal(executeAssembly('js.const "10"\njs.inc\nreturn'), 11);
  assert.equal(executeAssembly('js.const 10n\njs.dec\nreturn'), 9n);
});
test('property operand задаёт prefix/postfix и strict', () => {
  for (const op of ['js.prop.inc', 'js.prop.dec'])
    for (const prefix of [false, true]) {
      const object = { x: '10' };
      const result = executeAssembly(
        `js.global.get "object"\njs.const "x"\n${op} ${prefix} false\nreturn`,
        { environment: { object } },
      );
      const updated = op === 'js.prop.inc' ? 11 : 9;
      assert.equal(object.x, updated);
      assert.equal(result, prefix ? updated : 10);
    }
});
test('readonly property: strict бросает, sloppy возвращает результат', () => {
  const object = Object.freeze({ x: '10' });
  const start = 'js.global.get "object"\njs.const "x"\n';
  assert.equal(
    executeAssembly(start + 'js.prop.inc true false\nreturn', {
      environment: { object },
    }),
    11,
  );
  assert.equal(object.x, '10');
  assert.throws(
    () =>
      executeAssembly(start + 'js.prop.inc false true\nreturn', {
        environment: { object },
      }),
    TypeError,
  );
});
test('новые инструкции проверяют недостаток стека', () => {
  for (const op of [
    'js.to_numeric',
    'js.inc',
    'js.dec',
    'js.prop.inc true false',
    'js.prop.dec false true',
  ])
    assert.throws(() => executeAssembly(op + '\nhalt'), /Stack underflow/);
});
test('парсер и генератор проверяют число и тип operands', () => {
  for (const text of [
    'js.inc 1',
    'js.prop.inc true',
    'js.prop.dec 1 false',
    'js.prop.inc "true" false',
  ])
    assert.throws(() => parseAssembly(text + '\nhalt'));
  const builder = new AssemblyBuilder();
  builder.emit('js.const', 1);
  assert.throws(() => builder.emit('js.prop.inc', true, 'false'));
  builder.emit('js.inc');
  builder.emit('return');
  assert.equal(executeAssembly(builder.build()), 2);
});
test('property update не повреждает нижнее значение стека', () => {
  assert.equal(
    executeAssembly(
      'js.const 100\njs.global.get "object"\njs.const "x"\njs.prop.inc false false\njs.add\nreturn',
      { environment: { object: { x: 10 } } },
    ),
    110,
  );
});
test('ToNumeric конвертирует объект ровно один раз', () => {
  let calls = 0;
  assert.equal(
    executeAssembly(
      'js.global.get "value"\njs.to_numeric\ndup\njs.inc\ndrop\nreturn',
      {
        environment: {
          value: {
            valueOf() {
              calls++;
              return '7';
            },
          },
        },
      },
    ),
    7,
  );
  assert.equal(calls, 1);
});
test('операторы учитываются в общем instruction budget', () => {
  const text = 'js.const 1\njs.inc\nreturn';
  assert.equal(executeAssembly(text, { maxSteps: 3 }), 2);
  assert.throws(
    () => executeAssembly(text, { maxSteps: 2 }),
    /Instruction limit/,
  );
});
