/* Main-panel projections for the "#" route. */

/**
 * A main panel is one full-page entry the sidebar's panel list opens. DSH
 * registers a navigation row in the `sidebar.panellist` list slot and the page
 * component in the layout's `main` keyed slot under the same id; the sidebar
 * derives its rows from that list and `ctx.layout.selectPanel(id)` selects one.
 *
 * The switcher reads the same list instead of naming panels. A panel shipped
 * by any plugin therefore joins the route without the switcher knowing it, and
 * unloading a plugin leaves no ghost row behind.
 *
 * The only two fields a registration exposes are the id and the label, so the
 * id doubles as the English search term: the label is localized and a Chinese
 * interface would otherwise leave English input with nothing to match.
 */

/** Root-scoped slot that declares the sidebar's panel entries. */
export const PANEL_SLOT = "sidebar.panellist";

/**
 * Pick a display string out of one slot label.
 *
 * DSH accepts a plain string, a function re-evaluated on locale changes, or a
 * language map. The function and the map are both resolved here because the
 * slot's own `resolveSlotLabel` helper lives in a client module this bundle
 * does not depend on, and the sidebar leans on the same three shapes.
 */
function localizedText(value, activeLocale) {
  if (typeof value === "string") return value.trim();
  if (value === null || typeof value !== "object" || Array.isArray(value)) return "";
  const ordered = [activeLocale, "zh", "en"];
  for (const language of ordered) {
    if (typeof language !== "string" || language === "") continue;
    const text = value[language];
    if (typeof text === "string" && text.trim() !== "") return text.trim();
  }
  for (const text of Object.values(value)) {
    if (typeof text === "string" && text.trim() !== "") return text.trim();
  }
  return "";
}

/** Resolve one registration's label, tolerating a throwing label function. */
export function resolvePanelLabel(label, activeLocale = "") {
  if (typeof label === "function") {
    try {
      return localizedText(label(), activeLocale);
    } catch {
      // A broken label belongs to the plugin that registered it. Falling back
      // to the id keeps that panel reachable and keeps the list rendering.
      return "";
    }
  }
  return localizedText(label, activeLocale);
}

/**
 * Project the panel registrations onto searchable entries.
 *
 * Ordering copies the sidebar exactly: ascending `order`, and registration
 * order for equal values, which the stable sort preserves. A panel with no
 * label falls back to its id so it stays visible and searchable. Duplicate ids
 * are collapsed because the layout can only hold one `main` entry per id, so a
 * second row would open the first one's page.
 */
export function collectPanelEntries(registrations, activeLocale = "") {
  const seen = new Set();
  const entries = [];
  for (const registration of Array.isArray(registrations) ? registrations : []) {
    const options = registration?.options ?? registration;
    if (options === null || typeof options !== "object") continue;
    const id = typeof options.id === "string" ? options.id.trim() : "";
    if (id === "" || seen.has(id)) continue;
    seen.add(id);

    const label = resolvePanelLabel(options.label, activeLocale);
    const title = label === "" ? id : label;
    const order =
      typeof options.order === "number" && Number.isFinite(options.order)
        ? options.order
        : 0;
    entries.push({
      id,
      order,
      title,
      titleLower: title.toLocaleLowerCase(),
      metaLower: id.toLocaleLowerCase(),
      // The row shows the id underneath the title. It is the searchable
      // English term, and it doubles as the marker that separates a panel row
      // from a session row, which shows a workspace and a time instead.
      idText: id === title ? "" : id,
    });
  }
  entries.sort((left, right) => left.order - right.order);
  return entries;
}

/** True when two entry lists describe the same rows in the same order. */
function sameEntries(left, right) {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index];
    const b = right[index];
    if (a.id !== b.id || a.title !== b.title || a.order !== b.order) return false;
  }
  return true;
}

/**
 * Hold the current panel entries in a subscribable snapshot.
 *
 * The overlay mounts long after the plugin and outlives every database change,
 * so the list is rebuilt on the two events that can change it: a registration
 * in the slot, and a locale switch that re-evaluates the label functions. The
 * equality check keeps unrelated dictionary registrations, which also notify
 * the locale service, from re-rendering an open panel.
 */
export function createPanelStore(evaluate) {
  let entries = [];
  const listeners = new Set();
  return {
    getSnapshot: () => entries,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    refresh() {
      const next = evaluate();
      if (sameEntries(entries, next)) return entries;
      entries = next;
      for (const listener of [...listeners]) listener();
      return entries;
    },
  };
}
