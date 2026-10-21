/**
 * Tokenizes assembly source into non-empty lines with tokens.
 *
 * Line and column numbers are 1-based.
 * Columns are measured in UTF-16 code units, matching JS string indices.
 *
 * Supported features:
 * - Line breaks: LF, CRLF, and CR;
 * - Spaces and tabs between tokens;
 * - Double-quoted strings with JSON escape sequences.
 *
 * Comments are not yet supported.
 *
 * @param {string} source
 * @returns {Array<{
 *   line: number,
 *   tokens: Array<{
 *     type: 'word' | 'string',
 *     value: string,
 *     column: number
 *   }>
 * }>}
 */
export function tokenizeAssembly(source) {
  if (typeof source !== 'string' && !(source instanceof String)) {
    throw new TypeError('Assembly source must be a string');
  }

  const str = String(source);
  const lines = str.split(/\r\n|\n|\r/);
  const result = [];

  for (let index = 0; index < lines.length; index++) {
    const lineNumber = index + 1;
    const tokens = tokenizeLine(lines[index], lineNumber);

    if (tokens.length > 0) {
      result.push({
        line: lineNumber,
        tokens,
      });
    }
  }

  return result;
}

function tokenizeLine(text, lineNumber) {
  const tokens = [];
  let position = 0;

  while (position < text.length) {
    if (isSeparator(text[position])) {
      position++;
      continue;
    }

    const start = position;

    if (text[position] === '"') {
      position++;
      let closed = false;

      while (position < text.length) {
        const character = text[position];

        if (character === '\\') {
          // Skip escaped character.
          // Escape sequence validity will be checked by JSON.parse.
          position += 2;
          continue;
        }

        if (character === '"') {
          position++;
          closed = true;
          break;
        }

        position++;
      }

      if (!closed) {
        fail(lineNumber, start + 1, 'Unterminated string literal');
      }

      const raw = text.slice(start, position);
      let value;

      try {
        value = JSON.parse(raw);
      } catch {
        fail(lineNumber, start + 1, 'Invalid JSON string literal');
      }

      if (
        position < text.length &&
        !isSeparator(text[position])
      ) {
        fail(
          lineNumber,
          position + 1,
          'Expected whitespace after string literal',
        );
      }

      tokens.push({
        type: 'string',
        value,
        column: start + 1,
      });

      continue;
    }

    while (
      position < text.length &&
      !isSeparator(text[position])
    ) {
      const character = text[position];

      if (character === '"') {
        fail(
          lineNumber,
          position + 1,
          'Expected whitespace before string literal',
        );
      }

      if (character.charCodeAt(0) < 0x20) {
        fail(
          lineNumber,
          position + 1,
          'Unexpected control character',
        );
      }

      position++;
    }

    tokens.push({
      type: 'word',
      value: text.slice(start, position),
      column: start + 1,
    });
  }

  return tokens;
}

function isSeparator(character) {
  return character === ' ' || character === '\t';
}

function fail(line, column, message) {
  throw new SyntaxError(
    `Assembly ${line}:${column}: ${message}`,
  );
}