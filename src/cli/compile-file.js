import { Buffer } from 'node:buffer';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { compileToAssembly } from '../compiler/compile-assembly.js';
import { buildBrowserScript } from '../packer/build-browser-script.js';

/**
 * Compiles a file into a standalone browser script.
 *
 * By default, normalizes ES6+ to ES5 before generating assembly/bytecode.
 * Does not execute the user program.
 * Overwrites the existing output file upon successful compilation.
 *
 * @param {{
 *   inputPath: string,
 *   outputPath: string,
 *   minify?: boolean,
 *   normalize?: boolean,
 *   mangleNames?: boolean,
 *   encryptProgram?: boolean,
 *   randomizeInstructions?: boolean,
 *   mangleProperties?: boolean,
 *   pruneOpcodes?: boolean,
 *   maskErrors?: boolean,
 *   protectStrings?: boolean,
 *   exposeFunctionMetadata?: boolean,
 *   keepFunctionNames?: boolean
 * }} options
 * @returns {Promise<{
 *   inputPath: string,
 *   outputPath: string,
 *   bytes: number
 * }>}
 */
export async function compileFile({
  inputPath,
  outputPath,
  minify = true,
  normalize = true,
  mangleNames = true,
  keepFunctionNames = false,
  encryptProgram = true,
  randomizeInstructions = true,
  mangleProperties = true,
  pruneOpcodes = true,
  maskErrors = true,
  protectStrings = true,
  exposeFunctionMetadata = false,
  shuffleHandlers = true,
}) {
  assertPath(inputPath, 'Input');
  assertPath(outputPath, 'Output');

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

  if (typeof normalize !== 'boolean') {
    throw new TypeError('normalize must be a boolean');
  }

  if (typeof mangleNames !== 'boolean')
    throw new TypeError('mangleNames must be a boolean');
  if (typeof keepFunctionNames !== 'boolean')
    throw new TypeError('keepFunctionNames must be a boolean');
  if (keepFunctionNames && !mangleNames)
    throw new TypeError('keepFunctionNames requires mangleNames');

  const absoluteInputPath = resolve(inputPath);
  const absoluteOutputPath = resolve(outputPath);

  if (absoluteInputPath === absoluteOutputPath) {
    throw new Error('Input and output paths must be different');
  }

  const inputStats = await stat(absoluteInputPath);

  if (!inputStats.isFile()) {
    throw new Error('Input path must point to a regular file');
  }

  const source = await readFile(absoluteInputPath, 'utf8');

  let compilerSource = source;
  if (normalize) {
    // Load Babel only for builds that request ES6+ -> ES5 normalization.
    // --help and the raw VM path do not need to initialize Babel.
    const { normalizeSource } = await import('../compiler/normalize-source.js');
    compilerSource = normalizeSource(source, { filename: absoluteInputPath });
  }

  const assembly = compileToAssembly(compilerSource, {
    filename: absoluteInputPath,
  });

  const output = await buildBrowserScript(assembly, {
    minify,
    mangleNames,
    keepFunctionNames,
    encryptProgram,
    randomizeInstructions,
    mangleProperties,
    pruneOpcodes,
    maskErrors,
    protectStrings,
    exposeFunctionMetadata,
    shuffleHandlers,
  });

  // Do not create output directory until compilation succeeds.
  await mkdir(dirname(absoluteOutputPath), {
    recursive: true,
  });

  // Write only after successful compilation; creates or overwrites output.
  await writeFile(absoluteOutputPath, output, {
    encoding: 'utf8',
    flag: 'w',
  });

  return {
    inputPath: absoluteInputPath,
    outputPath: absoluteOutputPath,
    bytes: Buffer.byteLength(output, 'utf8'),
  };
}

function assertPath(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${label} path must be a non-empty string`);
  }
}
