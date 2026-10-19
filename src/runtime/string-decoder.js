import { openProgramEnvelope } from './open-program.js';

/** No decoded-value cache: unused operands are not decrypted. Each operand is
 * authenticated/decrypted when its instruction accesses it. Parsed instruction
 * args hold getters and encrypted references, not a plaintext string pool.
 */
export function createStringDecoder(entries) {
  if (!Array.isArray(entries)) throw new TypeError('Invalid string vault');
  // Keep an encoded-only snapshot, independent of the caller's mutable table.
  const snapshot = JSON.parse(JSON.stringify(entries));
  const vault = new Map();
  for (const entry of snapshot) {
    if (
      !Array.isArray(entry) ||
      entry.length !== 2 ||
      typeof entry[0] !== 'string' ||
      !/^[a-f0-9]{16}$/.test(entry[0]) ||
      vault.has(entry[0])
    )
      throw new TypeError('Invalid string vault entry');
    vault.set(entry[0], entry[1]);
  }
  return function decodeString(reference) {
    if (
      typeof reference !== 'string' ||
      !/^@[a-f0-9]{16}$/.test(reference) ||
      !vault.has(reference.slice(1))
    )
      throw new TypeError('Unknown protected operand');
    return openProgramEnvelope(vault.get(reference.slice(1)));
  };
}
