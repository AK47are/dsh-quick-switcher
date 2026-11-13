/* Route table and dispatch. */

import { createCommandsRoute } from "./commands.js";
import { createFilesRoute } from "./files.js";
import { createSessionsRoute } from "./sessions.js";
import { createWorkspacesRoute } from "./workspaces.js";

/**
 * Build the route instances for one panel.
 *
 * Routes are matched by prefix, longest first; the sessions route owns the
 * empty prefix and therefore always closes the chain. Instances are created
 * per panel mount so route-local state (the workspaces token, the file query
 * cache) resets when the panel closes.
 *
 * `notify` is how an asynchronous route asks the shell for one more render:
 * the files route settles Host search results after the synchronous view has
 * already been projected. The shell owns the render; routes only request it.
 */
export function createRoutes({ notify } = {}) {
  return [
    createWorkspacesRoute(),
    createFilesRoute({ notify }),
    createCommandsRoute(),
    createSessionsRoute(),
  ].sort((left, right) => right.prefix.length - left.prefix.length);
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
