import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ASSEMBLY_VERSION,
  INSTRUCTIONS,
  DIRECTIVES,
} from '../src/assembly/instructions.js';

test('версия текстового формата — положительное целое число', () => {
  assert.ok(Number.isSafeInteger(ASSEMBLY_VERSION) && ASSEMBLY_VERSION > 0);
});
test('инструкции имеют текстовые имена и корректные описания', () => {
  const operands = new Set([
    'literal',
    'slot',
    'count',
    'name',
    'text',
    'parameters',
    'boolean',
    'bindingKind',
    'label',
  ]);
  const flows = new Set(['next', 'jump', 'branch', 'return', 'halt', 'throw']);
  for (const [name, description] of Object.entries(INSTRUCTIONS)) {
    assert.match(name, /^[a-z][a-z0-9_.]*$/);
    assert.ok(Array.isArray(description.operands));
    for (const type of description.operands)
      assert.ok(
        operands.has(type),
        `Unknown operand type for ${name}: ${type}`,
      );
    assert.ok(Number.isSafeInteger(description.pops) && description.pops >= 0);
    assert.ok(
      Number.isSafeInteger(description.pushes) && description.pushes >= 0,
    );
    assert.ok(
      flows.has(description.flow),
      `Unknown flow for ${name}: ${description.flow}`,
    );
  }
});
test('js.const принимает значение, а не индекс пула', () => {
  assert.deepEqual(INSTRUCTIONS['js.const'], {
    operands: ['literal'],
    pops: 0,
    pushes: 1,
    flow: 'next',
  });
});
test('создание лексической ячейки принимает слот, имя и вид объявления', () => {
  assert.deepEqual(INSTRUCTIONS['js.lex.create'].operands, [
    'slot',
    'name',
    'bindingKind',
  ]);
});
test('переходы ссылаются на метки и описывают управление потоком', () => {
  assert.deepEqual(INSTRUCTIONS.jump, {
    operands: ['label'],
    pops: 0,
    pushes: 0,
    flow: 'jump',
  });
  assert.deepEqual(INSTRUCTIONS.jump_if_false, {
    operands: ['label'],
    pops: 1,
    pushes: 0,
    flow: 'branch',
  });
});
test('label является директивой, а не исполняемой инструкцией', () => {
  assert.equal(Object.hasOwn(INSTRUCTIONS, 'label'), false);
  assert.deepEqual(DIRECTIVES.label.operands, ['label']);
});
test('контракт глубоко защищён от изменений', () => {
  assert.equal(Object.isFrozen(INSTRUCTIONS), true);
  assert.equal(Object.isFrozen(DIRECTIVES), true);
  for (const definition of [
    ...Object.values(INSTRUCTIONS),
    ...Object.values(DIRECTIVES),
  ]) {
    assert.equal(Object.isFrozen(definition), true);
    assert.equal(Object.isFrozen(definition.operands), true);
    assert.throws(() => definition.operands.push('slot'), TypeError);
  }
  assert.throws(() => (INSTRUCTIONS.custom = {}), TypeError);
});
test('операции со стеком и ячейками сохраняют ожидаемые эффекты', () => {
  for (const [op, pops, pushes] of [
    ['dup', 1, 2],
    ['dup2', 2, 4],
    ['drop', 1, 0],
    ['local.get', 0, 1],
    ['local.set', 1, 0],
    ['local.tee', 1, 1],
    ['js.lex.get', 0, 1],
    ['js.lex.set', 1, 0],
    ['js.lex.tee', 1, 1],
  ]) {
    assert.equal(INSTRUCTIONS[op].pops, pops);
    assert.equal(INSTRUCTIONS[op].pushes, pushes);
  }
});
test('throw описывает исключительное завершение, не обычный return', () => {
  assert.deepEqual(INSTRUCTIONS.throw, {
    operands: [],
    pops: 1,
    pushes: 0,
    flow: 'throw',
  });
  assert.equal(INSTRUCTIONS.return.flow, 'return');
  assert.equal(INSTRUCTIONS.halt.flow, 'halt');
});
test('RegExp и delete фиксируют операнды в текстовом контракте', () => {
  assert.deepEqual(INSTRUCTIONS['js.regexp.create'].operands, ['text', 'text']);
  assert.deepEqual(INSTRUCTIONS['js.prop.delete'].operands, ['boolean']);
  assert.deepEqual(INSTRUCTIONS['js.global.typeof'].operands, ['name']);
  assert.deepEqual(INSTRUCTIONS['js.global.delete'].operands, ['name']);
});
