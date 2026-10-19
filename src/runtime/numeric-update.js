import { VMFunction } from './vm-function.js';

const apply = Reflect.apply;
const stringify = String;
const toPrimitiveSymbol = Symbol.toPrimitive;
const NativeTypeError = TypeError;

function isPrimitive(value) {
  return (
    value === null || (typeof value !== 'object' && typeof value !== 'function')
  );
}
function isCallable(value) {
  return typeof value === 'function' || value instanceof VMFunction;
}

/** OrdinaryToPrimitive/GetMethod, with VM-aware calls and an explicit hint. */
export function toPrimitive(value, hint, invoke = apply) {
  if (isPrimitive(value)) return value;
  const exotic = value[toPrimitiveSymbol];
  if (exotic !== undefined && exotic !== null) {
    if (!isCallable(exotic))
      throw new NativeTypeError('Symbol.toPrimitive is not callable');
    const result = invoke(exotic, value, [hint]);
    if (!isPrimitive(result))
      throw new NativeTypeError('Cannot convert object to primitive value');
    return result;
  }
  const names =
    hint === 'string' ? ['toString', 'valueOf'] : ['valueOf', 'toString'];
  for (const name of names) {
    const method = value[name];
    if (!isCallable(method)) continue;
    const result = invoke(method, value, []);
    if (isPrimitive(result)) return result;
  }
  throw new NativeTypeError('Cannot convert object to primitive value');
}

/** ToNumeric uses the number hint and preserves BigInt. */
export function toNumeric(value, invoke = apply) {
  const primitive = toPrimitive(value, 'number', invoke);
  return typeof primitive === 'bigint' ? primitive : +primitive;
}

/** ToPropertyKey uses the string hint and preserves Symbols. */
export function toPropertyKey(value, invoke = apply) {
  const primitive = toPrimitive(value, 'string', invoke);
  return typeof primitive === 'symbol' ? primitive : stringify(primitive);
}

export function updateNumeric(value, increment, invoke = apply) {
  if (typeof increment !== 'boolean')
    throw new NativeTypeError('Increment flag must be a boolean');
  const oldValue = toNumeric(value, invoke);
  let newValue = oldValue;
  if (increment) newValue++;
  else newValue--;
  return { oldValue, newValue };
}
