// glassbox/src/formatValue.js

/**
 * Render a heap object as the short text shown inside its box.
 * @param {{type: string, value: unknown}} obj
 * @returns {string}
 */
export function formatValue(obj) {
  switch (obj.type) {
    case "int":
      return String(obj.value);
    case "str":
      return `"${obj.value}"`;
    case "list":
      return `[${obj.value.join(", ")}]`;
    default:
      return String(obj.value);
  }
}
