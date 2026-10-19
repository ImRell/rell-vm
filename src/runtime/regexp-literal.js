const NativeRegExp = /(?:)/.constructor;
/** A fresh literal per evaluation. No prototype .compile or global RegExp lookup. */
export function createRegExpLiteral(pattern, flags) {
  if (typeof pattern !== 'string' || typeof flags !== 'string')
    throw new TypeError('RegExp pattern and flags must be strings');
  if (!/^[gim]*$/.test(flags))
    throw new SyntaxError(
      'Only ES5 RegExp flags g, i, m are supported; normalize source first',
    );
  return new NativeRegExp(pattern, flags);
}
