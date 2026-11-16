/**
 * Host entry of the quick switcher.
 *
 * The host half is one module today (the side-question routes and their live
 * event state), so this file only builds the registry and hands it the static
 * list. Host contributions stay internal: the public `quickSwitcher` service
 * covers the client half only.
 */

import { createHostRegistry } from "./src/core/host/registry.js";
import { hostModules } from "./src/modules/host-manifest.js";

export const name = "dsh-quick-switcher";
export const inject = ["webServer", "agents", "llm", "sessionController"];

export function apply(ctx) {
  const registry = createHostRegistry({ ctx });
  registry.apply(hostModules);
  ctx.effect(() => () => registry.dispose(), "quick-switcher: host modules");
}
