import { parse as parseJavaScript } from '@babel/parser';
import { readFile } from 'node:fs/promises';
import { resolve, relative, sep } from 'node:path';
import { randomBytes } from 'node:crypto';
import { parseAssembly } from '../assembly/parse.js';

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
    for (const instruction of parseAssembly(text, { allowProtectedReferences: true }).instructions) {
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
import { OPCODES, OPCODE_NAMES, INSTRUCTION_SPECS } from '../bytecode/opcodes.js';

function makeDecoy(id) {
  const rand = Math.floor(Math.random() * 4);
  const name = `_rell_vm_d${id}_${Math.random().toString(36).slice(2, 6)}`;
  let body;
  switch (rand) {
    case 0:
      body = `let r = (x * 31 + 17) ^ 0x5a5a; return (r >>> 3) | (r << 29);`;
      break;
    case 1:
      body = `let acc = 0; for (let i = 0; i < 4; i++) { acc = (acc + (x ^ (i * 17))) & 0x7fffffff; } return acc;`;
      break;
    case 2:
      body = `let v = (x ^ 0xdeadbeef) + 101; return v ^ (v >>> 16);`;
      break;
    default:
      body = `let h = 0x811c9dc5; for (let i = 0; i < 3; i++) h = Math.imul(h ^ (x + i), 0x01000193); return h >>> 0;`;
      break;
  }
  return {
    name,
    code: `function ${name}(x) { ${body} }`,
  };
}

function shuffleFunctionNodes(statements, source, edits, anchorFnName = null, excludeNames = []) {
  const funcs = [];
  for (const stmt of statements) {
    let fnName = null;
    let targetStmt = null;
    if (stmt.type === 'FunctionDeclaration') {
      fnName = stmt.id ? stmt.id.name : null;
      targetStmt = stmt;
    } else if (
      stmt.type === 'ExportNamedDeclaration' &&
      stmt.declaration &&
      stmt.declaration.type === 'FunctionDeclaration'
    ) {
      fnName = stmt.declaration.id ? stmt.declaration.id.name : null;
      targetStmt = stmt;
    }
    if (targetStmt && fnName && !excludeNames.includes(fnName)) {
      funcs.push({ node: targetStmt, name: fnName });
    }
  }
  if (funcs.length < 2) return;

  const texts = funcs.map((item) => source.slice(item.node.start, item.node.end));

  const decoyCount = 1 + Math.floor(Math.random() * 2);
  const decoys = [];
  for (let d = 0; d < decoyCount; d++) {
    decoys.push(makeDecoy(d));
  }

  for (let i = texts.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [texts[i], texts[j]] = [texts[j], texts[i]];
  }

  const decoyCodes = decoys.map((d) => d.code).join('\n');
  const decoyCalls = decoys.map((d) => `if (Math.random() < 0) ${d.name}(0);`).join('\n');

  let targetIdx = 0;
  if (anchorFnName) {
    const found = texts.findIndex(
      (t) =>
        t.includes(`function ${anchorFnName}`) ||
        t.includes(`function* ${anchorFnName}`),
    );
    if (found !== -1) targetIdx = found;
  }

  const lastBrace = texts[targetIdx].lastIndexOf('}');
  if (lastBrace !== -1) {
    texts[targetIdx] =
      texts[targetIdx].slice(0, lastBrace) +
      '\n' +
      decoyCalls +
      '\n' +
      texts[targetIdx].slice(lastBrace) +
      '\n' +
      decoyCodes;
  } else {
    texts[targetIdx] += '\n' + decoyCodes;
  }

  for (let i = 0; i < funcs.length; i++) {
    edits.push([funcs[i].node.start, funcs[i].node.end, texts[i]]);
  }
}

export function specializeRuntimeSource(
  source,
  {
    filename,
    usedOpcodes,
    pruneOpcodes = true,
    maskErrors = true,
    numericMapping = null,
    shuffleHandlers = true,
  },
) {
  if (!pruneOpcodes && !maskErrors && !numericMapping && !shuffleHandlers) return source;
  const ast = parseJavaScript(source, { sourceType: 'module' }),
    edits = [];
  const dispatcher =
    filename === 'runtime/execute-bytecode.js' ||
    filename === 'runtime/es5-operators.js';

  if (shuffleHandlers && pruneOpcodes) {
    if (filename === 'runtime/open-program.js') {
      shuffleFunctionNodes(ast.program.body, source, edits, 'openProgramEnvelope');
    } else if (filename === 'bytecode/binary-serializer.js') {
      shuffleFunctionNodes(ast.program.body, source, edits, 'decodeBytecode');
    } else if (filename === 'runtime/vm-function.js') {
      shuffleFunctionNodes(ast.program.body, source, edits, 'attachVMFunction');
    } else if (filename === 'runtime/execute-bytecode.js') {
      walk(ast, (node) => {
        if (
          node.type === 'FunctionDeclaration' &&
          node.id &&
          node.id.name === 'executeBytecode' &&
          node.body &&
          Array.isArray(node.body.body)
        ) {
          shuffleFunctionNodes(node.body.body, source, edits, 'activate', ['runUntil']);
        }
      });
    }
  }

  walk(ast, (node) => {
    if (
      numericMapping &&
      filename === 'runtime/execute-bytecode.js' &&
      node.type === 'VariableDeclarator' &&
      node.id.type === 'Identifier' &&
      node.id.name === 'POPS_TABLE' &&
      node.init.type === 'NewExpression'
    ) {
      const originalPops = new Array(Object.keys(OPCODES).length);
      for (const [name, opcode] of Object.entries(OPCODES)) {
        originalPops[opcode] = INSTRUCTION_SPECS[name]?.pops ?? 0;
      }
      const count = originalPops.length;
      const shuffled = new Array(count);
      for (let i = 0; i < count; i++) {
        const target = numericMapping.get(i) ?? i;
        shuffled[target] = originalPops[i];
      }
      edits.push([node.init.start, node.init.end, `new Uint8Array([${shuffled.join(',')}])`]);
    }
    if (
      (pruneOpcodes || numericMapping || shuffleHandlers) &&
      dispatcher &&
      node.type === 'SwitchStatement' &&
      node.discriminant.type === 'Identifier' &&
      node.discriminant.name === 'op'
    ) {
      if (shuffleHandlers && filename === 'runtime/execute-bytecode.js') {
        let group = [];
        const keptBlocks = [];
        let defaultBlock = null;
        for (const branch of node.cases) {
          group.push(branch);
          if (branch.consequent.length === 0) continue;
          if (
            group.every(
              (c) =>
                c.test === null ||
                c.test.type === 'StringLiteral' ||
                c.test.type === 'NumericLiteral',
            )
          ) {
            const kept = group.filter((c) => {
              if (c.test === null) return true;
              if (!pruneOpcodes) return true;
              if (c.test.type === 'NumericLiteral') {
                const opName = OPCODE_NAMES[c.test.value];
                return opName && usedOpcodes ? usedOpcodes.has(opName) : true;
              }
              return true;
            });
            if (kept.length > 0) {
              const body = source.slice(branch.consequent[0].start, branch.end);
              const isDefault = kept.some((c) => c.test === null);
              const labels = kept
                .map((c) => {
                  if (c.test === null) return 'default:';
                  const val = numericMapping
                    ? (numericMapping.get(c.test.value) ?? c.test.value)
                    : c.test.value;
                  return 'case ' + val + ':';
                })
                .join('\n');
              const blockText = labels + '\n' + body;
              if (isDefault) {
                defaultBlock = blockText;
              } else {
                keptBlocks.push(blockText);
              }
            }
          }
          group = [];
        }

        // Fisher-Yates shuffle
        for (let i = keptBlocks.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [keptBlocks[i], keptBlocks[j]] = [keptBlocks[j], keptBlocks[i]];
        }

        const allCases = [...keptBlocks, ...(defaultBlock ? [defaultBlock] : [])];
        if (node.cases.length > 0) {
          edits.push([node.cases[0].start, node.cases[node.cases.length - 1].end, allCases.join('\n')]);
        }
      } else {
        let group = [];
        for (const branch of node.cases) {
          group.push(branch);
          if (branch.consequent.length === 0) continue;
          if (
            group.every(
              (c) =>
                c.test === null ||
                c.test.type === 'StringLiteral' ||
                c.test.type === 'NumericLiteral',
            )
          ) {
            const kept = group.filter((c) => {
              if (c.test === null) return true;
              if (!pruneOpcodes) return true;
              if (c.test.type === 'StringLiteral') {
                return usedOpcodes ? usedOpcodes.has(c.test.value) : true;
              }
              if (c.test.type === 'NumericLiteral') {
                const opName = OPCODE_NAMES[c.test.value];
                return opName && usedOpcodes ? usedOpcodes.has(opName) : true;
              }
              return true;
            });
            if (kept.length !== group.length || (numericMapping && filename === 'runtime/execute-bytecode.js')) {
              const body = source.slice(branch.consequent[0].start, branch.end);
              edits.push([
                group[0].start,
                branch.end,
                kept.length
                  ? kept
                      .map((c) => {
                        if (c.test === null) return 'default:';
                        if (c.test.type === 'NumericLiteral') {
                          const val = (numericMapping && filename === 'runtime/execute-bytecode.js')
                            ? (numericMapping.get(c.test.value) ?? c.test.value)
                            : c.test.value;
                          return 'case ' + val + ':';
                        }
                        return 'case ' + JSON.stringify(c.test.value) + ':';
                      })
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
  if ((pruneOpcodes || shuffleHandlers) && maskErrors)
    return specializeRuntimeSource(result, {
      filename,
      usedOpcodes,
      pruneOpcodes: false,
      maskErrors: true,
      numericMapping: null,
      shuffleHandlers: false,
    });
  return result;
}
export function runtimeHardeningPlugin({
  sourceDirectory,
  numericMapping = null,
  usedOpcodes,
  pruneOpcodes,
  maskErrors,
  shuffleHandlers = true,
}) {
  const root = resolve(sourceDirectory);
  return {
    name: 'rell-specialized-runtime',
    setup(build) {
      build.onLoad({ filter: /\.js$/ }, async ({ path }) => {
        const filename = relative(root, path).split(sep).join('/');
        if (
          !filename.startsWith('runtime/') &&
          !filename.startsWith('assembly/') &&
          !filename.startsWith('bytecode/')
        )
          return undefined;
        let contents = await readFile(path, 'utf8');
        contents = specializeRuntimeSource(contents, {
          filename,
          usedOpcodes,
          pruneOpcodes,
          maskErrors,
          numericMapping,
          shuffleHandlers,
        });
        if (numericMapping && filename === 'runtime/vm-function.js') {
          contents = contents.replace(
            /import\s*\{\s*parseAssembly\s*\}\s*from\s*['"]\.\.\/assembly\/parse\.js['"];/,
            'const parseAssembly = () => { throw new TypeError("???"); };',
          );
        }
        return { contents, loader: 'js' };
      });
    },
  };
}
