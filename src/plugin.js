/* Plugin face: build the panel body from the static module manifest. */

import { createBody } from "./core/body.js";
import { clientModules } from "./modules/client-manifest.js";

export const inject = [
  "slots",
  "locale",
  "shortcuts",
  "sessions",
  "uiWorkspace",
  "layout",
];

export function apply(ctx) {
  createBody({ ctx, modules: clientModules });
}

export default { name: "dsh-quick-switcher", inject, apply };
