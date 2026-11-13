/* Route table and dispatch. */

import { createCommandsRoute } from "./commands.js";
import { createHistoryRoute } from "./history.js";
import { createSessionsRoute } from "./sessions.js";
import { createWorkspacesRoute } from "./workspaces.js";

/**
 * Build the route instances for one panel.
 *
 * Routes are matched by prefix, longest first; the sessions route owns the
 * empty prefix and therefore always closes the chain. Instances are created
 * per panel mount so route-local state (the workspaces token) resets when the
 * panel closes. The history prefix is a real query prefix rather than a hidden
 * mode, so the input always shows which list is active.
 */
export function createRoutes() {
  return [
    createWorkspacesRoute(),
    createCommandsRoute(),
    createHistoryRoute(),
    createSessionsRoute(),
  ].sort((left, right) => right.prefix.length - left.prefix.length);
}

/**
 * Build the active view for a query. The default route always claims it.
 *
 * The returned view also carries the claiming route's prefix. The dialog
 * republishes it so a command can tell which mode the open panel is in
 * without keeping a second copy of the route table.
 */
export function pickView(routes, query, ctx) {
  for (const route of routes) {
    if (!query.startsWith(route.prefix)) continue;
    const parsed = route.parse(query, ctx);
    if (parsed !== null) return { ...route.view(parsed, ctx), prefix: route.prefix };
  }
  throw new Error("quick-switcher: no route claimed the query");
}
