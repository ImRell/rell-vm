const SCOPE_BOUNDARIES = new Set([
  'FunctionDeclaration',
  'FunctionExpression',
  'ArrowFunctionExpression',

  // Границы тел методов в Babel AST.
  'ObjectMethod',
  'ClassMethod',
  'ClassPrivateMethod',

  // Объявления внутри static-блока не принадлежат внешней области.
  'StaticBlock',
]);

/**
 * Собирает уникальные имена var в одном скрипте или теле функции.
 *
 * Входит во вложенные блоки, условия и циклы,
 * но не входит во вложенные функции.
 *
 * Не выполняет код и не изменяет AST.
 *
 * @param {object} root Babel Program или BlockStatement тела функции.
 * @returns {ReadonlyArray<string>}
 */
export function collectVarNames(root) {
  if (
    root === null ||
    typeof root !== 'object' ||
    (
      root.type !== 'Program' &&
      root.type !== 'BlockStatement'
    ) ||
    !Array.isArray(root.body)
  ) {
    throw new TypeError(
      'Expected a Program or function body BlockStatement',
    );
  }

  const names = new Set();

  visit(root);

  return Object.freeze([...names]);

  function visit(node) {
    if (
      node === null ||
      typeof node !== 'object' ||
      typeof node.type !== 'string'
    ) {
      return;
    }

    if (SCOPE_BOUNDARIES.has(node.type)) {
      return;
    }

    if (
      node.type === 'VariableDeclaration' &&
      node.kind === 'var'
    ) {
      for (const declaration of node.declarations) {
        if (declaration.id.type !== 'Identifier') {
          throw new SyntaxError(
            `Unsupported var binding pattern: ${declaration.id.type}`,
          );
        }

        names.add(declaration.id.name);
      }
    }

    for (const value of Object.values(node)) {
      if (Array.isArray(value)) {
        for (const child of value) {
          visit(child);
        }
      } else {
        visit(value);
      }
    }
  }
}