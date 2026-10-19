/**
 * Читает имя из явно переданного внешнего окружения.
 *
 * Значение читается в момент обращения, без предварительного
 * копирования свойств или вызова всех геттеров окружения.
 *
 * @param {string} name
 * @param {object | Function} environment
 * @returns {unknown}
 */
export function readExternal(name, environment) {
  if (typeof name !== 'string' || name.length === 0) {
    throw new TypeError('External name must be a non-empty string');
  }

  if (
    environment === null ||
    (
      typeof environment !== 'object' &&
      typeof environment !== 'function'
    )
  ) {
    throw new TypeError('External environment must be an object or function');
  }

  if (!Reflect.has(environment, name)) {
    throw new ReferenceError(`${name} is not defined`);
  }

  return Reflect.get(environment, name);
}