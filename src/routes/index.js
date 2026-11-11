/* Route table and dispatch. */

import { createSessionsRoute } from "./sessions.js";
import { createWorkspacesRoute } from "./workspaces.js";

/**
 * Build the route instances for one panel.
 *
 * Routes are matched by prefix, longest first; the sessions route owns the
 * empty prefix and therefore always closes the chain. Instances are created
 * per panel mount so route-local state (the workspaces token) resets when the
 * panel closes.
 */
export function createRoutes() {
  return [createWorkspacesRoute(), createSessionsRoute()].sort(
    (left, right) => right.prefix.length - left.prefix.length,
  );
}

/** Build the active view for a query. The default route always claims it. */
export function pickView(routes, query, ctx) {
  for (const route of routes) {
    if (!query.startsWith(route.prefix)) continue;
    const parsed = route.parse(query, ctx);
    if (parsed !== null) return route.view(parsed, ctx);
  }
  throw new Error("quick-switcher: no route claimed the query");
}
