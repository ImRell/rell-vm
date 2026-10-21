import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import {
  collectUsedOpcodes,
  runtimeHardeningPlugin,
  runtimePropertyOptions,
} from './runtime-hardening.js';
import { protectAssemblyStrings } from './protect-strings.js';
import { sealProgram } from './seal-program.js';
import { createStringDecoder } from '../runtime/string-decoder.js';
import { assembleTextToBytecode } from '../bytecode/assemble.js';
import { encodeBytecode } from '../bytecode/binary-serializer.js';
import {
  createNumericOpcodeAliases,
  remapBytecodeProgram,
  collectUsedOpcodesFromBytecode,
} from '../bytecode/polymorphic.js';

import { mangleAssemblyNames } from '../assembly/mangle-names.js';
import { parseAssembly } from '../assembly/parse.js';

const SOURCE_DIRECTORY = fileURLToPath(new URL('../', import.meta.url));

/**
 * Combines instruction text and VM runtime
 * into a standalone browser script.
 *
 * Does not execute the program and does not write files.
 *
 * @param {string} assembly
 * @param {{ minify?: boolean, mangleNames?: boolean, keepFunctionNames?: boolean, encryptProgram?: boolean, exposeFunctionMetadata?: boolean, randomizeInstructions?: boolean, mangleProperties?: boolean, pruneOpcodes?: boolean, maskErrors?: boolean, protectStrings?: boolean }} [options]
 * @returns {Promise<string>}
 */
export async function buildBrowserScript(
  assembly,
  {
    minify = true,
    mangleNames = true,
    keepFunctionNames = false,
    encryptProgram = true,
    exposeFunctionMetadata = false,
    randomizeInstructions = true,
    mangleProperties = true,
    pruneOpcodes = true,
    maskErrors = true,
    protectStrings = true,
    shuffleHandlers = true,
  } = {},
) {
  for (const [name, value] of Object.entries({
    mangleProperties,
    pruneOpcodes,
    maskErrors,
    protectStrings,
    shuffleHandlers,
  }))
    if (typeof value !== 'boolean')
      throw new TypeError(name + ' must be a boolean');
  if (typeof randomizeInstructions !== 'boolean')
    throw new TypeError('randomizeInstructions must be a boolean');
  if (typeof exposeFunctionMetadata !== 'boolean')
    throw new TypeError('exposeFunctionMetadata must be a boolean');
  if (typeof encryptProgram !== 'boolean')
    throw new TypeError('encryptProgram must be a boolean');
  if (typeof minify !== 'boolean') {
    throw new TypeError('minify must be a boolean');
  }

  if (typeof mangleNames !== 'boolean')
    throw new TypeError('mangleNames must be a boolean');
  if (typeof keepFunctionNames !== 'boolean')
    throw new TypeError('keepFunctionNames must be a boolean');
  if (keepFunctionNames && !mangleNames)
    throw new TypeError('keepFunctionNames requires mangleNames');
  // Validate source before bundling.
  let program = mangleNames
    ? mangleAssemblyNames(assembly, { keepFunctionNames })
    : assembly;
  if (!mangleNames) parseAssembly(program);

  const usedOpcodes = collectUsedOpcodes(program);

  let stringEntries;
  if (protectStrings) {
    const protectedProgram = protectAssemblyStrings(program);
    program = protectedProgram.program;
    stringEntries = protectedProgram.entries;
  }
  const decoderSource = protectStrings
    ? 'decodeString: createStringDecoder(' +
      JSON.stringify(stringEntries).replace(/</g, '\\u003c') +
      '),'
    : '';

  const buildTimeDecoder = protectStrings
    ? createStringDecoder(stringEntries)
    : null;

  const bytecode = assembleTextToBytecode(program, {
    decodeString: buildTimeDecoder,
  });
  collectUsedOpcodesFromBytecode(bytecode, usedOpcodes);
  const numericMapping = randomizeInstructions ? createNumericOpcodeAliases() : null;

  let stdinContents;
  if (encryptProgram) {
    const remapped = numericMapping ? remapBytecodeProgram(bytecode, numericMapping) : bytecode;
    const sealedChildren = sealNestedBytecodes(remapped);
    const binaryBytes = encodeBytecode(sealedChildren);
    const sealed = sealProgram(binaryBytes);
    const embeddedSource = JSON.stringify(sealed)
      .replace(/</g, '\\u003c')
      .replace(/\u2028/g, '\\u2028')
      .replace(/\u2029/g, '\\u2029');

    stdinContents = [
      'import { executeBytecode } from "./runtime/execute-bytecode.js";',
      ...(protectStrings
        ? ['import { createStringDecoder } from "./runtime/string-decoder.js";']
        : []),
      'import { openProgramEnvelope } from "./runtime/open-program.js";',
      `executeBytecode(openProgramEnvelope(${embeddedSource}), {${decoderSource}exposeFunctionMetadata: ${exposeFunctionMetadata}});`,
    ].join('\n');
  } else {
    const programObj = numericMapping ? remapBytecodeProgram(bytecode, numericMapping) : bytecode;
    const embeddedObj = `{version:${programObj.version},constants:${serializeConstantsForScript(programObj.constants)},code:new Uint8Array([${Array.from(programObj.code).join(',')}])}`;

    stdinContents = [
      'import { executeBytecode } from "./runtime/execute-bytecode.js";',
      ...(protectStrings
        ? ['import { createStringDecoder } from "./runtime/string-decoder.js";']
        : []),
      `executeBytecode(${embeddedObj}, {${decoderSource}exposeFunctionMetadata: ${exposeFunctionMetadata}});`,
    ].join('\n');
  }

  const result = await build({
    stdin: {
      contents: stdinContents,
      resolveDir: SOURCE_DIRECTORY,
      sourcefile: 'jsvm-entry.js',
      loader: 'js',
    },

    plugins: [
      runtimeHardeningPlugin({
        sourceDirectory: SOURCE_DIRECTORY,
        numericMapping,
        usedOpcodes,
        pruneOpcodes,
        maskErrors,
        shuffleHandlers,
      }),
    ],
    ...runtimePropertyOptions(mangleProperties && !exposeFunctionMetadata),
    bundle: true,
    write: false,

    platform: 'browser',
    format: 'iife',
    target: 'es2022',

    minify,
    treeShaking: true,
    sourcemap: false,
    legalComments: 'none',
    charset: 'ascii',
    logLevel: 'silent',
  });

  if (result.outputFiles.length !== 1) {
    throw new Error('Browser build must produce exactly one output file');
  }

  return result.outputFiles[0].text;
}

function serializeConstantsForScript(constants) {
  const parts = constants.map((val) => {
    if (val === null) return 'null';
    if (val === undefined) return 'undefined';
    if (typeof val === 'number') {
      return Object.is(val, -0) ? '-0' : String(val);
    }
    if (typeof val === 'boolean') return String(val);
    if (typeof val === 'string') {
      return JSON.stringify(val).replace(/</g, '\\u003c');
    }
    if (typeof val === 'bigint') return `${val}n`;
    if (Array.isArray(val)) return JSON.stringify(val);
    if (val && val.code instanceof Uint8Array) {
      return `{version:${val.version},constants:${serializeConstantsForScript(val.constants)},code:new Uint8Array([${Array.from(val.code).join(',')}])}`;
    }
    return JSON.stringify(val);
  });
  return `[${parts.join(',')}]`;
}

function sealNestedBytecodes(program) {
  if (!program || !Array.isArray(program.constants)) return program;
  const newConstants = program.constants.map((val) => {
    if (val && val.code instanceof Uint8Array) {
      const childWithSealedChildren = sealNestedBytecodes(val);
      const childBytes = encodeBytecode(childWithSealedChildren);
      return sealProgram(childBytes);
    }
    return val;
  });
  return {
    version: program.version,
    code: program.code,
    constants: newConstants,
    instructions: program.instructions,
  };
}

