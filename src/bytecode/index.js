export {
  BYTECODE_VERSION,
  OPCODES,
  OPCODE_NAMES,
  INSTRUCTION_SPECS,
} from './opcodes.js';
export {
  TAG_NULL,
  TAG_UNDEFINED,
  TAG_FALSE,
  TAG_TRUE,
  TAG_INT32,
  TAG_FLOAT64,
  TAG_BIGINT,
  TAG_STRING,
  TAG_STRING_REF,
  TAG_PARAMETERS,
  TAG_BYTECODE,
  TAG_NAN,
  TAG_INFINITY,
  TAG_NEG_INFINITY,
  TAG_SEALED_PROGRAM,
  writeVarint,
  readVarint,
  writeInt32,
  readInt32,
  writeFloat64,
  readFloat64,
  writeString,
  readString,
  encodeBytecode,
  decodeBytecode,
} from './binary-serializer.js';
export { BytecodeProgram, BytecodeBuilder } from './bytecode-builder.js';
export { assembleTextToBytecode } from './assemble.js';
export {
  createNumericOpcodeAliases,
  collectUsedOpcodesFromBytecode,
  remapBytecodeProgram,
  skipOperand,
} from './polymorphic.js';
