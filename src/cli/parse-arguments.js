import { parseArgs } from 'node:util';

export const HELP_TEXT = `
Usage:
  node bin/jsvm.js <input.js> --output <output.js> [options]

Obfuscation is ON by default: name mangling, encrypted program and lazy strings, random instruction dialect, runtime minification.
Options:
  -o, --output <path>    Output JavaScript file (overwritten if it exists)
      --keep-function-names  Preserve function.name, still hide local/parameter names
      --no-mangle-names  Disable metadata name mangling (debugging/reflection)
      --no-randomize-instructions  Use canonical instruction names (debugging)
      --no-encrypt-program  Disable whole-program envelope (strings stay protected)
      --expose-function-metadata  Publish VM internals on functions (debugging only)
      --no-mangle-properties  Keep internal VM property names (debugging)
      --no-prune-opcodes  Keep all VM opcode handlers (debugging)
      --no-mask-errors  Keep detailed VM diagnostics (debugging)
      --no-protect-strings  Disable lazy string operand encryption (debugging)
      --no-minify       Keep runtime formatting (debugging)
      --no-normalize    Skip Babel ES6+ to ES5 normalization
      --mangle-names    Explicitly enable name mangling (already the default)
      --encrypt-program  Explicitly enable encryption (already the default)
      --minify          Explicitly enable minification (already the default)
  -h, --help            Show this help

Examples:
  node bin/jsvm.js input.js --output output.js
  node bin/jsvm.js input.js -o debug.js --no-mangle-names --no-encrypt-program --no-randomize-instructions --no-protect-strings --no-minify
`.trim();

/**
 * Разбирает аргументы без обращения к process.argv и файловой системе.
 *
 * @param {string[]} args
 * @returns {
 *   { help: true } |
 *   {
 *     help: false,
 *     inputPath: string,
 *     outputPath: string,
 *     minify: boolean,
 *     encryptProgram: boolean,
 *     randomizeInstructions: boolean,
 *     mangleProperties: boolean,
 *     pruneOpcodes: boolean,
 *     maskErrors: boolean,
 *     exposeFunctionMetadata: boolean,
 *     normalize: boolean,
 *     mangleNames: boolean,
 *     protectStrings: boolean,
 *     keepFunctionNames: boolean
 *   }
 * }
 */
export function parseArguments(args) {
  if (
    !Array.isArray(args) ||
    !args.every((argument) => typeof argument === 'string')
  ) {
    throw new TypeError('Arguments must be an array of strings');
  }

  const { values, positionals, tokens } = parseArgs({
    args,
    strict: true,
    allowPositionals: true,
    tokens: true,

    options: {
      output: {
        type: 'string',
        short: 'o',
      },
      minify: {
        type: 'boolean',
      },
      'mangle-names': { type: 'boolean' },
      'no-mangle-names': { type: 'boolean' },
      'encrypt-program': { type: 'boolean' },
      'randomize-instructions': { type: 'boolean' },
      'no-randomize-instructions': { type: 'boolean' },
      'no-encrypt-program': { type: 'boolean' },
      'mangle-properties': { type: 'boolean' },
      'no-mangle-properties': { type: 'boolean' },
      'prune-opcodes': { type: 'boolean' },
      'no-prune-opcodes': { type: 'boolean' },
      'mask-errors': { type: 'boolean' },
      'no-mask-errors': { type: 'boolean' },
      'protect-strings': { type: 'boolean' },
      'no-protect-strings': { type: 'boolean' },
      'no-minify': { type: 'boolean' },
      'expose-function-metadata': { type: 'boolean' },
      'keep-function-names': { type: 'boolean' },
      'no-normalize': {
        type: 'boolean',
      },
      help: {
        type: 'boolean',
        short: 'h',
      },
    },
  });

  const seenOptions = new Set();

  for (const token of tokens) {
    if (token.kind !== 'option') {
      continue;
    }

    if (seenOptions.has(token.name)) {
      throw new TypeError(`Option --${token.name} must not be repeated`);
    }

    seenOptions.add(token.name);
  }

  if (values.help === true) {
    return { help: true };
  }

  if (positionals.length !== 1) {
    throw new TypeError('Exactly one input file is required');
  }

  const inputPath = positionals[0];
  const outputPath = values.output;

  if (inputPath.trim().length === 0) {
    throw new TypeError('Input path must not be empty');
  }

  if (typeof outputPath !== 'string' || outputPath.trim().length === 0) {
    throw new TypeError('A non-empty --output path is required');
  }

  for (const name of [
    'mangle-names',
    'encrypt-program',
    'randomize-instructions',
    'minify',
    'mangle-properties',
    'prune-opcodes',
    'mask-errors',
    'protect-strings',
  ]) {
    if (values[name] && values[`no-${name}`])
      throw new TypeError(`--${name} conflicts with --no-${name}`);
  }
  if (values['keep-function-names'] && values['no-mangle-names'])
    throw new TypeError(
      '--keep-function-names requires name mangling; remove --no-mangle-names',
    );

  return {
    help: false,
    inputPath,
    outputPath,
    minify: values['no-minify'] !== true,
    normalize: values['no-normalize'] !== true,
    mangleNames: values['no-mangle-names'] !== true,
    encryptProgram: values['no-encrypt-program'] !== true,
    randomizeInstructions: values['no-randomize-instructions'] !== true,
    mangleProperties: values['no-mangle-properties'] !== true,
    pruneOpcodes: values['no-prune-opcodes'] !== true,
    maskErrors: values['no-mask-errors'] !== true,
    protectStrings: values['no-protect-strings'] !== true,
    exposeFunctionMetadata: values['expose-function-metadata'] ?? false,
    keepFunctionNames: values['keep-function-names'] ?? false,
  };
}
