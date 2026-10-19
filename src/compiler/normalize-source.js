import { transformSync } from '@babel/core';
import presetEnv from '@babel/preset-env';
import { parse } from 'acorn';

/**
 * Преобразует современный JavaScript в синтаксис ES5.
 *
 * Не выполняет исходный код.
 * Не подключает полифиллы стандартных API.
 * Не читает пользовательские конфигурационные файлы Babel.
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

    // Сборка не должна зависеть от .babelrc
    // или babel.config.js рядом с входным файлом.
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

          // ESM пока не входит в контракт входного скрипта.
          modules: false,

          // Не добавляем импорты core-js и другие полифиллы.
          useBuiltIns: false,
        },
      ],
    ],
  });

  if (result === null || typeof result.code !== 'string') {
    throw new Error('Normalization did not produce JavaScript code');
  }

  const code = result.code;

  // Независимая проверка результата:
  // выход действительно должен разбираться как ES5.
  try {
    parse(code, {
      ecmaVersion: 5,
      sourceType: 'script',
      locations: true,
      sourceFile: filename,
    });
  } catch (cause) {
    throw new SyntaxError(
      `Normalization produced non-ES5 syntax for ${filename}: ` +
        cause.message,
      { cause },
    );
  }

  return code;
}