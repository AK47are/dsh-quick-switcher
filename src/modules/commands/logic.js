/* Command projection, resolution and the live catalog store. */

/**
 * Turn one catalog row into the shape the search and row renderers need.
 *
 * The label is localized, but the aliases users type are usually English, so
 * the Latin spellings are shown under the name. Localized aliases stay
 * searchable but are not repeated under their own translation.
 */
function toEntry(row, isRecent) {
  const label = String(row.label ?? row.id);
  const aliases = Array.isArray(row.aliases)
    ? row.aliases.filter((value) => typeof value === "string" && value !== "")
    : [];
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
    keys: Array.isArray(row.keys) ? row.keys.filter((value) => typeof value === "string") : [],
    isRecent,
  };
}

/**
 * Order the command list: recently executed commands first in recency order,
 * then the remaining catalog by display name. Recent ids that no longer exist
 * are skipped rather than rendered as ghosts.
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
    (left, right) => left.title.localeCompare(right.title) || left.id.localeCompare(right.id),
  );
  return [...entries, ...rest];
}

/**
 * Resolve one command without inventing a second dispatch policy.
 *
 * The registry's own `invoke` silently drops blocked and missing commands,
 * which leaves the panel unable to explain a refusal. Calling `resolve`
 * directly returns that reason, and a thrown resolve is contained here so one
 * broken command cannot take the whole palette down.
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
        typeof result.reason === "string" && result.reason !== "" ? result.reason : null,
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
    element.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""]')
  ) {
    return "editable";
  }
  return "page";
}

/** Follow focus into open shadow roots, as DSH's native command path does. */
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
 * The context a command would have seen if the panel were not open.
 *
 * `target` is the element focused before the overlay mounted. `modal` is null
 * because the panel closes before the action runs, and `source` is "menu"
 * because the palette is a menu, matching the registry's own invoke path.
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

/**
 * Keep the command rows current while the panel is closed or open.
 *
 * The shortcut catalog and its config are DSH snapshot stores; the module
 * subscribes once at setup and republishes a plain snapshot that the matcher
 * reads. Recent ids are re-read on every rebuild so a command executed in
 * another tab appears on the next open.
 */
export function createCommandStore({ shortcuts, recent }) {
  let snapshot = { entries: [], loading: false };
  const listeners = new Set();

  function rebuild() {
    const catalog = shortcuts.catalog.getSnapshot();
    const config = shortcuts.config.getSnapshot();
    snapshot = {
      entries: buildCommandEntries(catalog, recent.read()),
      loading: config?.status === "loading",
    };
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch (error) {
        console.error("[dsh-quick-switcher] command store listener failed", error);
      }
    }
  }

  function start() {
    const offCatalog = shortcuts.catalog.subscribe(rebuild);
    const offConfig = shortcuts.config.subscribe(rebuild);
    rebuild();
    return () => {
      offCatalog?.();
      offConfig?.();
    };
  }

  return {
    start,
    refresh: rebuild,
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
