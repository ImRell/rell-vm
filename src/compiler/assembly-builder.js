import { INSTRUCTIONS } from '../assembly/instructions.js';
import { parseAssembly } from '../assembly/parse.js';

/**
 * Генератор собственного текстового формата.
 *
 * Не использует числовые опкоды и пул констант.
 * build() возвращает строку, принимаемую executeAssembly().
 */
export class AssemblyBuilder {
  #lines = [];
  #labels = new Map();

  /**
   * Создаёт метку, принадлежащую этому генератору.
   *
   * @returns {object}
   */
  createLabel() {
    const label = Object.freeze(Object.create(null));

    this.#labels.set(label, {
      name: `L${this.#labels.size}`,
      marked: false,
    });

    return label;
  }

  /**
   * Привязывает метку к следующей исполняемой инструкции.
   *
   * @param {object} label
   * @returns {void}
   */
  markLabel(label) {
    const definition = this.#getLabel(label);

    if (definition.marked) {
      throw new Error('Label is already marked');
    }

    this.#lines.push(`label ${definition.name}`);
    definition.marked = true;
  }

  /**
   * Добавляет инструкцию после проверки аргументов.
   *
   * Для переходов нужно передавать объект метки.
   *
   * @param {string} op
   * @param {...unknown} args
   * @returns {void}
   */
  emit(op, ...args) {
    if (typeof op !== 'string' || !Object.hasOwn(INSTRUCTIONS, op)) {
      throw new TypeError(`Unknown instruction: ${String(op)}`);
    }

    const definition = INSTRUCTIONS[op];

    if (args.length !== definition.operands.length) {
      throw new TypeError(
        `${op} expects ${definition.operands.length} arguments, ` +
          `received ${args.length}`,
      );
    }

    const operands = definition.operands.map((type, index) => {
      const value = args[index];

      if (type === 'label') {
        return this.#getLabel(value).name;
      }

      return formatOperand(value, type);
    });

    // Записываем строку только после проверки всех аргументов.
    const line = [op, ...operands].join(' ');
    if (
      op === 'js.function.create' ||
      op === 'js.function.named.create' ||
      op === 'js.regexp.create'
    )
      parseAssembly(`${line}\n`);
    this.#lines.push(line);
  }

  /**
   * Возвращает проверенный текст программы.
   *
   * Проверка не исполняет программу.
   *
   * @returns {string}
   */
  build() {
    const source = `${this.#lines.join('\n')}\n`;

    parseAssembly(source);

    return source;
  }

  #getLabel(label) {
    const definition = this.#labels.get(label);

    if (definition === undefined) {
      throw new TypeError('Label must belong to this builder');
    }

    return definition;
  }
}

function formatOperand(value, type) {
  switch (type) {
    case 'text':
      if (typeof value !== 'string')
        throw new TypeError('Text must be a string');
      return quoteString(value);
    case 'parameters':
      if (
        !Array.isArray(value) ||
        Array.from(value).some(
          (name) => typeof name !== 'string' || name.length === 0,
        )
      )
        throw new TypeError('Parameters must be an array of non-empty strings');
      return quoteString(JSON.stringify(value));
    case 'boolean':
      if (typeof value !== 'boolean')
        throw new TypeError('Boolean operand must be a boolean');
      return String(value);
    case 'literal':
      return formatLiteral(value);

    case 'slot':
    case 'count':
      if (!Number.isSafeInteger(value) || value < 0) {
        const label = type === 'slot' ? 'Slot' : 'Argument count';

        throw new TypeError(`${label} must be a non-negative safe integer`);
      }

      return String(value);

    case 'name':
      if (typeof value !== 'string' || value.length === 0) {
        throw new TypeError('Name must be a non-empty string');
      }

      return quoteString(value);

    case 'bindingKind':
      if (value !== 'let' && value !== 'const') {
        throw new TypeError('Binding kind must be let or const');
      }

      return value;

    default:
      throw new Error(`Unsupported operand type in contract: ${type}`);
  }
}

function formatLiteral(value) {
  if (value === null) {
    return 'null';
  }

  switch (typeof value) {
    case 'undefined':
      return 'undefined';

    case 'boolean':
      return value ? 'true' : 'false';

    case 'string':
      return quoteString(value);

    case 'number':
      return Object.is(value, -0) ? '-0' : String(value);

    case 'bigint':
      return `${value.toString()}n`;

    default:
      throw new TypeError('Only primitive non-symbol literals are supported');
  }
}

function quoteString(value) {
  return JSON.stringify(value)
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}
