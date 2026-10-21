import { LexicalCell } from './lexical-cell.js';

/**
 * Immutable binding for a FunctionExpression's own name.
 * Unlike const, assignment in sloppy mode is silently ignored.
 * Strictness is determined by the assignment location, not cell creation time.
 */
export class FunctionNameCell extends LexicalCell {
  constructor(name) {
    super(name, 'const');
  }

  assign(value, strict) {
    if (typeof strict !== 'boolean') {
      throw new TypeError('Assignment strict flag must be a boolean');
    }

    // Disallow bypassing TDZ even when using module independently.
    this.read();

    if (strict) {
      // Base const cell throws standard TypeError in strict mode.
      this.write(value);
    }

    // Only assignment is ignored, not RHS evaluation or its return value.
    return value;
  }
}
