import { randomBytes, randomInt } from 'node:crypto';
import { tokenizeAssembly } from '../assembly/tokenize.js';
import { sealProgram } from './seal-program.js';

/** Input is already validated, optionally relabeled assembly. No plaintext
 * string operands (including nested function bodies) remain in the result.
 * Keys travel with the bundle: this raises analysis cost, not key secrecy.
 */
export function protectAssemblyStrings(source, aliases = null) {
  const entries = [],
    ids = new Set(),
    byValue = new Map();
  const functionOps = new Set([
    aliases?.get('js.function.create') ?? 'js.function.create',
    aliases?.get('js.function.named.create') ?? 'js.function.named.create',
  ]);
  function store(value) {
    if (byValue.has(value)) return byValue.get(value);
    let id;
    do id = randomBytes(8).toString('hex');
    while (ids.has(id));
    ids.add(id);
    const reference = '@' + id;
    entries.push([id, sealProgram(value)]);
    byValue.set(value, reference);
    return reference;
  }
  function rewrite(text) {
    return tokenizeAssembly(text)
      .map(({ tokens }) => {
        const isFunction = functionOps.has(tokens[0].value);
        return tokens
          .map((token, index) => {
            if (token.type !== 'string') return token.value;
            return store(
              isFunction && index === 4 ? rewrite(token.value) : token.value,
            );
          })
          .join(' ');
      })
      .join('\n');
  }
  const program = rewrite(source);
  for (let i = entries.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [entries[i], entries[j]] = [entries[j], entries[i]];
  }
  return { program, entries };
}
