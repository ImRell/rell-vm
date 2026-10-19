import { parse } from '@babel/parser';

/**
 * Разбирает исходный JavaScript в Babel AST.
 *
 * Поддержка синтаксиса парсером не означает,
 * что этот синтаксис уже поддерживается компилятором.
 *
 * @param {string} source
 * @param {{ filename?: string }} [options]
 * @returns {import('@babel/types').File}
 */
export function parseSource(source, { filename = 'input.js' } = {}) {
  if (typeof source !== 'string') {
    throw new TypeError('Source must be a string');
  }

  if (typeof filename !== 'string' || filename.length === 0) {
    throw new TypeError('Filename must be a non-empty string');
  }

  return parse(source, {
    sourceType: 'script',
    sourceFilename: filename,
    errorRecovery: false,
    attachComment: false,
  });
}