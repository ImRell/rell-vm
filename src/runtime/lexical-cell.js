/**
 * Lexical variable cell for let or const bindings.
 *
 * States:
 * 1. Created, uninitialized — TDZ.
 * 2. Initialized — readable and mutable (if let).
 *
 * Initialization and subsequent assignment are distinct operations.
 */
export class LexicalCell {
  #name;
  #kind;
  #initialized = false;
  #value = undefined;

  /**
   * @param {string} name
   * @param {'let' | 'const'} kind
   */
  constructor(name, kind) {
    if (typeof name !== 'string' || name.length === 0) {
      throw new TypeError('Cell name must be a non-empty string');
    }

    if (kind !== 'let' && kind !== 'const') {
      throw new TypeError('Cell kind must be let or const');
    }

    this.#name = name;
    this.#kind = kind;
  }

  /**
   * Initial declaration binding initialization.
   *
   * @param {unknown} value
   * @returns {void}
   */
  initialize(value) {
    if (this.#initialized) {
      throw new Error(
        `Lexical cell '${this.#name}' is already initialized`,
      );
    }

    this.#value = value;
    this.#initialized = true;
  }

  /**
   * @returns {unknown}
   */
  read() {
    this.#assertInitialized();

    return this.#value;
  }

  /**
   * Assigns a new value and returns it.
   *
   * @param {unknown} value
   * @returns {unknown}
   */
  write(value) {
    this.#assertInitialized();

    if (this.#kind === 'const') {
      throw new TypeError(
        `Assignment to constant variable '${this.#name}'`,
      );
    }

    this.#value = value;

    return value;
  }

  #assertInitialized() {
    if (!this.#initialized) {
      throw new ReferenceError(
        `Cannot access '${this.#name}' before initialization`,
      );
    }
  }
}