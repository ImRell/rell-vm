// Synchronous RFC 8439 ChaCha20-Poly1305 loader. No eval, Function, WebCrypto,
// Buffer, atob or TextDecoder: works in the same synchronous browser IIFE as VM.
// The key is embedded in the distributable. This is obfuscation, NOT a secret
// against someone able to inspect or instrument this JavaScript runtime.
const BASE64 =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function invalid() {
  throw new Error('Invalid encrypted VM program');
}
function decode64(text) {
  if (typeof text !== 'string' || text.length % 4 !== 0) invalid();
  const padding = text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0;
  const bytes = new Uint8Array((text.length / 4) * 3 - padding);
  let output = 0;
  for (let i = 0; i < text.length; i += 4) {
    const a = BASE64.indexOf(text[i]),
      b = BASE64.indexOf(text[i + 1]);
    const c = text[i + 2] === '=' ? 0 : BASE64.indexOf(text[i + 2]);
    const d = text[i + 3] === '=' ? 0 : BASE64.indexOf(text[i + 3]);
    if (
      i + 4 === text.length &&
      ((padding === 2 && b & 15) || (padding === 1 && c & 3))
    )
      invalid();
    if (
      a < 0 ||
      b < 0 ||
      c < 0 ||
      d < 0 ||
      (i + 4 !== text.length && (text[i + 2] === '=' || text[i + 3] === '=')) ||
      (text[i + 2] === '=' && text[i + 3] !== '=')
    )
      invalid();
    const word = (a << 18) | (b << 12) | (c << 6) | d;
    if (output < bytes.length) bytes[output++] = word >>> 16;
    if (output < bytes.length) bytes[output++] = word >>> 8;
    if (output < bytes.length) bytes[output++] = word;
  }
  return bytes;
}
function read32(bytes, offset) {
  return (
    (bytes[offset] |
      (bytes[offset + 1] << 8) |
      (bytes[offset + 2] << 16) |
      (bytes[offset + 3] << 24)) >>>
    0
  );
}
function rotate(value, count) {
  return (value << count) | (value >>> (32 - count));
}
function quarter(x, a, b, c, d) {
  x[a] += x[b];
  x[d] = rotate(x[d] ^ x[a], 16);
  x[c] += x[d];
  x[b] = rotate(x[b] ^ x[c], 12);
  x[a] += x[b];
  x[d] = rotate(x[d] ^ x[a], 8);
  x[c] += x[d];
  x[b] = rotate(x[b] ^ x[c], 7);
}
export function chacha20Block(key, nonce, counter) {
  if (
    !(key instanceof Uint8Array) ||
    key.length !== 32 ||
    !(nonce instanceof Uint8Array) ||
    nonce.length !== 12 ||
    !Number.isInteger(counter) ||
    counter < 0 ||
    counter > 0xffffffff
  )
    invalid();
  const state = new Uint32Array(16);
  state.set([0x61707865, 0x3320646e, 0x79622d32, 0x6b206574]);
  for (let i = 0; i < 8; i++) state[4 + i] = read32(key, i * 4);
  state[12] = counter;
  for (let i = 0; i < 3; i++) state[13 + i] = read32(nonce, i * 4);
  const work = new Uint32Array(state);
  for (let i = 0; i < 10; i++) {
    quarter(work, 0, 4, 8, 12);
    quarter(work, 1, 5, 9, 13);
    quarter(work, 2, 6, 10, 14);
    quarter(work, 3, 7, 11, 15);
    quarter(work, 0, 5, 10, 15);
    quarter(work, 1, 6, 11, 12);
    quarter(work, 2, 7, 8, 13);
    quarter(work, 3, 4, 9, 14);
  }
  const output = new Uint8Array(64);
  for (let i = 0; i < 16; i++) {
    const word = (work[i] + state[i]) >>> 0;
    for (let j = 0; j < 4; j++) output[i * 4 + j] = word >>> (j * 8);
  }
  return output;
}
function littleInteger(bytes) {
  let value = 0n;
  for (let i = bytes.length - 1; i >= 0; i--)
    value = (value << 8n) | BigInt(bytes[i]);
  return value;
}
// Empty AAD, ciphertext padded to 16 bytes, then uint64(0), uint64(length).
function authenticationTag(ciphertext, key, nonce) {
  const block = chacha20Block(key, nonce, 0);
  const r =
    littleInteger(block.subarray(0, 16)) & 0x0ffffffc0ffffffc0ffffffc0fffffffn;
  const s = littleInteger(block.subarray(16, 32));
  const prime = (1n << 130n) - 5n;
  let accumulator = 0n;
  for (let i = 0; i < ciphertext.length; i += 16) {
    const padded = new Uint8Array(16);
    padded.set(ciphertext.subarray(i, i + 16));
    accumulator =
      ((accumulator + littleInteger(padded) + (1n << 128n)) * r) % prime;
  }
  accumulator =
    ((accumulator + (BigInt(ciphertext.length) << 64n) + (1n << 128n)) * r) %
    prime;
  let value = (accumulator + s) & ((1n << 128n) - 1n);
  const tag = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    tag[i] = Number(value & 255n);
    value >>= 8n;
  }
  return tag;
}
/** Restore an authenticated, shuffled encrypted program to text instructions. */
export function openProgramEnvelope(envelope) {
  if (
    !envelope ||
    typeof envelope !== 'object' ||
    envelope.v !== 1 ||
    !Array.isArray(envelope.k) ||
    envelope.k.length !== 2 ||
    !Array.isArray(envelope.c) ||
    !Array.isArray(envelope.o) ||
    envelope.c.length !== envelope.o.length ||
    envelope.c.length === 0
  )
    invalid();
  const first = decode64(envelope.k[0]),
    second = decode64(envelope.k[1]);
  const nonce = decode64(envelope.n),
    suppliedTag = decode64(envelope.t);
  if (
    first.length !== 32 ||
    second.length !== 32 ||
    nonce.length !== 12 ||
    suppliedTag.length !== 16
  )
    invalid();
  const key = new Uint8Array(32);
  for (let i = 0; i < 32; i++) key[i] = first[i] ^ second[i];
  const seen = new Set();
  const parts = [];
  for (const index of envelope.o) {
    if (
      !Number.isInteger(index) ||
      index < 0 ||
      index >= envelope.c.length ||
      seen.has(index) ||
      typeof envelope.c[index] !== 'string'
    )
      invalid();
    seen.add(index);
    parts.push(envelope.c[index]);
  }
  const ciphertext = decode64(parts.join(''));
  // UTF-16LE must have an even byte count. Counter zero is reserved for the MAC.
  if (
    ciphertext.length % 2 !== 0 ||
    Math.ceil(ciphertext.length / 64) > 0xffffffff
  )
    invalid();
  const tag = authenticationTag(ciphertext, key, nonce);
  let difference = 0;
  for (let i = 0; i < 16; i++) difference |= tag[i] ^ suppliedTag[i];
  if (difference !== 0) invalid();
  const plain = new Uint8Array(ciphertext.length);
  for (
    let offset = 0, counter = 1;
    offset < ciphertext.length;
    offset += 64, counter++
  ) {
    const stream = chacha20Block(key, nonce, counter);
    for (let j = 0; j < 64 && offset + j < ciphertext.length; j++)
      plain[offset + j] = ciphertext[offset + j] ^ stream[j];
  }
  const segments = [];
  for (let start = 0; start < plain.length; start += 8192) {
    const units = [];
    for (let i = start; i < Math.min(start + 8192, plain.length); i += 2)
      units.push(plain[i] | (plain[i + 1] << 8));
    segments.push(String.fromCharCode(...units));
  }
  key.fill(0);
  plain.fill(0);
  return segments.join('');
}
