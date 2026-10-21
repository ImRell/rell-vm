import { parseAssembly } from '../assembly/parse.js';
import { BytecodeBuilder } from './bytecode-builder.js';
import { INSTRUCTIONS } from '../assembly/instructions.js';

/**
 * Assembles instruction text into a BytecodeProgram.
 *
 * @param {string|object} source
 * @param {{ decodeString?: (reference: string) => string }} [options]
 * @returns {import('./bytecode-builder.js').BytecodeProgram}
 */
export function assembleTextToBytecode(
  source,
  { decodeString, allowProtectedReferences = true, fuseOpcodes = true } = {},
) {
  if (source && source.code instanceof Uint8Array && Array.isArray(source.constants)) {
    return source;
  }

  const parsed = parseAssembly(source, {
    decodeString: typeof decodeString === 'function' ? decodeString : undefined,
    allowProtectedReferences,
  });
  const { instructions } = parsed;
  const builder = new BytecodeBuilder();

  // Collect all instruction indices targeted by branch/jump instructions
  const targetIndices = new Set();
  for (const inst of instructions) {
    const flow = INSTRUCTIONS[inst.op]?.flow;
    if (flow === 'jump' || flow === 'branch' || inst.op === 'js.abrupt.jump') {
      if (typeof inst.target === 'number') {
        targetIndices.add(inst.target);
      }
    }
    if (inst.op === 'js.try.enter' && Array.isArray(inst.targets)) {
      for (const t of inst.targets) {
        if (typeof t === 'number') targetIndices.add(t);
      }
    }
  }

  // Create labels for all target instructions
  const targetLabels = new Map();
  for (const idx of targetIndices) {
    targetLabels.set(idx, builder.createLabel());
  }

  // Emit instructions into builder
  for (let i = 0; i < instructions.length; i++) {
    if (targetLabels.has(i)) {
      builder.markLabel(targetLabels.get(i));
    }

    const inst = instructions[i];

    if (fuseOpcodes) {
      // 3-instruction opcode fusion patterns
      if (
        i + 2 < instructions.length &&
        !targetIndices.has(i + 1) &&
        !targetIndices.has(i + 2)
      ) {
        const i1 = instructions[i + 1];
        const i2 = instructions[i + 2];

        // 1. local.get $slot + js.const $c + js.add -> macro.local_const_add
        if (
          inst.op === 'local.get' &&
          i1.op === 'js.const' &&
          i2.op === 'js.add'
        ) {
          builder.emit('macro.local_const_add', inst.args[0], i1.args[0]);
          i += 2;
          continue;
        }

        // 2. local.get $slot + js.const $c + js.sub -> macro.local_const_sub
        if (
          inst.op === 'local.get' &&
          i1.op === 'js.const' &&
          i2.op === 'js.sub'
        ) {
          builder.emit('macro.local_const_sub', inst.args[0], i1.args[0]);
          i += 2;
          continue;
        }

        // 3. local.get $slot + js.const $c + js.prop.get -> macro.local_prop_get
        if (
          inst.op === 'local.get' &&
          i1.op === 'js.const' &&
          i2.op === 'js.prop.get'
        ) {
          builder.emit('macro.local_prop_get', inst.args[0], i1.args[0]);
          i += 2;
          continue;
        }

        // 4. local.get $slot1 + local.get $slot2 + js.add -> macro.local_local_add
        if (
          inst.op === 'local.get' &&
          i1.op === 'local.get' &&
          i2.op === 'js.add'
        ) {
          builder.emit('macro.local_local_add', inst.args[0], i1.args[0]);
          i += 2;
          continue;
        }

        // 5. local.get $slot1 + local.get $slot2 + js.strict_eq -> macro.local_local_strict_eq
        if (
          inst.op === 'local.get' &&
          i1.op === 'local.get' &&
          i2.op === 'js.strict_eq'
        ) {
          builder.emit('macro.local_local_strict_eq', inst.args[0], i1.args[0]);
          i += 2;
          continue;
        }
      }

      // 2-instruction opcode fusion patterns
      if (i + 1 < instructions.length && !targetIndices.has(i + 1)) {
        const i1 = instructions[i + 1];

        // 6. js.const $c + return -> macro.return_const
        if (inst.op === 'js.const' && i1.op === 'return') {
          builder.emit('macro.return_const', inst.args[0]);
          i += 1;
          continue;
        }

        // 7. local.get $slot + return -> macro.return_local
        if (inst.op === 'local.get' && i1.op === 'return') {
          builder.emit('macro.return_local', inst.args[0]);
          i += 1;
          continue;
        }
      }
    }

    const { op, args } = inst;
    const flow = INSTRUCTIONS[op]?.flow;

    if (op === 'js.abrupt.jump') {
      const label = targetLabels.get(inst.target);
      builder.emit(op, label, args[1], args[2]);
    } else if (flow === 'jump' || flow === 'branch') {
      const label = targetLabels.get(inst.target);
      builder.emit(op, label);
    } else if (op === 'js.try.enter') {
      const catchLabel = targetLabels.get(inst.targets[0]);
      const finallyLabel = targetLabels.get(inst.targets[1]);
      const endLabel = targetLabels.get(inst.targets[2]);
      builder.emit(op, catchLabel, finallyLabel, endLabel, args[3], args[4]);
    } else if (op === 'js.function.create' || op === 'js.function.named.create') {
      const bodyArg = args[3];
      let childBody = bodyArg;
      if (typeof bodyArg === 'string' && !bodyArg.startsWith('@')) {
        childBody = assembleTextToBytecode(bodyArg, {
          decodeString,
          allowProtectedReferences,
          fuseOpcodes,
        });
      }
      builder.emit(op, args[0], args[1], args[2], childBody);
    } else {
      builder.emit(op, ...args);
    }
  }

  return builder.build();
}
