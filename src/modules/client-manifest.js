/* Static module list for the client bundle. Order is descriptive; `order` on
 * each module decides matching and provider nesting. */

import commands from "./commands/client.js";
import files from "./files/client.js";
import panels from "./panels/client.js";
import sessions from "./sessions/client.js";
import workspaces from "./workspaces/client.js";

export const clientModules = [sessions, workspaces, commands, panels, files];
