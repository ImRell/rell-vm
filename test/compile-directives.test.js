import test from 'node:test';
import assert from 'node:assert/strict';
import { compileToAssembly } from '../src/compiler/compile-assembly.js';
import { executeAssembly } from './es5-test-helpers.js';
function run(source) {
  const values = [],
    environment = { undefined, capture: (v) => values.push(v) };
  executeAssembly(compileToAssembly(source), { environment });
  return values;
}
test('unknown directive prologue strings are inert', () => {
  assert.deepEqual(run('"custom";"@babel/helpers - typeof";capture(7);'), [7]);
  assert.deepEqual(run('function f(){"custom";return 7;}capture(f());'), [7]);
});
test('actual use strict after an unknown directive still activates strict mode', () => {
  assert.deepEqual(
    run('function f(){"custom";"use strict";return this;}capture(f());'),
    [undefined],
  );
});
test('unknown directives do not enable strict mode', () => {
  assert.deepEqual(
    run('function f(){"custom";return this===undefined;}capture(f());'),
    [false],
  );
});
test('escaped use strict does not enable strict mode', () => {
  assert.deepEqual(
    run('function f(){"use\\x20strict";return this===undefined;}capture(f());'),
    [false],
  );
});
test('inherited strict mode is retained across helper markers', () => {
  assert.deepEqual(
    run(
      '"use strict";function f(){"@babel/helpers - typeof";return this;}capture(f());',
    ),
    [undefined],
  );
});
test('string after non-directive statement does not become a directive', () => {
  assert.deepEqual(
    run('function f(){0;"use strict";return this===undefined;}capture(f());'),
    [false],
  );
});
test('directive-only function still returns undefined', () => {
  assert.deepEqual(run('function f(){"custom";}capture(f());'), [undefined]);
});
