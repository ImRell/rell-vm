import { AssemblyBuilder } from './assembly-builder.js';
import { LexicalScope } from './scope.js';
import { parseSource } from './parse.js';
import { collectVarNames } from './collect-var-names.js';

const BINARY_OPERATORS = new Map([
  ['+', 'js.add'],
  ['-', 'js.sub'],
  ['*', 'js.mul'],
  ['/', 'js.div'],
  ['%', 'js.rem'],
  ['===', 'js.strict_eq'],
  ['!==', 'js.strict_ne'],
  ['==', 'js.eq'],
  ['!=', 'js.ne'],
  ['&', 'js.bit_and'],
  ['|', 'js.bit_or'],
  ['^', 'js.bit_xor'],
  ['<<', 'js.shl'],
  ['>>', 'js.shr'],
  ['>>>', 'js.ushr'],
  ['in', 'js.in'],
  ['instanceof', 'js.instanceof'],

  ['<', 'js.lt'],
  ['<=', 'js.le'],
  ['>', 'js.gt'],
  ['>=', 'js.ge'],
]);

const UNARY_OPERATORS = new Map([
  ['+', 'js.pos'],
  ['~', 'js.bit_not'],
  ['typeof', 'js.typeof'],
  ['void', 'js.void'],

  ['-', 'js.neg'],
  ['!', 'js.not'],
]);

const ASSIGNMENT_OPERATORS = new Map([
  ['&=', 'js.bit_and'],
  ['|=', 'js.bit_or'],
  ['^=', 'js.bit_xor'],
  ['<<=', 'js.shl'],
  ['>>=', 'js.shr'],
  ['>>>=', 'js.ushr'],

  ['+=', 'js.add'],
  ['-=', 'js.sub'],
  ['*=', 'js.mul'],
  ['/=', 'js.div'],
  ['%=', 'js.rem'],
]);

/**
 * Компилирует JavaScript непосредственно в текст инструкций.
 *
 * @param {string} source
 * @param {{ filename?: string }} [options]
 * @returns {string}
 */
export function compileToAssembly(source, options = {}) {
  const ast = parseSource(source, options);
  return compileUnit(ast.program, new LexicalScope(), [], false, false);
}

function compileUnit(body, rootScope, parameters, isFunction, inheritedStrict) {
  const builder = new AssemblyBuilder();
  let currentScope = rootScope;
  let currentLoop = null;
  let currentBreakable = null;
  let handlerDepth = 0;
  let pendingLabels = [];
  const labelTargets = new Map();
  // Compiler temporaries use CallFrame.locals, never lexical bindings.
  // Each function has its own namespace and allocator.
  let nextTemporary = 0;
  const blockParents = new Map();
  let strict = inheritedStrict;

  for (const directive of body.directives ?? []) {
    // Unknown directive-prologue strings are valid, inert JS expressions.
    // Babel helpers use markers such as "@babel/helpers - typeof".
    // Babel preserves escapes in value: "use\\x20strict" is NOT use strict.
    if (directive.value.value === 'use strict') strict = true;
  }

  // Порядок уникальных параметров совпадает с createFunctionFrame().
  const parameterNames = new Set(parameters);
  for (const name of parameters) rootScope.declareVar(name);

  const functionDeclarations = body.body.filter(
    (statement) => statement.type === 'FunctionDeclaration',
  );
  const hoistedFunctions = new Set(functionDeclarations);
  const varBindings = new Map();

  for (const name of collectVarNames(body)) {
    varBindings.set(name, rootScope.declareVar(name));
  }
  for (const declaration of functionDeclarations) {
    assertFunction(declaration);
    const name = declaration.id.name;
    varBindings.set(name, rootScope.declareVar(name));
  }

  // Implicit arguments belongs to every ordinary function, unless a
  // parameter, a direct function declaration, or a body lexical binding
  // supplies that name. A plain var arguments must NOT suppress it.
  const hasLexicalArguments = body.body.some(
    (statement) =>
      statement.type === 'VariableDeclaration' &&
      statement.kind !== 'var' &&
      statement.declarations.some(
        (declaration) =>
          declaration.id.type === 'Identifier' &&
          declaration.id.name === 'arguments',
      ),
  );
  const needsArguments =
    isFunction &&
    !parameterNames.has('arguments') &&
    !functionDeclarations.some(
      (declaration) => declaration.id.name === 'arguments',
    ) &&
    !hasLexicalArguments;
  const argumentsBinding = needsArguments
    ? rootScope.declareVar('arguments')
    : null;
  if (argumentsBinding !== null) {
    builder.emit('js.arguments.create', argumentsBinding.slot);
  }

  // Параметры уже созданы runtime. var с тем же именем не сбрасывает их.
  for (const binding of varBindings.values()) {
    if (parameterNames.has(binding.name) || binding === argumentsBinding)
      continue;
    builder.emit('js.lex.create', binding.slot, binding.name, 'let');
    builder.emit('js.const', undefined);
    builder.emit('js.lex.init', binding.slot);
  }

  compileScopeBody(body.body, rootScope, functionDeclarations);
  if (isFunction) {
    builder.emit('js.const', undefined);
    builder.emit('return');
  } else {
    builder.emit('halt');
  }
  return builder.build();

  function compileScopeBody(statements, scope, declarations = []) {
    const previousScope = currentScope;
    currentScope = scope;

    try {
      prepareScopeBindings(statements, scope);

      // Все прямые lexical-объявления уже зарегистрированы и имеют TDZ.
      // Поэтому поднятые функции видят и объявления ниже по исходнику.
      for (const declaration of declarations) {
        compileFunction(declaration);
        emitReference(
          'set',
          currentScope.resolveReference(declaration.id.name),
        );
      }

      for (const statement of statements) {
        compileStatement(statement);
      }
    } finally {
      currentScope = previousScope;
    }
  }

  function prepareScopeBindings(statements, scope) {
    const bindings = [];

    for (const statement of statements) {
      if (
        statement.type !== 'VariableDeclaration' ||
        statement.kind === 'var'
      ) {
        continue;
      }

      assertDeclaration(statement);

      for (const declaration of statement.declarations) {
        bindings.push(scope.declare(declaration.id.name, statement.kind));
      }
    }

    for (const binding of bindings) {
      builder.emit('js.lex.create', binding.slot, binding.name, binding.kind);
    }
  }

  function compileStatement(node) {
    const labels = pendingLabels;
    pendingLabels = [];
    switch (node.type) {
      case 'LabeledStatement':
        compileLabeledStatement(node, labels);
        return;
      case 'TryStatement':
        compileTryStatement(node);
        return;
      case 'EmptyStatement':
        return;

      case 'DebuggerStatement':
        builder.emit('nop');
        return;

      case 'ThrowStatement':
        compileExpression(node.argument);
        builder.emit('throw');
        return;

      case 'SwitchStatement':
        compileSwitchStatement(node);
        return;

      case 'ExpressionStatement':
        compileExpression(node.expression);
        builder.emit('drop');
        return;

      case 'BlockStatement': {
        // Блок без собственных lexical-привязок не требует окружения.
        // Это сохраняет прежний компактный код для пустых блоков
        // и последовательностей обычных выражений.
        const needsEnvironment = node.body.some(
          (statement) =>
            statement.type === 'VariableDeclaration' &&
            statement.kind !== 'var',
        );
        if (!needsEnvironment) {
          compileScopeBody(node.body, currentScope);
          return;
        }
        const child = currentScope.createChild();
        blockParents.set(child, currentScope);
        builder.emit('js.scope.enter');
        compileScopeBody(node.body, child);
        builder.emit('js.scope.leave');
        return;
      }

      case 'FunctionDeclaration':
        if (!hoistedFunctions.has(node)) {
          unsupported(
            node,
            'Block-level function declarations are not supported yet',
          );
        }
        return;

      case 'ReturnStatement':
        if (!isFunction) {
          unsupported(node, 'Return requires a function');
        }
        if (node.argument === null) builder.emit('js.const', undefined);
        else compileExpression(node.argument);
        // Возврат удаляет кадр целиком; блоки снимать отдельно не нужно.
        builder.emit('return');
        return;

      case 'VariableDeclaration':
        compileVariableDeclaration(node);
        return;

      case 'IfStatement':
        compileIfStatement(node);
        return;

      case 'ForInStatement':
        compileForInStatement(node, labels);
        return;

      case 'ForStatement':
        compileForStatement(node, labels);
        return;

      case 'DoWhileStatement':
        compileDoWhileStatement(node, labels);
        return;

      case 'WhileStatement':
        compileWhileStatement(node, labels);
        return;

      case 'BreakStatement':
        compileLoopControl(node, 'break');
        return;

      case 'ContinueStatement':
        compileLoopControl(node, 'continue');
        return;

      default:
        unsupported(node, `Unsupported statement: ${node.type}`);
    }
  }

  function compileLabeledStatement(node, outerLabels) {
    const end = builder.createLabel();
    const label = {
      breakTarget: end,
      scope: currentScope,
      handlerDepth,
      continueContext: null,
    };
    labelTargets.set(node.label.name, label);
    try {
      pendingLabels = [...outerLabels, label];
      compileStatement(node.body);
      builder.markLabel(end);
      builder.emit('nop');
    } finally {
      pendingLabels = [];
      labelTargets.delete(node.label.name);
    }
  }

  function compileTryStatement(node) {
    const catchTarget = builder.createLabel();
    const finallyTarget = builder.createLabel();
    const end = builder.createLabel();
    builder.emit(
      'js.try.enter',
      catchTarget,
      finallyTarget,
      end,
      node.handler !== null,
      node.finalizer !== null,
    );
    handlerDepth++;
    try {
      compileStatement(node.block);
      builder.emit('js.try.leave');
      builder.markLabel(catchTarget);
      if (node.handler !== null) {
        if (
          node.handler.param !== null &&
          node.handler.param.type !== 'Identifier'
        )
          unsupported(
            node.handler.param,
            'Catch destructuring requires normalization',
          );
        const parent = currentScope;
        const child = parent.createChild();
        blockParents.set(child, parent);
        builder.emit('js.scope.enter');
        currentScope = child;
        try {
          if (node.handler.param !== null) {
            const binding = child.declare(node.handler.param.name, 'let');
            builder.emit('js.lex.create', binding.slot, binding.name, 'let');
            builder.emit('js.catch.get');
            builder.emit('js.lex.init', binding.slot);
          }
          compileScopeBody(node.handler.body.body, child);
        } finally {
          currentScope = parent;
        }
        builder.emit('js.scope.leave');
        builder.emit('js.try.leave');
      }
      builder.markLabel(finallyTarget);
      if (node.finalizer !== null) {
        compileStatement(node.finalizer);
        builder.emit('js.finally.end');
      }
    } finally {
      handlerDepth--;
    }
    builder.markLabel(end);
    builder.emit('nop');
  }

  function compileVariableDeclaration(node) {
    assertDeclaration(node);

    for (const declaration of node.declarations) {
      // Повторное var без инициализатора не меняет значение.
      if (node.kind === 'var' && declaration.init === null) {
        continue;
      }

      const reference = currentScope.resolveReference(declaration.id.name);

      if (reference === null) {
        throw new Error(
          `Compiler invariant violated: missing binding '${declaration.id.name}'`,
        );
      }

      if (declaration.init === null) {
        builder.emit('js.const', undefined);
      } else {
        compileExpression(declaration.init);
      }

      if (node.kind === 'var') {
        emitReference('set', reference);
      } else {
        builder.emit('js.lex.init', reference.binding.slot);
      }
    }
  }

  function compileIfStatement(node) {
    const alternative = builder.createLabel();

    compileExpression(node.test);
    builder.emit('jump_if_false', alternative);
    compileStatement(node.consequent);

    if (node.alternate === null) {
      builder.markLabel(alternative);
      return;
    }

    const end = builder.createLabel();

    builder.emit('jump', end);
    builder.markLabel(alternative);
    compileStatement(node.alternate);
    builder.markLabel(end);
  }

  function compileSwitchStatement(node) {
    const valueSlot = nextTemporary++;
    // The discriminant is evaluated OUTSIDE the case block's lexical scope.
    compileExpression(node.discriminant);
    builder.emit('local.set', valueSlot);
    const statements = node.cases.flatMap((clause) => clause.consequent);
    const needsEnvironment = statements.some(
      (statement) =>
        statement.type === 'VariableDeclaration' && statement.kind !== 'var',
    );
    const previousScope = currentScope;
    const previousBreakable = currentBreakable;
    if (needsEnvironment) {
      currentScope = previousScope.createChild();
      blockParents.set(currentScope, previousScope);
      builder.emit('js.scope.enter');
    }
    const end = builder.createLabel();
    const labels = node.cases.map(() => builder.createLabel());
    currentBreakable = { breakTarget: end, scope: currentScope, handlerDepth };
    try {
      // All cases share ONE lexical block, including tests and default.
      prepareScopeBindings(statements, currentScope);
      let defaultTarget = end;
      for (let index = 0; index < node.cases.length; index++) {
        const clause = node.cases[index];
        if (clause.test === null) {
          defaultTarget = labels[index];
          continue;
        }
        const nextTest = builder.createLabel();
        builder.emit('local.get', valueSlot);
        compileExpression(clause.test);
        builder.emit('js.strict_eq');
        builder.emit('jump_if_false', nextTest);
        builder.emit('jump', labels[index]);
        builder.markLabel(nextTest);
      }
      builder.emit('jump', defaultTarget);
      for (let index = 0; index < node.cases.length; index++) {
        builder.markLabel(labels[index]);
        // Release discriminant before body/continue/return. Fall-through
        // may repeat this harmless store, but never re-evaluates case tests.
        builder.emit('js.const', undefined);
        builder.emit('local.set', valueSlot);
        for (const statement of node.cases[index].consequent)
          compileStatement(statement);
      }
      builder.markLabel(end);
      builder.emit('js.const', undefined);
      builder.emit('local.set', valueSlot);
      if (needsEnvironment) builder.emit('js.scope.leave');
    } finally {
      currentScope = previousScope;
      currentBreakable = previousBreakable;
    }
  }

  function compileWhileStatement(node, labels = []) {
    const condition = builder.createLabel();
    const end = builder.createLabel();

    builder.markLabel(condition);
    compileExpression(node.test);
    builder.emit('jump_if_false', end);

    compileLoopBody(node.body, end, condition, labels);

    builder.emit('jump', condition);
    builder.markLabel(end);
  }

  function compileForInStatement(node, labels = []) {
    let target = node.left;
    if (target.type === 'VariableDeclaration') {
      if (target.kind !== 'var') {
        unsupported(
          target,
          'Lexical for-in bindings require normalization; use var',
        );
      }
      assertDeclaration(target);
      if (target.declarations.length !== 1) {
        unsupported(target, 'for-in requires one binding');
      }
      // Sloppy ES5 permits `for (var k = initializer in object)`.
      // The initializer runs before the RHS, even for an empty enumeration.
      compileVariableDeclaration(target);
      target = target.declarations[0].id;
    }
    if (target.type !== 'Identifier' && target.type !== 'MemberExpression') {
      unsupported(target, `Unsupported for-in target: ${target.type}`);
    }
    const reference =
      target.type === 'Identifier'
        ? currentScope.resolveReference(target.name)
        : null;
    if (target.type === 'Identifier' && reference === null) {
      unsupported(target, 'Assignment to unresolved identifier');
    }

    const iteratorSlot = nextTemporary++;
    const keySlot = target.type === 'MemberExpression' ? nextTemporary++ : null;
    const next = builder.createLabel();
    const exhausted = builder.createLabel();
    const end = builder.createLabel();
    compileExpression(node.right);
    builder.emit('js.for_in.create');
    builder.emit('local.set', iteratorSlot);
    builder.markLabel(next);
    builder.emit('local.get', iteratorSlot);
    builder.emit('js.for_in.next');
    builder.emit('jump_if_false', exhausted);
    if (reference !== null) {
      emitReference('set', reference);
    } else {
      // A member reference is evaluated afresh for every produced key,
      // but never for an empty or exhausted enumeration.
      builder.emit('local.set', keySlot);
      compileExpression(target.object);
      compilePropertyKey(target);
      builder.emit('local.get', keySlot);
      builder.emit('js.prop.set', strict);
    }
    compileLoopBody(node.body, end, next, labels);
    builder.emit('jump', next);
    builder.markLabel(exhausted);
    builder.emit('drop'); // next returned undefined plus false.
    builder.markLabel(end); // break has no pending key to discard.
    builder.emit('js.const', undefined);
    builder.emit('local.set', iteratorSlot);
    if (keySlot !== null) {
      builder.emit('js.const', undefined);
      builder.emit('local.set', keySlot);
    }
  }

  function compileForStatement(node, labels = []) {
    if (node.init !== null) {
      if (node.init.type === 'VariableDeclaration') {
        if (node.init.kind !== 'var') {
          unsupported(
            node.init,
            'Lexical for initializers require normalization; use var or an expression',
          );
        }
        compileVariableDeclaration(node.init);
      } else {
        compileExpression(node.init);
        builder.emit('drop');
      }
    }

    const condition = builder.createLabel();
    const update = builder.createLabel();
    const end = builder.createLabel();
    builder.markLabel(condition);
    if (node.test !== null) {
      compileExpression(node.test);
      builder.emit('jump_if_false', end);
    }
    compileLoopBody(node.body, end, update, labels);
    builder.markLabel(update);
    if (node.update !== null) {
      compileExpression(node.update);
      builder.emit('drop');
    }
    builder.emit('jump', condition);
    builder.markLabel(end);
  }

  function compileDoWhileStatement(node, labels = []) {
    const body = builder.createLabel();
    const condition = builder.createLabel();
    const end = builder.createLabel();
    builder.markLabel(body);
    compileLoopBody(node.body, end, condition, labels);
    builder.markLabel(condition);
    compileExpression(node.test);
    builder.emit('jump_if_false', end);
    builder.emit('jump', body);
    builder.markLabel(end);
  }

  function compileLoopBody(body, breakTarget, continueTarget, labels = []) {
    const previousLoop = currentLoop;
    const previousBreakable = currentBreakable;
    currentLoop = {
      breakTarget,
      continueTarget,
      scope: currentScope,
      handlerDepth,
    };
    currentBreakable = currentLoop;
    for (const label of labels) {
      label.continueContext = currentLoop;
      label.breakTarget = breakTarget;
    }
    try {
      compileStatement(body);
    } finally {
      currentLoop = previousLoop;
      currentBreakable = previousBreakable;
    }
  }

  function compileLoopControl(node, kind) {
    let context;
    if (node.label !== null) {
      const label = labelTargets.get(node.label.name);
      context = kind === 'continue' ? label?.continueContext : label;
      if (!context)
        unsupported(node, `Invalid ${kind} label: ${node.label.name}`);
    } else context = kind === 'break' ? currentBreakable : currentLoop;
    if (context === null) {
      unsupported(
        node,
        `${kind} requires an enclosing ${kind === 'break' ? 'loop or switch' : 'loop'}`,
      );
    }

    // Выходим только из блоков между текущей точкой и телом цикла.
    // Compile-time currentScope не меняем: далее может быть другой путь.
    let scope = currentScope;
    let scopesToLeave = 0;
    while (scope !== context.scope) {
      scopesToLeave++;
      // scope здесь является блоком этого же compileUnit.
      scope = blockParents.get(scope);
      if (scope === undefined) {
        throw new Error(
          'Compiler invariant violated: loop scope is unreachable',
        );
      }
    }

    builder.emit(
      'js.abrupt.jump',
      kind === 'break' ? context.breakTarget : context.continueTarget,
      scopesToLeave,
      context.handlerDepth,
    );
  }

  function compileExpression(node) {
    switch (node.type) {
      case 'NumericLiteral':
      case 'StringLiteral':
      case 'BooleanLiteral':
        builder.emit('js.const', node.value);
        return;

      case 'NullLiteral':
        builder.emit('js.const', null);
        return;

      case 'RegExpLiteral':
        builder.emit('js.regexp.create', node.pattern, node.flags);
        return;

      case 'BigIntLiteral':
        builder.emit('js.const', BigInt(node.value));
        return;

      case 'Identifier': {
        const reference = currentScope.resolveReference(node.name);

        if (reference === null) {
          builder.emit('js.global.get', node.name);
        } else {
          emitReference('get', reference);
        }

        return;
      }

      case 'ThisExpression':
        builder.emit('js.this.get');
        return;

      case 'FunctionExpression':
        compileFunction(node);
        return;

      case 'ObjectExpression':
        compileObjectLiteral(node);
        return;

      case 'ArrayExpression':
        compileArrayLiteral(node);
        return;

      case 'MemberExpression':
        compileExpression(node.object);
        compilePropertyKey(node);
        builder.emit('js.prop.get');
        return;

      case 'NewExpression':
        for (const argument of node.arguments)
          if (argument.type === 'SpreadElement')
            unsupported(
              argument,
              'Spread constructor arguments require normalization',
            );
        compileExpression(node.callee);
        for (const argument of node.arguments) compileExpression(argument);
        builder.emit('js.construct', node.arguments.length);
        return;

      case 'CallExpression':
        compileCallExpression(node);
        return;

      case 'BinaryExpression': {
        const op = BINARY_OPERATORS.get(node.operator);

        if (op === undefined) {
          unsupported(node, `Unsupported binary operator: ${node.operator}`);
        }

        compileExpression(node.left);
        compileExpression(node.right);
        builder.emit(op);
        return;
      }

      case 'UnaryExpression': {
        if (node.operator === 'delete') {
          compileDeleteExpression(node);
          return;
        }
        if (
          node.operator === 'typeof' &&
          node.argument.type === 'Identifier' &&
          currentScope.resolveReference(node.argument.name) === null
        ) {
          builder.emit('js.global.typeof', node.argument.name);
          return;
        }
        const op = UNARY_OPERATORS.get(node.operator);

        if (op === undefined) {
          unsupported(node, `Unsupported unary operator: ${node.operator}`);
        }

        compileExpression(node.argument);
        builder.emit(op);
        return;
      }

      case 'SequenceExpression':
        // A comma expression returns only its last value. Earlier values must
        // not accumulate on the operand stack (notably in a for update).
        for (let index = 0; index < node.expressions.length; index++) {
          compileExpression(node.expressions[index]);
          if (index + 1 < node.expressions.length) builder.emit('drop');
        }
        return;

      case 'UpdateExpression':
        compileUpdateExpression(node);
        return;

      case 'AssignmentExpression':
        compileAssignmentExpression(node);
        return;

      case 'LogicalExpression':
        compileLogicalExpression(node);
        return;

      case 'ConditionalExpression':
        compileConditionalExpression(node);
        return;

      default:
        unsupported(node, `Unsupported expression: ${node.type}`);
    }
  }

  function compileDeleteExpression(node) {
    const target = node.argument;
    if (target.type === 'MemberExpression') {
      compileExpression(target.object);
      compilePropertyKey(target);
      builder.emit('js.prop.delete', strict);
    } else if (target.type === 'Identifier') {
      const reference = currentScope.resolveReference(target.name);
      if (reference === null) builder.emit('js.global.delete', target.name);
      else builder.emit('js.const', false); // Do not read a local TDZ binding.
    } else {
      compileExpression(target);
      builder.emit('drop');
      builder.emit('js.const', true);
    }
  }

  function compileObjectLiteral(node) {
    builder.emit('js.object.create');
    for (const property of node.properties) {
      if (property.type === 'SpreadElement') {
        unsupported(
          property,
          'Object spread is not supported; normalize source first',
        );
      }
      if (property.computed || property.shorthand) {
        unsupported(
          property,
          'Computed and shorthand object properties require normalization',
        );
      }
      const keyNode = property.key;
      let key;
      if (keyNode.type === 'Identifier') key = keyNode.name;
      else if (
        keyNode.type === 'StringLiteral' ||
        keyNode.type === 'NumericLiteral'
      )
        key = String(keyNode.value);
      else
        unsupported(keyNode, `Unsupported object literal key: ${keyNode.type}`);

      if (property.type === 'ObjectProperty') {
        if (key === '__proto__') {
          compileExpression(property.value);
          builder.emit('js.object.proto');
        } else {
          builder.emit('js.const', key);
          compileExpression(property.value);
          builder.emit('js.object.define');
        }
      } else if (
        property.type === 'ObjectMethod' &&
        (property.kind === 'get' || property.kind === 'set')
      ) {
        builder.emit('js.const', key);
        compileFunction(property);
        builder.emit(
          property.kind === 'get' ? 'js.object.getter' : 'js.object.setter',
        );
      } else {
        unsupported(property, 'Object method shorthand requires normalization');
      }
    }
  }

  function compileArrayLiteral(node) {
    builder.emit('js.array.create', node.elements.length);
    for (let index = 0; index < node.elements.length; index++) {
      const element = node.elements[index];
      // Holes affect length but must not create own indexed properties.
      if (element === null) continue;
      if (element.type === 'SpreadElement')
        unsupported(
          element,
          'Array spread is not supported; normalize source first',
        );
      builder.emit('js.const', String(index));
      compileExpression(element);
      builder.emit('js.object.define');
    }
  }

  function compilePropertyKey(node) {
    if (node.computed) {
      compileExpression(node.property);
      return;
    }

    if (node.property.type !== 'Identifier') {
      unsupported(
        node.property,
        `Unsupported property key: ${node.property.type}`,
      );
    }

    builder.emit('js.const', node.property.name);
  }

  function compileCallExpression(node) {
    // Прямой eval требует доступа к лексическому окружению JS.
    // Вызов через Reflect.apply не воспроизводит эту семантику.
    if (node.callee.type === 'Identifier' && node.callee.name === 'eval') {
      unsupported(node, 'Direct eval calls are not supported');
    }

    for (const argument of node.arguments) {
      if (argument.type === 'SpreadElement') {
        unsupported(argument, 'Spread arguments are not supported');
      }
    }

    if (node.callee.type === 'MemberExpression') {
      // После получения свойства стек содержит:
      // ..., object, function
      compileExpression(node.callee.object);
      builder.emit('dup');
      compilePropertyKey(node.callee);
      builder.emit('js.prop.get');
    } else {
      // Обычный вызов не имеет объекта-получателя.
      builder.emit('js.const', undefined);
      compileExpression(node.callee);
    }

    for (const argument of node.arguments) {
      compileExpression(argument);
    }

    builder.emit('js.call', node.arguments.length);
  }

  function compileUpdateExpression(node) {
    const increment = node.operator === '++';
    if (!increment && node.operator !== '--')
      unsupported(node, `Unsupported update operator: ${node.operator}`);
    if (node.argument.type === 'MemberExpression') {
      compileExpression(node.argument.object);
      compilePropertyKey(node.argument);
      builder.emit(
        increment ? 'js.prop.inc' : 'js.prop.dec',
        node.prefix,
        strict,
      );
      return;
    }
    if (node.argument.type !== 'Identifier')
      unsupported(
        node.argument,
        `Unsupported update target: ${node.argument.type}`,
      );
    const reference = currentScope.resolveReference(node.argument.name);
    if (reference === null)
      unsupported(node.argument, 'Update of unresolved identifier');
    emitReference('get', reference);
    if (!node.prefix) {
      // Postfix returns the OLD NUMERIC value, not the original string/object.
      builder.emit('js.to_numeric');
      builder.emit('dup');
    }
    builder.emit(increment ? 'js.inc' : 'js.dec');
    emitReference(node.prefix ? 'tee' : 'set', reference);
  }

  function compileAssignmentExpression(node) {
    if (node.left.type === 'MemberExpression') {
      compilePropertyAssignment(node);
      return;
    }
    if (node.left.type !== 'Identifier') {
      unsupported(
        node.left,
        `Unsupported assignment target: ${node.left.type}`,
      );
    }

    const op = ASSIGNMENT_OPERATORS.get(node.operator);

    if (node.operator !== '=' && op === undefined) {
      unsupported(node, `Unsupported assignment operator: ${node.operator}`);
    }

    const reference = currentScope.resolveReference(node.left.name);

    if (reference === null) {
      unsupported(node.left, 'Assignment to unresolved identifier');
    }

    if (node.operator !== '=') {
      emitReference('get', reference);
    }

    compileExpression(node.right);

    if (node.operator !== '=') {
      builder.emit(op);
    }

    emitReference('tee', reference);
  }

  function compilePropertyAssignment(node) {
    const op = ASSIGNMENT_OPERATORS.get(node.operator);
    if (node.operator !== '=' && op === undefined) {
      unsupported(node, `Unsupported assignment operator: ${node.operator}`);
    }

    // Evaluate base and key expression exactly once, keeping the raw key.
    // Simple assignment must not read the old value or coerce the key yet.
    compileExpression(node.left.object);
    compilePropertyKey(node.left);

    if (node.operator !== '=') {
      builder.emit('dup2');
      builder.emit('js.prop.get');
    }

    compileExpression(node.right);
    if (node.operator !== '=') builder.emit(op);
    builder.emit('js.prop.tee', strict);
  }

  function emitReference(operation, reference) {
    if (operation !== 'get' && reference.binding.kind === 'functionName') {
      builder.emit(
        `js.name.${operation}`,
        reference.depth,
        reference.binding.slot,
        strict,
      );
      return;
    }
    if (reference.depth === 0) {
      builder.emit(`js.lex.${operation}`, reference.binding.slot);
    } else {
      builder.emit(
        `js.env.${operation}`,
        reference.depth,
        reference.binding.slot,
      );
    }
  }

  function compileFunction(node) {
    assertFunction(node);
    const parameters = node.params.map((parameter) => parameter.name);
    const functionStrict =
      strict ||
      (node.body.directives ?? []).some(
        (directive) => directive.value.value === 'use strict',
      );
    const namedExpression =
      node.type === 'FunctionExpression' && node.id !== null;
    let capturedScope = currentScope;

    if (namedExpression) {
      // Runtime создаёт private-окружение между внешним окружением
      // и корнем вызова. В нём только имя функции, всегда в слоте 0.
      // Используем независимый allocator; переменные внешнего кадра
      // от объявления private-имени не меняются.
      capturedScope = currentScope.createFunctionChild();
      capturedScope.declareFunctionName(node.id.name);
    }

    const functionBody = compileUnit(
      node.body,
      capturedScope.createFunctionChild(),
      parameters,
      true,
      functionStrict,
    );
    builder.emit(
      namedExpression ? 'js.function.named.create' : 'js.function.create',
      node.id?.name ?? '',
      parameters,
      functionStrict,
      functionBody,
    );
  }

  function compileLogicalExpression(node) {
    if (node.operator !== '&&' && node.operator !== '||') {
      unsupported(node, `Unsupported logical operator: ${node.operator}`);
    }

    const end = builder.createLabel();

    compileExpression(node.left);
    builder.emit('dup');

    if (node.operator === '||') {
      builder.emit('js.not');
    }

    builder.emit('jump_if_false', end);
    builder.emit('drop');
    compileExpression(node.right);
    builder.markLabel(end);
  }

  function compileConditionalExpression(node) {
    const alternative = builder.createLabel();
    const end = builder.createLabel();

    compileExpression(node.test);
    builder.emit('jump_if_false', alternative);

    compileExpression(node.consequent);
    builder.emit('jump', end);

    builder.markLabel(alternative);
    compileExpression(node.alternate);

    builder.markLabel(end);
  }
}

function assertFunction(node) {
  if (node.async || node.generator) {
    unsupported(node, 'Async and generator functions must be normalized first');
  }
  for (const parameter of node.params) {
    if (parameter.type !== 'Identifier') {
      unsupported(parameter, `Unsupported parameter: ${parameter.type}`);
    }
  }
}

function assertDeclaration(node) {
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

function unsupported(node, message) {
  if (!node.loc) {
    throw new SyntaxError(message);
  }

  const filename = node.loc.filename ?? 'input.js';
  const { line, column } = node.loc.start;

  throw new SyntaxError(`${filename}:${line}:${column + 1}: ${message}`);
}
