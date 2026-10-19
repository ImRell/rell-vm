import { LexicalCell } from './lexical-cell.js';
import { FunctionNameCell } from './function-name-cell.js';
function assertIndex(value, label) {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new TypeError(`${label} must be a non-negative safe integer`);
}
export class LexicalEnvironment {
  #parent;
  #cells = new Map();
  constructor(parent = null) {
    if (parent !== null && !(parent instanceof LexicalEnvironment))
      throw new TypeError('Parent must be a LexicalEnvironment or null');
    this.#parent = parent;
  }
  get parent() {
    return this.#parent;
  }
  createChild() {
    return new LexicalEnvironment(this);
  }
  create(slot, name, kind) {
    assertIndex(slot, 'Slot');
    if (this.#cells.has(slot))
      throw new Error(
        `Lexical slot ${slot} already exists in this environment`,
      );
    const cell = new LexicalCell(name, kind);
    this.#cells.set(slot, cell);
    return cell;
  }
  createFunctionName(slot, name) {
    assertIndex(slot, 'Slot');
    if (this.#cells.has(slot)) {
      throw new Error(
        `Lexical slot ${slot} already exists in this environment`,
      );
    }
    const cell = new FunctionNameCell(name);
    this.#cells.set(slot, cell);
    return cell;
  }

  recreate(slot, name, kind) {
    assertIndex(slot, 'Slot');
    const cell = new LexicalCell(name, kind);
    this.#cells.set(slot, cell);
    return cell;
  }
  getCell(slot, depth = 0) {
    assertIndex(slot, 'Slot');
    assertIndex(depth, 'Depth');
    let environment = this;
    for (let i = 0; i < depth; i++) {
      environment = environment.#parent;
      if (environment === null)
        throw new Error(`Lexical environment at depth ${depth} does not exist`);
    }
    if (!environment.#cells.has(slot))
      throw new Error(`Lexical slot ${slot} does not exist at depth ${depth}`);
    return environment.#cells.get(slot);
  }
}
