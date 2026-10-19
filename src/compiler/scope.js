/**
 * Области скрипта, функций и блоков.
 * Каждая область соответствует одному runtime-окружению.
 * Блоки разделяют счётчик слотов кадра; функции имеют новый счётчик.
 */
export class LexicalScope {
  #parent;
  #bindings = new Map();
  #allocator;
  #isFrameRoot;

  constructor(parent = null, { functionRoot = false } = {}) {
    if (parent !== null && !(parent instanceof LexicalScope)) {
      throw new TypeError('Parent must be a LexicalScope or null');
    }
    if (typeof functionRoot !== 'boolean') {
      throw new TypeError('functionRoot must be a boolean');
    }
    this.#parent = parent;
    this.#isFrameRoot = parent === null || functionRoot;
    this.#allocator = this.#isFrameRoot ? { nextSlot: 0 } : parent.#allocator;
  }

  get localCount() {
    return this.#allocator.nextSlot;
  }

  createChild() {
    return new LexicalScope(this);
  }

  createFunctionChild() {
    return new LexicalScope(this, { functionRoot: true });
  }

  declare(name, kind) {
    assertName(name);
    if (kind !== 'let' && kind !== 'const') {
      throw new TypeError('Binding kind must be let or const');
    }
    if (this.#bindings.has(name)) {
      throw new SyntaxError(`Identifier is already declared: ${name}`);
    }
    return this.#createBinding(name, kind);
  }

  /** Вызывается для отдельной private-области имени FunctionExpression. */
  declareFunctionName(name) {
    assertName(name);
    if (this.#bindings.has(name)) {
      throw new SyntaxError(`Identifier is already declared: ${name}`);
    }
    return this.#createBinding(name, 'functionName');
  }

  declareVar(name) {
    assertName(name);
    let scope = this;
    while (!scope.#isFrameRoot) {
      if (scope.#bindings.has(name)) {
        throw new SyntaxError(`Identifier is already declared: ${name}`);
      }
      scope = scope.#parent;
    }
    const existing = scope.#bindings.get(name);
    if (existing !== undefined) {
      if (existing.kind === 'var') return existing;
      throw new SyntaxError(`Identifier is already declared: ${name}`);
    }
    return scope.#createBinding(name, 'var');
  }

  resolve(name) {
    return this.resolveReference(name)?.binding ?? null;
  }

  /** Ищет привязку только внутри текущего кадра. */
  resolveFrameReference(name) {
    assertName(name);
    let scope = this;
    let depth = 0;
    while (scope !== null) {
      const binding = scope.#bindings.get(name);
      if (binding !== undefined) return Object.freeze({ binding, depth });
      if (scope.#isFrameRoot) return null;
      scope = scope.#parent;
      depth += 1;
    }
    return null;
  }

  /** Глубина считает и блоки, и границы функций. */
  resolveReference(name) {
    assertName(name);
    let scope = this;
    let depth = 0;
    while (scope !== null) {
      const binding = scope.#bindings.get(name);
      if (binding !== undefined) {
        return Object.freeze({ binding, depth });
      }
      scope = scope.#parent;
      depth += 1;
    }
    return null;
  }

  #createBinding(name, kind) {
    const binding = Object.freeze({
      name,
      kind,
      slot: this.#allocator.nextSlot,
    });
    this.#bindings.set(name, binding);
    this.#allocator.nextSlot += 1;
    return binding;
  }
}

function assertName(name) {
  if (typeof name !== 'string' || name.length === 0) {
    throw new TypeError('Binding name must be a non-empty string');
  }
}
