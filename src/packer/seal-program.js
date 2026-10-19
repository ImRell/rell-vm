import { createCipheriv, randomBytes, randomInt } from 'node:crypto';

/** Encrypt the ENTIRE assembly: literals, labels, global names and nested bodies.
 * Fresh key/nonce per build. Embedded key shares are obfuscation, not key secrecy.
 * UTF-16LE preserves every JS string code unit, including lone surrogates.
 */
export function sealProgram(source) {
  if (typeof source !== 'string')
    throw new TypeError('Program source must be a string');
  const key = randomBytes(32),
    nonce = randomBytes(12),
    mask = randomBytes(32);
  const other = Buffer.alloc(32);
  for (let i = 0; i < 32; i++) other[i] = key[i] ^ mask[i];
  const cipher = createCipheriv('chacha20-poly1305', key, nonce, {
    authTagLength: 16,
  });
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.from(source, 'utf16le')),
    cipher.final(),
  ]);
  const encoded = ciphertext.toString('base64'),
    chunks = [];
  for (let i = 0; i < encoded.length;) {
    const size = randomInt(64, 193) * 4;
    chunks.push(encoded.slice(i, i + size));
    i += size;
  }
  if (chunks.length === 0) chunks.push('');
  const positions = chunks.map((_, i) => i);
  for (let i = positions.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [positions[i], positions[j]] = [positions[j], positions[i]];
  }
  const order = new Array(chunks.length);
  positions.forEach((original, physical) => (order[original] = physical));
  const result = {
    v: 1,
    k: [mask.toString('base64'), other.toString('base64')],
    n: nonce.toString('base64'),
    t: cipher.getAuthTag().toString('base64'),
    c: positions.map((i) => chunks[i]),
    o: order,
  };
  key.fill(0);
  other.fill(0);
  mask.fill(0);
  return result;
}
