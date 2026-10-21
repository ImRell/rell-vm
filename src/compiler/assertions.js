/**
 * AST node validation and compiler syntax error helpers.
 */

export function assertFunction(node) {
  if (node.async || node.generator) {
    unsupported(node, 'Async and generator functions must be normalized first');
  }
  for (const parameter of node.params) {
    if (parameter.type !== 'Identifier') {
      unsupported(parameter, `Unsupported parameter: ${parameter.type}`);
    }
  }
}

export function assertDeclaration(node) {
  if (node.kind !== 'var' && node.kind !== 'let' && node.kind !== 'const') {
    unsupported(node, `Unsupported variable kind: ${node.kind}`);
  }

  for (const declaration of node.declarations) {
    if (declaration.id.type !== 'Identifier') {
      unsupported(
        declaration.id,
        `Unsupported binding pattern: ${declaration.id.type}`,
      );
    }
  }
}

export function unsupported(node, message) {
  if (!node.loc) {
    throw new SyntaxError(message);
  }

  const filename = node.loc.filename ?? 'input.js';
  const { line, column } = node.loc.start;

  throw new SyntaxError(`${filename}:${line}:${column + 1}: ${message}`);
}
