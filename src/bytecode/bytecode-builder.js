import { OPCODES, INSTRUCTION_SPECS, BYTECODE_VERSION } from './opcodes.js';
import {
  writeVarint,
  writeInt32,
  encodeBytecode,
} from './binary-serializer.js';
import { createRegExpLiteral } from '../runtime/regexp-literal.js';

export class BytecodeProgram extends String {
  constructor(text, { version, code, constants, instructions }) {
    super(text);
    Object.defineProperty(this, 'version', {
      value: version,
      writable: true,
      configurable: true,
      enumerable: true,
    });
    Object.defineProperty(this, 'code', {
      value: code,
      writable: true,
      configurable: true,
      enumerable: true,
    });
    Object.defineProperty(this, 'constants', {
      value: constants,
      writable: true,
      configurable: true,
      enumerable: true,
    });
    Object.defineProperty(this, 'instructions', {
      value: instructions ?? code,
      writable: true,
      configurable: true,
      enumerable: true,
    });
  }
}

function varintLength(value) {
  let len = 1;
  let v = value;
  while (v >= 0x80) {
    len++;
    v >>>= 7;
  }
  return len;
}

export class BytecodeBuilder {
  #instructions = [];
  #labels = new Map();
  #constants = [];
  #constantLookup = new Map();

  /**
   * Creates a branch label.
   *
   * @returns {object}
   */
  createLabel() {
    const label = Object.freeze(Object.create(null));
    this.#labels.set(label, {
      id: this.#labels.size,
      marked: false,
      offset: null,
    });
    return label;
  }

  /**
   * Binds a label to the next instruction.
   *
   * @param {object} label
   * @returns {void}
   */
  markLabel(label) {
    const def = this.#labels.get(label);
    if (!def) {
      throw new Error('Label does not belong to this builder');
    }
    if (def.marked) {
      throw new Error('Label is already marked');
    }
    def.marked = true;
    this.#instructions.push({ type: 'label', label: def });
  }

  /**
   * Emits an instruction with operands.
   *
   * @param {string} op
   * @param {...unknown} args
   * @returns {void}
   */
  emit(op, ...args) {
    if (typeof op !== 'string' || !Object.hasOwn(OPCODES, op)) {
      throw new TypeError(`Unknown instruction: ${String(op)}`);
    }

    const spec = INSTRUCTION_SPECS[op];
    if (args.length !== spec.operands.length) {
      throw new TypeError(
        `${op} expects ${spec.operands.length} arguments, received ${args.length}`,
      );
    }

    const operands = spec.operands.map((type, index) => {
      const val = args[index];
      if (type === 'label') {
        const def = this.#labels.get(val);
        if (!def) throw new TypeError(`Expected label operand for ${op}`);
        return def;
      }
      return val;
    });

    if (op === 'js.regexp.create') {
      if (
        typeof args[0] === 'string' &&
        typeof args[1] === 'string' &&
        !args[0].startsWith('@') &&
        !args[1].startsWith('@')
      ) {
        createRegExpLiteral(args[0], args[1]);
      }
    }

    this.#instructions.push({
      type: 'instruction',
      op,
      opcode: OPCODES[op],
      operands,
      spec,
    });
  }

  #addConstant(value) {
    // Deduplicate primitives (except objects/functions, NaN, and -0)
    let key = null;
    if (
      value === null ||
      value === undefined ||
      typeof value === 'boolean' ||
      typeof value === 'string' ||
      typeof value === 'bigint' ||
      (typeof value === 'number' && Number.isFinite(value) && !Object.is(value, -0))
    ) {
      key = typeof value + ':' + String(value);
      if (this.#constantLookup.has(key)) {
        return this.#constantLookup.get(key);
      }
    }

    const index = this.#constants.length;
    this.#constants.push(value);
    if (key !== null) {
      this.#constantLookup.set(key, index);
    }
    return index;
  }

  /**
   * Builds the bytecode program.
   *
   * @returns {{
   *   version: number,
   *   constants: Array<unknown>,
   *   code: Uint8Array
   * }}
   */
  build() {
    // Verify that all labels were marked
    for (const [label, def] of this.#labels) {
      if (!def.marked) {
        throw new Error(`Unmarked label L${def.id}`);
      }
    }

    // Prepare constants and instructions
    const prepared = [];
    for (const item of this.#instructions) {
      if (item.type === 'label') {
        prepared.push(item);
        continue;
      }

      const { op, opcode, operands, spec } = item;
      const encodedArgs = [];

      spec.operands.forEach((type, i) => {
        const val = operands[i];
        switch (type) {
          case 'literal':
          case 'name':
          case 'text':
          case 'parameters':
          case 'bytecode': {
            const constIdx = this.#addConstant(val);
            encodedArgs.push({ type: 'constIndex', value: constIdx });
            break;
          }
          case 'slot':
          case 'count': {
            if (!Number.isSafeInteger(val) || val < 0) {
              throw new TypeError(`Invalid ${type}: ${val}`);
            }
            encodedArgs.push({ type: 'varint', value: val });
            break;
          }
          case 'boolean': {
            if (typeof val !== 'boolean') {
              throw new TypeError(`Expected boolean operand, received ${val}`);
            }
            encodedArgs.push({ type: 'byte', value: val ? 1 : 0 });
            break;
          }
          case 'bindingKind': {
            if (val !== 'let' && val !== 'const') {
              throw new TypeError(`Invalid bindingKind: ${val}`);
            }
            encodedArgs.push({ type: 'byte', value: val === 'let' ? 0 : 1 });
            break;
          }
          case 'label': {
            encodedArgs.push({ type: 'label', label: val });
            break;
          }
          default:
            throw new Error(`Unknown operand type: ${type}`);
        }
      });

      prepared.push({
        type: 'instruction',
        op,
        opcode,
        args: encodedArgs,
      });
    }

    // Pass 1: compute exact byte offsets for each instruction and label
    let currentOffset = 0;
    for (const item of prepared) {
      if (item.type === 'label') {
        item.label.offset = currentOffset;
      } else {
        item.offset = currentOffset;
        let len = 1; // 1 byte opcode
        for (const arg of item.args) {
          if (arg.type === 'byte') {
            len += 1;
          } else if (arg.type === 'varint' || arg.type === 'constIndex') {
            len += varintLength(arg.value);
          } else if (arg.type === 'label') {
            len += 4; // 4 bytes int32 offset
          }
        }
        currentOffset += len;
      }
    }

    // Pass 2: encode bytes and generate text representation
    const codeBuffer = [];
    const textLines = [];

    for (const item of this.#instructions) {
      if (item.type === 'label') {
        textLines.push(`label L${item.label.id}`);
        continue;
      }
      const formattedArgs = item.operands.map((val, idx) => {
        const type = item.spec.operands[idx];
        if (type === 'label') return `L${val.id}`;
        return formatOperand(val, type);
      });
      textLines.push([item.op, ...formattedArgs].join(' '));
    }

    for (const item of prepared) {
      if (item.type === 'label') continue;

      codeBuffer.push(item.opcode);
      for (const arg of item.args) {
        if (arg.type === 'byte') {
          codeBuffer.push(arg.value);
        } else if (arg.type === 'varint' || arg.type === 'constIndex') {
          writeVarint(codeBuffer, arg.value);
        } else if (arg.type === 'label') {
          const targetOffset = arg.label.offset;
          if (targetOffset === null) {
            throw new Error(`Target offset unresolved for label L${arg.label.id}`);
          }
          writeInt32(codeBuffer, targetOffset);
        }
      }
    }

    const text = textLines.length > 0 ? `${textLines.join('\n')}\n` : '';

    const instructionList = Object.freeze(
      this.#instructions
        .filter((item) => item.type === 'instruction')
        .map((item) => Object.freeze({ op: item.op, args: item.operands })),
    );

    return Object.freeze(
      new BytecodeProgram(text, {
        version: BYTECODE_VERSION,
        constants: [...this.#constants],
        code: new Uint8Array(codeBuffer),
        instructions: instructionList,
      }),
    );
  }

  /**
   * Builds and returns serialized Uint8Array.
   *
   * @returns {Uint8Array}
   */
  buildBytes() {
    return encodeBytecode(this.build());
  }
}

function formatOperand(value, type) {
  switch (type) {
    case 'bytecode':
    case 'text':
      if (typeof value === 'string' && value.startsWith('@')) {
        return value;
      }
      if (typeof value !== 'string' && !(value instanceof BytecodeProgram))
        throw new TypeError('Text must be a string or BytecodeProgram');
      return quoteString(String(value));
    case 'parameters':
      if (typeof value === 'string' && value.startsWith('@')) {
        return value;
      }
      if (
        !Array.isArray(value) ||
        Array.from(value).some(
          (name) => typeof name !== 'string' || name.length === 0,
        )
      )
        throw new TypeError('Parameters must be an array of non-empty strings');
      return quoteString(JSON.stringify(value));
    case 'boolean':
      if (typeof value !== 'boolean')
        throw new TypeError('Boolean operand must be a boolean');
      return String(value);
    case 'literal':
      return formatLiteral(value);
    case 'slot':
    case 'count':
      if (!Number.isSafeInteger(value) || value < 0) {
        const label = type === 'slot' ? 'Slot' : 'Argument count';
        throw new TypeError(`${label} must be a non-negative safe integer`);
      }
      return String(value);
    case 'name':
      if (typeof value === 'string' && value.startsWith('@')) {
        return value;
      }
      if (typeof value !== 'string' || value.length === 0) {
        throw new TypeError('Name must be a non-empty string');
      }
      return quoteString(value);
    case 'bindingKind':
      if (value !== 'let' && value !== 'const') {
        throw new TypeError('Binding kind must be let or const');
      }
      return value;
    default:
      throw new Error(`Unsupported operand type: ${type}`);
  }
}

function formatLiteral(value) {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'undefined':
      return 'undefined';
    case 'boolean':
      return value ? 'true' : 'false';
    case 'string':
      return quoteString(value);
    case 'number':
      return Object.is(value, -0) ? '-0' : String(value);
    case 'bigint':
      return `${value.toString()}n`;
    default:
      throw new TypeError('Only primitive non-symbol literals are supported');
  }
}

function quoteString(value) {
  return JSON.stringify(value)
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}
