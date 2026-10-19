// Capture the operations used by the VM before the user program can replace
// Object or Reflect.set on the global object.
const toObject = Object;
const reflectSet = Reflect.set;
const NativeTypeError = TypeError;

/**
 * Implements property PutValue with an explicit strict flag.
 * key is intentionally kept raw: native [[Get]] and [[Set]] each perform
 * their own ToPropertyKey. Converting early would change observable order.
 * The expression result is always the RHS, not the setter's return value.
 */
export function writeProperty(base, key, value, strict = false) {
  if (typeof strict !== 'boolean') {
    throw new NativeTypeError(
      'Property assignment strict flag must be a boolean',
    );
  }
  if (base === null || base === undefined) {
    throw new NativeTypeError('Cannot set property of null or undefined');
  }

  // Box primitive bases for lookup, but keep the ORIGINAL receiver.
  // This allows inherited setters on primitives while preventing creation
  // of properties on a temporary wrapper object.
  const succeeded = reflectSet(toObject(base), key, value, base);
  if (!succeeded && strict) {
    // Do not stringify key/base here: that could repeat user coercions.
    throw new NativeTypeError('Cannot assign to property in strict mode');
  }
  return value;
}
