/* "@" route: search the current session's workspace files and open them beside it. */

import { splitFilePath } from "../data/files.js";
import { fuzzyMatch } from "../data/search.js";

/** A panel search runs on every keystroke; the Host index only needs the settled text. */
const DEBOUNCE_MS = 120;

/** Results are cheap to rebuild but the map would otherwise grow with every keystroke. */
const CACHE_LIMIT = 60;

function cacheKey(sessionId, filter) {
  return `${sessionId}\u0000${filter}`;
}

/** Drop the oldest settled queries once the cache outgrows its budget. */
function trimCache(cache) {
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) return;
    cache.delete(oldest);
  }
}

function noop() {}

/**
 * Build the "@" route.
 *
 * The Host search is asynchronous, while a route's `view` is a synchronous
 * projection. The route keeps a small per-panel cache and exposes one `load`
 * the shell calls after render; when a result settles it calls `notify` so the
 * panel rebuilds the view from the cache. Nothing here touches DSH directly:
 * the shell supplies the search and the open action through `ctx.files`.
 *
 * `debounceMs` is injectable so tests can settle a query without waiting on a
 * wall clock.
 */
export function createFilesRoute({ notify = noop, debounceMs = DEBOUNCE_MS } = {}) {
  /** Settled queries, keyed by session and filter text. */
  const cache = new Map();
  /** The one query currently waiting or in flight. */
  let pending = null;

  function cancelPending() {
    if (pending === null) return;
    clearTimeout(pending.timer);
    pending.controller.abort();
    pending = null;
  }

  function settle(key, entry) {
    cache.set(key, entry);
    trimCache(cache);
    pending = null;
    notify();
  }

  /**
   * Start the Host search for one query, unless it already settled or is
   * already in flight. A newer query aborts the older one so a slow index
   * build never lands after the caret has moved on.
   */
  function ensure(parsed, ctx) {
    if (parsed.sessionId === null) return;
    const key = cacheKey(parsed.sessionId, parsed.filter);
    if (cache.has(key)) return;
    if (pending !== null && pending.key === key) return;
    cancelPending();
    if (typeof ctx.files?.search !== "function") {
      cache.set(key, { status: "error", reason: "search" });
      notify();
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      if (controller.signal.aborted) return;
      Promise.resolve()
        .then(() =>
          ctx.files.search(parsed.sessionId, parsed.filter, controller.signal),
        )
        .then((result) => {
          if (controller.signal.aborted) return;
          settle(
            key,
            result?.ok === true
              ? { status: "ready", items: result.items ?? [] }
              : { status: "error", reason: result?.reason ?? null },
          );
        })
        .catch((error) => {
          if (controller.signal.aborted) return;
          settle(key, {
            status: "error",
            reason: String(error?.message ?? error).slice(0, 160),
          });
        });
    }, debounceMs);
    pending = { key, controller, timer };
  }

  /**
   * Project one candidate to a row.
   *
   * Directory rows only append a slash to the query, so they share the Enter
   * and Shift+Enter behavior. File rows open the preview: Enter leaves the
   * caret where the panel found it, Shift+Enter moves it into the preview.
   * Highlight positions index the raw name, and the title may carry a trailing
   * slash, so the highlight stays valid for both kinds.
   */
  function fileRow(candidate, filter) {
    const path = String(candidate.path ?? "");
    const { directory, name } = splitFilePath(path);
    const isDirectory = candidate.kind === "directory";
    const matched =
      filter.includes("/") || filter.trim() === ""
        ? null
        : fuzzyMatch(name, filter);
    const row = {
      key: `${isDirectory ? "d" : "f"}:${path}`,
      title: isDirectory ? `${name}/` : name,
      positions: matched === null ? null : new Set(matched.positions),
      meta: [
        {
          text: directory === "" ? "./" : directory,
          className: "dqs-file-directory",
        },
      ],
      className: isDirectory ? "dqs-file-row dqs-file-dir" : "dqs-file-row",
    };
    if (isDirectory) {
      row.run = () => ({ type: "query", query: `@${path}/` });
      row.shiftRun = row.run;
      return row;
    }
    row.run = () => ({ type: "file", path, focus: "previous" });
    row.shiftRun = () => ({ type: "file", path, focus: "preview" });
    return row;
  }

  return {
    id: "files",
    prefix: "@",
    parse(query, ctx) {
      if (!query.startsWith("@")) return null;
      return {
        filter: query.slice(1),
        sessionId: ctx.currentId ?? null,
      };
    },
    view(parsed, ctx) {
      const t = ctx.t;
      const key =
        parsed.sessionId === null
          ? null
          : cacheKey(parsed.sessionId, parsed.filter);
      const entry = key === null ? undefined : cache.get(key);
      const items = entry?.status === "ready" ? entry.items : [];
      const rows = items.map((candidate) => fileRow(candidate, parsed.filter));

      let emptyText = null;
      if (parsed.sessionId === null) emptyText = t("filesNoSession");
      else if (entry === undefined) emptyText = t("filesLoading");
      else if (entry.status === "error") {
        emptyText = entry.reason
          ? t("filesFailedWithReason", { reason: entry.reason })
          : t("filesFailed");
      } else if (rows.length === 0) emptyText = t("filesEmpty");

      return {
        placeholder: t("placeholderFiles"),
        searchAria: t("searchAriaFiles"),
        listLabel: t("listLabelFiles"),
        rows,
        emptyText,
        note: null,
        hints: [
          { keys: ["Enter"], label: t("hintFilesOpen") },
          { keys: ["Shift+Enter"], label: t("hintFilesPreview") },
          { keys: ["Esc"], label: t("hintClose") },
        ],
        count:
          entry?.status === "ready" ? t("countFiles", { count: rows.length }) : "",
        load() {
          ensure(parsed, ctx);
        },
      };
    },
    /** Abort the in-flight query when the panel unmounts. */
    dispose() {
      cancelPending();
      cache.clear();
    },
  };
}
