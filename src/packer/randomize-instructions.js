import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { parse as parseJavaScript } from '@babel/parser';
import { INSTRUCTIONS, DIRECTIVES } from '../assembly/instructions.js';
import { parseAssembly } from '../assembly/parse.js';
import { tokenizeAssembly } from '../assembly/tokenize.js';

/** A fresh bijection for this build, including directives. Never emitted as a
 * canonical-name -> random-name table: runtime code is rewritten at build time.
 */
export function createInstructionAliases() {
  const aliases = new Map(),
    used = new Set();
  for (const name of [
    ...Object.keys(INSTRUCTIONS),
    ...Object.keys(DIRECTIVES),
  ]) {
    let token;
    do token = '_rell_vm_' + randomBytes(4).toString('hex');
    while (used.has(token));
    used.add(token);
    aliases.set(name, token);
  }
  return aliases;
}
export function relabelAssembly(source, aliases) {
  parseAssembly(source);
  function rewrite(text) {
    const lines = text.split(/\r\n|\n|\r/);
    for (const row of tokenizeAssembly(text)) {
      const tokens = row.tokens.map((t) => ({ ...t })),
        op = tokens[0].value;
      if (!aliases.has(op))
        throw new TypeError('Missing instruction alias: ' + op);
      if (op === 'js.function.create' || op === 'js.function.named.create')
        tokens[4].value = rewrite(tokens[4].value);
      tokens[0].value = aliases.get(op);
      lines[row.line - 1] = tokens
        .map((t) => (t.type === 'string' ? JSON.stringify(t.value) : t.value))
        .join(' ');
    }
    return lines.join('\n');
  }
  return rewrite(source);
}
/** Rewrite opcode string constants in runtime sources, never user literals.
 * Identifier keys only occur in the canonical instruction/directive tables.
 * AST ranges avoid editing comments, substrings or executable JS keywords.
 */
export function rewriteRuntimeInstructions(
  source,
  aliases,
  instructionTable = false,
) {
  const ast = parseJavaScript(source, { sourceType: 'module' }),
    pending = [ast],
    edits = [];
  while (pending.length) {
    const node = pending.pop();
    if (node.type === 'StringLiteral' && aliases.has(node.value))
      edits.push([
        node.start,
        node.end,
        JSON.stringify(aliases.get(node.value)),
      ]);
    if (
      instructionTable &&
      node.type === 'ObjectProperty' &&
      !node.computed &&
      !node.shorthand &&
      node.key.type === 'Identifier' &&
      aliases.has(node.key.name)
    )
      edits.push([
        node.key.start,
        node.key.end,
        JSON.stringify(aliases.get(node.key.name)),
      ]);
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) {
        for (const child of value)
          if (child && typeof child.type === 'string') pending.push(child);
      } else if (value && typeof value.type === 'string') pending.push(value);
    }
  }
  edits.sort((a, b) => b[0] - a[0]);
  for (const [start, end, replacement] of edits)
    source = source.slice(0, start) + replacement + source.slice(end);
  return source;
}
export function instructionAliasPlugin(aliases, sourceDirectory) {
  const root = resolve(sourceDirectory);
  return {
    name: 'rell-private-instruction-dialect',
    setup(build) {
      build.onLoad({ filter: /\.js$/ }, async ({ path }) => {
        if (
          !path.startsWith(root + sep + 'runtime' + sep) &&
          !path.startsWith(root + sep + 'assembly' + sep)
        )
          return undefined;
        const source = await readFile(path, 'utf8');
        return {
          contents: rewriteRuntimeInstructions(
            source,
            aliases,
            path === resolve(root, 'assembly', 'instructions.js'),
          ),
          loader: 'js',
        };
      });
    },
  };
}
