import { parse as parseJavaScript } from '@babel/parser';
import { readFile } from 'node:fs/promises';
import { resolve, relative, sep } from 'node:path';
import { randomBytes } from 'node:crypto';
import { parseAssembly } from '../assembly/parse.js';
import { rewriteRuntimeInstructions } from './randomize-instructions.js';

// Deliberately audited allowlist, NOT arbitrary public property mangling.
// Never include descriptor keys/value/get/set, name/length/prototype, iterator
// value/done/next, error name/message or host APIs (Reflect, Symbol, Object...).
export const INTERNAL_PROPERTIES = Object.freeze([
  'pc',
  'stack',
  'locals',
  'rootEnvironment',
  'environment',
  'args',
  'thisArg',
  'parentEnvironment',
  'enterScope',
  'leaveScope',
  'restoreEnvironment',
  'parent',
  'createChild',
  'createFunctionName',
  'recreate',
  'getCell',
  'initialize',
  'read',
  'write',
  'assign',
  'program',
  'frame',
  'instructions',
  'op',
  'line',
  'column',
  'target',
  'targets',
  'pops',
  'pushes',
  'operands',
  'flow',
  'parameters',
  'strict',
  'source',
  'capturedEnvironment',
  'exposeMetadata',
  'exposeFunctionMetadata',
  'maxSteps',
  'handlers',
  'phase',
  'stackDepth',
  'catchTarget',
  'finallyTarget',
  'endTarget',
  'hasCatch',
  'hasFinally',
  'pending',
  'argumentsObject',
  'decodeString',
]);

export function runtimePropertyOptions(enabled) {
  if (!enabled) return {};
  const cache = {},
    used = new Set(INTERNAL_PROPERTIES);
  for (const name of INTERNAL_PROPERTIES) {
    let alias;
    do alias = '_rell_vm_' + randomBytes(4).toString('hex');
    while (used.has(alias));
    used.add(alias);
    cache[name] = alias;
  }
  return {
    mangleProps: new RegExp('^(?:' + INTERNAL_PROPERTIES.join('|') + ')$'),
    mangleQuoted: true,
    mangleCache: cache,
  };
}

/** Conservative structural scan, NOT execution/reachability analysis.
 * Include every nested function, even one created in an unreachable branch.
 */
export function collectUsedOpcodes(source) {
  const used = new Set();
  function visit(text) {
    for (const instruction of parseAssembly(text).instructions) {
      used.add(instruction.op);
      if (
        instruction.op === 'js.function.create' ||
        instruction.op === 'js.function.named.create'
      )
        visit(instruction.args[3]);
    }
  }
  visit(source);
  return used;
}
function walk(root, visit) {
  const pending = [root];
  while (pending.length) {
    const node = pending.pop();
    visit(node);
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) {
        for (const child of value)
          if (child && typeof child.type === 'string') pending.push(child);
      } else if (value && typeof value.type === 'string') pending.push(value);
    }
  }
}
function applyEdits(source, edits) {
  // Keep only outer edits. E.g. a removed switch case may contain a masked error.
  edits.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  const chosen = [];
  let lastEnd = -1;
  for (const edit of edits) {
    if (edit[0] >= lastEnd) {
      chosen.push(edit);
      lastEnd = edit[1];
    }
  }
  for (let i = chosen.length - 1; i >= 0; i--) {
    const [a, b, text] = chosen[i];
    source = source.slice(0, a) + text + source.slice(b);
  }
  return source;
}
function opcodeTests(node) {
  if (
    node.type === 'BinaryExpression' &&
    ['===', '=='].includes(node.operator)
  ) {
    if (
      node.left.type === 'Identifier' &&
      node.left.name === 'op' &&
      node.right.type === 'StringLiteral'
    )
      return [node.right.value];
    if (
      node.right.type === 'Identifier' &&
      node.right.name === 'op' &&
      node.left.type === 'StringLiteral'
    )
      return [node.left.value];
  }
  if (node.type === 'LogicalExpression' && node.operator === '||') {
    const a = opcodeTests(node.left),
      b = opcodeTests(node.right);
    if (a && b) return [...a, ...b];
  }
  return null;
}
export function specializeRuntimeSource(
  source,
  { filename, usedOpcodes, pruneOpcodes = true, maskErrors = true },
) {
  if (!pruneOpcodes && !maskErrors) return source;
  const ast = parseJavaScript(source, { sourceType: 'module' }),
    edits = [];
  const dispatcher =
    filename === 'runtime/execute-assembly.js' ||
    filename === 'runtime/es5-operators.js';
  walk(ast, (node) => {
    if (
      pruneOpcodes &&
      dispatcher &&
      node.type === 'SwitchStatement' &&
      node.discriminant.type === 'Identifier' &&
      node.discriminant.name === 'op'
    ) {
      let group = [];
      for (const branch of node.cases) {
        group.push(branch);
        if (branch.consequent.length === 0) continue;
        if (
          group.every((c) => c.test === null || c.test.type === 'StringLiteral')
        ) {
          const kept = group.filter(
            (c) => c.test === null || usedOpcodes.has(c.test.value),
          );
          if (kept.length !== group.length) {
            const body = source.slice(branch.consequent[0].start, branch.end);
            edits.push([
              group[0].start,
              branch.end,
              kept.length
                ? kept
                    .map((c) =>
                      c.test === null
                        ? 'default:'
                        : 'case ' + JSON.stringify(c.test.value) + ':',
                    )
                    .join('\n') +
                  '\n' +
                  body
                : '',
            ]);
          }
        }
        group = [];
      }
    }
    if (
      pruneOpcodes &&
      filename === 'runtime/es5-operators.js' &&
      node.type === 'IfStatement' &&
      !node.alternate
    ) {
      const names = opcodeTests(node.test);
      if (names && names.every((n) => !usedOpcodes.has(n)))
        edits.push([node.start, node.end, '']);
    }
    if (
      pruneOpcodes &&
      filename === 'assembly/instructions.js' &&
      node.type === 'VariableDeclarator' &&
      node.id.type === 'Identifier' &&
      node.id.name === 'INSTRUCTIONS'
    ) {
      const table = node.init.arguments[0];
      for (const property of table.properties) {
        const name =
          property.key.type === 'Identifier'
            ? property.key.name
            : property.key.value;
        if (!usedOpcodes.has(name)) {
          // Include the separator comma, but never eat whitespace/comments or
          // the next property's text. A trailing comma is valid JavaScript.
          let end = property.end;
          while (/\s/.test(source[end] ?? '') && end < source.length) end++;
          if (source[end] === ',') end++;
          edits.push([property.start, end, '']);
        }
      }
    }
    if (
      maskErrors &&
      node.type === 'NewExpression' &&
      node.callee.type === 'Identifier' &&
      /^(?:Native)?(?:Error|TypeError|ReferenceError|SyntaxError|RangeError)$/.test(
        node.callee.name,
      )
    )
      edits.push([node.start, node.end, 'new ' + node.callee.name + '("???")']);
    if (
      maskErrors &&
      node.type === 'CallExpression' &&
      node.callee.type === 'Identifier' &&
      node.callee.name === 'fail' &&
      node.arguments.length > 0
    ) {
      const last = node.arguments[node.arguments.length - 1];
      edits.push([last.start, last.end, '"???"']);
    }
  });
  // Pruning replacements preserve original bodies; mask again on a fresh AST
  // so no diagnostics survive merely because they were inside a kept case body.
  const result = applyEdits(source, edits);
  if (pruneOpcodes && maskErrors)
    return specializeRuntimeSource(result, {
      filename,
      usedOpcodes,
      pruneOpcodes: false,
      maskErrors: true,
    });
  return result;
}
export function runtimeHardeningPlugin({
  sourceDirectory,
  aliases,
  usedOpcodes,
  pruneOpcodes,
  maskErrors,
}) {
  const root = resolve(sourceDirectory);
  return {
    name: 'rell-specialized-runtime',
    setup(build) {
      build.onLoad({ filter: /\.js$/ }, async ({ path }) => {
        const filename = relative(root, path).split(sep).join('/');
        if (
          !filename.startsWith('runtime/') &&
          !filename.startsWith('assembly/')
        )
          return undefined;
        let contents = await readFile(path, 'utf8');
        contents = specializeRuntimeSource(contents, {
          filename,
          usedOpcodes,
          pruneOpcodes,
          maskErrors,
        });
        if (aliases)
          contents = rewriteRuntimeInstructions(
            contents,
            aliases,
            filename === 'assembly/instructions.js',
          );
        return { contents, loader: 'js' };
      });
    },
  };
}
