/* Host module contract: a declaration that contributes routes and listeners. */

const ID_PATTERN = /^[a-z][a-z0-9-]*$/u;

/**
 * Declare a host module.
 *
 * The setup runs once while the host plugin applies; it receives the host
 * capabilities and returns the exact routes, event listeners and teardown the
 * registry needs. Host modules are internal to this bundle: the public
 * `quickSwitcher` service covers the client only.
 *
 * @param {string} id
 * @param {(api: HostModuleApi) => HostModuleSpec} setup
 */
export function defineHostModule(id, setup) {
  if (typeof id !== "string" || !ID_PATTERN.test(id)) {
    throw new TypeError(
      `dsh-quick-switcher: host module id must match ${ID_PATTERN.source}, got ${JSON.stringify(id)}`,
    );
  }
  if (typeof setup !== "function") {
    throw new TypeError(`dsh-quick-switcher: host module "${id}" setup must be a function`);
  }
  return Object.freeze({ id, setup });
}

/**
 * @typedef {object} HostModuleApi
 * @property {string} id
 * @property {object} webServer
 * @property {object} agents
 * @property {object} llm
 * @property {object} sessionController
 * @property {(name: string, listener: Function, options?: object) => () => void} on
 * @property {(callback: () => unknown, label?: string) => () => void} effect
 * @property {{ info: Function, warn: Function, error: Function }} log
 */

/**
 * @typedef {object} HostModuleSpec
 * @property {Array<{ path: string, handler: Function }>} [routes]
 * @property {Array<{ name: string, handler: Function, options?: object }>} [listeners]
 * @property {() => void} [dispose]
 */

export function isHostModuleDefinition(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof value.id === "string" &&
    typeof value.setup === "function"
  );
}
