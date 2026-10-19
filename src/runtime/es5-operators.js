import { VMFunction } from './vm-function.js';
import { toNumeric, toPrimitive, toPropertyKey } from './numeric-update.js';
const apply = Reflect.apply;
const has = Reflect.has;
const get = Reflect.get;
const remove = Reflect.deleteProperty;
const box = Object;
const NativeTypeError = TypeError;
const objectLike = (value) =>
  value !== null && (typeof value === 'object' || typeof value === 'function');

export function typeOfValue(value) {
  return value instanceof VMFunction ? 'function' : typeof value;
}
export function typeOfExternal(name, environment) {
  // Do not catch ReferenceError from a getter: only an absent binding is safe.
  return has(environment, name)
    ? typeOfValue(get(environment, name))
    : 'undefined';
}
export function deleteExternal(name, environment) {
  return remove(environment, name);
}
export function deleteProperty(base, rawKey, strict, invoke = apply) {
  if (typeof strict !== 'boolean')
    throw new NativeTypeError('Strict flag must be a boolean');
  if (base === null || base === undefined)
    throw new NativeTypeError('Cannot delete property of null or undefined');
  const result = remove(box(base), toPropertyKey(rawKey, invoke));
  if (!result && strict)
    throw new NativeTypeError('Cannot delete non-configurable property');
  return result;
}
function looseEqual(left, right, invoke) {
  // The object/object and nullish cases never request ToPrimitive.
  if (
    objectLike(left) &&
    !objectLike(right) &&
    right !== null &&
    right !== undefined
  )
    left = toPrimitive(left, 'default', invoke);
  else if (
    objectLike(right) &&
    !objectLike(left) &&
    left !== null &&
    left !== undefined
  )
    right = toPrimitive(right, 'default', invoke);
  return left == right;
}
export function unaryOperation(op, value, invoke = apply) {
  switch (op) {
    case 'js.pos':
      return +toPrimitive(value, 'number', invoke);
    case 'js.neg':
      return -toPrimitive(value, 'number', invoke);
    case 'js.bit_not':
      return ~toPrimitive(value, 'number', invoke);
    case 'js.typeof':
      return typeOfValue(value);
    case 'js.void':
      return undefined;
    default:
      throw new Error(`Unknown unary operation: ${op}`);
  }
}
export function binaryOperation(op, left, right, invoke = apply) {
  if (op === 'js.strict_eq') return left === right;
  if (op === 'js.strict_ne') return left !== right;
  if (op === 'js.eq') return looseEqual(left, right, invoke);
  if (op === 'js.ne') return !looseEqual(left, right, invoke);
  if (op === 'js.in') {
    // RHS type validation precedes ToPropertyKey of the left operand.
    if (!objectLike(right)) return left in right;
    return toPropertyKey(left, invoke) in right;
  }
  if (op === 'js.instanceof') {
    return left instanceof right;
  }
  if (op === 'js.add') {
    left = toPrimitive(left, 'default', invoke);
    right = toPrimitive(right, 'default', invoke);
    return left + right;
  }
  if (op === 'js.lt' || op === 'js.le' || op === 'js.gt' || op === 'js.ge') {
    // Even > and <= coerce the ORIGINAL left value first.
    left = toPrimitive(left, 'number', invoke);
    right = toPrimitive(right, 'number', invoke);
    switch (op) {
      case 'js.lt':
        return left < right;
      case 'js.le':
        return left <= right;
      case 'js.gt':
        return left > right;
      case 'js.ge':
        return left >= right;
    }
  }
  left = toNumeric(left, invoke);
  right = toNumeric(right, invoke);
  switch (op) {
    case 'js.sub':
      return left - right;
    case 'js.mul':
      return left * right;
    case 'js.div':
      return left / right;
    case 'js.rem':
      return left % right;
    case 'js.bit_and':
      return left & right;
    case 'js.bit_or':
      return left | right;
    case 'js.bit_xor':
      return left ^ right;
    case 'js.shl':
      return left << right;
    case 'js.shr':
      return left >> right;
    case 'js.ushr':
      return left >>> right;
    default:
      throw new Error(`Unknown binary operation: ${op}`);
  }
}
