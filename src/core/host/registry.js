/* Host registry: turns host module declarations into web routes and listeners. */

import { isHostModuleDefinition } from "./module.js";

/**
 * @param {object} deps
 * @param {object} deps.ctx host context with webServer, agents, llm, sessionController and on
 * @param {object} [deps.log]
 */
export function createHostRegistry({ ctx, log = console }) {
  const disposers = [];
  let disposed = false;

  function keep(value) {
    if (typeof value === "function") disposers.push(value);
  }

  function apply(definitions) {
    for (const definition of definitions) {
      if (!isHostModuleDefinition(definition)) {
        log.error("[dsh-quick-switcher] registerHostModule needs a { id, setup } definition");
        continue;
      }
      const id = definition.id;
      const api = {
        id,
        webServer: ctx.webServer,
        agents: ctx.agents,
        llm: ctx.llm,
        sessionController: ctx.sessionController,
        on: (name, listener, options) => ctx.on(name, listener, options),
        effect: (callback, label) => ctx.effect(callback, label ?? `quick-switcher: host ${id}`),
        log: {
          info: (...args) => log.info?.(`[dsh-quick-switcher:host:${id}]`, ...args),
          warn: (...args) => log.warn?.(`[dsh-quick-switcher:host:${id}]`, ...args),
          error: (...args) => log.error?.(`[dsh-quick-switcher:host:${id}]`, ...args),
        },
      };

      let spec;
      try {
        spec = definition.setup(api);
      } catch (error) {
        log.error(`[dsh-quick-switcher] host module "${id}" setup failed`, error);
        continue;
      }
      if (spec === null || typeof spec !== "object") {
        log.error(`[dsh-quick-switcher] host module "${id}" setup must return an object`);
        continue;
      }

      try {
        for (const route of Array.isArray(spec.routes) ? spec.routes : []) {
          keep(
            ctx.effect(
              () =>
                ctx.webServer.register({
                  kind: "exact",
                  path: route.path,
                  handler: route.handler,
                }),
              `quick-switcher: ${id} route ${route.path}`,
            ),
          );
        }
        for (const listener of Array.isArray(spec.listeners) ? spec.listeners : []) {
          keep(
            ctx.effect(
              () => ctx.on(listener.name, listener.handler, listener.options ?? { global: true }),
              `quick-switcher: ${id} event ${listener.name}`,
            ),
          );
        }
        if (typeof spec.dispose === "function") disposers.push(spec.dispose);
      } catch (error) {
        log.error(`[dsh-quick-switcher] host module "${id}" failed to register`, error);
      }
    }
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const dispose of [...disposers].reverse()) {
      try {
        dispose();
      } catch (error) {
        log.error("[dsh-quick-switcher] host module cleanup failed", error);
      }
    }
    disposers.length = 0;
  }

  return { apply, dispose };
}
