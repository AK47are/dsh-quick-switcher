/* Switcher-local record of executed application commands. */

/**
 * The command list wants a "most recently used first" block, but DSH keeps no
 * such history for its shortcut registry. The plugin therefore owns one small
 * ordered list in `localStorage`. Only ids are stored, so a command that is
 * later unregistered simply disappears from the block instead of leaving a
 * stale label behind.
 *
 * The key is versioned: a future change to the value shape can move to a new
 * key instead of silently reinterpreting the old one.
 */
export const RECENT_STORAGE_KEY = "dsh-quick-switcher.recent-commands.v1";

/**
 * Commands kept on write and shown in the recent block. The panel is a quick
 * jump surface, not a history browser; a short list stays scannable and keeps
 * the empty query from hiding the alphabetical tail behind old entries.
 */
export const RECENT_LIMIT = 25;

/** localStorage without trusting the host: some shells deny or hide it. */
function resolveStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * Parse a persisted id list, dropping values the list cannot use.
 *
 * Corrupt JSON, foreign shapes, duplicates, and blank ids all collapse to an
 * empty or trimmed list rather than throwing: the command palette must keep
 * working on a profile whose storage was edited by hand or written by an older
 * plugin version.
 */
export function parseRecentCommands(raw) {
  if (typeof raw !== "string" || raw === "") return [];
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const seen = new Set();
  const ids = [];
  for (const value of parsed) {
    if (typeof value !== "string" || value === "") continue;
    if (seen.has(value)) continue;
    seen.add(value);
    ids.push(value);
    if (ids.length >= RECENT_LIMIT) break;
  }
  return ids;
}

/**
 * Move one command id to the front, dropping its previous position and the
 * oldest overflow. The function is pure so ordering tests do not need a
 * storage mock.
 */
export function pushRecentCommand(ids, id, limit = RECENT_LIMIT) {
  if (typeof id !== "string" || id === "") return [...ids];
  const next = [id];
  for (const value of ids) {
    if (value !== id) next.push(value);
  }
  return next.slice(0, Math.max(0, limit));
}

/** Read the persisted list, treating a denied storage as empty. */
function loadRecent(target) {
  try {
    return parseRecentCommands(target?.getItem?.(RECENT_STORAGE_KEY) ?? "");
  } catch {
    return [];
  }
}

/**
 * Build the recent-command store over a storage-like object.
 *
 * `read()` re-reads storage every time, so a command executed in another tab
 * or another panel generation appears on the next open. `record()` re-reads
 * before writing for the same reason; concurrent tabs stay last-writer-wins,
 * which is acceptable for a convenience ordering.
 */
export function createRecentCommands(storage) {
  const target = storage ?? resolveStorage();

  return {
    read: () => loadRecent(target),
    record(id) {
      const next = pushRecentCommand(loadRecent(target), id);
      try {
        target?.setItem?.(RECENT_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Only persistence is lost; this open already reflects the new order
        // in memory, and the next read falls back to whatever was last saved.
      }
      return next;
    },
  };
}
