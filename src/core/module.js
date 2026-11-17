/* Re-export the public module contract for code inside the bundle. */

export { API_VERSION, defineModule, prefixMatcher, suffixMatcher } from "../../module.js";

/**
 * Whether a value is the shape the registry accepts. `defineModule` produces
 * this shape, but a caller may pass a plain object instead.
 * @param {unknown} value
 */
export function isModuleDefinition(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof value.id === "string" &&
    typeof value.setup === "function"
  );
}
