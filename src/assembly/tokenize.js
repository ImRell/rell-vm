/**
 * Разбивает текст инструкций на непустые строки с токенами.
 *
 * Номера строк и столбцов начинаются с 1.
 * Столбцы считаются в UTF-16 кодовых единицах, как индексы JS-строк.
 *
 * Поддерживаются:
 * - переводы строк LF, CRLF и CR;
 * - пробелы и табуляции между токенами;
 * - строки в двойных кавычках с JSON-экранированием.
 *
 * Комментарии пока не поддерживаются.
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
  if (typeof source !== 'string') {
    throw new TypeError('Assembly source must be a string');
  }

  const lines = source.split(/\r\n|\n|\r/);
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
          // Пропускаем экранированный символ.
          // Корректность escape-последовательности проверит JSON.parse.
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