import test from 'node:test';
import assert from 'node:assert/strict';
import { AssemblyBuilder } from '../src/compiler/assembly-builder.js';
import { executeAssembly } from '../src/runtime/execute-assembly.js';

function call(body) {
  const builder = new AssemblyBuilder();
  builder.emit('js.const', undefined);
  builder.emit('js.function.create', '', [], false, body);
  builder.emit('js.call', 0);
  builder.emit('return');
  return builder.build();
}

test('arguments создаётся только в кадре VM-функции', () => {
  assert.throws(
    () => executeAssembly('js.arguments.create 0\nhalt\n'),
    /arguments requires a VM function call/,
  );
});

test('arguments создаётся только в корневом окружении вызова', () => {
  assert.throws(
    () =>
      executeAssembly(call('js.scope.enter\njs.arguments.create 0\nhalt\n')),
    /arguments must be created in the function root environment/,
  );
});

test('разные binding-слоты одного кадра получают один объект arguments', () => {
  assert.equal(
    executeAssembly(
      call(
        'js.arguments.create 0\njs.arguments.create 1\njs.lex.get 0\njs.lex.get 1\njs.strict_eq\nreturn\n',
      ),
    ),
    true,
  );
  assert.throws(
    () =>
      executeAssembly(
        call('js.arguments.create 0\njs.arguments.create 0\nhalt\n'),
      ),
    /already exists/,
  );
});

test('создание arguments учитывается общим лимитом инструкций', () => {
  const source = call('js.arguments.create 0\njs.lex.get 0\nreturn\n');
  const result = executeAssembly(source, { maxSteps: 7 });
  assert.equal(result.length, 0);
  assert.throws(
    () => executeAssembly(source, { maxSteps: 6 }),
    /Instruction limit exceeded: 6/,
  );
});
