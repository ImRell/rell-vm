import { LexicalEnvironment } from './lexical-environment.js';
export class CallFrame {
  #rootEnvironment;
  #environment;
  #arguments;
  #thisArg;
  pc = 0;
  stack = [];
  locals = new Map();
  constructor({
    parentEnvironment = null,
    args = [],
    thisArg = undefined,
  } = {}) {
    if (
      parentEnvironment !== null &&
      !(parentEnvironment instanceof LexicalEnvironment)
    )
      throw new TypeError('Invalid parent environment');
    if (!Array.isArray(args)) throw new TypeError('Arguments must be an array');
    this.#arguments = Object.freeze([...args]);
    this.#thisArg = thisArg;
    this.#rootEnvironment = new LexicalEnvironment(parentEnvironment);
    this.#environment = this.#rootEnvironment;
  }
  get rootEnvironment() {
    return this.#rootEnvironment;
  }
  get environment() {
    return this.#environment;
  }
  get args() {
    return this.#arguments;
  }
  get thisArg() {
    return this.#thisArg;
  }
  enterScope() {
    return (this.#environment = this.#environment.createChild());
  }
  restoreEnvironment(environment) {
    if (!(environment instanceof LexicalEnvironment))
      throw new TypeError('Environment does not belong to this frame');
    let cursor = environment;
    while (cursor !== null && cursor !== this.#rootEnvironment)
      cursor = cursor.parent;
    if (
      !(environment instanceof LexicalEnvironment) ||
      cursor !== this.#rootEnvironment
    )
      throw new TypeError('Environment does not belong to this frame');
    this.#environment = environment;
  }
  leaveScope() {
    if (this.#environment === this.#rootEnvironment)
      throw new Error('Cannot leave the root environment of a call frame');
    return (this.#environment = this.#environment.parent);
  }
}
