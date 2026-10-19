import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createArgumentsObject } from '../src/runtime/arguments-object.js';
import { LexicalEnvironment } from '../src/runtime/lexical-environment.js';

function make(args = [10, 20], parameters = ['a', 'b'], strict = false) {
  const environment = new LexicalEnvironment();
  const slots = new Map();
  parameters.forEach((name, index) => {
    if (slots.has(name))
      environment.getCell(slots.get(name)).write(args[index]);
    else {
      const slot = slots.size;
      slots.set(name, slot);
      environment.create(slot, name, 'let').initialize(args[index]);
    }
  });
  const callee = function example() {};
  const object = createArgumentsObject({
    args,
    parameters,
    strict,
    parameterEnvironment: environment,
    callee,
  });
  return {
    object,
    callee,
    get(name) {
      return environment.getCell(slots.get(name)).read();
    },
    set(name, value) {
      environment.getCell(slots.get(name)).write(value);
    },
  };
}

function nativePair(strict = false) {
  if (strict)
    return (function (a, b) {
      'use strict';
      return {
        object: arguments,
        get(name) {
          return name === 'a' ? a : b;
        },
        set(name, value) {
          if (name === 'a') a = value;
          else b = value;
        },
      };
    })(10, 20);
  return vm.runInNewContext(
    '(function(a,b) { return {object:arguments, get:function(name) {return name === "a" ? a : b;}, set:function(name,value) {if(name === "a") a=value;else b=value;}}; })(10,20)',
  );
}

function compare(operation, strict = false) {
  assert.deepEqual(
    operation(make([10, 20], ['a', 'b'], strict)),
    operation(nativePair(strict)),
  );
}

test('создаёт не-массив с индексами, length и Arguments brand', () => {
  const { object } = make();
  assert.equal(Array.isArray(object), false);
  assert.equal(Object.getPrototypeOf(object), Object.prototype);
  assert.equal(Object.prototype.toString.call(object), '[object Arguments]');
  assert.deepEqual(Object.keys(object), ['0', '1']);
  assert.equal(object.length, 2);
  assert.equal(object[0], 10);
  assert.deepEqual(Object.getOwnPropertyDescriptor(object, 'length'), {
    value: 2,
    writable: true,
    enumerable: false,
    configurable: true,
  });
});

test('length учитывает лишние аргументы, отсутствующие индексы не создаются', () => {
  const { object } = make([1, 2, 3], ['a']);
  assert.equal(object.length, 3);
  assert.equal(object[2], 3);
  assert.equal(Object.hasOwn(object, '3'), false);
  const empty = make([], ['a']);
  assert.equal(empty.object.length, 0);
  assert.equal(empty.get('a'), undefined);
  assert.equal(Object.hasOwn(empty.object, '0'), false);
});

test('изменение параметра отражается в значении и дескрипторе индекса', () => {
  compare((pair) => {
    pair.set('a', 42);
    return [
      pair.object[0],
      Object.getOwnPropertyDescriptor(pair.object, '0').value,
    ];
  });
});

test('прямая запись индекса изменяет параметр в нестрогом режиме', () => {
  compare((pair) => {
    pair.object[0] = 42;
    return [pair.get('a'), pair.object[0]];
  });
});

test('строгие аргументы не связаны с параметрами в обе стороны', () => {
  compare((pair) => {
    pair.set('a', 42);
    pair.object[1] = 99;
    return [pair.object[0], pair.get('a'), pair.get('b'), pair.object[1]];
  }, true);
});

test('повторные параметры связывают только последнее вхождение', () => {
  const pair = make([10, 20], ['a', 'a']);
  pair.set('a', 42);
  assert.equal(pair.object[0], 10);
  assert.equal(pair.object[1], 42);
  pair.object[0] = 100;
  assert.equal(pair.get('a'), 42);
  pair.object[1] = 200;
  assert.equal(pair.get('a'), 200);
});

test('отсутствующий последний дубликат не связывает ранний аргумент', () => {
  const pair = make([10], ['a', 'a']);
  assert.equal(pair.get('a'), undefined);
  pair.set('a', 42);
  assert.equal(pair.object[0], 10);
  pair.object[0] = 100;
  assert.equal(pair.get('a'), 42);
});

test('defineProperty с value обновляет параметр', () => {
  compare((pair) => {
    Object.defineProperty(pair.object, '0', { value: 42 });
    return [pair.get('a'), pair.object[0]];
  });
});

test('writable false без value сохраняет текущий параметр и разрывает связь', () => {
  compare((pair) => {
    pair.set('a', 42);
    Object.defineProperty(pair.object, '0', { writable: false });
    pair.set('a', 99);
    return [
      pair.object[0],
      pair.get('a'),
      Object.getOwnPropertyDescriptor(pair.object, '0').writable,
    ];
  });
});

test('value и writable false сначала обновляют параметр, затем разрывают связь', () => {
  compare((pair) => {
    Object.defineProperty(pair.object, '0', { value: 42, writable: false });
    const first = pair.get('a');
    pair.set('a', 99);
    return [first, pair.object[0], pair.get('a')];
  });
});

test('переход к accessor разрывает связь, не изменяя параметр', () => {
  compare((pair) => {
    Object.defineProperty(pair.object, '0', {
      get() {
        return 7;
      },
      configurable: true,
    });
    pair.set('a', 42);
    return [pair.object[0], pair.get('a')];
  });
});

test('изменение enumerable не разрывает связь', () => {
  compare((pair) => {
    Object.defineProperty(pair.object, '0', { enumerable: false });
    pair.set('a', 42);
    return [pair.object[0], Object.keys(pair.object)];
  });
});

test('delete и последующее создание индекса не восстанавливают связь', () => {
  compare((pair) => {
    assert.equal(Reflect.deleteProperty(pair.object, '0'), true);
    pair.object[0] = 42;
    return [pair.object[0], pair.get('a')];
  });
});

test('неуспешное удаление сохраняет связь', () => {
  compare((pair) => {
    Object.defineProperty(pair.object, '0', { configurable: false });
    const deleted = Reflect.deleteProperty(pair.object, '0');
    pair.set('a', 42);
    return [deleted, pair.object[0]];
  });
});

test('неуспешный defineProperty сохраняет связь и значение параметра', () => {
  compare((pair) => {
    Object.defineProperty(pair.object, '0', { configurable: false });
    const result = Reflect.defineProperty(pair.object, '0', {
      get() {
        return 99;
      },
    });
    pair.set('a', 42);
    return [result, pair.object[0], pair.get('a')];
  });
});

test('freeze сохраняет текущие значения и разрывает отображение', () => {
  compare((pair) => {
    pair.set('a', 42);
    Object.freeze(pair.object);
    pair.set('a', 99);
    return [pair.object[0], pair.get('a'), Object.isFrozen(pair.object)];
  });
});

test('seal и preventExtensions не разрывают отображение', () => {
  for (const operation of [Object.seal, Object.preventExtensions]) {
    compare((pair) => {
      operation(pair.object);
      pair.set('a', 42);
      pair.object[1] = 99;
      return [pair.object[0], pair.get('b'), Object.isExtensible(pair.object)];
    });
  }
});

test('Reflect.set с другим receiver не меняет исходный параметр', () => {
  compare((pair) => {
    const receiver = {};
    const success = Reflect.set(pair.object, '0', 42, receiver);
    return [success, receiver[0], pair.object[0], pair.get('a')];
  });
});

test('нестрогий callee доступен, строгие callee и caller запрещены по ES5', () => {
  const pair = make();
  assert.equal(pair.object.callee, pair.callee);
  assert.deepEqual(Object.getOwnPropertyDescriptor(pair.object, 'callee'), {
    value: pair.callee,
    writable: true,
    enumerable: false,
    configurable: true,
  });
  const strict = make([10], ['a'], true).object;
  for (const key of ['callee', 'caller']) {
    assert.throws(() => strict[key], TypeError);
    assert.throws(() => {
      strict[key] = 42;
    }, TypeError);
    const descriptor = Object.getOwnPropertyDescriptor(strict, key);
    assert.equal(descriptor.configurable, false);
    assert.equal(descriptor.enumerable, false);
    assert.equal(descriptor.get, descriptor.set);
  }
});

test('проверяет входные данные и сохраняет объектные аргументы по ссылке', () => {
  const original = { value: 10 };
  const pair = make([original], ['a']);
  original.value = 42;
  assert.equal(pair.object[0], original);
  assert.equal(pair.get('a').value, 42);
  const valid = {
    args: [],
    parameters: [],
    strict: false,
    parameterEnvironment: new LexicalEnvironment(),
    callee() {},
  };
  for (const override of [
    { args: null },
    { parameters: 'a' },
    { parameters: [null] },
    { parameters: new Array(1) },
    { strict: 0 },
    { parameterEnvironment: {} },
    { callee: 42 },
  ]) {
    assert.throws(
      () => createArgumentsObject({ ...valid, ...override }),
      TypeError,
    );
  }
});
