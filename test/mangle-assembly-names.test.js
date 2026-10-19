import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { compileToAssembly } from '../src/compiler/compile-assembly.js';
import { mangleAssemblyNames } from '../src/assembly/mangle-names.js';
import { parseAssembly } from '../src/assembly/parse.js';
import { executeAssembly } from '../src/runtime/execute-assembly.js';
function execute(source, mangle = true, options = {}) {
  const values = [],
    environment = {
      capture: (v) => values.push(v),
      Object,
      Array,
      Function,
      Number,
      String,
      Boolean,
      Error,
      TypeError,
      ReferenceError,
      Symbol,
      JSON,
      Math,
      undefined,
    };
  const text = compileToAssembly(source);
  executeAssembly(mangle ? mangleAssemblyNames(text, options) : text, {
    environment,
    maxSteps: 200000,
  });
  return values;
}
const cases = [
  [
    'var hoisting',
    'capture(hiddenValue);var hiddenValue=42;capture(hiddenValue);',
  ],
  [
    'let const and blocks',
    'let secretNumber=10;{const secretNumber=20;capture(secretNumber);}capture(secretNumber);',
  ],
  [
    'compound update',
    'var hiddenValue=1;capture(hiddenValue++);capture(++hiddenValue);hiddenValue+=7;capture(hiddenValue);',
  ],
  [
    'nested closure',
    'function makeReader(initialSecret){var hiddenState=initialSecret;return function updateSecret(stepValue){hiddenState+=stepValue;return hiddenState;};}var reader=makeReader(1);capture(reader(2));capture(reader(3));',
  ],
  [
    'independent factories',
    'function factory(initialValue){return function(){return ++initialValue;};}var firstReader=factory(1),secondReader=factory(10);capture(firstReader());capture(secondReader());capture(firstReader());',
  ],
  [
    'shared closure cell',
    'function factory(){var hiddenState=0;return {write:function(){hiddenState++;},read:function(){return hiddenState;}};}var pair=factory();pair.write();capture(pair.read());',
  ],
  [
    'named recursion',
    'var recursiveFunction=function internalSecret(n){return n>0?n*internalSecret(n-1):1;};capture(recursiveFunction(5));capture(typeof internalSecret);',
  ],
  [
    'declaration recursion',
    'function recursiveFunction(n){return n>0?n*recursiveFunction(n-1):1;}capture(recursiveFunction(5));',
  ],
  [
    'named shadowing',
    'var recursiveFunction=function innerName(innerName){return innerName;};capture(recursiveFunction(42));',
  ],
  [
    'sloppy parameters map arguments',
    'function secretFunction(secretParameter){arguments[0]=42;capture(secretParameter);secretParameter=7;capture(arguments[0]);}secretFunction(1);',
  ],
  [
    'duplicate parameters',
    'function secretFunction(repeatedSecret,repeatedSecret){capture(repeatedSecret);arguments[0]=3;capture(repeatedSecret);arguments[1]=4;capture(repeatedSecret);}secretFunction(1,2);',
  ],
  [
    'missing last duplicate',
    'function secretFunction(repeatedSecret,repeatedSecret){capture(repeatedSecret);arguments[0]=3;capture(repeatedSecret);}secretFunction(1);',
  ],
  [
    'strict arguments unmapped',
    'function secretFunction(secretParameter){"use strict";arguments[0]=42;capture(secretParameter);}secretFunction(1);',
  ],
  [
    'explicit arguments parameter',
    'function secretFunction(arguments){capture(arguments);}secretFunction(42);',
  ],
  [
    'var arguments retains implicit object',
    'function secretFunction(secretParameter){var arguments;capture(arguments[0]);}secretFunction(42);',
  ],
  [
    'arguments deletion disconnects mapping',
    'function secretFunction(secretParameter){delete arguments[0];secretParameter=42;capture(arguments[0]);capture(secretParameter);}secretFunction(1);',
  ],
  [
    'arguments length callee',
    'function secretFunction(secretParameter){capture(arguments.length);capture(arguments.callee===secretFunction);}secretFunction(1,2);',
  ],
  [
    'property names untouched',
    'var secretProperty=42;var objectValue={secretProperty:secretProperty};capture(objectValue.secretProperty);capture(objectValue["secretProperty"]);',
  ],
  [
    'getters setters',
    'var hiddenValue=1;var objectValue={get secretProperty(){return hiddenValue;},set secretProperty(newValue){hiddenValue=newValue;}};objectValue.secretProperty=42;capture(objectValue.secretProperty);',
  ],
  [
    'native callbacks',
    'var hiddenOffset=2;capture([1,2,3].map(function(secretParameter){return secretParameter+hiddenOffset;}).join(","));',
  ],
  [
    'constructors',
    'function SecretConstructor(secretParameter){this.secretProperty=secretParameter;}SecretConstructor.prototype.read=function(){return this.secretProperty;};var secretInstance=new SecretConstructor(42);capture(secretInstance.read());capture(secretInstance instanceof SecretConstructor);',
  ],
  [
    'call apply bind',
    'function secretFunction(firstSecret,secondSecret){return this.value+firstSecret+secondSecret;}capture(secretFunction.bind({value:1},2)(3));capture(secretFunction.apply({value:1},[2,3]));',
  ],
  [
    'catch closure',
    'var reader;try{throw 42;}catch(secretError){reader=function(){return secretError;};}capture(reader());',
  ],
  [
    'catch var same name',
    'var secretError=1;try{throw 2;}catch(secretError){var secretError=3;capture(secretError);}capture(secretError);',
  ],
  [
    'TDZ',
    'try{capture(hiddenValue);let hiddenValue=42;}catch(secretError){capture(secretError.name);}',
  ],
  [
    'const write',
    'const hiddenValue=1;try{hiddenValue=2;}catch(secretError){capture(secretError.name);}capture(hiddenValue);',
  ],
  [
    'finally labels for-in',
    'var hiddenCount=0;outer:for(var hiddenKey in {a:1,b:2}){try{hiddenCount++;continue outer;}finally{capture(hiddenKey);}}capture(hiddenCount);',
  ],
  [
    'switch scopes',
    'let hiddenValue=1;switch(1){case 1:let hiddenValue=2;capture(hiddenValue);break;}capture(hiddenValue);',
  ],
  [
    'literal containing assembly text',
    'var hiddenValue="js.lex.create 0 \\\"hiddenValue\\\" let\\n雪";capture(hiddenValue);',
  ],
  [
    'prototype-looking identifiers',
    'function secretFunction(__proto__,constructor){var prototype=__proto__+constructor;return prototype;}capture(secretFunction(20,22));',
  ],
  [
    'unicode identifiers',
    'var скрытоеЗначение=40;function вычислить(π){return скрытоеЗначение+π;}capture(вычислить(2));',
  ],
];
for (const [name, source] of cases)
  test('mangle preserves ' + name, () => {
    const expected = [];
    vm.runInNewContext(
      source,
      { capture: (v) => expected.push(v) },
      { timeout: 1000 },
    );
    assert.deepEqual(execute(source, false), expected, 'plain VM');
    assert.deepEqual(execute(source), expected, 'mangled VM');
  });
function metadata(source) {
  const names = [];
  for (const i of parseAssembly(source).instructions) {
    if (i.op === 'js.lex.create') names.push(i.args[1]);
    if (i.op === 'js.function.create' || i.op === 'js.function.named.create') {
      names.push(i.args[0], ...i.args[1], ...metadata(i.args[3]));
    }
  }
  return names;
}
test('all local names disappear recursively and maps are not emitted', () => {
  const originalNames = [
    'secretRootName',
    'secretParameterName',
    'secretClosureName',
    'privateSelfName',
    'secretErrorName',
  ];
  const source =
    'var secretRootName=7;function secretClosureName(secretParameterName){return function privateSelfName(){try{throw secretParameterName;}catch(secretErrorName){return secretErrorName+secretRootName;}};}capture(secretClosureName(35)());';
  const text = compileToAssembly(source),
    result = mangleAssemblyNames(text),
    names = metadata(result);
  for (const name of originalNames) {
    assert.ok(!names.includes(name));
    assert.ok(!result.includes(name));
  }
  assert.deepEqual(execute(source), [42]);
  assert.ok(names.filter(Boolean).every((n) => /^_[0-9a-z]+$/.test(n)));
});
test('globals and same-spelled literal/property strings are NOT rewritten', () => {
  const text = compileToAssembly(
    'capture(secretName);{let secretName=42;capture({secretName:secretName}.secretName);capture("secretName");}',
  );
  const result = mangleAssemblyNames(text),
    values = [];
  executeAssembly(result, {
    environment: { secretName: 7, capture: (v) => values.push(v) },
  });
  assert.deepEqual(values, [7, 42, 'secretName']);
  assert.match(result, /js.global.get "secretName"/);
  assert.ok(!metadata(result).includes('secretName'));
});
test('function.name is renamed unless explicitly retained', () => {
  const source =
    'function NamedSecret(){};var value=function PrivateSecret(){};capture(NamedSecret.name);capture(value.name);';
  const plain = execute(source, false),
    mangled = execute(source),
    kept = execute(source, true, { keepFunctionNames: true });
  assert.deepEqual(plain, ['NamedSecret', 'PrivateSecret']);
  assert.notDeepEqual(mangled, plain);
  assert.deepEqual(kept, plain);
});
test('keepFunctionNames keeps names but still mangles local cells and parameters', () => {
  const text = mangleAssemblyNames(
    compileToAssembly(
      'function NamedSecret(secretParameter){var secretValue=secretParameter;return secretValue;}',
    ),
    { keepFunctionNames: true },
  );
  assert.ok(text.includes('NamedSecret'));
  assert.ok(!text.includes('secretParameter'));
  assert.ok(!text.includes('secretValue'));
});
test('empty anonymous names remain empty', () => {
  const result = mangleAssemblyNames(
    compileToAssembly(
      'var value=function(secretParameter){return secretParameter;};',
    ),
  );
  assert.equal(
    parseAssembly(result).instructions.find(
      (i) => i.op === 'js.function.create',
    ).args[0],
    '',
  );
});
test('aliases never coincide with any original metadata name, including nested names', () => {
  const text = mangleAssemblyNames(
    compileToAssembly(
      'var _0=1;function _1(_2){return function _3(){return _0+_2;};}',
    ),
  );
  for (const old of ['_0', '_1', '_2', '_3'])
    assert.ok(!metadata(text).includes(old));
});
test('transformation is deterministic and has no cross-build state', () => {
  const text = compileToAssembly('var secretValue=42;');
  const a = mangleAssemblyNames(text);
  mangleAssemblyNames(compileToAssembly('var otherValue=1;'));
  assert.equal(mangleAssemblyNames(text), a);
  assert.ok(text.includes('secretValue'));
});
test('const error type survives but diagnostic variable name is hidden', () => {
  const values = [],
    text = mangleAssemblyNames(
      compileToAssembly(
        'const SecretVariable=1;try{SecretVariable=2;}catch(e){capture(e.name);capture(e.message);}',
      ),
    );
  executeAssembly(text, { environment: { capture: (v) => values.push(v) } });
  assert.equal(values[0], 'TypeError');
  assert.ok(!values[1].includes('SecretVariable'));
});
for (const value of [undefined, null, 42, {}, []])
  test('invalid assembly source ' + String(value), () =>
    assert.throws(() => mangleAssemblyNames(value), TypeError),
  );
for (const value of [null, 1, 'yes', {}])
  test('invalid keepFunctionNames ' + String(value), () =>
    assert.throws(
      () => mangleAssemblyNames('halt', { keepFunctionNames: value }),
      /must be a boolean/,
    ),
  );
for (const text of [
  '',
  'unknown',
  'js.function.create "f" "[\\"x\\",\\"x\\"]" true "halt"',
  'jump Missing\nhalt',
])
  test('invalid assembly remains rejected ' + text, () =>
    assert.throws(() => mangleAssemblyNames(text), SyntaxError),
  );
test('no evaluation of instruction body while mangling', () =>
  assert.doesNotThrow(() =>
    mangleAssemblyNames('js.global.get "mustNotBeRead"\nthrow'),
  ));
test('blank lines, literal words, labels, targets and instruction count survive', () => {
  const source =
    '\r\n\tjs.lex.create 0 "SecretValue" let\r\njs.const -0\r\njs.lex.init 0\r\n\r\njump End\r\njs.const NaN\r\nlabel End\r\njs.lex.get 0\r\nreturn\r\n';
  const result = mangleAssemblyNames(source),
    before = parseAssembly(source).instructions,
    after = parseAssembly(result).instructions;
  assert.equal(before.length, after.length);
  for (let j = 0; j < before.length; j++) {
    assert.equal(before[j].op, after[j].op);
    assert.equal(before[j].line, after[j].line);
    assert.equal(before[j].target, after[j].target);
    if (before[j].op !== 'js.lex.create')
      assert.deepEqual(before[j].args, after[j].args);
  }
  assert.ok(Object.is(executeAssembly(result), -0));
});
test('mangling does not change VM instruction budget', () => {
  const text = compileToAssembly(
    'var secretValue=0;while(true){secretValue++;}',
  );
  for (const source of [text, mangleAssemblyNames(text)])
    assert.throws(
      () => executeAssembly(source, { maxSteps: 100 }),
      /Instruction limit exceeded: 100/,
    );
});

test('only name metadata changes across nested functions and exception handlers', () => {
  const source = compileToAssembly(`
 function SecretFactory(secretParameter){
   var secretState=secretParameter;
   return function SecretReader(secretDelta){
     try { for(var secretIndex in {publicKey:1}) { secretState+=secretDelta; } }
     catch(secretError){secretState=0;} finally { secretState+=1; }
     return secretState;
   };
 }
 var secretReader=SecretFactory(40);capture(secretReader(1));
 `);
  // Function operands: name, JSON parameter list, strict flag, assembly body.
  function compareBodies(beforeText, afterText) {
    const before = parseAssembly(beforeText).instructions,
      after = parseAssembly(afterText).instructions;
    assert.equal(before.length, after.length);
    for (let i = 0; i < before.length; i++) {
      const a = before[i],
        b = after[i];
      assert.equal(a.op, b.op);
      for (const key of Object.keys(a))
        if (key !== 'args' && key !== 'column')
          assert.deepEqual(a[key], b[key]);
      if (a.op === 'js.lex.create')
        assert.deepEqual([a.args[0], a.args[2]], [b.args[0], b.args[2]]);
      else if (
        a.op === 'js.function.create' ||
        a.op === 'js.function.named.create'
      ) {
        assert.equal(a.args[2], b.args[2]);
        assert.equal(a.args[1].length, b.args[1].length);
        compareBodies(a.args[3], b.args[3]);
      } else assert.deepEqual(a.args, b.args);
    }
  }
  compareBodies(source, mangleAssemblyNames(source));
});
test('special constants keep exact values and are not interpreted as names', () => {
  for (const literal of [
    'undefined',
    'null',
    'true',
    'false',
    'NaN',
    'Infinity',
    '-Infinity',
    '-0',
    '12345678901234567890n',
    '"SecretVariable"',
  ]) {
    const text = `js.lex.create 0 "SecretVariable" let\njs.const ${literal}\nreturn`;
    assert.ok(
      Object.is(
        executeAssembly(text),
        executeAssembly(mangleAssemblyNames(text)),
      ),
    );
  }
});
test('global typeof/delete names remain public lookup strings', () => {
  const text = compileToAssembly(
    'var SecretLocal=1;capture(typeof SecretGlobal);capture(delete SecretGlobal);',
  );
  const mangled = mangleAssemblyNames(text);
  assert.ok(!mangled.includes('SecretLocal'));
  assert.ok(mangled.includes('SecretGlobal'));
  const values = [];
  executeAssembly(mangled, {
    environment: { capture: (v) => values.push(v), SecretGlobal: 42 },
  });
  assert.deepEqual(values, ['number', true]);
});
