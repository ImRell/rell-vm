// Full replacement: metadata stays immutable; the function itself is now
// an ordinary mutable native-callable/constructable object (ES5 prototypes).
import test from 'node:test';
import assert from 'node:assert/strict';
import { VMFunction } from '../src/runtime/vm-function.js';
import { LexicalEnvironment } from '../src/runtime/lexical-environment.js';
function make(options = {}) {
  return new VMFunction({
    source: 'js.const 7\nreturn',
    capturedEnvironment: new LexicalEnvironment(),
    ...options,
  });
}
test('сохраняет описание функции и подготовленное тело', () => {
  const fn = make({ name: 'f', parameters: ['x'], strict: true });
  assert.equal(fn.name, 'f');
  assert.deepEqual(fn.parameters, ['x']);
  assert.equal(fn.strict, true);
  assert.equal(fn.program.instructions[0].op, 'js.const');
  assert.equal(typeof fn, 'function');
});
test('поддерживает анонимную функцию без параметров', () => {
  const f = make();
  assert.equal(f.name, '');
  assert.equal(f.length, 0);
  assert.ok(f instanceof VMFunction);
});
test('копирует и защищает metadata, но допускает собственные свойства функции', () => {
  const parameters = ['x'],
    f = make({ parameters });
  parameters.push('y');
  assert.deepEqual(f.parameters, ['x']);
  assert.throws(() => f.parameters.push('z'), TypeError);
  assert.throws(() => (f.source = 'halt'), TypeError);
  assert.ok(Object.isFrozen(f.program));
  f.extra = 7;
  assert.equal(f.extra, 7);
  assert.equal(f.prototype.constructor, f);
});
test('создание функции проверяет текст, но не исполняет его', () => {
  make({ source: 'js.global.get "notReadAtCreation"\nthrow' });
  assert.throws(() => make({ source: 'unknown' }), SyntaxError);
});
test('захватывает живую ячейку, а не снимок', () => {
  const e = new LexicalEnvironment(),
    cell = e.create(0, 'x', 'let');
  cell.initialize(1);
  const f = make({ capturedEnvironment: e });
  cell.write(7);
  assert.equal(f.capturedEnvironment.getCell(0).read(), 7);
});
test('разные функции разделяют одно захваченное окружение', () => {
  const e = new LexicalEnvironment(),
    a = make({ capturedEnvironment: e }),
    b = make({ capturedEnvironment: e });
  assert.equal(a.capturedEnvironment, b.capturedEnvironment);
  assert.notEqual(a, b);
});
test('повторные параметры разрешены только в нестрогом режиме', () => {
  make({ parameters: ['x', 'x'] });
  assert.throws(
    () => make({ parameters: ['x', 'x'], strict: true }),
    SyntaxError,
  );
});
test('проверяет типы полей описания функции', () => {
  for (const options of [
    { name: 1 },
    { parameters: {} },
    { parameters: [1] },
    { parameters: [''] },
    { strict: 1 },
    { source: 0 },
    { capturedEnvironment: null },
  ])
    assert.throws(() => make(options), TypeError);
});
