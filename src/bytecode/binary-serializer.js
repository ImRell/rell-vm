export const BYTECODE_VERSION = 1;

// Constant Type Tags
export const TAG_NULL = 0;
export const TAG_UNDEFINED = 1;
export const TAG_FALSE = 2;
export const TAG_TRUE = 3;
export const TAG_INT32 = 4;
export const TAG_FLOAT64 = 5;
export const TAG_BIGINT = 6;
export const TAG_STRING = 7;
export const TAG_STRING_REF = 8;
export const TAG_PARAMETERS = 9;
export const TAG_BYTECODE = 10;
export const TAG_NAN = 11;
export const TAG_INFINITY = 12;
export const TAG_NEG_INFINITY = 13;
export const TAG_SEALED_PROGRAM = 14;

const floatBuf = new ArrayBuffer(8);
const floatView = new DataView(floatBuf);
const floatBytes = new Uint8Array(floatBuf);

export function writeVarint(buffer, value) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError('Invalid unsigned varint: ' + value);
  }
  let v = value;
  while (v >= 0x80) {
    buffer.push((v & 0x7f) | 0x80);
    v >>>= 7;
  }
  buffer.push(v & 0x7f);
}

export function readVarint(bytes, offsetObj) {
  let res = 0,
    shift = 0,
    b;
  do {
    if (offsetObj.offset >= bytes.length) {
      throw new RangeError('Unexpected end of bytecode stream reading varint');
    }
    b = bytes[offsetObj.offset++];
    res |= (b & 0x7f) << shift;
    shift += 7;
  } while (b & 0x80);
  return res >>> 0;
}

export function writeInt32(buffer, num) {
  buffer.push(
    num & 0xff,
    (num >>> 8) & 0xff,
    (num >>> 16) & 0xff,
    (num >>> 24) & 0xff,
  );
}

export function readInt32(bytes, offsetObj) {
  if (offsetObj.offset + 4 > bytes.length) {
    throw new RangeError('Unexpected end of bytecode stream reading int32');
  }
  const o = offsetObj.offset;
  offsetObj.offset += 4;
  return (
    bytes[o] |
    (bytes[o + 1] << 8) |
    (bytes[o + 2] << 16) |
    (bytes[o + 3] << 24)
  );
}

export function writeFloat64(buffer, num) {
  floatView.setFloat64(0, num, true);
  for (let i = 0; i < 8; i++) buffer.push(floatBytes[i]);
}

export function readFloat64(bytes, offsetObj) {
  if (offsetObj.offset + 8 > bytes.length) {
    throw new RangeError('Unexpected end of bytecode stream reading float64');
  }
  for (let i = 0; i < 8; i++) floatBytes[i] = bytes[offsetObj.offset++];
  return floatView.getFloat64(0, true);
}

export function writeString(buffer, str) {
  writeVarint(buffer, str.length);
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    buffer.push(code & 0xff, (code >>> 8) & 0xff);
  }
}

export function readString(bytes, offsetObj) {
  const len = readVarint(bytes, offsetObj);
  if (offsetObj.offset + len * 2 > bytes.length) {
    throw new RangeError('Unexpected end of bytecode stream reading string');
  }
  let result = '';
  const CHUNK_SIZE = 4096;
  for (let i = 0; i < len; i += CHUNK_SIZE) {
    const chunkLen = Math.min(CHUNK_SIZE, len - i);
    const chunk = new Uint16Array(chunkLen);
    for (let j = 0; j < chunkLen; j++) {
      const b0 = bytes[offsetObj.offset++];
      const b1 = bytes[offsetObj.offset++];
      chunk[j] = b0 | (b1 << 8);
    }
    result += String.fromCharCode.apply(null, chunk);
  }
  return result;
}

/**
 * Serializes a bytecode program into a Uint8Array.
 *
 * @param {{
 *   version?: number,
 *   constants: Array<unknown>,
 *   code: Uint8Array
 * }} program
 * @returns {Uint8Array}
 */
export function encodeBytecode(program) {
  const buffer = [];
  // Magic: 'RVM\1'
  buffer.push(0x52, 0x56, 0x4d, 0x01);
  writeVarint(buffer, program.version ?? BYTECODE_VERSION);

  // Constants
  const constants = program.constants ?? [];
  writeVarint(buffer, constants.length);

  for (const constant of constants) {
    encodeConstant(buffer, constant);
  }

  // Code
  const code = program.code instanceof Uint8Array ? program.code : new Uint8Array(program.code ?? []);
  writeVarint(buffer, code.length);
  for (let i = 0; i < code.length; i++) {
    buffer.push(code[i]);
  }

  return new Uint8Array(buffer);
}

function encodeConstant(buffer, value) {
  if (value === null) {
    buffer.push(TAG_NULL);
  } else if (value === undefined) {
    buffer.push(TAG_UNDEFINED);
  } else if (value === false) {
    buffer.push(TAG_FALSE);
  } else if (value === true) {
    buffer.push(TAG_TRUE);
  } else if (typeof value === 'number') {
    if (Number.isNaN(value)) {
      buffer.push(TAG_NAN);
    } else if (value === Infinity) {
      buffer.push(TAG_INFINITY);
    } else if (value === -Infinity) {
      buffer.push(TAG_NEG_INFINITY);
    } else if (Number.isInteger(value) && value >= -2147483648 && value <= 2147483647 && !Object.is(value, -0)) {
      buffer.push(TAG_INT32);
      writeInt32(buffer, value);
    } else {
      buffer.push(TAG_FLOAT64);
      writeFloat64(buffer, value);
    }
  } else if (typeof value === 'bigint') {
    buffer.push(TAG_BIGINT);
    writeString(buffer, value.toString());
  } else if (typeof value === 'string') {
    if (value.startsWith('@') && /^@[a-f0-9]{16}$/.test(value)) {
      buffer.push(TAG_STRING_REF);
      writeString(buffer, value);
    } else {
      buffer.push(TAG_STRING);
      writeString(buffer, value);
    }
  } else if (Array.isArray(value)) {
    // Parameter list
    buffer.push(TAG_PARAMETERS);
    writeVarint(buffer, value.length);
    for (const item of value) {
      if (typeof item !== 'string') {
        throw new TypeError('Parameter name must be a string: ' + item);
      }
      writeString(buffer, item);
    }
  } else if (value && typeof value === 'object' && value.v === 1 && Array.isArray(value.k)) {
    buffer.push(TAG_SEALED_PROGRAM);
    writeString(buffer, JSON.stringify(value));
  } else if (value && typeof value === 'object' && (value.code || value instanceof Uint8Array)) {
    buffer.push(TAG_BYTECODE);
    const encoded = value instanceof Uint8Array ? value : encodeBytecode(value);
    writeVarint(buffer, encoded.length);
    for (let i = 0; i < encoded.length; i++) buffer.push(encoded[i]);
  } else {
    throw new TypeError('Unsupported constant in bytecode constant pool: ' + String(value));
  }
}

/**
 * Deserializes a Uint8Array into a bytecode program.
 *
 * @param {Uint8Array} bytes
 * @param {{decodeString?: (ref: string) => string}} [options]
 * @returns {{
 *   version: number,
 *   constants: Array<unknown>,
 *   code: Uint8Array
 * }}
 */
export function decodeBytecode(bytes, { decodeString } = {}) {
  if (!(bytes instanceof Uint8Array)) {
    throw new TypeError('Bytecode must be a Uint8Array');
  }
  const offsetObj = { offset: 0 };
  if (
    bytes[offsetObj.offset++] !== 0x52 ||
    bytes[offsetObj.offset++] !== 0x56 ||
    bytes[offsetObj.offset++] !== 0x4d ||
    bytes[offsetObj.offset++] !== 0x01
  ) {
    throw new Error('Invalid Rell VM bytecode magic header');
  }

  const version = readVarint(bytes, offsetObj);
  const constCount = readVarint(bytes, offsetObj);
  const constants = new Array(constCount);

  for (let i = 0; i < constCount; i++) {
    const tag = bytes[offsetObj.offset++];
    switch (tag) {
      case TAG_NULL:
        constants[i] = null;
        break;
      case TAG_UNDEFINED:
        constants[i] = undefined;
        break;
      case TAG_FALSE:
        constants[i] = false;
        break;
      case TAG_TRUE:
        constants[i] = true;
        break;
      case TAG_NAN:
        constants[i] = NaN;
        break;
      case TAG_INFINITY:
        constants[i] = Infinity;
        break;
      case TAG_NEG_INFINITY:
        constants[i] = -Infinity;
        break;
      case TAG_INT32:
        constants[i] = readInt32(bytes, offsetObj);
        break;
      case TAG_FLOAT64:
        constants[i] = readFloat64(bytes, offsetObj);
        break;
      case TAG_BIGINT:
        constants[i] = BigInt(readString(bytes, offsetObj));
        break;
      case TAG_STRING:
        constants[i] = readString(bytes, offsetObj);
        break;
      case TAG_STRING_REF: {
        const ref = readString(bytes, offsetObj);
        if (decodeString) {
          Object.defineProperty(constants, i, {
            enumerable: true,
            configurable: true,
            get() {
              const val = decodeString(ref);
              if (typeof val !== 'string') {
                throw new TypeError('Decoded string reference must be a string');
              }
              return val;
            },
          });
        } else {
          constants[i] = ref;
        }
        break;
      }
      case TAG_PARAMETERS: {
        const pCount = readVarint(bytes, offsetObj);
        const params = new Array(pCount);
        for (let p = 0; p < pCount; p++) {
          params[p] = readString(bytes, offsetObj);
        }
        constants[i] = Object.freeze(params);
        break;
      }
      case TAG_BYTECODE: {
        const bLen = readVarint(bytes, offsetObj);
        const nestedBytes = bytes.subarray(offsetObj.offset, offsetObj.offset + bLen);
        offsetObj.offset += bLen;
        constants[i] = decodeBytecode(nestedBytes, { decodeString });
        break;
      }
      case TAG_SEALED_PROGRAM: {
        const json = readString(bytes, offsetObj);
        constants[i] = JSON.parse(json);
        break;
      }
      default:
        throw new Error('Unknown bytecode constant tag: ' + tag);
    }
  }

  const codeLen = readVarint(bytes, offsetObj);
  const code = bytes.subarray(offsetObj.offset, offsetObj.offset + codeLen);
  offsetObj.offset += codeLen;

  return {
    version,
    constants,
    code,
    instructions: code,
  };
}
