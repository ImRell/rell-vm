import { OPCODES, OPCODE_NAMES, INSTRUCTION_SPECS, BYTECODE_VERSION } from './opcodes.js';
import { BytecodeProgram } from './bytecode-builder.js';

/**
 * Creates a random bijection of numeric opcodes:
 * canonical ID (0..N) -> randomized ID (0..N).
 *
 * @returns {Map<number, number>}
 */
export function createNumericOpcodeAliases() {
  const count = Object.keys(OPCODES).length;
  const perm = Array.from({ length: count }, (_, i) => i);
  // Fisher-Yates shuffle for uniform random permutation
  for (let i = count - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [perm[i], perm[j]] = [perm[j], perm[i]];
  }
  const mapping = new Map();
  for (let i = 0; i < count; i++) {
    mapping.set(i, perm[i]);
  }
  return mapping;
}

export function skipOperand(code, offset, type) {
  if (type === 'byte' || type === 'boolean' || type === 'bindingKind') {
    return offset + 1;
  }
  if (type === 'label') {
    return offset + 4;
  }
  // Varint (constIndex, slot, count)
  while (offset < code.length && (code[offset] & 0x80)) {
    offset++;
  }
  return offset + 1;
}

/**
 * Scans bytecode (including nested functions) and collects the set of used symbolic opcodes.
 *
 * @param {import('./bytecode-builder.js').BytecodeProgram|object} program
 * @param {Set<string>} [used]
 * @returns {Set<string>}
 */
export function collectUsedOpcodesFromBytecode(program, used = new Set()) {
  if (!program || !(program.code instanceof Uint8Array)) {
    return used;
  }

  const code = program.code;
  let pc = 0;
  while (pc < code.length) {
    const opcode = code[pc];
    const opName = OPCODE_NAMES[opcode];
    if (!opName) {
      break;
    }
    used.add(opName);

    if (opName === 'macro.local_const_add' || opName === 'macro.local_local_add') {
      used.add('js.add');
    } else if (opName === 'macro.local_const_sub') {
      used.add('js.sub');
    } else if (opName === 'macro.local_local_strict_eq') {
      used.add('js.strict_eq');
    }

    pc++;
    const spec = INSTRUCTION_SPECS[opName];
    if (spec && spec.operands) {
      for (const operandType of spec.operands) {
        pc = skipOperand(code, pc, operandType);
      }
    }
  }

  if (Array.isArray(program.constants)) {
    for (const val of program.constants) {
      if (val && val.code instanceof Uint8Array) {
        collectUsedOpcodesFromBytecode(val, used);
      }
    }
  }

  return used;
}

/**
 * Remaps opcodes in the bytecode buffer and in all nested functions.
 *
 * @param {import('./bytecode-builder.js').BytecodeProgram|object} program
 * @param {Map<number, number>} mapping
 * @returns {import('./bytecode-builder.js').BytecodeProgram}
 */
export function remapBytecodeProgram(program, mapping) {
  if (!mapping || !(mapping instanceof Map)) {
    return program;
  }

  const oldCode = program.code;
  const newCode = new Uint8Array(oldCode.length);
  newCode.set(oldCode);

  let pc = 0;
  while (pc < newCode.length) {
    const canonicalOp = newCode[pc];
    const opName = OPCODE_NAMES[canonicalOp];
    if (!opName) {
      throw new Error(`Unknown canonical opcode at pc ${pc}: ${canonicalOp}`);
    }

    // Replace opcode with mapped alias
    if (mapping.has(canonicalOp)) {
      newCode[pc] = mapping.get(canonicalOp);
    }

    pc++;

    const spec = INSTRUCTION_SPECS[opName];
    if (spec && spec.operands) {
      for (const operandType of spec.operands) {
        pc = skipOperand(newCode, pc, operandType);
      }
    }
  }

  // Recursively remap nested programs in constants
  const newConstants = program.constants.map((val) => {
    if (val && val.code instanceof Uint8Array && Array.isArray(val.constants)) {
      return remapBytecodeProgram(val, mapping);
    }
    return val;
  });

  return new BytecodeProgram(String(program), {
    version: program.version ?? BYTECODE_VERSION,
    code: newCode,
    constants: Object.freeze(newConstants),
  });
}
