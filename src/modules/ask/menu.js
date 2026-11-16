/* Pure menu behavior for the settings pickers: filtering, active row, placement. */

/**
 * Headers are labels only; every other row can be selected.
 *
 * The picker keeps the same item shape for the model list (provider headers plus
 * models) and the effort list (plain rows), so the keyboard and filtering rules
 * do not branch on which field they serve.
 */
export function isSelectable(item) {
  return item !== null && typeof item === "object" && item.kind !== "header";
}

/**
 * Keep the rows matching a query and only the header that still has children.
 *
 * A model matches on its own name and on its provider name, so typing a provider
 * narrows the list to that group instead of hiding every row. A header is
 * emitted right before the first matching child, which keeps the original order
 * without a second pass.
 */
export function filterMenuItems(items, query) {
  if (!Array.isArray(items)) return [];
  const text = typeof query === "string" ? query.trim().toLowerCase() : "";
  if (text === "") return items.slice();
  const kept = [];
  let header = null;
  let headerKept = false;
  for (const item of items) {
    if (item === null || typeof item !== "object") continue;
    if (item.kind === "header") {
      header = item;
      headerKept = false;
      continue;
    }
    const haystack = `${String(item.label ?? "")}\u0000${String(item.group ?? "")}`.toLowerCase();
    if (!haystack.includes(text)) continue;
    if (header !== null && !headerKept) {
      kept.push(header);
      headerKept = true;
    }
    kept.push(item);
  }
  return kept;
}

/** First selectable row, or null when the list holds headers only. */
export function firstSelectableKey(items) {
  for (const item of items) {
    if (isSelectable(item)) return item.key;
  }
  return null;
}

/** Last selectable row, or null when the list holds headers only. */
export function lastSelectableKey(items) {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (isSelectable(items[index])) return items[index].key;
  }
  return null;
}

/**
 * Move the active row, clamping at both ends.
 *
 * Headers are skipped and the ends do not wrap, matching how a menu behaves
 * under a held arrow key. An active key that is no longer visible (the query
 * changed) restarts from the edge the movement came from.
 */
export function stepActiveKey(items, activeKey, delta) {
  if (!Array.isArray(items) || !Number.isFinite(delta) || delta === 0) return null;
  const selectable = items.filter(isSelectable);
  if (selectable.length === 0) return null;
  const current = selectable.findIndex((item) => item.key === activeKey);
  if (current < 0) {
    return delta > 0 ? selectable[0].key : selectable[selectable.length - 1].key;
  }
  const next = Math.min(selectable.length - 1, Math.max(0, current + delta));
  return selectable[next].key;
}

/**
 * Place a fixed panel next to its trigger inside the viewport.
 *
 * The menu opens below unless that side is too short and the upper side is
 * larger, in which case it anchors by its bottom edge. Width follows the trigger
 * but never drops below the readable minimum or leaves the viewport; height is
 * capped by the chosen side so the menu can scroll instead of running off
 * screen.
 */
export function placeMenu(anchor, viewport, options = {}) {
  const gap = options.gap ?? 4;
  const margin = options.margin ?? 8;
  const minWidth = options.minWidth ?? 240;
  const maxWidth = options.maxWidth ?? 360;
  const maxHeight = options.maxHeight ?? 360;
  const minSide = options.minSide ?? 160;
  if (!isRect(anchor) || !isViewport(viewport)) {
    return { left: margin, top: 0, width: minWidth, maxHeight };
  }
  const room = Math.max(0, viewport.width - margin * 2);
  const width = Math.max(1, Math.min(Math.max(anchor.width, minWidth), maxWidth, room));
  let left = anchor.left;
  if (left + width > viewport.width - margin) left = viewport.width - margin - width;
  if (left < margin) left = margin;

  const below = viewport.height - anchor.bottom - gap - margin;
  const above = anchor.top - gap - margin;
  const opensAbove = below < minSide && above > below;
  if (!opensAbove) {
    return {
      left,
      width,
      top: anchor.bottom + gap,
      maxHeight: Math.max(0, Math.min(maxHeight, below)),
    };
  }
  return {
    left,
    width,
    bottom: viewport.height - anchor.top + gap,
    maxHeight: Math.max(0, Math.min(maxHeight, above)),
  };
}

function isRect(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    Number.isFinite(value.left) &&
    Number.isFinite(value.top) &&
    Number.isFinite(value.bottom) &&
    Number.isFinite(value.width)
  );
}

function isViewport(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    Number.isFinite(value.width) &&
    Number.isFinite(value.height)
  );
}
