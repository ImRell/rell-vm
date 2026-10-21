import test from 'node:test';
import assert from 'node:assert/strict';

import { HELP_TEXT, parseArguments } from '../src/cli/parse-arguments.js';

test('parses input file and required output', () => {
  assert.deepEqual(parseArguments(['input.js', '--output', 'output.js']), {
    help: false,
    inputPath: 'input.js',
    outputPath: 'output.js',
    minify: true,
    normalize: true,
    mangleNames: true,
    encryptProgram: true,
    randomizeInstructions: true,
    mangleProperties: true,
    pruneOpcodes: true,
    maskErrors: true,
    protectStrings: true,
    exposeFunctionMetadata: false,
    keepFunctionNames: false,
  });
});

test('supports short option and minification', () => {
  assert.deepEqual(
    parseArguments(['--minify', '-o', 'output.js', 'input.js']),
    {
      help: false,
      inputPath: 'input.js',
      outputPath: 'output.js',
      minify: true,
      normalize: true,
      mangleNames: true,
      encryptProgram: true,
      randomizeInstructions: true,
      mangleProperties: true,
      pruneOpcodes: true,
      maskErrors: true,
      protectStrings: true,
      exposeFunctionMetadata: false,
      keepFunctionNames: false,
    },
  );
});

test('preserves paths with spaces and supports output via equals', () => {
  assert.deepEqual(
    parseArguments(['source files/input.js', '--output=build files/output.js']),
    {
      help: false,
      inputPath: 'source files/input.js',
      outputPath: 'build files/output.js',
      minify: true,
      normalize: true,
      mangleNames: true,
      encryptProgram: true,
      randomizeInstructions: true,
      mangleProperties: true,
      pruneOpcodes: true,
      maskErrors: true,
      protectStrings: true,
      exposeFunctionMetadata: false,
      keepFunctionNames: false,
    },
  );
});

test('help does not require input and output file', () => {
  assert.deepEqual(parseArguments(['--help']), { help: true });
  assert.deepEqual(parseArguments(['-h']), { help: true });

  assert.ok(HELP_TEXT.includes('--output'));
  assert.ok(HELP_TEXT.includes('--minify'));
});

test('requires exactly one non-empty input path', () => {
  for (const args of [
    [],
    ['--output', 'output.js'],
    ['first.js', 'second.js', '-o', 'output.js'],
  ]) {
    assert.throws(
      () => parseArguments(args),
      /Exactly one input file is required/,
    );
  }

  assert.throws(
    () => parseArguments([' ', '-o', 'output.js']),
    /Input path must not be empty/,
  );
});

test('requires non-empty output and rejects unknown options', () => {
  for (const args of [
    ['input.js'],
    ['input.js', '--output='],
    ['input.js', '-o', ' '],
  ]) {
    assert.throws(
      () => parseArguments(args),
      /A non-empty --output path is required/,
    );
  }

  assert.throws(() => parseArguments(['input.js', '--unknown']), {
    code: 'ERR_PARSE_ARGS_UNKNOWN_OPTION',
  });

  assert.throws(() => parseArguments(['input.js', '--output']), {
    code: 'ERR_PARSE_ARGS_INVALID_OPTION_VALUE',
  });
});

test('rejects duplicate options including short and long forms', () => {
  const cases = [
    ['input.js', '-o', 'first.js', '--output', 'second.js'],
    ['input.js', '-o', 'output.js', '--minify', '--minify'],
    ['--help', '-h'],
  ];

  for (const args of cases) {
    assert.throws(() => parseArguments(args), /must not be repeated/);
  }
});

test('supports input path after option terminator', () => {
  assert.deepEqual(parseArguments(['-o', 'output.js', '--', '-input.js']), {
    help: false,
    inputPath: '-input.js',
    outputPath: 'output.js',
    minify: true,
    normalize: true,
    mangleNames: true,
    encryptProgram: true,
    randomizeInstructions: true,
    mangleProperties: true,
    pruneOpcodes: true,
    maskErrors: true,
    protectStrings: true,
    exposeFunctionMetadata: false,
    keepFunctionNames: false,
  });
});

test('does not mutate arguments and validates input type', () => {
  const args = Object.freeze(['input.js', '-o', 'output.js']);

  assert.doesNotThrow(() => parseArguments(args));

  for (const value of [undefined, null, 'input.js', [42]]) {
    assert.throws(
      () => parseArguments(value),
      /Arguments must be an array of strings/,
    );
  }
});
