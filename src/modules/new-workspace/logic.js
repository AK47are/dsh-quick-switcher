/**
 * New-workspace mode: path parsing, directory loading, and row building.
 *
 * The client cannot ask DSH for an arbitrary directory listing on this host
 * (the native picker is composed, so `uiWorkspace.listDirectory` is refused),
 * so this module owns a small cache over the plugin's host route. A view only
 * ever lists one directory: the parent of the typed segment, or the typed
 * directory itself when the text ends with a separator.
 */
import {
  isRootPath,
  normalizeForCompare,
  withTrailingSeparator,
} from "../../core/lib/paths.js";
import { RESULT_LIMIT, fuzzyMatch } from "../../core/lib/search.js";
import { parseCreateQuery } from "./path.js";
import { LIST_PATH, MAX_ENTRIES, MKDIR_PATH } from "./shared.js";

/** One panel search runs on every keystroke; the host only sees the settled directory. */
const DEBOUNCE_MS = 120;

/** Directories are cheap to list but the cache would otherwise grow with every drill. */
const CACHE_LIMIT = 40;

/** Prefix hits outrank every fuzzy score, so the two groups never interleave. */
const PREFIX_SCORE = 2_000_000;

/**
 * @param {object} options
 * @param {object} options.api module API
 * @param {object} options.panel panel context
 * @param {(path: string, init?: object) => Promise<Response>} options.request fetch-like transport
 * @param {string|null} options.startDir current workspace path when one is open
 * @param {"win32"|"posix"} options.style path grammar guessed before the first response
 */
export function createNewWorkspaceRuntime({
  api,
  panel,
  request,
  startDir = null,
  style = "posix",
}) {
  const runtime = {
    startDir: typeof startDir === "string" && startDir !== "" ? startDir : null,
    style: style === "win32" ? "win32" : "posix",
    seeded: false,
    seeding: false,
  };
  const cache = new Map();
  let pending = null;
  let disposed = false;

  const listService = api.get("workspaces")?.list;
  const unsubscribe =
    listService !== null && typeof listService?.subscribe === "function"
      ? listService.subscribe(() => panel.notify())
      : null;

  /** Snapshot of DSH's workspace rows; a missing service reads as an empty list. */
  function workspaceItems() {
    const list = api.get("workspaces")?.list;
    const snapshot = typeof list?.getSnapshot === "function" ? list.getSnapshot() : null;
    return Array.isArray(snapshot?.items) ? snapshot.items : [];
  }

  /** The workspace the current session belongs to, if any. */
  function currentWorkspacePath() {
    const sessionId = panel.currentSessionId;
    if (typeof sessionId !== "string" || sessionId === "") return null;
    for (const item of workspaceItems()) {
      if (!Array.isArray(item?.sessionIds) || !item.sessionIds.includes(sessionId)) continue;
      return typeof item.path === "string" && item.path !== "" ? item.path : null;
    }
    return null;
  }

  function findWorkspace(path) {
    const target = normalizeForCompare(path, runtime.style);
    if (target === "") return null;
    for (const item of workspaceItems()) {
      if (typeof item?.path !== "string") continue;
      if (normalizeForCompare(item.path, runtime.style) === target) return item;
    }
    return null;
  }

  function cacheKey(directory) {
    return `${runtime.style}\u0000${normalizeForCompare(directory, runtime.style)}`;
  }

  function trimCache() {
    while (cache.size > CACHE_LIMIT) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) return;
      cache.delete(oldest);
    }
  }

  function cancelPending() {
    if (pending === null) return;
    clearTimeout(pending.timer);
    pending.controller.abort();
    pending = null;
  }

  /** One same-origin JSON call; every host answer is `{ ok, ... }`. */
  async function callJson(path, init) {
    const response = await request(path, init);
    let body = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    if (body !== null && typeof body === "object") {
      if (body.ok === undefined && typeof body.error === "string") {
        return { ok: false, code: "request", message: body.error };
      }
      return body;
    }
    const status = typeof response?.status === "number" ? response.status : 0;
    return {
      ok: false,
      code: "io",
      message: status === 0 ? "invalid response" : `HTTP ${status}`,
    };
  }

  function settle(key, body) {
    pending = null;
    if (body?.ok === true) {
      if (typeof body.platform === "string") {
        runtime.style = body.platform === "win32" ? "win32" : "posix";
      }
      cache.set(key, {
        status: "ready",
        path: typeof body.path === "string" ? body.path : "",
        entries: Array.isArray(body.entries) ? body.entries : [],
        truncated: body.truncated === true,
      });
    } else {
      cache.set(key, {
        status: "error",
        code: typeof body?.code === "string" ? body.code : "io",
        message: typeof body?.message === "string" ? body.message : "",
      });
    }
    trimCache();
    panel.notify();
  }

  /**
   * Start the Host listing for one directory unless it already settled or is in
   * flight. Typing inside a segment never refetches, because the directory part
   * stays the same.
   */
  function ensure(directory) {
    if (disposed) return;
    const key = cacheKey(directory);
    if (cache.has(key)) return;
    if (pending !== null && pending.key === key) return;
    cancelPending();
    const controller = new AbortController();
    const timer = setTimeout(() => {
      if (controller.signal.aborted) return;
      callJson(`${LIST_PATH}?path=${encodeURIComponent(directory)}`, {
        signal: controller.signal,
      })
        .then((body) => {
          if (controller.signal.aborted) return;
          settle(key, body);
        })
        .catch((error) => {
          if (controller.signal.aborted) return;
          settle(key, { ok: false, code: "io", message: messageOf(error) });
        });
    }, DEBOUNCE_MS);
    pending = { key, controller, timer };
  }

  /**
   * The entry seed is static, so a bare "=" is completed on the first frame.
   *
   * The current workspace path is known synchronously; without one, the Host
   * answers with the home directory, which also teaches the path grammar.
   */
  function seed() {
    if (disposed || runtime.seeded || runtime.seeding) return;
    const known =
      runtime.startDir ?? (typeof panel.currentSessionId === "string" ? currentWorkspacePath() : null);
    if (known !== null) {
      runtime.startDir = known;
      runtime.seeded = true;
      panel.setQuery(`=${withTrailingSeparator(known)}`);
      return;
    }
    runtime.seeding = true;
    callJson(`${LIST_PATH}?path=`, {})
      .then((body) => {
        runtime.seeding = false;
        if (disposed) return;
        const home =
          typeof body?.home === "string" && body.home !== ""
            ? body.home
            : typeof body?.path === "string"
              ? body.path
              : "";
        if (body?.ok !== true || home === "") {
          panel.setError(api.t("newWorkspaceStartFailed"));
          return;
        }
        if (typeof body.platform === "string") {
          runtime.style = body.platform === "win32" ? "win32" : "posix";
        }
        runtime.startDir = home;
        runtime.seeded = true;
        panel.setQuery(`=${withTrailingSeparator(home)}`);
      })
      .catch(() => {
        runtime.seeding = false;
        if (disposed) return;
        panel.setError(api.t("newWorkspaceStartFailed"));
      });
  }

  function load(text) {
    if (disposed) return;
    if (text === "") {
      seed();
      return;
    }
    const parsed = parseCreateQuery(text, runtime);
    if (parsed.kind === "none") return;
    ensure(parsed.directory);
  }

  /** Build one directory row; the path is what Tab drills into and Enter commits. */
  function directoryRow(match) {
    return {
      key: `d:${match.path}`,
      path: match.path,
      title: `${match.name}/`,
      positions: match.positions,
      meta: [{ text: match.path, className: "dqs-workspace-path" }],
      badge: findWorkspace(match.path) === null ? null : api.t("newWorkspaceBadge"),
      className: "dqs-new-workspace-row",
      run: commit(match.path),
    };
  }

  /** The row that represents the typed directory itself. */
  function targetRow(directory) {
    const workspace = findWorkspace(directory);
    if (workspace !== null) {
      return {
        key: `t:${directory}`,
        target: true,
        path: directory,
        title: api.t("newWorkspaceExisting", { title: String(workspace.title ?? "") }),
        meta: [{ text: directory, className: "dqs-workspace-path" }],
        className: "dqs-create-row",
        titleClassName: "dqs-create-label",
        run: commit(directory),
      };
    }
    return {
      key: `t:${directory}`,
      target: true,
      path: directory,
      title: api.t("newWorkspaceHere"),
      meta: [{ text: directory, className: "dqs-workspace-path" }],
      className: "dqs-create-row",
      titleClassName: "dqs-create-label",
      icon: "+",
      run: commit(directory),
    };
  }

  /** The row for a directory the user asked for by name but does not exist yet. */
  function mkdirRow(directory) {
    return {
      key: `m:${directory}`,
      target: true,
      path: directory,
      title: api.t("newWorkspaceCreateDirectory"),
      meta: [{ text: directory, className: "dqs-workspace-path" }],
      className: "dqs-create-row",
      titleClassName: "dqs-create-label",
      icon: "+",
      run: commit(directory, { needsMkdir: true }),
    };
  }

  function listingErrorText(listing) {
    const reason =
      listing.message !== "" ? listing.message : api.t("newWorkspaceUnknownReason");
    if (listing.code === "missing") return api.t("newWorkspaceMissing");
    if (listing.code === "not-directory") return api.t("newWorkspaceNotDirectory");
    if (listing.code === "denied") return api.t("newWorkspaceDenied", { reason });
    return api.t("newWorkspaceUnreadable", { reason });
  }

  /**
   * Filter and rank the listed subdirectories for one typed segment.
   *
   * A prefix hit leads every fuzzy hit, and both are case-insensitive on
   * Windows only. Dot directories stay out of the way until the segment itself
   * starts with a dot, matching how the "@" mode treats hidden files.
   */
  function collectDirectories(listing, fragment) {
    const showHidden = fragment.startsWith(".");
    const needle = fragment === "" ? null : fragment;
    const needleLower = needle === null ? "" : needle.toLocaleLowerCase();
    const matched = [];
    for (const entry of listing.entries) {
      const name = typeof entry?.name === "string" ? entry.name : "";
      if (name === "" || name === "." || name === "..") continue;
      if (name.startsWith(".") && !showHidden) continue;
      const path =
        typeof entry?.path === "string" && entry.path !== ""
          ? entry.path
          : `${listing.path}${
              listing.path.endsWith("\\") || listing.path.endsWith("/") ? "" : "/"
            }${name}`;
      let positions = null;
      let score = 0;
      if (needle !== null) {
        const prefix =
          runtime.style === "win32"
            ? name.toLocaleLowerCase().startsWith(needleLower)
            : name.startsWith(needle);
        if (prefix) {
          positions = new Set();
          for (let index = 0; index < Math.min(needle.length, name.length); index += 1) {
            positions.add(index);
          }
          score = PREFIX_SCORE - name.length;
        } else {
          const hit = fuzzyMatch(name, needle);
          if (hit === null) continue;
          positions = new Set(hit.positions);
          score = hit.score;
        }
      }
      matched.push({ name, path, positions, score });
    }
    matched.sort(
      (left, right) =>
        right.score - left.score ||
        left.name.localeCompare(right.name, undefined, { sensitivity: "base" }),
    );
    return { rows: matched.slice(0, RESULT_LIMIT), trimmed: matched.length > RESULT_LIMIT };
  }

  function trimmedNote(directories, listing) {
    if (directories.trimmed) return api.t("newWorkspaceTrimmed", { count: RESULT_LIMIT });
    if (listing.truncated) return api.t("newWorkspaceTruncated", { count: MAX_ENTRIES });
    return null;
  }

  /** Tab enters a listed subdirectory; on the typed directory itself it does nothing. */
  function onKeydown(event, _panel, row) {
    if (event?.key !== "Tab") return false;
    if (event.shiftKey === true || event.altKey === true || event.ctrlKey === true) return false;
    if (event.metaKey === true) return false;
    if (row === null || row === undefined || typeof row.path !== "string") return false;
    if (row.target === true) return true;
    panel.setQuery(`=${withTrailingSeparator(row.path)}`);
    return true;
  }

  const hints = [
    { keys: ["Enter"], label: api.t("newWorkspaceHintSelect") },
    { keys: ["Tab"], label: api.t("newWorkspaceHintEnter") },
    { keys: ["Esc"], label: api.t("hintClose") },
  ];

  function view(text) {
    if (text !== "") runtime.seeded = false;
    const parsed = parseCreateQuery(text, runtime);
    const result = {
      placeholder: api.t("newWorkspacePlaceholder"),
      searchAria: api.t("newWorkspaceSearchAria"),
      listLabel: api.t("newWorkspaceListLabel"),
      rows: [],
      emptyText: null,
      note: null,
      hints,
      count: "",
      keydown: onKeydown,
      load: () => load(text),
    };

    if (parsed.kind === "none") {
      result.emptyText =
        parsed.reason === "missing-start"
          ? api.t("newWorkspaceLoading")
          : api.t("newWorkspaceNeedAbsolute");
      return result;
    }

    const listing = cache.get(cacheKey(parsed.directory));
    if (listing === undefined) {
      result.emptyText = api.t("newWorkspaceLoading");
      return result;
    }

    if (listing.status === "error") {
      if (parsed.kind === "intent" && listing.code === "missing") {
        if (isRootPath(parsed.directory)) {
          result.emptyText = api.t("newWorkspaceRootMissing");
          return result;
        }
        result.rows = [mkdirRow(parsed.directory)];
        result.note = api.t("newWorkspaceWillCreate");
        return result;
      }
      result.emptyText = listingErrorText(listing);
      return result;
    }

    const directories = collectDirectories(listing, parsed.fragment);
    if (parsed.kind === "intent") {
      const children = directories.rows.map(directoryRow);
      // The Host answers with the canonical spelling, so the target commits the
      // same path DSH will store instead of a symlinked or mixed-case variant.
      const targetDirectory = listing.path !== "" ? listing.path : parsed.directory;
      result.rows = [targetRow(targetDirectory), ...children];
      result.count = api.t("newWorkspaceCount", { count: children.length });
      result.note = trimmedNote(directories, listing);
      return result;
    }

    result.rows = directories.rows.map(directoryRow);
    if (result.rows.length === 0) {
      result.emptyText = api.t("newWorkspaceNoMatch");
      result.note = api.t("newWorkspaceSeparatorHint");
      return result;
    }
    result.count = api.t("newWorkspaceCount", { count: result.rows.length });
    result.note = trimmedNote(directories, listing);
    return result;
  }

  /**
   * Register the path as a workspace and open a session in it.
   *
   * DSH's create is idempotent: an already registered path returns that row, so
   * entering an existing workspace needs no second branch. A missing directory
   * is created first, and the row that offered it says so before Enter.
   */
  function commit(path, { needsMkdir = false } = {}) {
    return async () => {
      try {
        if (needsMkdir) {
          const created = await callJson(MKDIR_PATH, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ path }),
          });
          if (created?.ok !== true) {
            panel.setError(api.t("newWorkspaceMkdirFailed", { reason: reasonOf(created) }));
            return;
          }
          cache.delete(cacheKey(path));
        }
        const service = api.get("workspaces");
        if (service === null || service === undefined || typeof service.create !== "function") {
          panel.setError(api.t("newWorkspaceServiceUnavailable"));
          return;
        }
        const workspace = await service.create({ path });
        const workspaceId =
          typeof workspace?.workspaceId === "string" ? workspace.workspaceId : "";
        if (workspaceId === "") {
          panel.setError(api.t("newWorkspaceCreateFailed", { reason: api.t("newWorkspaceUnknownReason") }));
          return;
        }
        const uiWorkspace = api.services?.uiWorkspace;
        if (uiWorkspace !== undefined && typeof uiWorkspace.startSession === "function") {
          try {
            uiWorkspace.startSession(workspaceId);
          } catch {
            // The workspace exists now; keeping the panel open lets the user
            // press Enter again or find it in the "+" list.
            panel.setError(api.t("newWorkspaceSessionFailed"));
            return;
          }
        }
        panel.close({ restoreFocus: false });
      } catch (error) {
        const code = error?.rpcError?.code ?? error?.code;
        if (code === "workspace/invalid-path") {
          panel.setError(api.t("newWorkspaceInvalidPath"));
          return;
        }
        panel.setError(api.t("newWorkspaceCreateFailed", { reason: messageOf(error) }));
      }
    };
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    cancelPending();
    cache.clear();
    if (typeof unsubscribe === "function") unsubscribe();
  }

  return { view, dispose };
}

/** Readable text for a thrown value without trusting its shape. */
function messageOf(error) {
  if (error instanceof Error) return error.message.slice(0, 160);
  try {
    return String(error).slice(0, 160);
  } catch {
    return "";
  }
}

/** A failure body names its reason in `message`; fall back to its code. */
function reasonOf(failure) {
  if (typeof failure?.message === "string" && failure.message !== "") {
    return failure.message.slice(0, 160);
  }
  if (typeof failure?.code === "string" && failure.code !== "") return failure.code;
  return "";
}
