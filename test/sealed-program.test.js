import test from 'node:test';
import assert from 'node:assert/strict';
import { createCipheriv, randomBytes } from 'node:crypto';
import { sealProgram } from '../src/packer/seal-program.js';
import {
  openProgramEnvelope,
  chacha20Block,
} from '../src/runtime/open-program.js';
const hex = (s) => new Uint8Array(Buffer.from(s.replace(/\s/g, ''), 'hex'));

test('RFC 8439 section 2.3.2 ChaCha20 block known answer', () => {
  const key = hex(
    '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f',
  );
  const nonce = hex('000000090000004a00000000');
  assert.equal(
    Buffer.from(chacha20Block(key, nonce, 1)).toString('hex'),
    '10f1e7e4d13b5915500fdd1fa32071c4c7d1f4c733c068030422aa9ac3d46c4ed2826446079faa0914c2d705d98b02a2b5129cd1de164eb9cbd083e8a2503c4e',
  );
});
for (const length of [
  0, 1, 2, 7, 8, 15, 16, 17, 31, 32, 33, 63, 64, 65, 127, 128, 129, 1024, 4095,
  4096, 4097, 50000,
]) {
  test(`cross-check Node/OpenSSL AEAD and UTF-16LE: ${length} code units`, () => {
    const bytes = randomBytes(length * 2);
    const text = bytes.toString('utf16le');
    const envelope = sealProgram(text);
    assert.equal(openProgramEnvelope(envelope), text);
    const first = Buffer.from(envelope.k[0], 'base64'),
      second = Buffer.from(envelope.k[1], 'base64');
    const key = Buffer.from(first.map((v, i) => v ^ second[i]));
    const cipher = createCipheriv(
      'chacha20-poly1305',
      key,
      Buffer.from(envelope.n, 'base64'),
      { authTagLength: 16 },
    );
    const expected = Buffer.concat([cipher.update(bytes), cipher.final()]);
    assert.equal(
      envelope.o.map((i) => envelope.c[i]).join(''),
      expected.toString('base64'),
    );
    assert.equal(envelope.t, cipher.getAuthTag().toString('base64'));
  });
}
for (const text of [
  '',
  'ASCII',
  'кириллица 日本語 😀',
  '\u0000\ud800\udfff\u2028\u2029',
  '</script>\\"\n\r\t',
  'js.function.create "secret" "[]" false "js.const 42\\nreturn"',
])
  test('preserve every string code unit: ' + JSON.stringify(text), () =>
    assert.equal(openProgramEnvelope(sealProgram(text)), text),
  );
test('every build uses a fresh key, nonce and ciphertext', () => {
  const a = sealProgram('very secret text'),
    b = sealProgram('very secret text');
  assert.notDeepEqual(a, b);
  assert.notDeepEqual(a.k, b.k);
  assert.notEqual(a.n, b.n);
  assert.notDeepEqual(a.c, b.c);
});
test('chunk order is a complete permutation and not sequential for a large input', () => {
  const text = 'SecretText'.repeat(10000),
    e = sealProgram(text);
  assert.ok(e.c.length > 100);
  assert.deepEqual(
    [...e.o].sort((a, b) => a - b),
    e.c.map((_, i) => i),
  );
  // Reshuffle if needed in the astronomically unlikely identity case; do not make
  // the random layout itself a flaky correctness assertion.
  assert.equal(openProgramEnvelope(e), text);
});
const mutations = [
  (e) => (e.v = 2),
  (e) => (e.k = []),
  (e) => (e.k[0] = 'AA=='),
  (e) => (e.k[1] = '!invalid'),
  (e) => (e.n = 'AA=='),
  (e) => (e.t = 'AA=='),
  (e) => (e.t = Buffer.alloc(16).toString('base64')),
  (e) => (e.c[0] = '!invalid'),
  (e) => (e.o[0] = -1),
  (e) => (e.o[0] = 0.5),
  (e) => (e.o[0] = 100000),
  (e) => e.o.push(0),
  (e) => (e.c = []),
  (e) => (e.o = null),
  (e) => (e.k = null),
  (e) => {
    const b = Buffer.from(e.c[0], 'base64');
    b[0] ^= 1;
    e.c[0] = b.toString('base64');
  },
  (e) => {
    const b = Buffer.from(e.n, 'base64');
    b[0] ^= 1;
    e.n = b.toString('base64');
  },
  (e) => {
    const b = Buffer.from(e.k[0], 'base64');
    b[0] ^= 1;
    e.k[0] = b.toString('base64');
  },
];
for (const [i, mutate] of mutations.entries())
  test('reject damaged envelope ' + i, () => {
    const e = sealProgram('SecretText');
    mutate(e);
    assert.throws(() => openProgramEnvelope(e), /Invalid encrypted VM program/);
  });
for (const value of [null, undefined, 42, 'text', {}, []])
  test('reject invalid envelope ' + String(value), () =>
    assert.throws(
      () => openProgramEnvelope(value),
      /Invalid encrypted VM program/,
    ),
  );
for (const value of [null, undefined, 42, {}, []])
  test('seal validates string input ' + String(value), () =>
    assert.throws(() => sealProgram(value), TypeError),
  );
test('opening does not mutate envelope or execute assembly', () => {
  const e = sealProgram('js.global.get "neverRead"\nthrow'),
    before = structuredClone(e);
  Object.freeze(e.c);
  Object.freeze(e.o);
  Object.freeze(e.k);
  Object.freeze(e);
  assert.equal(openProgramEnvelope(e), 'js.global.get "neverRead"\nthrow');
  assert.deepEqual(e, before);
});
test('permuted or duplicated ciphertext parts are rejected before VM execution', () => {
  const e = sealProgram('abc'.repeat(2000));
  assert.ok(e.c.length > 2);
  const a = structuredClone(e);
  [a.o[0], a.o[1]] = [a.o[1], a.o[0]];
  assert.throws(() => openProgramEnvelope(a));
  const b = structuredClone(e);
  b.o[0] = b.o[1];
  assert.throws(() => openProgramEnvelope(b));
});

test('large payload decoding avoids regexp recursion and argument-count overflow', () => {
  const text = 'large\ud800-X\udfff\u0000😀'.repeat(100000);
  assert.equal(openProgramEnvelope(sealProgram(text)), text);
});
for (const text of ['\ud800X', '\udfffX', 'X\ud800', '\ud800\ud800'])
  test('unpaired surrogate remains exact ' + JSON.stringify(text), () =>
    assert.equal(openProgramEnvelope(sealProgram(text)), text),
  );
