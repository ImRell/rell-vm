/**
 * Версия собственного текстового формата.
 * Это не версия стандарта WebAssembly.
 */
export const ASSEMBLY_VERSION = 1;

/**
 * Типы аргументов:
 *
 * literal     — примитивное значение:
 *               строка, число, boolean, null, undefined, BigInt.
 *
 * slot        — неотрицательное безопасное целое число.
 *
 * name        — непустая строка в двойных кавычках.
 *
 * bindingKind — ключевое слово let или const.
 *
 * label       — имя метки: [A-Za-z_][A-Za-z0-9_]*.
 *
 * Строки используют JSON-экранирование.
 * Проверять аргументы будет парсер формата.
 */

/**
 * Исполняемые инструкции.
 *
 * operands — типы аргументов в порядке записи.
 * pops     — минимальное число снимаемых значений.
 * pushes   — число помещаемых значений.
 *
 * flow:
 * next   — продолжение со следующей инструкции;
 * jump   — безусловный переход;
 * branch — условный переход;
 * return — завершение текущего вызова;
 * halt   — завершение программы;
 * throw  — исключительное завершение с исходным значением.
 *
 * DUP описан как pops: 1, pushes: 2:
 * это фиксирует необходимость значения на стеке.
 */
export const INSTRUCTIONS = Object.freeze({
  halt: define([], 0, 0, 'halt'),

  'js.const': define(['literal'], 0, 1),
  'js.global.get': define(['name'], 0, 1),
  'js.global.typeof': define(['name'], 0, 1),
  'js.global.delete': define(['name'], 0, 1),
  'js.prop.delete': define(['boolean'], 2, 1),
  'js.regexp.create': define(['text', 'text'], 0, 1),
  // Abrupt completion: propagates the original value out of this execution.
  throw: define([], 1, 0, 'throw'),
  nop: define([], 0, 0),
  // EnumerateProperty state is opaque, not a JS-visible iterable.
  'js.for_in.create': define([], 1, 1),
  // ..., state -> ..., keyOrUndefined, hasKey. No property value is read.
  'js.for_in.next': define([], 1, 2),
  'js.prop.get': define([], 2, 1),
  'js.object.create': define([], 0, 1),
  'js.array.create': define(['count'], 0, 1),
  // ..., object, key, value -> ..., object (own data property).
  'js.object.define': define([], 3, 1),
  'js.object.getter': define([], 3, 1),
  'js.object.setter': define([], 3, 1),
  // ..., object, prototype -> ..., object.
  'js.object.proto': define([], 2, 1),
  // Stack: ..., base, rawKey, value. Operand: strict mode.
  'js.prop.set': define(['boolean'], 3, 0),
  'js.prop.tee': define(['boolean'], 3, 1),
  // ..., a, b -> ..., a, b, a, b. Needed for compound property writes.
  dup2: define([], 2, 4),
  drop: define([], 1, 0),
  dup: define([], 1, 2),

  'local.get': define(['slot'], 0, 1),
  'local.set': define(['slot'], 1, 0),
  'local.tee': define(['slot'], 1, 1),

  'js.add': define([], 2, 1),
  'js.sub': define([], 2, 1),
  'js.mul': define([], 2, 1),
  'js.div': define([], 2, 1),
  'js.rem': define([], 2, 1),
  // Numeric update primitives preserve Number/BigInt and numeric postfix values.
  'js.to_numeric': define([], 1, 1),
  'js.inc': define([], 1, 1),
  'js.dec': define([], 1, 1),
  // ..., base, rawKey -> ..., result. Operands: prefix, strict.
  'js.prop.inc': define(['boolean', 'boolean'], 2, 1),
  'js.prop.dec': define(['boolean', 'boolean'], 2, 1),
  'js.pos': define([], 1, 1),
  'js.bit_not': define([], 1, 1),
  'js.typeof': define([], 1, 1),
  'js.void': define([], 1, 1),
  'js.neg': define([], 1, 1),
  'js.not': define([], 1, 1),

  'js.eq': define([], 2, 1),
  'js.ne': define([], 2, 1),
  'js.strict_ne': define([], 2, 1),
  'js.bit_and': define([], 2, 1),
  'js.bit_or': define([], 2, 1),
  'js.bit_xor': define([], 2, 1),
  'js.shl': define([], 2, 1),
  'js.shr': define([], 2, 1),
  'js.ushr': define([], 2, 1),
  'js.in': define([], 2, 1),
  'js.instanceof': define([], 2, 1),
  'js.strict_eq': define([], 2, 1),
  'js.lt': define([], 2, 1),
  'js.le': define([], 2, 1),
  'js.gt': define([], 2, 1),
  'js.ge': define([], 2, 1),

  jump: define(['label'], 0, 0, 'jump'),
  jump_if_false: define(['label'], 1, 0, 'branch'),

  return: define([], 1, 0, 'return'),

  'js.lex.create': define(['slot', 'name', 'bindingKind'], 0, 0),
  'js.lex.init': define(['slot'], 1, 0),
  'js.lex.get': define(['slot'], 0, 1),
  'js.lex.set': define(['slot'], 1, 0),
  'js.lex.tee': define(['slot'], 1, 1),

  // Именованное выражение создаёт отдельное окружение имени (слот 0).
  'js.function.named.create': define(
    ['text', 'parameters', 'boolean', 'text'],
    0,
    1,
  ),
  // depth, slot, strictness of the assignment code.
  'js.name.set': define(['count', 'slot', 'boolean'], 1, 0),
  'js.name.tee': define(['count', 'slot', 'boolean'], 1, 1),
  'js.function.create': define(['text', 'parameters', 'boolean', 'text'], 0, 1),
  'js.this.get': define([], 0, 1),
  'js.arguments.create': define(['slot'], 0, 0),
  'js.arg.get': define(['count'], 0, 1),
  'js.scope.enter': define([], 0, 0),
  'js.scope.leave': define([], 0, 0),
  'js.env.get': define(['count', 'slot'], 0, 1),
  'js.env.set': define(['count', 'slot'], 1, 0),
  'js.env.tee': define(['count', 'slot'], 1, 1),
  'js.call': define(['count'], 2, 1),
  'js.construct': define(['count'], 1, 1),
  // catch, finally, end; booleans say which handlers actually exist.
  'js.try.enter': define(
    ['label', 'label', 'label', 'boolean', 'boolean'],
    0,
    0,
  ),
  'js.try.leave': define([], 0, 0),
  'js.catch.get': define([], 0, 1),
  'js.finally.end': define([], 0, 0),
  // target label, scopes to leave, active handlers at target.
  'js.abrupt.jump': define(['label', 'count', 'count'], 0, 0, 'jump'),
});

/**
 * Директивы обрабатываются загрузчиком,
 * но не становятся исполняемыми инструкциями.
 */
export const DIRECTIVES = Object.freeze({
  label: Object.freeze({
    operands: Object.freeze(['label']),
  }),
});

function define(operands, pops, pushes, flow = 'next') {
  return Object.freeze({
    operands: Object.freeze([...operands]),
    pops,
    pushes,
    flow,
  });
}
