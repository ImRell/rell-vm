const SCOPE_BOUNDARIES = new Set([
  'FunctionDeclaration',
  'FunctionExpression',
  'ArrowFunctionExpression',

  // Method body boundaries in Babel AST.
  'ObjectMethod',
  'ClassMethod',
  'ClassPrivateMethod',

  // Declarations inside static blocks do not belong to the outer scope.
  'StaticBlock',
]);

/**
 * Collects unique var binding names within a single script or function body.
 *
 * Traverses nested blocks, conditionals, and loops,
 * but does not traverse into nested functions.
 *
 * Does not execute code or mutate the AST.
 *
 * @param {object} root Babel Program or function body BlockStatement.
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