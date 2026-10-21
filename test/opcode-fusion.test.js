import test from 'node:test';
import assert from 'node:assert/strict';
import { Script, createContext } from 'node:vm';
import { OPCODES, OPCODE_NAMES, INSTRUCTION_SPECS } from '../src/bytecode/opcodes.js';
import { assembleTextToBytecode } from '../src/bytecode/assemble.js';
import { executeBytecode } from '../src/runtime/execute-bytecode.js';
import { createNumericOpcodeAliases, remapBytecodeProgram, collectUsedOpcodesFromBytecode } from '../src/bytecode/polymorphic.js';
import { compileToAssembly } from '../src/compiler/compile-assembly.js';
import { buildBrowserScript } from '../src/packer/build-browser-script.js';

test('macro opcodes are defined in OPCODES and INSTRUCTION_SPECS', () => {
  const macros = [
    'macro.local_const_add',
    'macro.local_const_sub',
    'macro.local_prop_get',
    'macro.local_local_add',
    'macro.local_local_strict_eq',
    'macro.return_const',
    'macro.return_local',
  ];

  for (const name of macros) {
    assert.ok(name in OPCODES, `Missing opcode for ${name}`);
    assert.ok(name in INSTRUCTION_SPECS, `Missing spec for ${name}`);
    const opcode = OPCODES[name];
    assert.equal(OPCODE_NAMES[opcode], name);
  }
});

test('peephole optimizer fuses all 7 patterns into macro opcodes', () => {
  // Pattern 1: local.get + js.const + js.add -> macro.local_const_add
  const code1 = assembleTextToBytecode(
    'local.get 0\njs.const 10\njs.add\nreturn',
    { fuseOpcodes: true },
  );
  const used1 = collectUsedOpcodesFromBytecode(code1);
  assert.ok(used1.has('macro.local_const_add'));

  // Pattern 2: local.get + js.const + js.sub -> macro.local_const_sub
  const code2 = assembleTextToBytecode(
    'local.get 0\njs.const 5\njs.sub\nreturn',
    { fuseOpcodes: true },
  );
  const used2 = collectUsedOpcodesFromBytecode(code2);
  assert.ok(used2.has('macro.local_const_sub'));

  // Pattern 3: local.get + js.const + js.prop.get -> macro.local_prop_get
  const code3 = assembleTextToBytecode(
    'local.get 0\njs.const "foo"\njs.prop.get\nreturn',
    { fuseOpcodes: true },
  );
  const used3 = collectUsedOpcodesFromBytecode(code3);
  assert.ok(used3.has('macro.local_prop_get'));

  // Pattern 4: local.get + local.get + js.add -> macro.local_local_add
  const code4 = assembleTextToBytecode(
    'local.get 0\nlocal.get 1\njs.add\nreturn',
    { fuseOpcodes: true },
  );
  const used4 = collectUsedOpcodesFromBytecode(code4);
  assert.ok(used4.has('macro.local_local_add'));

  // Pattern 5: local.get + local.get + js.strict_eq -> macro.local_local_strict_eq
  const code5 = assembleTextToBytecode(
    'local.get 0\nlocal.get 1\njs.strict_eq\nreturn',
    { fuseOpcodes: true },
  );
  const used5 = collectUsedOpcodesFromBytecode(code5);
  assert.ok(used5.has('macro.local_local_strict_eq'));

  // Pattern 6: js.const + return -> macro.return_const
  const code6 = assembleTextToBytecode(
    'js.const 42\nreturn',
    { fuseOpcodes: true },
  );
  const used6 = collectUsedOpcodesFromBytecode(code6);
  assert.ok(used6.has('macro.return_const'));

  // Pattern 7: local.get + return -> macro.return_local
  const code7 = assembleTextToBytecode(
    'local.get 0\nreturn',
    { fuseOpcodes: true },
  );
  const used7 = collectUsedOpcodesFromBytecode(code7);
  assert.ok(used7.has('macro.return_local'));
});

test('peephole optimizer respects jump targets and does not fuse into branch targets', () => {
  // If target jumps to i+1 or i+2, fusion must be prevented
  const assembly = [
    'local.get 0',
    'jump_if_false L1',
    'js.const 10', // Target of L1 is this instruction!
    'label L1',
    'js.add',
    'return',
  ].join('\n');

  const code = assembleTextToBytecode(assembly, { fuseOpcodes: true });
  const used = collectUsedOpcodesFromBytecode(code);
  // Must NOT fuse into macro.local_const_add because L1 jumps to js.add
  assert.ok(!used.has('macro.local_const_add'));
  assert.ok(used.has('local.get'));
  assert.ok(used.has('js.add'));
});

test('peephole optimizer allows jumping to the start of a fused macro instruction', () => {
  // Target jumps to the head instruction (i)
  const assembly = [
    'jump L_start',
    'js.const 0',
    'return',
    'label L_start',
    'local.get 0',
    'js.const 10',
    'js.add',
    'return',
  ].join('\n');

  const code = assembleTextToBytecode(assembly, { fuseOpcodes: true });
  const used = collectUsedOpcodesFromBytecode(code);
  assert.ok(used.has('macro.local_const_add'));

  // Prepare frame with local 0 = 5, expected result: 15
  const prog = assembleTextToBytecode(
    [
      'js.const 5',
      'local.set 0',
      'jump L_start',
      'js.const 0',
      'return',
      'label L_start',
      'local.get 0',
      'js.const 10',
      'js.add',
      'return',
    ].join('\n'),
    { fuseOpcodes: true },
  );

  const result = executeBytecode(prog);
  assert.equal(result, 15);
});

test('macro-opcodes execute with identical semantics in executeBytecode', () => {
  // 1. macro.local_const_add
  {
    const prog = assembleTextToBytecode(
      [
        'js.const 100',
        'local.set 0',
        'local.get 0',
        'js.const 25',
        'js.add',
        'return',
      ].join('\n'),
    );
    assert.equal(executeBytecode(prog), 125);
  }

  // String concat with macro.local_const_add
  {
    const prog = assembleTextToBytecode(
      [
        'js.const "Hello, "',
        'local.set 0',
        'local.get 0',
        'js.const "World!"',
        'js.add',
        'return',
      ].join('\n'),
    );
    assert.equal(executeBytecode(prog), 'Hello, World!');
  }

  // 2. macro.local_const_sub
  {
    const prog = assembleTextToBytecode(
      [
        'js.const 100',
        'local.set 0',
        'local.get 0',
        'js.const 30',
        'js.sub',
        'return',
      ].join('\n'),
    );
    assert.equal(executeBytecode(prog), 70);
  }

  // 3. macro.local_prop_get
  {
    const prog = assembleTextToBytecode(
      [
        'js.object.create',
        'dup',
        'js.const "greeting"',
        'js.const "Hi!"',
        'js.prop.set false',
        'local.set 0',
        'local.get 0',
        'js.const "greeting"',
        'js.prop.get',
        'return',
      ].join('\n'),
    );
    assert.equal(executeBytecode(prog), 'Hi!');
  }

  // 4. macro.local_local_add
  {
    const prog = assembleTextToBytecode(
      [
        'js.const 40',
        'local.set 0',
        'js.const 2',
        'local.set 1',
        'local.get 0',
        'local.get 1',
        'js.add',
        'return',
      ].join('\n'),
    );
    assert.equal(executeBytecode(prog), 42);
  }

  // 5. macro.local_local_strict_eq
  {
    const progTrue = assembleTextToBytecode(
      [
        'js.const "abc"',
        'local.set 0',
        'js.const "abc"',
        'local.set 1',
        'local.get 0',
        'local.get 1',
        'js.strict_eq',
        'return',
      ].join('\n'),
    );
    assert.equal(executeBytecode(progTrue), true);

    const progFalse = assembleTextToBytecode(
      [
        'js.const 1',
        'local.set 0',
        'js.const "1"',
        'local.set 1',
        'local.get 0',
        'local.get 1',
        'js.strict_eq',
        'return',
      ].join('\n'),
    );
    assert.equal(executeBytecode(progFalse), false);
  }

  // 6. macro.return_const
  {
    const prog = assembleTextToBytecode('js.const 999\nreturn');
    assert.equal(executeBytecode(prog), 999);
  }

  // 7. macro.return_local
  {
    const prog = assembleTextToBytecode('js.const "res"\nlocal.set 0\nlocal.get 0\nreturn');
    assert.equal(executeBytecode(prog), 'res');
  }
});

test('remapBytecodeProgram correctly remaps macro opcodes in binary buffer', () => {
  const prog = assembleTextToBytecode(
    'local.get 0\njs.const 10\njs.add\nreturn',
    { fuseOpcodes: true },
  );
  assert.equal(prog.code[0], OPCODES['macro.local_const_add']);

  const mapping = createNumericOpcodeAliases();
  const remapped = remapBytecodeProgram(prog, mapping);
  assert.equal(remapped.code[0], mapping.get(OPCODES['macro.local_const_add']));
});

test('macro-opcodes execute flawlessly under polymorphic remapping and bundling', async () => {
  const source = `
    let a = 10;
    let b = 20;
    let sum = a + b;
    let diff = sum - 5;
    globalThis.__polyResult = diff;
  `;
  const assembly = compileToAssembly(source);
  const bundled = await buildBrowserScript(assembly, {
    randomizeInstructions: true,
    encryptProgram: false,
    pruneOpcodes: true,
    protectStrings: false,
    maskErrors: false,
    minify: false,
  });

  const sandbox = {};
  const context = createContext(sandbox);
  new Script(bundled).runInContext(context);
  assert.equal(sandbox.__polyResult, 25);
});

test('fused macro-opcodes reduce instruction execution steps', () => {
  const assembly = [
    'js.const 10',
    'local.set 0',
    'local.get 0',
    'js.const 5',
    'js.add',
    'return',
  ].join('\n');

  // Unfused: local.get, js.const, js.add, return = 4 steps (plus 2 setup steps = 6 total)
  const unfused = assembleTextToBytecode(assembly, { fuseOpcodes: false });
  // Fused: macro.local_const_add, return = 2 steps (plus 2 setup steps = 4 total)
  const fused = assembleTextToBytecode(assembly, { fuseOpcodes: true });

  assert.ok(fused.code.length < unfused.code.length, 'Fused bytecode buffer should be more compact');
  assert.equal(executeBytecode(unfused), 15);
  assert.equal(executeBytecode(fused), 15);
});

test('full end-to-end bundled application executes with all hardening and macro-opcodes', async () => {
  const jsSource = `
    function compute(a, b) {
      let x = a + 10;
      let y = b - 5;
      let sum = x + y;
      let obj = { total: sum };
      return obj.total;
    }
    const val = compute(20, 15);
    globalThis.__macroTestResult = val;
  `;

  const assembly = compileToAssembly(jsSource);
  const bundled = await buildBrowserScript(assembly, {
    minify: true,
    encryptProgram: true,
    randomizeInstructions: true,
    protectStrings: true,
    pruneOpcodes: true,
    maskErrors: true,
  });

  const sandbox = {};
  const context = createContext(sandbox);
  new Script(bundled).runInContext(context);

  // a = 20, x = 30; b = 15, y = 10; sum = 40; obj.total = 40
  assert.equal(sandbox.__macroTestResult, 40);
});
