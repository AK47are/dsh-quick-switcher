/* Route table and dispatch. */

import { createAskRoute } from "./ask.js";
import { createCommandsRoute } from "./commands.js";
import { createFilesRoute } from "./files.js";
import { createHistoryRoute } from "./history.js";
import { createPanelsRoute } from "./panels.js";
import { createSessionsRoute } from "./sessions.js";
import { createWorkspacesRoute } from "./workspaces.js";

/**
 * Build the route instances for one panel.
 *
 * Routes are matched by prefix, longest first; the sessions route owns the
 * empty prefix and therefore always closes the chain. Instances are created
 * per panel mount so route-local state (the workspaces token, the file query
 * cache, the side-question detail) resets when the panel closes. Every prefix
 * is a real query prefix rather than a hidden mode, so the input always shows
 * which list is active.
 *
 * `notify` is how an asynchronous route asks the shell for one more render:
 * the files route settles Host search results after the synchronous view has
 * already been projected, and the side-question route follows a streaming
 * answer. The shell owns the render; routes only request it.
 *
 * `store` is the side-question record store. It is optional so a route table
 * can be built without one (the tests do), but a missing store only disables
 * `?`; every other route keeps working.
 */
export function createRoutes({ notify, store } = {}) {
  return [
    createWorkspacesRoute(),
    createFilesRoute({ notify }),
    createCommandsRoute(),
    createHistoryRoute(),
    createPanelsRoute(),
    createAskRoute({ notify, store }),
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
