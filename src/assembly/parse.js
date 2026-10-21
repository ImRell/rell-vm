import { createRegExpLiteral } from '../runtime/regexp-literal.js';
import { ASSEMBLY_VERSION, INSTRUCTIONS, DIRECTIVES } from './instructions.js';

import { tokenizeAssembly } from './tokenize.js';

const LABEL_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const SLOT_PATTERN = /^(?:0|[1-9][0-9]*)$/;
const NUMBER_PATTERN = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/;
const BIGINT_PATTERN = /^-?(?:0|[1-9][0-9]*)n$/;

const SPECIAL_LITERALS = new Map([
  ['undefined', undefined],
  ['null', null],
  ['true', true],
  ['false', false],
  ['NaN', NaN],
  ['Infinity', Infinity],
  ['-Infinity', -Infinity],
]);

/**
 * Parses assembly program source into prepared instructions.
 *
 * Jump arguments retain label names.
 * The additional target field contains the index of the target instruction.
 *
 * Does not execute the program and does not check stack height
 * across all control flow paths.
 *
 * @param {string} source
 * @param {{decodeString?: (reference: string) => string}} [options]
 * @returns {object}
 */
export function parseAssembly(
  source,
  { decodeString, allowProtectedReferences = false } = {},
) {
  if (decodeString !== undefined && decodeString !== null && typeof decodeString !== 'function')
    throw new TypeError('decodeString must be a function');
  const lines = tokenizeAssembly(source);
  const instructions = [];
  const labels = new Map();

  for (const { line, tokens } of lines) {
    const head = tokens[0];

    if (head.type !== 'word') {
      fail(line, head.column, 'Expected instruction name');
    }

    const name = head.value;
    let definition;

    if (Object.hasOwn(INSTRUCTIONS, name)) {
      definition = INSTRUCTIONS[name];
    } else if (Object.hasOwn(DIRECTIVES, name)) {
      definition = DIRECTIVES[name];
    } else {
      fail(line, head.column, `Unknown instruction: ${name}`);
    }

    const argumentTokens = tokens.slice(1);

    if (argumentTokens.length !== definition.operands.length) {
      fail(
        line,
        head.column,
        `${name} expects ${definition.operands.length} arguments, ` +
        `received ${argumentTokens.length}`,
      );
    }

    const args = [];
    const protectedIndices = new Set();
    definition.operands.forEach((type, index) => {
      const token = argumentTokens[index];
      if (token.type === 'word' && token.value.startsWith('@')) {
        if (
          !/^@[a-f0-9]{16}$/.test(token.value) ||
          (!decodeString && !allowProtectedReferences) ||
          !['literal', 'name', 'text', 'parameters'].includes(type)
        )
          fail(line, token.column, 'Invalid protected operand');
        protectedIndices.add(index);

        if (
          decodeString &&
          allowProtectedReferences &&
          (type === 'parameters' ||
            (index === 3 &&
              (name === 'js.function.create' ||
                name === 'js.function.named.create')))
        ) {
          const value = decodeString(token.value);
          if (type === 'parameters') {
            try {
              args[index] = Object.freeze(JSON.parse(value));
            } catch {
              fail(line, token.column, 'Invalid parameters in protected operand');
            }
          } else {
            args[index] = value;
          }
          return;
        }

        if (decodeString && !allowProtectedReferences) {
          Object.defineProperty(args, index, {
            enumerable: true,
            get() {
              const value = decodeString(token.value);
              if (typeof value !== 'string')
                fail(
                  line,
                  token.column,
                  'Protected operand must decode to a string',
                );
              return parseOperand(
                { type: 'string', value, column: token.column },
                type,
                line,
              );
            },
          });
          return;
        }

        args[index] = token.value;
        return;
      }
      args[index] = parseOperand(token, type, line);
    });

    if (name === 'js.regexp.create' && protectedIndices.size === 0) {
      try {
        createRegExpLiteral(args[0], args[1]);
      } catch (error) {
        fail(line, head.column, `Invalid RegExp literal: ${error.message}`);
      }
    }
    if (name === 'js.function.create' || name === 'js.function.named.create') {
      if (
        name === 'js.function.named.create' &&
        !protectedIndices.has(0) &&
        args[0].length === 0
      ) {
        fail(
          line,
          argumentTokens[0].column,
          'Named function expression requires a non-empty name',
        );
      }
      if (
        !protectedIndices.has(1) &&
        args[2] &&
        new Set(args[1]).size !== args[1].length
      )
        fail(
          line,
          argumentTokens[1].column,
          'Duplicate parameter in strict function',
        );
      // Packed bodies were validated before encryption. Do not open all nested
      // bodies during load: VMFunction validates them when actually created.
      if (!protectedIndices.has(3))
        try {
          parseAssembly(args[3], { decodeString });
        } catch (error) {
          if (!(error instanceof SyntaxError)) throw error;
          fail(
            line,
            argumentTokens[3].column,
            `Invalid function body: ${error.message}`,
          );
        }
    }
    if (name === 'label') {
      const label = args[0];

      if (labels.has(label)) {
        fail(line, head.column, `Duplicate label: ${label}`);
      }

      labels.set(label, instructions.length);
      continue;
    }

    instructions.push({
      op: name,
      args,
      line,
      column: head.column,
    });
  }

  if (instructions.length === 0) {
    throw new SyntaxError(
      'Assembly program must contain at least one instruction',
    );
  }

  for (const instruction of instructions) {
    const flow = INSTRUCTIONS[instruction.op].flow;

    if (flow === 'jump' || flow === 'branch') {
      const label = instruction.args[0];

      if (!labels.has(label)) {
        fail(instruction.line, instruction.column, `Unknown label: ${label}`);
      }

      const target = labels.get(label);

      if (target >= instructions.length) {
        fail(
          instruction.line,
          instruction.column,
          `Label does not point to an instruction: ${label}`,
        );
      }

      instruction.target = target;
    }

    if (instruction.op === 'js.try.enter') {
      instruction.targets = Object.freeze(
        instruction.args.slice(0, 3).map((label) => {
          if (!labels.has(label))
            fail(
              instruction.line,
              instruction.column,
              `Unknown label: ${label}`,
            );
          const target = labels.get(label);
          if (target >= instructions.length)
            fail(
              instruction.line,
              instruction.column,
              `Label does not point to an instruction: ${label}`,
            );
          return target;
        }),
      );
      if (!instruction.args[3] && !instruction.args[4])
        fail(
          instruction.line,
          instruction.column,
          'try requires catch or finally',
        );
    }
    Object.freeze(instruction.args);
    Object.freeze(instruction);
  }

  return Object.freeze({
    version: ASSEMBLY_VERSION,
    instructions: Object.freeze(instructions),
  });
}

function parseOperand(token, type, line) {
  if (type === 'text') {
    if (token.type !== 'string')
      fail(line, token.column, 'Expected quoted text');
    return token.value;
  }
  if (type === 'parameters') {
    if (token.type !== 'string')
      fail(line, token.column, 'Expected quoted JSON parameter list');
    let parameters;
    try {
      parameters = JSON.parse(token.value);
    } catch {
      fail(line, token.column, 'Invalid JSON parameter list');
    }
    if (
      !Array.isArray(parameters) ||
      parameters.some((name) => typeof name !== 'string' || name.length === 0)
    )
      fail(
        line,
        token.column,
        'Parameters must be an array of non-empty strings',
      );
    return Object.freeze(parameters);
  }
  if (type === 'literal') {
    return parseLiteral(token, line);
  }

  if (type === 'name') {
    if (token.type !== 'string' || token.value.length === 0) {
      fail(line, token.column, 'Expected non-empty quoted name');
    }

    return token.value;
  }

  if (token.type !== 'word') {
    fail(line, token.column, `Expected ${type}, received string`);
  }

  const value = token.value;

  switch (type) {
    case 'slot':
    case 'count': {
      const number = Number(value);

      if (!SLOT_PATTERN.test(value) || !Number.isSafeInteger(number)) {
        const label = type === 'slot' ? 'slot' : 'argument count';

        fail(line, token.column, `Invalid ${label}: ${value}`);
      }

      return number;
    }

    case 'boolean':
      if (value !== 'true' && value !== 'false')
        fail(line, token.column, `Invalid boolean: ${value}`);
      return value === 'true';
    case 'bindingKind':
      if (value !== 'let' && value !== 'const') {
        fail(line, token.column, `Invalid binding kind: ${value}`);
      }
      return value;

    case 'label':
      if (!LABEL_PATTERN.test(value)) {
        fail(line, token.column, `Invalid label name: ${value}`);
      }
      return value;

    default:
      throw new Error(`Unsupported operand type in contract: ${type}`);
  }
}

function parseLiteral(token, line) {
  if (token.type === 'string') {
    return token.value;
  }

  const value = token.value;

  if (SPECIAL_LITERALS.has(value)) {
    return SPECIAL_LITERALS.get(value);
  }

  if (BIGINT_PATTERN.test(value)) {
    return BigInt(value.slice(0, -1));
  }

  if (NUMBER_PATTERN.test(value)) {
    const number = Number(value);

    if (!Number.isFinite(number)) {
      fail(
        line,
        token.column,
        'Numeric literal overflow; use Infinity or -Infinity explicitly',
      );
    }

    return number;
  }

  fail(line, token.column, `Invalid literal: ${value}`);
}

function fail(line, column, message) {
  throw new SyntaxError(`Assembly ${line}:${column}: ${message}`);
}
