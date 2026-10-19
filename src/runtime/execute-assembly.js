import {
  binaryOperation,
  unaryOperation,
  typeOfExternal,
  deleteExternal,
  deleteProperty,
} from './es5-operators.js';
import { createRegExpLiteral } from './regexp-literal.js';
import { createForInIterator, nextForInIterator } from './for-in-iterator.js';
import { toNumeric, toPropertyKey, updateNumeric } from './numeric-update.js';
import {
  createArrayLiteral,
  defineLiteralData,
  defineLiteralAccessor,
  setLiteralPrototype,
} from './literal-properties.js';
import { writeProperty } from './write-property.js';
import { createArgumentsObject } from './arguments-object.js';
import { INSTRUCTIONS } from '../assembly/instructions.js';
import { parseAssembly } from '../assembly/parse.js';
import { CallFrame } from './call-frame.js';
import {
  VMFunction,
  attachVMFunction,
  getVMFunctionInvoker,
  getVMFunctionRecord,
} from './vm-function.js';
import { LexicalEnvironment } from './lexical-environment.js';
import { FunctionNameCell } from './function-name-cell.js';
import { readExternal } from './read-external.js';
const constructFunction = Reflect.construct;
const applyFunction = Reflect.apply;
export function executeAssembly(
  source,
  {
    maxSteps = Infinity,
    environment = globalThis,
    exposeFunctionMetadata = true,
    decodeString,
  } = {},
) {
  if (
    maxSteps !== Infinity &&
    (!Number.isSafeInteger(maxSteps) || maxSteps <= 0)
  )
    throw new TypeError('maxSteps must be a positive safe integer or Infinity');
  if (
    environment === null ||
    (typeof environment !== 'object' && typeof environment !== 'function')
  )
    throw new TypeError('External environment must be an object or function');
  if (typeof exposeFunctionMetadata !== 'boolean')
    throw new TypeError('exposeFunctionMetadata must be a boolean');
  const frames = [
    {
      program: parseAssembly(source, { decodeString }),
      frame: new CallFrame({ thisArg: environment }),
    },
  ];
  let steps = 0;
  const fatalErrors = new WeakSet();
  try {
    return runUntil(0);
  } finally {
    frames.length = 0;
  }

  function runUntil(boundary) {
    while (frames.length > boundary) {
      const current = frames[frames.length - 1];
      const { frame } = current;
      const { instructions } = current.program;
      if (frame.pc >= instructions.length)
        fail(
          instructions[instructions.length - 1],
          'Execution reached the end without halt or return',
        );
      const instruction = instructions[frame.pc];
      const { op, args } = instruction;
      const definition = INSTRUCTIONS[op];
      const { stack, locals } = frame;
      if (steps >= maxSteps) {
        const error = new Error(
          `VM ${instruction.line}:${instruction.column}: Instruction limit exceeded: ${maxSteps}`,
        );
        fatalErrors.add(error);
        throw error; // Uncatchable execution budget, not a user throw.
      }
      if (stack.length < definition.pops)
        fail(
          instruction,
          `Stack underflow for ${op}: expected ${definition.pops}, received ${stack.length}`,
        );
      steps++;
      frame.pc++;
      try {
        switch (op) {
          case 'halt': {
            const result = complete(
              { type: 'return', value: undefined },
              boundary,
            );
            if (result.done) return result.value;
            break;
          }
          case 'js.try.enter': {
            const handlers = (current.handlers ??= []);
            handlers.push({
              phase: 'try',
              environment: frame.environment,
              stackDepth: stack.length,
              catchTarget: instruction.targets[0],
              finallyTarget: instruction.targets[1],
              endTarget: instruction.targets[2],
              hasCatch: args[3],
              hasFinally: args[4],
            });
            break;
          }
          case 'js.try.leave': {
            const handler = current.handlers?.at(-1);
            if (!handler || handler.phase === 'finally')
              fail(instruction, 'try.leave requires try or catch');
            frame.restoreEnvironment(handler.environment);
            stack.length = handler.stackDepth;
            if (handler.hasFinally) {
              handler.phase = 'finally';
              handler.pending = { type: 'normal' };
              frame.pc = handler.finallyTarget;
            } else {
              current.handlers.pop();
              frame.pc = handler.endTarget;
            }
            break;
          }
          case 'js.catch.get': {
            const handler = current.handlers?.at(-1);
            if (!handler || handler.phase !== 'catch')
              fail(instruction, 'catch.get requires catch');
            stack.push(handler.error);
            break;
          }
          case 'js.finally.end': {
            const handler = current.handlers?.at(-1);
            if (!handler || handler.phase !== 'finally')
              fail(instruction, 'finally.end requires finally');
            current.handlers.pop();
            frame.restoreEnvironment(handler.environment);
            stack.length = handler.stackDepth;
            if (handler.pending.type === 'normal') frame.pc = handler.endTarget;
            else {
              const result = complete(handler.pending, boundary);
              if (result.done) return result.value;
            }
            break;
          }
          case 'js.abrupt.jump': {
            let targetEnvironment = frame.environment;
            for (let depth = 0; depth < args[1]; depth++) {
              if (targetEnvironment === frame.rootEnvironment)
                fail(instruction, 'Abrupt jump cannot leave frame root');
              targetEnvironment = targetEnvironment.parent;
            }
            if (args[2] > (current.handlers?.length ?? 0))
              fail(instruction, 'Invalid target handler depth');
            const result = complete(
              {
                type: 'jump',
                target: instruction.target,
                environment: targetEnvironment,
                handlerDepth: args[2],
              },
              boundary,
            );
            if (result.done) return result.value;
            break;
          }
          case 'js.const':
            stack.push(args[0]);
            break;
          case 'js.function.named.create': {
            const capturedEnvironment = new LexicalEnvironment(
              frame.environment,
            );
            const cell = capturedEnvironment.createFunctionName(0, args[0]);
            const fn = new VMFunction({
              name: args[0],
              parameters: args[1],
              strict: args[2],
              source: args[3],
              capturedEnvironment,
              exposeMetadata: exposeFunctionMetadata,
              decodeString,
            });
            attachVMFunction(fn, invokeFunction);
            cell.initialize(fn);
            stack.push(fn);
            break;
          }
          case 'js.name.set':
          case 'js.name.tee': {
            const cell = getEnvironmentCell(
              frame,
              args[0],
              args[1],
              instruction,
            );
            if (!(cell instanceof FunctionNameCell)) {
              fail(instruction, 'Expected a function-name binding');
            }
            const value =
              op === 'js.name.set' ? stack.pop() : stack[stack.length - 1];
            cell.assign(value, args[2]);
            break;
          }
          case 'js.function.create':
            stack.push(
              attachVMFunction(
                new VMFunction({
                  name: args[0],
                  parameters: args[1],
                  strict: args[2],
                  source: args[3],
                  capturedEnvironment: frame.environment,
                  exposeMetadata: exposeFunctionMetadata,
                  decodeString,
                }),
                invokeFunction,
              ),
            );
            break;
          case 'js.this.get':
            stack.push(frame.thisArg);
            break;
          case 'js.arguments.create': {
            if (!(current.fn instanceof VMFunction)) {
              fail(instruction, 'arguments requires a VM function call');
            }
            if (frame.environment !== frame.rootEnvironment) {
              fail(
                instruction,
                'arguments must be created in the function root environment',
              );
            }
            if (current.argumentsObject === undefined) {
              current.argumentsObject = createArgumentsObject({
                args: frame.args,
                parameters: getVMFunctionRecord(current.fn).parameters,
                parameterEnvironment: frame.rootEnvironment,
                callee: current.fn,
                strict: getVMFunctionRecord(current.fn).strict,
              });
            }
            frame.rootEnvironment
              .create(args[0], 'arguments', 'let')
              .initialize(current.argumentsObject);
            break;
          }
          case 'js.arg.get':
            stack.push(frame.args[args[0]]);
            break;
          case 'nop':
            break;
          case 'throw':
            throw stack.pop();
          case 'js.regexp.create':
            stack.push(createRegExpLiteral(args[0], args[1]));
            break;
          case 'js.global.typeof':
            stack.push(typeOfExternal(args[0], environment));
            break;
          case 'js.global.delete':
            stack.push(deleteExternal(args[0], environment));
            break;
          case 'js.prop.delete': {
            const key = stack.pop();
            const base = stack.pop();
            stack.push(deleteProperty(base, key, args[0], invokeFunction));
            break;
          }
          case 'js.global.get':
            stack.push(activate(readExternal(args[0], environment)));
            break;
          case 'js.for_in.create':
            stack.push(createForInIterator(stack.pop()));
            break;
          case 'js.for_in.next': {
            const result = nextForInIterator(stack.pop());
            stack.push(result.value, !result.done);
            break;
          }
          case 'js.object.create':
            stack.push({});
            break;
          case 'js.array.create':
            stack.push(createArrayLiteral(args[0]));
            break;
          case 'js.object.define': {
            const value = stack.pop();
            const key = stack.pop();
            const object = stack.pop();
            stack.push(defineLiteralData(object, key, value));
            break;
          }
          case 'js.object.getter':
          case 'js.object.setter': {
            const fn = stack.pop();
            const key = stack.pop();
            const object = stack.pop();
            const accessor = activate(fn);
            stack.push(
              defineLiteralAccessor(
                object,
                key,
                accessor,
                op === 'js.object.getter' ? 'get' : 'set',
              ),
            );
            break;
          }
          case 'js.object.proto': {
            const prototype = stack.pop();
            const object = stack.pop();
            stack.push(setLiteralPrototype(object, prototype));
            break;
          }
          case 'js.prop.get': {
            const key = stack.pop();
            const object = stack.pop();
            stack.push(activate(object[propertyKey(object, key)]));
            break;
          }
          case 'js.prop.set':
          case 'js.prop.tee': {
            const value = stack.pop();
            const key = stack.pop();
            const object = stack.pop();
            const result = writeProperty(
              object,
              propertyKey(object, key),
              value,
              args[0],
            );
            if (op === 'js.prop.tee') stack.push(result);
            break;
          }
          case 'dup2': {
            const first = stack[stack.length - 2];
            const second = stack[stack.length - 1];
            stack.push(first, second);
            break;
          }
          case 'drop':
            stack.pop();
            break;
          case 'dup':
            stack.push(stack[stack.length - 1]);
            break;
          case 'local.get':
            stack.push(locals.get(args[0]));
            break;
          case 'local.set':
            locals.set(args[0], stack.pop());
            break;
          case 'local.tee':
            locals.set(args[0], stack[stack.length - 1]);
            break;
          case 'js.add':
          case 'js.sub':
          case 'js.mul':
          case 'js.div':
          case 'js.rem':
          case 'js.strict_eq':
          case 'js.strict_ne':
          case 'js.eq':
          case 'js.ne':
          case 'js.lt':
          case 'js.le':
          case 'js.gt':
          case 'js.ge':
          case 'js.bit_and':
          case 'js.bit_or':
          case 'js.bit_xor':
          case 'js.shl':
          case 'js.shr':
          case 'js.ushr':
          case 'js.in':
          case 'js.instanceof':
            binary(stack, (left, right) =>
              binaryOperation(op, left, right, invokeFunction),
            );
            break;
          case 'js.to_numeric':
            stack.push(toNumeric(stack.pop(), invokeFunction));
            break;
          case 'js.inc':
          case 'js.dec':
            stack.push(
              updateNumeric(stack.pop(), op === 'js.inc', invokeFunction)
                .newValue,
            );
            break;
          case 'js.prop.inc':
          case 'js.prop.dec': {
            const key = stack.pop();
            const object = stack.pop();
            const update = updateNumeric(
              object[propertyKey(object, key)],
              op === 'js.prop.inc',
              invokeFunction,
            );
            // Keep the raw key: native read and write each perform ToPropertyKey.
            writeProperty(
              object,
              propertyKey(object, key),
              update.newValue,
              args[1],
            );
            stack.push(args[0] ? update.newValue : update.oldValue);
            break;
          }
          case 'js.pos':
          case 'js.neg':
          case 'js.bit_not':
          case 'js.typeof':
          case 'js.void':
            stack.push(unaryOperation(op, stack.pop(), invokeFunction));
            break;
          case 'js.not':
            stack.push(!stack.pop());
            break;
          case 'js.scope.enter':
            frame.enterScope();
            break;
          case 'js.scope.leave':
            if (frame.environment === frame.rootEnvironment)
              fail(
                instruction,
                'Cannot leave the root environment of a call frame',
              );
            frame.leaveScope();
            break;
          case 'js.env.get':
            stack.push(
              getEnvironmentCell(frame, args[0], args[1], instruction).read(),
            );
            break;
          case 'js.env.set':
            getEnvironmentCell(frame, args[0], args[1], instruction).write(
              stack.pop(),
            );
            break;
          case 'js.env.tee':
            getEnvironmentCell(frame, args[0], args[1], instruction).write(
              stack[stack.length - 1],
            );
            break;
          case 'js.lex.create':
            frame.environment.recreate(args[0], args[1], args[2]);
            break;
          case 'js.lex.init':
            getCell(frame, args[0], instruction).initialize(stack.pop());
            break;
          case 'js.lex.get':
            stack.push(getCell(frame, args[0], instruction).read());
            break;
          case 'js.lex.set':
            getCell(frame, args[0], instruction).write(stack.pop());
            break;
          case 'js.lex.tee':
            getCell(frame, args[0], instruction).write(stack[stack.length - 1]);
            break;
          case 'jump':
            frame.pc = instruction.target;
            break;
          case 'jump_if_false':
            if (!stack.pop()) frame.pc = instruction.target;
            break;
          case 'return': {
            const result = complete(
              { type: 'return', value: stack.pop() },
              boundary,
            );
            if (result.done) return result.value;
            break;
          }
          case 'js.construct': {
            if (args[0] > stack.length - 1)
              fail(instruction, 'Stack underflow for constructor arguments');
            const values = stack.splice(stack.length - args[0], args[0]);
            const constructor = activate(stack.pop());
            for (const value of values) activate(value);
            stack.push(constructFunction(constructor, values));
            break;
          }
          case 'js.call': {
            if (args[0] > stack.length - 2)
              fail(
                instruction,
                `Stack underflow for ${op} arguments: expected ${args[0]}, available ${stack.length - 2}`,
              );
            const callArgs = stack.splice(stack.length - args[0], args[0]);
            const fn = activate(stack.pop());
            const thisArg = stack.pop();
            for (const value of callArgs) activate(value);
            if (
              fn instanceof VMFunction &&
              getVMFunctionInvoker(fn) === invokeFunction
            )
              frames.push({
                program: getVMFunctionRecord(fn).program,
                fn,
                frame: createFunctionFrame(fn, thisArg, callArgs, environment),
              });
            else stack.push(applyFunction(fn, thisArg, callArgs));
            break;
          }
          default:
            fail(instruction, `Unsupported instruction: ${op}`);
        }
      } catch (error) {
        if (
          error !== null &&
          (typeof error === 'object' || typeof error === 'function') &&
          fatalErrors.has(error)
        )
          throw error;
        const result = complete({ type: 'throw', value: error }, boundary);
        if (result.done) return result.value;
      }
    }
    return undefined;
  }

  function activate(value) {
    if (value instanceof VMFunction) attachVMFunction(value, invokeFunction);
    return value;
  }

  // A completion runs finally blocks from the inside out. Catch sees throws
  // only from its try phase; finally overrides any older pending completion.
  function complete(completion, boundary) {
    while (frames.length > boundary) {
      const current = frames.at(-1),
        frame = current.frame;
      const handlers = (current.handlers ??= []);
      const targetDepth =
        completion.type === 'jump' ? completion.handlerDepth : 0;
      while (handlers.length > targetDepth) {
        const handler = handlers.at(-1);
        frame.restoreEnvironment(handler.environment);
        frame.stack.length = handler.stackDepth;
        if (
          completion.type === 'throw' &&
          handler.phase === 'try' &&
          handler.hasCatch
        ) {
          handler.phase = 'catch';
          handler.error = completion.value;
          frame.pc = handler.catchTarget;
          return { done: false };
        }
        if (handler.phase !== 'finally' && handler.hasFinally) {
          handler.phase = 'finally';
          handler.pending = completion;
          frame.pc = handler.finallyTarget;
          return { done: false };
        }
        handlers.pop();
      }
      if (completion.type === 'jump') {
        frame.restoreEnvironment(completion.environment);
        frame.pc = completion.target;
        return { done: false };
      }
      frames.pop();
      if (completion.type === 'return') {
        if (frames.length === boundary)
          return { done: true, value: completion.value };
        frames.at(-1).frame.stack.push(completion.value);
        return { done: false };
      }
    }
    // Unhandled throw exits this invocation boundary; native code may catch
    // it, or the suspended outer dispatcher routes it through its handlers.
    throw completion.value;
  }

  function propertyKey(base, key) {
    // Native property access/PutValue rejects nullish bases before key coercion.
    // Let that operation produce its usual error without invoking a VM key.
    if (base === null || base === undefined) return key;
    return toPropertyKey(key, invokeFunction);
  }

  function invokeFunction(fn, thisArg, args) {
    activate(fn);
    if (
      !(fn instanceof VMFunction) ||
      getVMFunctionInvoker(fn) !== invokeFunction
    )
      return applyFunction(fn, thisArg, args);
    const boundary = frames.length;
    frames.push({
      program: getVMFunctionRecord(fn).program,
      fn,
      frame: createFunctionFrame(fn, thisArg, args, environment),
    });
    try {
      return runUntil(boundary);
    } finally {
      // Host code can catch an exception. Restore the suspended VM frame.
      frames.length = boundary;
    }
  }
}
function createFunctionFrame(fn, thisArg, args, globalEnvironment) {
  const metadata = getVMFunctionRecord(fn);
  const frame = new CallFrame({
    parentEnvironment: metadata.capturedEnvironment,
    args,
    thisArg: metadata.strict
      ? thisArg
      : thisArg === null || thisArg === undefined
        ? globalEnvironment
        : Object(thisArg),
  });
  const slots = new Map();
  for (let i = 0; i < metadata.parameters.length; i++) {
    const name = metadata.parameters[i];
    if (slots.has(name)) {
      frame.rootEnvironment.getCell(slots.get(name)).write(args[i]);
      continue;
    }
    const slot = slots.size;
    slots.set(name, slot);
    frame.rootEnvironment.create(slot, name, 'let').initialize(args[i]);
  }
  return frame;
}
function binary(stack, operation) {
  const right = stack.pop();
  const left = stack.pop();
  stack.push(operation(left, right));
}
function getCell(frame, slot, instruction) {
  try {
    return frame.environment.getCell(slot);
  } catch {
    fail(instruction, `Lexical cell has not been created: ${slot}`);
  }
}
function getEnvironmentCell(frame, depth, slot, instruction) {
  try {
    return frame.environment.getCell(slot, depth);
  } catch (error) {
    fail(
      instruction,
      `Cannot resolve lexical cell at depth ${depth}, slot ${slot}: ${error.message}`,
    );
  }
}
function fail(instruction, message) {
  throw new Error(`VM ${instruction.line}:${instruction.column}: ${message}`);
}
