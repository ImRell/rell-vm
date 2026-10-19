import { LexicalCell } from './lexical-cell.js';

/**
 * Собственная неизменяемая привязка имени FunctionExpression.
 * В отличие от const, запись в нестрогом коде игнорируется.
 * Строгость относится к коду присваивания, а не к моменту создания ячейки.
 */
export class FunctionNameCell extends LexicalCell {
  constructor(name) {
    super(name, 'const');
  }

  assign(value, strict) {
    if (typeof strict !== 'boolean') {
      throw new TypeError('Assignment strict flag must be a boolean');
    }

    // Не разрешаем обход TDZ даже при использовании модуля отдельно.
    this.read();

    if (strict) {
      // Базовая ячейка const выбрасывает штатный TypeError.
      this.write(value);
    }

    // Игнорируется только запись, но не вычисление RHS и не его результат.
    return value;
  }
}
