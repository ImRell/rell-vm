export { compileToAssembly, compileToBytecode } from './compile-assembly.js';
export { normalizeSource } from './normalize-source.js';
export { parseSource } from './parse.js';
export { collectVarNames } from './collect-var-names.js';
export { LexicalScope } from './scope.js';
export { AssemblyBuilder } from './assembly-builder.js';
export {
  BINARY_OPERATORS,
  UNARY_OPERATORS,
  ASSIGNMENT_OPERATORS,
} from './operators.js';
export {
  assertFunction,
  assertDeclaration,
  unsupported,
} from './assertions.js';
