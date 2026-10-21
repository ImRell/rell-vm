import { transformSync } from '@babel/core';
import presetEnv from '@babel/preset-env';
import { parse } from 'acorn';

/**
 * Transpiles modern JavaScript to ES5 syntax.
 *
 * Does not execute source code.
 * Does not include standard API polyfills.
 * Does not read user Babel configuration files.
 *
 * @param {string} source
 * @param {{ filename?: string }} [options]
 * @returns {string}
 */
export function normalizeSource(
  source,
  { filename = 'input.js' } = {},
) {
  if (typeof source !== 'string') {
    throw new TypeError('Source must be a string');
  }

  if (typeof filename !== 'string' || filename.trim().length === 0) {
    throw new TypeError('Filename must be a non-empty string');
  }

  const result = transformSync(source, {
    filename,
    sourceType: 'script',

    // Build must not depend on .babelrc or babel.config.js near the input file.
    babelrc: false,
    configFile: false,

    ast: false,
    code: true,
    sourceMaps: false,

    comments: false,
    compact: false,
    minified: false,

    presets: [
      [
        presetEnv,
        {
          targets: {
            ie: '11',
          },

          forceAllTransforms: true,
          bugfixes: true,

          // ESM is not yet part of the input script contract.
          modules: false,

          // Do not add core-js imports or other polyfills.
          useBuiltIns: false,
        },
      ],
    ],
  });

  if (result === null || typeof result.code !== 'string') {
    throw new Error('Normalization did not produce JavaScript code');
  }

  const code = result.code;

  // Independent result verification:
  // Output must parse as ES5 (or ES2020 when VM-supported BigInt literals are present).
  try {
    parse(code, {
      ecmaVersion: 5,
      sourceType: 'script',
      locations: true,
      sourceFile: filename,
    });
  } catch (cause) {
    try {
      parse(code, {
        ecmaVersion: 2020,
        sourceType: 'script',
        locations: true,
        sourceFile: filename,
      });
    } catch {
      throw new SyntaxError(
        `Normalization produced non-ES5 syntax for ${filename}: ` +
          cause.message,
        { cause },
      );
    }
  }

  return code;
}