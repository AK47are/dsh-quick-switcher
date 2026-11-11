/* "+" route: a workspace list that drills into one workspace's sessions. */

import { filterEntries } from "../data/search.js";
import { sessionRow } from "./session-row.js";

/**
 * Match a scoped query against the known workspace titles.
 *
 * The token is `+` plus the full title plus one space. Titles may contain
 * spaces, so the longest matching title wins; a title without the trailing
 * space never opens a scope, which keeps ordinary typing in the workspace
 * list from flipping the list underneath the caret.
 */
function matchScopeTitle(text, workspaces) {
  const candidates = workspaces.filter((workspace) => {
    const { title } = workspace;
    if (text.length <= title.length) return false;
    if (text[title.length] !== " ") return false;
    return text.slice(0, title.length).toLocaleLowerCase() === title.toLocaleLowerCase();
  });
  if (candidates.length === 0) return null;
  return candidates.reduce((best, next) =>
    next.title.length > best.title.length ? next : best,
  );
}

export function createWorkspacesRoute() {
  // Enter remembers the exact workspace id, so two workspaces that share a
  // title stay unambiguous while the user keeps editing the filter.
  let pinned = null;

  function remember(workspace) {
    const token = `+${workspace.title} `;
    pinned = { workspaceId: workspace.workspaceId, token };
    return token;
  }

  /** First row the caret should land on after Enter opens a workspace. */
  function scopeStartKey(workspace, ctx) {
    const current = workspace.sessions.find((entry) => entry.id === ctx.currentId);
    if (current) return `s:${current.id}`;
    const first = workspace.sessions[0];
    return first ? `s:${first.id}` : `c:${workspace.workspaceId}`;
  }

  function listView(parsed, ctx) {
    const rows = filterEntries(ctx.workspaceRows, parsed.filter).map(
      ({ entry, positions }) => ({
        key: `w:${entry.workspaceId}`,
        title: entry.title,
        positions,
        meta: [{ text: entry.path, className: "dqs-workspace-path" }],
        trailing: ctx.t("count", { count: entry.count }),
        className: "dqs-workspace-row",
        run() {
          return {
            type: "query",
            query: remember(entry),
            selectedKey: scopeStartKey(entry, ctx),
          };
        },
        shiftRun(activation) {
          return activation.startSession(entry.workspaceId)
            ? { type: "close", restoreFocus: false }
            : undefined;
        },
      }),
    );
    return {
      placeholder: ctx.t("placeholderWorkspaces"),
      listLabel: ctx.t("listLabelWorkspaces"),
      searchAria: ctx.t("searchAriaWorkspaces"),
      rows,
      emptyText: rows.length === 0 ? ctx.t("emptyWorkspaces") : null,
      note: null,
      hints: [
        { keys: ["Enter"], label: ctx.t("hintViewSessions") },
        { keys: ["Shift+Enter"], label: ctx.t("hintNewSession") },
        { keys: ["Esc"], label: ctx.t("hintClose") },
      ],
      count: ctx.t("countWorkspaces", { count: rows.length }),
    };
  }

  function scopeView(parsed, ctx) {
    const { workspace } = parsed;
    const sessionRows = filterEntries(workspace.sessions, parsed.filter).map(
      ({ entry, positions }) => sessionRow(entry, ctx, { showWorkspace: false, positions }),
    );
    const rows = [
      {
        key: `c:${workspace.workspaceId}`,
        action: true,
        icon: "+",
        title: ctx.t("newSession"),
        titleClassName: "dqs-create-label",
        className: "dqs-create-row",
        meta: [],
        run(activation) {
          return activation.startSession(workspace.workspaceId)
            ? { type: "close", restoreFocus: false }
            : undefined;
        },
      },
      ...sessionRows,
    ];
    const note =
      sessionRows.length === 0
        ? workspace.sessions.length === 0
          ? ctx.t("emptyWorkspaceSessions")
          : ctx.t("empty")
        : null;
    return {
      placeholder: ctx.t("placeholderScope"),
      listLabel: ctx.t("listLabelScope"),
      searchAria: ctx.t("searchAria"),
      rows,
      emptyText: null,
      note,
      hints: [
        { keys: ["Enter"], label: ctx.t("hintOpen") },
        { keys: ["Esc"], label: ctx.t("hintClose") },
      ],
      count: ctx.t("count", { count: sessionRows.length }),
    };
  }

  return {
    id: "workspaces",
    prefix: "+",
    parse(query, ctx) {
      if (!query.startsWith("+")) return null;
      if (pinned !== null && !query.startsWith(pinned.token)) pinned = null;
      const rest = query.slice(1);
      const pinnedWorkspace =
        pinned === null
          ? undefined
          : ctx.workspaceRows.find(
              (workspace) => workspace.workspaceId === pinned.workspaceId,
            );
      if (pinnedWorkspace && query.startsWith(pinned.token)) {
        return {
          mode: "scope",
          workspace: pinnedWorkspace,
          filter: query.slice(pinned.token.length),
        };
      }
      const matched = matchScopeTitle(rest, ctx.workspaceRows);
      if (matched !== null) {
        return {
          mode: "scope",
          workspace: matched,
          filter: rest.slice(matched.title.length + 1),
        };
      }
      return { mode: "list", filter: rest };
    },
    view(parsed, ctx) {
      return parsed.mode === "list" ? listView(parsed, ctx) : scopeView(parsed, ctx);
    },
  };
}
