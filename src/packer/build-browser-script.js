import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import {
  createInstructionAliases,
  relabelAssembly,
} from './randomize-instructions.js';
import {
  collectUsedOpcodes,
  runtimeHardeningPlugin,
  runtimePropertyOptions,
} from './runtime-hardening.js';
import { protectAssemblyStrings } from './protect-strings.js';
import { sealProgram } from './seal-program.js';

import { mangleAssemblyNames } from '../assembly/mangle-names.js';
import { parseAssembly } from '../assembly/parse.js';

const SOURCE_DIRECTORY = fileURLToPath(new URL('../', import.meta.url));

/**
 * Объединяет текст инструкций и текстовый runtime
 * в самостоятельный браузерный скрипт.
 *
 * Не выполняет программу и не записывает файлы.
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
  } = {},
) {
  for (const [name, value] of Object.entries({
    mangleProperties,
    pruneOpcodes,
    maskErrors,
    protectStrings,
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

  // Проверяем текст до упаковки.
  // Подготовленные объекты не встраиваем:
  // входом браузерной VM останется строка.
  let program = mangleNames
    ? mangleAssemblyNames(assembly, { keepFunctionNames })
    : assembly;
  if (!mangleNames) parseAssembly(program);

  const usedOpcodes = collectUsedOpcodes(program);
  const aliases = randomizeInstructions ? createInstructionAliases() : null;
  if (aliases) program = relabelAssembly(program, aliases);

  let stringEntries;
  if (protectStrings) {
    const protectedProgram = protectAssemblyStrings(program, aliases);
    program = protectedProgram.program;
    stringEntries = protectedProgram.entries;
  }
  const decoderSource = protectStrings
    ? 'decodeString: createStringDecoder(' +
      JSON.stringify(stringEntries).replace(/</g, '\\u003c') +
      '),'
    : '';
  const embeddedSource = JSON.stringify(
    encryptProgram ? sealProgram(program) : program,
  )
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');

  const result = await build({
    stdin: {
      contents: [
        'import { executeAssembly } from "./runtime/execute-assembly.js";',
        ...(protectStrings
          ? [
              'import { createStringDecoder } from "./runtime/string-decoder.js";',
            ]
          : []),
        ...(encryptProgram
          ? ['import { openProgramEnvelope } from "./runtime/open-program.js";']
          : []),
        encryptProgram
          ? `executeAssembly(openProgramEnvelope(${embeddedSource}), {${decoderSource}exposeFunctionMetadata: ${exposeFunctionMetadata}});`
          : `executeAssembly(${embeddedSource}, {${decoderSource}exposeFunctionMetadata: ${exposeFunctionMetadata}});`,
      ].join('\n'),
      resolveDir: SOURCE_DIRECTORY,
      sourcefile: 'jsvm-entry.js',
      loader: 'js',
    },

    plugins: [
      runtimeHardeningPlugin({
        sourceDirectory: SOURCE_DIRECTORY,
        aliases,
        usedOpcodes,
        pruneOpcodes,
        maskErrors,
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
