/* File module: "@" searches the current session's workspace files. */

import { defineModule } from "../../core/module.js";
import { fuzzyMatch } from "../../core/lib/search.js";
import { locale } from "./locale.js";
import { fileAddress, splitFilePath } from "./path.js";
import { focusSidebarPane } from "./rightbar.js";

/** A panel search runs on every keystroke; the Host index only needs the settled text. */
const DEBOUNCE_MS = 120;

/** Results are cheap to rebuild but the map would otherwise grow with every keystroke. */
const CACHE_LIMIT = 60;

function cacheKey(sessionId, filter) {
  return `${sessionId}\u0000${filter}`;
}

function trimCache(cache) {
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) return;
    cache.delete(oldest);
  }
}

export default defineModule("files", (api) => {
  /**
   * Ask the Host for one page of candidates.
   *
   * The service is read by name on every call instead of being injected: a
   * profile without it then loses only the file mode's results, not the whole
   * switcher.
   */
  async function search(sessionId, query, signal) {
    const references = api.get("remote.fileReferences");
    if (references === undefined) {
      console.error("[dsh-quick-switcher] file reference Remote is unavailable");
      return { ok: false, reason: "fileReferences" };
    }
    try {
      const result = await references.list(sessionId, query, signal);
      if (signal?.aborted === true) return { ok: false };
      if (result?.ok === true) {
        return { ok: true, items: result.value ?? [] };
      }
      console.error("[dsh-quick-switcher] file search failed", result?.error);
      const code = result?.error?.code;
      const message = result?.error?.message;
      return {
        ok: false,
        reason: `${String(code ?? "rpc")}: ${String(message ?? "")}`.slice(0, 160),
      };
    } catch (error) {
      console.error("[dsh-quick-switcher] file search threw", error);
      return { ok: false, reason: String(error?.message ?? error).slice(0, 160) };
    }
  }

  function open(sessionId, path) {
    const sidebarRight = api.get("sidebarRight");
    if (sidebarRight === undefined) {
      throw new Error("dsh-quick-switcher: the right Sidebar is unavailable");
    }
    sidebarRight.openResource(fileAddress(sessionId, path));
  }

  return {
    apiVersion: 1,
    order: 50,
    labelKey: "filesTitle",
    locale,
    mount(panel) {
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
        panel.notify();
      }

      /**
       * Start the Host search for one query, unless it already settled or is
       * already in flight. A newer query aborts the older one so a slow index
       * build never lands after the caret has moved on.
       */
      function ensure(state) {
        if (state.sessionId === null) return;
        const key = cacheKey(state.sessionId, state.filter);
        if (cache.has(key)) return;
        if (pending !== null && pending.key === key) return;
        cancelPending();
        if (api.get("remote.fileReferences") === undefined) {
          cache.set(key, { status: "error", reason: "search" });
          panel.notify();
          return;
        }
        const controller = new AbortController();
        const timer = setTimeout(() => {
          if (controller.signal.aborted) return;
          Promise.resolve()
            .then(() => search(state.sessionId, state.filter, controller.signal))
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
        }, DEBOUNCE_MS);
        pending = { key, controller, timer };
      }

      function openCandidate(sessionId, path) {
        try {
          open(sessionId, path);
          return true;
        } catch (error) {
          console.error("[dsh-quick-switcher] file open failed", error);
          panel.setError(api.t("fileOpenFailed"));
          return false;
        }
      }

      /**
       * Project one candidate to a row.
       *
       * Directory rows only append a slash to the query, so they share Enter
       * and Shift+Enter. File rows open the preview: Enter leaves the caret
       * where the panel found it, Shift+Enter moves it into the preview.
       * Highlight positions index the raw name, and the title may carry a
       * trailing slash, so the highlight stays valid for both kinds.
       */
      function fileRow(candidate, filter, sessionId) {
        const path = String(candidate.path ?? "");
        const { directory, name } = splitFilePath(path);
        const isDirectory = candidate.kind === "directory";
        const matched =
          filter.includes("/") || filter.trim() === "" ? null : fuzzyMatch(name, filter);
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
          row.run = () => panel.setQuery(`@${path}/`);
          row.shiftRun = row.run;
          return row;
        }
        row.run = () => {
          if (!openCandidate(sessionId, path)) return;
          panel.close();
        };
        row.shiftRun = () => {
          if (!openCandidate(sessionId, path)) return;
          // Skipping focus restoration keeps the panel from yanking the caret
          // back to the composer while the Sidebar column is opening.
          panel.close({ restoreFocus: false });
          focusSidebarPane(globalThis.document, sessionId);
        };
        return row;
      }

      function view(state) {
        const key = state.sessionId === null ? null : cacheKey(state.sessionId, state.filter);
        const entry = key === null ? undefined : cache.get(key);
        const items = entry?.status === "ready" ? entry.items : [];
        const rows = items.map((candidate) => fileRow(candidate, state.filter, state.sessionId));

        let emptyText = null;
        if (state.sessionId === null) emptyText = api.t("filesNoSession");
        else if (entry === undefined) emptyText = api.t("filesLoading");
        else if (entry.status === "error") {
          emptyText = entry.reason
            ? api.t("filesFailedWithReason", { reason: entry.reason })
            : api.t("filesFailed");
        } else if (rows.length === 0) emptyText = api.t("filesEmpty");

        return {
          placeholder: api.t("placeholderFiles"),
          searchAria: api.t("searchAriaFiles"),
          listLabel: api.t("listLabelFiles"),
          rows,
          emptyText,
          note: null,
          hints: [
            { keys: ["Enter"], label: api.t("hintFilesOpen") },
            { keys: ["Shift+Enter"], label: api.t("hintFilesPreview") },
            { keys: ["Esc"], label: api.t("hintClose") },
          ],
          count:
            entry?.status === "ready" ? api.t("countFiles", { count: rows.length }) : "",
          load() {
            ensure(state);
          },
        };
      }

      return {
        matchers: [
          {
            id: "files",
            priority: 10,
            match(query, context) {
              return query.startsWith("@")
                ? { filter: query.slice(1), sessionId: context.currentSessionId }
                : null;
            },
            view,
          },
        ],
        dispose() {
          cancelPending();
          cache.clear();
        },
      };
    },
  };
});
