/* Switcher-local record of when each session was last shown in the main view. */

/**
 * DSH tracks what a session's content last did (`updatedAt`) but never when
 * the user last looked at it. The switcher wants the second value for its
 * empty-query order, so the plugin keeps its own map and treats DSH's
 * `updatedAt` as the fallback for sessions it has never observed.
 *
 * The map lives in `localStorage` under a versioned key: a future change to
 * the value shape can move to a new key and keep the old one intact instead
 * of silently reinterpreting it.
 */
export const ACCESS_STORAGE_KEY = "dsh-quick-switcher.access.v1";

/**
 * Newest entries kept on write. The map only needs enough history to explain
 * the visible list, so a long tail of deleted sessions is pruned rather than
 * grown forever.
 */
export const ACCESS_ENTRY_LIMIT = 500;

/** localStorage without trusting the host: some shells deny or hide it. */
function resolveStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** Parse the persisted object, dropping values the sorter cannot use. */
function parseTimes(raw) {
  if (typeof raw !== "string" || raw === "") return new Map();
  try {
    const parsed = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return new Map();
    }
    const times = new Map();
    for (const [id, value] of Object.entries(parsed)) {
      if (typeof value === "number" && Number.isFinite(value) && value > 0) {
        times.set(id, value);
      }
    }
    return times;
  } catch {
    // A corrupt entry must not take the panel down; an empty map simply
    // falls back to `updatedAt` until the next successful write replaces it.
    return new Map();
  }
}

/** Keep the newest entries only; the sorter reads the map, not the order. */
function prune(times) {
  if (times.size <= ACCESS_ENTRY_LIMIT) return times;
  const newest = [...times.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, ACCESS_ENTRY_LIMIT);
  return new Map(newest);
}

/** Read the persisted map, treating a denied storage as empty. */
function loadTimes(target) {
  try {
    return parseTimes(target?.getItem?.(ACCESS_STORAGE_KEY) ?? "");
  } catch {
    return new Map();
  }
}

/** Persist the map; the in-memory copy still serves this run on failure. */
function writeTimes(target, times) {
  try {
    target?.setItem?.(ACCESS_STORAGE_KEY, JSON.stringify(Object.fromEntries(times)));
  } catch {
    // Only persistence is lost; sorting keeps the in-memory map.
  }
}

/**
 * Build one access map over a storage-like object.
 *
 * The store is immutable from the caller's view: `getSnapshot` returns the
 * current map and `record` replaces it, so a consumer that reads once (the
 * panel at mount) never sees a map mutate under it. Storage failures are
 * swallowed on purpose: sorting can always fall back to `updatedAt`, and a
 * read-only browser profile must not break session switching.
 */
export function createAccessStore(storage) {
  const target = storage ?? resolveStorage();
  let times = loadTimes(target);

  return {
    getSnapshot: () => times,
    record(id, now) {
      if (typeof id !== "string" || id === "") return times;
      if (!Number.isFinite(now) || now <= 0) return times;
      // Another page may have written since this store loaded; merge before
      // overwriting so parallel windows keep each other's visits.
      const merged = loadTimes(target);
      for (const [key, value] of times) {
        if (value > (merged.get(key) ?? 0)) merged.set(key, value);
      }
      if ((merged.get(id) ?? 0) >= now) {
        times = merged;
        return times;
      }
      merged.set(id, now);
      times = prune(merged);
      writeTimes(target, times);
      return times;
    },
  };
}

let singleton = null;

/** Lazily share one map between the recorder and the panel. */
export function getAccessStore() {
  if (singleton === null) singleton = createAccessStore();
  return singleton;
}
