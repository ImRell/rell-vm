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
import { decodeBytecode } from '../bytecode/binary-serializer.js';
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

// Pops table for fast O(1) operand count checks
const POPS_TABLE = new Uint8Array([
  0, 0, 0, 0, 0, 2, 0, 1, 0, 1, 1, 2, 0, 0, 3, 3, 3, 2, 3, 3, 2, 1, 1, 0, 1, 1,
  2, 2, 2, 2, 2, 1, 1, 1, 2, 2, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2,
  2, 2, 2, 2, 2, 2, 0, 1, 1, 0, 1, 0, 1, 1, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 1, 1,
  2, 1, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0 // 85..91 macro opcodes
]);

function readVarint(code, frame) {
  let res = 0,
    shift = 0,
    b;
  do {
    if (frame.pc >= code.length) {
      fail('Unexpected end of bytecode');
    }
    b = code[frame.pc++];
    res |= (b & 0x7f) << shift;
    shift += 7;
  } while (b & 0x80);
  return res >>> 0;
}

function readInt32(code, frame) {
  if (frame.pc + 4 > code.length) {
    fail('Unexpected end of bytecode');
  }
  const p = frame.pc;
  frame.pc += 4;
  return (
    code[p] |
    (code[p + 1] << 8) |
    (code[p + 2] << 16) |
    (code[p + 3] << 24)
  );
}

export function executeBytecode(
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

  let program;
  if (source instanceof Uint8Array) {
    program = decodeBytecode(source, { decodeString });
  } else if (source && source.code instanceof Uint8Array) {
    program = source;
    if (decodeString) {
      attachStringDecoder(program, decodeString);
    }
  } else {
    throw new TypeError('Invalid bytecode source');
  }

  const frames = [
    {
      program,
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
      const { frame, program } = current;
      const { code, constants } = program;

      if (frame.pc >= code.length) {
        fail('Execution reached the end without halt or return');
      }

      const op = code[frame.pc++];
      const pops = POPS_TABLE[op];
      const { stack, locals } = frame;

      if (steps >= maxSteps) {
        const error = new Error(`VM 0:0: Instruction limit exceeded: ${maxSteps}`);
        fatalErrors.add(error);
        throw error;
      }

      if (stack.length < pops) {
        fail(`Stack underflow for opcode ${op}: expected ${pops}, received ${stack.length}`);
      }

      steps++;

      try {
        switch (op) {
          case 0: { // halt
            const result = complete(
              { type: 'return', value: undefined },
              boundary,
            );
            if (result.done) return result.value;
            break;
          }
          case 80: { // js.try.enter
            const catchTarget = readInt32(code, frame);
            const finallyTarget = readInt32(code, frame);
            const endTarget = readInt32(code, frame);
            const hasCatch = code[frame.pc++] === 1;
            const hasFinally = code[frame.pc++] === 1;
            const handlers = (current.handlers ??= []);
            handlers.push({
              phase: 'try',
              environment: frame.environment,
              stackDepth: stack.length,
              catchTarget,
              finallyTarget,
              endTarget,
              hasCatch,
              hasFinally,
            });
            break;
          }
          case 81: { // js.try.leave
            const handler = current.handlers?.at(-1);
            if (!handler || handler.phase === 'finally')
              fail('try.leave requires try or catch');
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
          case 82: { // js.catch.get
            const handler = current.handlers?.at(-1);
            if (!handler || handler.phase !== 'catch')
              fail('catch.get requires catch');
            stack.push(handler.error);
            break;
          }
          case 83: { // js.finally.end
            const handler = current.handlers?.at(-1);
            if (!handler || handler.phase !== 'finally')
              fail('finally.end requires finally');
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
          case 84: { // js.abrupt.jump
            const target = readInt32(code, frame);
            const scopesToLeave = readVarint(code, frame);
            const handlerDepth = readVarint(code, frame);
            let targetEnvironment = frame.environment;
            for (let depth = 0; depth < scopesToLeave; depth++) {
              if (targetEnvironment === frame.rootEnvironment)
                fail('Abrupt jump cannot leave frame root');
              targetEnvironment = targetEnvironment.parent;
            }
            if (handlerDepth > (current.handlers?.length ?? 0))
              fail('Invalid target handler depth');
            const result = complete(
              {
                type: 'jump',
                target,
                environment: targetEnvironment,
                handlerDepth,
              },
              boundary,
            );
            if (result.done) return result.value;
            break;
          }
          case 1: { // js.const
            const constIdx = readVarint(code, frame);
            stack.push(constants[constIdx]);
            break;
          }
          case 66: { // js.function.named.create
            const nameConst = constants[readVarint(code, frame)];
            const paramsConst = constants[readVarint(code, frame)];
            const strict = code[frame.pc++] === 1;
            const bodyBytecode = constants[readVarint(code, frame)];
            const capturedEnvironment = new LexicalEnvironment(
              frame.environment,
            );
            const cell = capturedEnvironment.createFunctionName(0, nameConst);
            const fn = new VMFunction({
              name: nameConst,
              parameters: paramsConst,
              strict,
              bytecode: bodyBytecode,
              capturedEnvironment,
              exposeMetadata: exposeFunctionMetadata,
              decodeString,
            });
            attachVMFunction(fn, invokeFunction);
            cell.initialize(fn);
            stack.push(fn);
            break;
          }
          case 67: { // js.name.set
            const depth = readVarint(code, frame);
            const slot = readVarint(code, frame);
            const strict = code[frame.pc++] === 1;
            const cell = getEnvironmentCell(frame, depth, slot);
            if (!(cell instanceof FunctionNameCell)) {
              fail('Expected a function-name binding');
            }
            cell.assign(stack.pop(), strict);
            break;
          }
          case 68: { // js.name.tee
            const depth = readVarint(code, frame);
            const slot = readVarint(code, frame);
            const strict = code[frame.pc++] === 1;
            const cell = getEnvironmentCell(frame, depth, slot);
            if (!(cell instanceof FunctionNameCell)) {
              fail('Expected a function-name binding');
            }
            cell.assign(stack[stack.length - 1], strict);
            break;
          }
          case 69: { // js.function.create
            const nameConst = constants[readVarint(code, frame)];
            const paramsConst = constants[readVarint(code, frame)];
            const strict = code[frame.pc++] === 1;
            const bodyBytecode = constants[readVarint(code, frame)];
            stack.push(
              attachVMFunction(
                new VMFunction({
                  name: nameConst,
                  parameters: paramsConst,
                  strict,
                  bytecode: bodyBytecode,
                  capturedEnvironment: frame.environment,
                  exposeMetadata: exposeFunctionMetadata,
                  decodeString,
                }),
                invokeFunction,
              ),
            );
            break;
          }
          case 70: // js.this.get
            stack.push(frame.thisArg);
            break;
          case 71: { // js.arguments.create
            const slot = readVarint(code, frame);
            if (!(current.fn instanceof VMFunction)) {
              fail('arguments requires a VM function call');
            }
            if (frame.environment !== frame.rootEnvironment) {
              fail('arguments must be created in the function root environment');
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
              .create(slot, 'arguments', 'let')
              .initialize(current.argumentsObject);
            break;
          }
          case 72: { // js.arg.get
            const slot = readVarint(code, frame);
            stack.push(frame.args[slot]);
            break;
          }
          case 8: // nop
            break;
          case 7: // throw
            throw stack.pop();
          case 6: { // js.regexp.create
            const patConst = constants[readVarint(code, frame)];
            const flagsConst = constants[readVarint(code, frame)];
            stack.push(createRegExpLiteral(patConst, flagsConst));
            break;
          }
          case 3: { // js.global.typeof
            const nameConst = constants[readVarint(code, frame)];
            stack.push(typeOfExternal(nameConst, environment));
            break;
          }
          case 4: { // js.global.delete
            const nameConst = constants[readVarint(code, frame)];
            stack.push(deleteExternal(nameConst, environment));
            break;
          }
          case 5: { // js.prop.delete
            const strict = code[frame.pc++] === 1;
            const key = stack.pop();
            const base = stack.pop();
            stack.push(deleteProperty(base, key, strict, invokeFunction));
            break;
          }
          case 2: { // js.global.get
            const nameConst = constants[readVarint(code, frame)];
            stack.push(activate(readExternal(nameConst, environment)));
            break;
          }
          case 9: // js.for_in.create
            stack.push(createForInIterator(stack.pop()));
            break;
          case 10: { // js.for_in.next
            const result = nextForInIterator(stack.pop());
            stack.push(result.value, !result.done);
            break;
          }
          case 12: // js.object.create
            stack.push({});
            break;
          case 13: { // js.array.create
            const count = readVarint(code, frame);
            stack.push(createArrayLiteral(count));
            break;
          }
          case 14: { // js.object.define
            const value = stack.pop();
            const key = stack.pop();
            const object = stack.pop();
            stack.push(defineLiteralData(object, key, value));
            break;
          }
          case 15: { // js.object.getter
            const fn = stack.pop();
            const key = stack.pop();
            const object = stack.pop();
            const accessor = activate(fn);
            stack.push(defineLiteralAccessor(object, key, accessor, 'get'));
            break;
          }
          case 16: { // js.object.setter
            const fn = stack.pop();
            const key = stack.pop();
            const object = stack.pop();
            const accessor = activate(fn);
            stack.push(defineLiteralAccessor(object, key, accessor, 'set'));
            break;
          }
          case 17: { // js.object.proto
            const prototype = stack.pop();
            const object = stack.pop();
            stack.push(setLiteralPrototype(object, prototype));
            break;
          }
          case 11: { // js.prop.get
            const key = stack.pop();
            const object = stack.pop();
            stack.push(activate(object[propertyKey(object, key)]));
            break;
          }
          case 18: { // js.prop.set
            const strict = code[frame.pc++] === 1;
            const value = stack.pop();
            const key = stack.pop();
            const object = stack.pop();
            writeProperty(object, propertyKey(object, key), value, strict);
            break;
          }
          case 19: { // js.prop.tee
            const strict = code[frame.pc++] === 1;
            const value = stack.pop();
            const key = stack.pop();
            const object = stack.pop();
            const result = writeProperty(
              object,
              propertyKey(object, key),
              value,
              strict,
            );
            stack.push(result);
            break;
          }
          case 20: { // dup2
            const first = stack[stack.length - 2];
            const second = stack[stack.length - 1];
            stack.push(first, second);
            break;
          }
          case 21: // drop
            stack.pop();
            break;
          case 22: // dup
            stack.push(stack[stack.length - 1]);
            break;
          case 23: { // local.get
            const slot = readVarint(code, frame);
            stack.push(locals.get(slot));
            break;
          }
          case 24: { // local.set
            const slot = readVarint(code, frame);
            locals.set(slot, stack.pop());
            break;
          }
          case 25: { // local.tee
            const slot = readVarint(code, frame);
            locals.set(slot, stack[stack.length - 1]);
            break;
          }
          case 26: // js.add
            binary(stack, (left, right) =>
              binaryOperation('js.add', left, right, invokeFunction),
            );
            break;
          case 27: // js.sub
            binary(stack, (left, right) =>
              binaryOperation('js.sub', left, right, invokeFunction),
            );
            break;
          case 28: // js.mul
            binary(stack, (left, right) =>
              binaryOperation('js.mul', left, right, invokeFunction),
            );
            break;
          case 29: // js.div
            binary(stack, (left, right) =>
              binaryOperation('js.div', left, right, invokeFunction),
            );
            break;
          case 30: // js.rem
            binary(stack, (left, right) =>
              binaryOperation('js.rem', left, right, invokeFunction),
            );
            break;
          case 31: // js.to_numeric
            stack.push(toNumeric(stack.pop(), invokeFunction));
            break;
          case 32: // js.inc
            stack.push(
              updateNumeric(stack.pop(), true, invokeFunction).newValue,
            );
            break;
          case 33: // js.dec
            stack.push(
              updateNumeric(stack.pop(), false, invokeFunction).newValue,
            );
            break;
          case 34: { // js.prop.inc
            const prefix = code[frame.pc++] === 1;
            const strict = code[frame.pc++] === 1;
            const key = stack.pop();
            const object = stack.pop();
            const update = updateNumeric(
              object[propertyKey(object, key)],
              true,
              invokeFunction,
            );
            writeProperty(
              object,
              propertyKey(object, key),
              update.newValue,
              strict,
            );
            stack.push(prefix ? update.newValue : update.oldValue);
            break;
          }
          case 35: { // js.prop.dec
            const prefix = code[frame.pc++] === 1;
            const strict = code[frame.pc++] === 1;
            const key = stack.pop();
            const object = stack.pop();
            const update = updateNumeric(
              object[propertyKey(object, key)],
              false,
              invokeFunction,
            );
            writeProperty(
              object,
              propertyKey(object, key),
              update.newValue,
              strict,
            );
            stack.push(prefix ? update.newValue : update.oldValue);
            break;
          }
          case 36: // js.pos
            stack.push(unaryOperation('js.pos', stack.pop(), invokeFunction));
            break;
          case 37: // js.bit_not
            stack.push(unaryOperation('js.bit_not', stack.pop(), invokeFunction));
            break;
          case 38: // js.typeof
            stack.push(unaryOperation('js.typeof', stack.pop(), invokeFunction));
            break;
          case 39: // js.void
            stack.push(unaryOperation('js.void', stack.pop(), invokeFunction));
            break;
          case 40: // js.neg
            stack.push(unaryOperation('js.neg', stack.pop(), invokeFunction));
            break;
          case 41: // js.not
            stack.push(!stack.pop());
            break;
          case 42: // js.eq
            binary(stack, (left, right) =>
              binaryOperation('js.eq', left, right, invokeFunction),
            );
            break;
          case 43: // js.ne
            binary(stack, (left, right) =>
              binaryOperation('js.ne', left, right, invokeFunction),
            );
            break;
          case 44: // js.strict_ne
            binary(stack, (left, right) =>
              binaryOperation('js.strict_ne', left, right, invokeFunction),
            );
            break;
          case 45: // js.bit_and
            binary(stack, (left, right) =>
              binaryOperation('js.bit_and', left, right, invokeFunction),
            );
            break;
          case 46: // js.bit_or
            binary(stack, (left, right) =>
              binaryOperation('js.bit_or', left, right, invokeFunction),
            );
            break;
          case 47: // js.bit_xor
            binary(stack, (left, right) =>
              binaryOperation('js.bit_xor', left, right, invokeFunction),
            );
            break;
          case 48: // js.shl
            binary(stack, (left, right) =>
              binaryOperation('js.shl', left, right, invokeFunction),
            );
            break;
          case 49: // js.shr
            binary(stack, (left, right) =>
              binaryOperation('js.shr', left, right, invokeFunction),
            );
            break;
          case 50: // js.ushr
            binary(stack, (left, right) =>
              binaryOperation('js.ushr', left, right, invokeFunction),
            );
            break;
          case 51: // js.in
            binary(stack, (left, right) =>
              binaryOperation('js.in', left, right, invokeFunction),
            );
            break;
          case 52: // js.instanceof
            binary(stack, (left, right) =>
              binaryOperation('js.instanceof', left, right, invokeFunction),
            );
            break;
          case 53: // js.strict_eq
            binary(stack, (left, right) =>
              binaryOperation('js.strict_eq', left, right, invokeFunction),
            );
            break;
          case 54: // js.lt
            binary(stack, (left, right) =>
              binaryOperation('js.lt', left, right, invokeFunction),
            );
            break;
          case 55: // js.le
            binary(stack, (left, right) =>
              binaryOperation('js.le', left, right, invokeFunction),
            );
            break;
          case 56: // js.gt
            binary(stack, (left, right) =>
              binaryOperation('js.gt', left, right, invokeFunction),
            );
            break;
          case 57: // js.ge
            binary(stack, (left, right) =>
              binaryOperation('js.ge', left, right, invokeFunction),
            );
            break;
          case 73: // js.scope.enter
            frame.enterScope();
            break;
          case 74: // js.scope.leave
            if (frame.environment === frame.rootEnvironment)
              fail('Cannot leave the root environment of a call frame');
            frame.leaveScope();
            break;
          case 75: { // js.env.get
            const depth = readVarint(code, frame);
            const slot = readVarint(code, frame);
            stack.push(getEnvironmentCell(frame, depth, slot).read());
            break;
          }
          case 76: { // js.env.set
            const depth = readVarint(code, frame);
            const slot = readVarint(code, frame);
            getEnvironmentCell(frame, depth, slot).write(stack.pop());
            break;
          }
          case 77: { // js.env.tee
            const depth = readVarint(code, frame);
            const slot = readVarint(code, frame);
            getEnvironmentCell(frame, depth, slot).write(stack[stack.length - 1]);
            break;
          }
          case 61: { // js.lex.create
            const slot = readVarint(code, frame);
            const nameConst = constants[readVarint(code, frame)];
            const kind = code[frame.pc++] === 0 ? 'let' : 'const';
            frame.environment.recreate(slot, nameConst, kind);
            break;
          }
          case 62: { // js.lex.init
            const slot = readVarint(code, frame);
            getCell(frame, slot).initialize(stack.pop());
            break;
          }
          case 63: { // js.lex.get
            const slot = readVarint(code, frame);
            stack.push(getCell(frame, slot).read());
            break;
          }
          case 64: { // js.lex.set
            const slot = readVarint(code, frame);
            getCell(frame, slot).write(stack.pop());
            break;
          }
          case 65: { // js.lex.tee
            const slot = readVarint(code, frame);
            getCell(frame, slot).write(stack[stack.length - 1]);
            break;
          }
          case 58: { // jump
            const target = readInt32(code, frame);
            frame.pc = target;
            break;
          }
          case 59: { // jump_if_false
            const target = readInt32(code, frame);
            if (!stack.pop()) frame.pc = target;
            break;
          }
          case 60: { // return
            const result = complete(
              { type: 'return', value: stack.pop() },
              boundary,
            );
            if (result.done) return result.value;
            break;
          }
          case 79: { // js.construct
            const count = readVarint(code, frame);
            if (count > stack.length - 1)
              fail('Stack underflow for constructor arguments');
            const values = stack.splice(stack.length - count, count);
            const constructor = activate(stack.pop());
            for (const value of values) activate(value);
            stack.push(constructFunction(constructor, values));
            break;
          }
          case 78: { // js.call
            const count = readVarint(code, frame);
            if (count > stack.length - 2)
              fail(
                `Stack underflow for call arguments: expected ${count}, available ${stack.length - 2}`,
              );
            const callArgs = stack.splice(stack.length - count, count);
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
          case 85: { // macro.local_const_add
            const slot = readVarint(code, frame);
            const constVal = constants[readVarint(code, frame)];
            const left = locals.get(slot);
            stack.push(binaryOperation('js.add', left, constVal, invokeFunction));
            break;
          }
          case 86: { // macro.local_const_sub
            const slot = readVarint(code, frame);
            const constVal = constants[readVarint(code, frame)];
            const left = locals.get(slot);
            stack.push(binaryOperation('js.sub', left, constVal, invokeFunction));
            break;
          }
          case 87: { // macro.local_prop_get
            const slot = readVarint(code, frame);
            const key = constants[readVarint(code, frame)];
            const object = locals.get(slot);
            stack.push(activate(object[propertyKey(object, key)]));
            break;
          }
          case 88: { // macro.local_local_add
            const slot1 = readVarint(code, frame);
            const slot2 = readVarint(code, frame);
            const left = locals.get(slot1);
            const right = locals.get(slot2);
            stack.push(binaryOperation('js.add', left, right, invokeFunction));
            break;
          }
          case 89: { // macro.local_local_strict_eq
            const slot1 = readVarint(code, frame);
            const slot2 = readVarint(code, frame);
            const left = locals.get(slot1);
            const right = locals.get(slot2);
            stack.push(binaryOperation('js.strict_eq', left, right, invokeFunction));
            break;
          }
          case 90: { // macro.return_const
            const constVal = constants[readVarint(code, frame)];
            const result = complete({ type: 'return', value: constVal }, boundary);
            if (result.done) return result.value;
            break;
          }
          case 91: { // macro.return_local
            const slot = readVarint(code, frame);
            const val = locals.get(slot);
            const result = complete({ type: 'return', value: val }, boundary);
            if (result.done) return result.value;
            break;
          }
          default:
            fail(`Unsupported instruction opcode: ${op}`);
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
    throw completion.value;
  }

  function propertyKey(base, key) {
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

function getCell(frame, slot) {
  try {
    return frame.environment.getCell(slot);
  } catch {
    fail(`Lexical cell has not been created: ${slot}`);
  }
}

function getEnvironmentCell(frame, depth, slot) {
  try {
    return frame.environment.getCell(slot, depth);
  } catch (error) {
    fail(`Cannot resolve lexical cell at depth ${depth}, slot ${slot}: ${error.message}`);
  }
}

function fail(message) {
  throw new Error(`VM: ${message}`);
}

export function attachStringDecoder(program, decodeString) {
  if (!decodeString || !program) return;
  if (Array.isArray(program.constants)) {
    if (Object.isFrozen(program.constants)) {
      const cloned = [...program.constants];
      try {
        program.constants = cloned;
      } catch {
        Object.defineProperty(program, 'constants', {
          value: cloned,
          writable: true,
          configurable: true,
          enumerable: true,
        });
      }
    }
    const constants = program.constants;
    for (let i = 0; i < constants.length; i++) {
      const val = constants[i];
      if (typeof val === 'string' && val.startsWith('@') && /^@[a-f0-9]{16}$/.test(val)) {
        Object.defineProperty(constants, i, {
          enumerable: true,
          configurable: true,
          get() {
            const decoded = decodeString(val);
            if (typeof decoded !== 'string') {
              throw new TypeError('Decoded string reference must be a string');
            }
            return decoded;
          },
        });
      } else if (val && val.code instanceof Uint8Array) {
        attachStringDecoder(val, decodeString);
      }
    }
  }
}


