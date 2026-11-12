/* Application commands for the ">" route. */

/**
 * A command row is a projection of the DSH shortcut catalog. The catalog owns
 * labels, aliases, effective keycaps, and the resolve/run pair; this module
 * only decides display order and hands one command back to the panel.
 */

/** Turn one catalog row into the shape the search and row renderers need. */
function toEntry(row, isRecent) {
  const label = String(row.label ?? row.id);
  const aliases = Array.isArray(row.aliases)
    ? row.aliases.filter((value) => typeof value === "string" && value !== "")
    : [];

  // The label is localized, but the aliases users type are usually English.
  // Show the Latin spellings under the name so a Chinese label still explains
  // what to search for. Localized aliases stay searchable but are not repeated
  // under their own translation.
  const labelKey = label.toLocaleLowerCase();
  const seen = new Set();
  const visibleAliases = [];
  for (const alias of aliases) {
    if (!/[A-Za-z]/u.test(alias)) continue;
    const key = alias.toLocaleLowerCase();
    if (key === labelKey || seen.has(key)) continue;
    seen.add(key);
    visibleAliases.push(alias);
  }

  return {
    id: row.id,
    label,
    title: label,
    titleLower: labelKey,
    metaLower: aliases.join(" ").toLocaleLowerCase(),
    aliases,
    aliasesText: visibleAliases.join(" · "),
    keys: Array.isArray(row.keys)
      ? row.keys.filter((value) => typeof value === "string")
      : [],
    isRecent,
  };
}

/**
 * Order the command list: recently executed commands first in recency order,
 * then the remaining catalog by display name.
 *
 * Recent ids that no longer exist in the catalog are skipped rather than
 * rendered as ghosts; the alphabetical tail keeps the list complete while a
 * plugin is unloading. Name order is the same tie-break the "编辑快捷键" list
 * uses, so both surfaces describe the same set in the same sequence.
 */
export function buildCommandEntries(catalog, recentIds = []) {
  const byId = new Map();
  for (const row of Array.isArray(catalog) ? catalog : []) {
    if (row === null || typeof row !== "object") continue;
    if (typeof row.id !== "string" || row.id === "") continue;
    byId.set(row.id, row);
  }

  const seen = new Set();
  const entries = [];
  for (const id of Array.isArray(recentIds) ? recentIds : []) {
    if (seen.has(id)) continue;
    const row = byId.get(id);
    if (row === undefined) continue;
    seen.add(id);
    entries.push(toEntry(row, true));
  }

  const rest = [];
  for (const [id, row] of byId) {
    if (seen.has(id)) continue;
    rest.push(toEntry(row, false));
  }
  rest.sort(
    (left, right) =>
      left.title.localeCompare(right.title) || left.id.localeCompare(right.id),
  );
  return [...entries, ...rest];
}

/**
 * Resolve one command without inventing a second dispatch policy.
 *
 * The registry's own `invoke` silently drops blocked and missing commands,
 * which is fine for a native menu that already checked availability but leaves
 * the panel unable to explain a refusal. Calling the command's `resolve`
 * directly returns that reason, and the panel keeps the overlay open until it
 * has one. A thrown resolve is contained here so one broken command cannot take
 * the whole palette down.
 */
export function resolveCommand(registry, id, context) {
  const command = registry?.commands?.get?.(id);
  if (command === undefined || typeof command.resolve !== "function") {
    return { status: "missing" };
  }

  let result;
  try {
    result = command.resolve(context);
  } catch (error) {
    return { status: "failed", error };
  }

  if (result?.status === "handled" && typeof result.run === "function") {
    return { status: "handled", run: result.run };
  }
  if (result?.status === "blocked") {
    return {
      status: "blocked",
      reason:
        typeof result.reason === "string" && result.reason !== ""
          ? result.reason
          : null,
    };
  }
  return { status: "pass" };
}

/** Mirror DSH's own keyboard region classification for one focused element. */
export function commandRegion(element) {
  if (element === null || element === undefined) return "page";
  if (typeof element.closest !== "function") return "page";
  if (element.closest(".xterm")) return "terminal";
  if (
    element.closest(
      'input, textarea, select, [contenteditable="true"], [contenteditable=""]',
    )
  ) {
    return "editable";
  }
  return "page";
}

/**
 * Follow focus into open shadow roots, as DSH's native command path does.
 *
 * The document's activeElement is the shadow host when focus lives inside one;
 * commands that inspect the focused pane need the inner element to find their
 * target. A browser webview is a boundary rather than a container, so focus
 * stops at it.
 */
function focusedWithin(element) {
  let target = element;
  while (
    target?.shadowRoot?.activeElement != null &&
    target.matches?.("webview[data-sidebar-browser-frame]") !== true
  ) {
    target = target.shadowRoot.activeElement;
  }
  return target;
}

/**
 * The context a command would have seen if the palette were not open.
 *
 * `target` is the element focused before the overlay mounted. Commands such as
 * splitting the right sidebar or closing its focused page read that element;
 * leaving the palette input as the target would make them act on the panel
 * itself. `modal` is null because the panel closes before the action runs, and
 * `source` is "menu" because the palette is a menu, matching the registry's
 * own invoke path.
 */
export function commandContext(target) {
  const focused = focusedWithin(target);
  return {
    target: focused ?? undefined,
    region: commandRegion(focused),
    modal: null,
    source: "menu",
  };
}
