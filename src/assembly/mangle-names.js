import { parseAssembly } from './parse.js';
import { tokenizeAssembly } from './tokenize.js';

/**
 * Replace local binding/parameter/function metadata names in text assembly.
 * Addressing stays depth+slot based: this is NOT a JS-source string replacement.
 * Global lookup names, property keys, literals and labels are never renamed.
 * The original-name map exists only during this call and is not emitted.
 *
 * @param {string} source
 * @param {{keepFunctionNames?: boolean}} [options]
 * @returns {string}
 */
export function mangleAssemblyNames(
  source,
  { keepFunctionNames = false } = {},
) {
  if (typeof keepFunctionNames !== 'boolean')
    throw new TypeError('keepFunctionNames must be a boolean');
  // Includes validation of nested bodies, parameters, labels and operand types.
  parseAssembly(source);
  const originals = new Set();
  const tree = collect(source);
  const aliases = new Map();
  let next = 0;

  function alias(name) {
    if (name === '') return '';
    if (!aliases.has(name)) {
      let candidate;
      do candidate = `_${(next++).toString(36)}`;
      while (originals.has(candidate));
      aliases.set(name, candidate);
    }
    return aliases.get(name);
  }

  function collect(text) {
    const rows = tokenizeAssembly(text);
    const children = new Map();
    for (const row of rows) {
      const tokens = row.tokens;
      const op = tokens[0].value;
      if (op === 'js.lex.create') originals.add(tokens[2].value);
      else if (
        op === 'js.function.create' ||
        op === 'js.function.named.create'
      ) {
        if (tokens[1].value !== '') originals.add(tokens[1].value);
        for (const parameter of JSON.parse(tokens[2].value))
          originals.add(parameter);
        children.set(row.line, collect(tokens[4].value));
      }
    }
    return { text, rows, children };
  }

  function rewrite(node) {
    const lines = node.text.split(/\r\n|\n|\r/);
    for (const row of node.rows) {
      const tokens = row.tokens.map((token) => ({ ...token }));
      const op = tokens[0].value;
      if (op === 'js.lex.create') tokens[2].value = alias(tokens[2].value);
      else if (
        op === 'js.function.create' ||
        op === 'js.function.named.create'
      ) {
        if (!keepFunctionNames) tokens[1].value = alias(tokens[1].value);
        // Equal parameter names must remain equal: mapped arguments and
        // duplicate-parameter slots depend on that equivalence relation.
        tokens[2].value = JSON.stringify(
          JSON.parse(tokens[2].value).map(alias),
        );
        tokens[4].value = rewrite(node.children.get(row.line));
      } else continue;
      lines[row.line - 1] = tokens
        .map((token) =>
          token.type === 'string' ? JSON.stringify(token.value) : token.value,
        )
        .join(' ');
    }
    // Preserve blank lines and line numbers (columns of rewritten rows change).
    return lines.join('\n');
  }

  const result = rewrite(tree);
  parseAssembly(result);
  return result;
}
