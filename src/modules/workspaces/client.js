/* Workspace module: the "+" list and the scoped session list. */

import { defineModule } from "../../core/module.js";
import { filterEntries } from "../../core/lib/search.js";
import { locale } from "./locale.js";

/**
 * Match a scoped query against the known workspace titles.
 *
 * The token is `+` plus the full title plus one space. Titles may contain
 * spaces, so the longest matching title wins; a title without the trailing
 * space never opens a scope, which keeps ordinary typing in the workspace list
 * from flipping the list underneath the caret.
 */
function matchScopeTitle(text, workspaces) {
  const candidates = workspaces.filter((workspace) => {
    const { title } = workspace;
    if (text.length <= title.length) return false;
    if (text[title.length] !== " ") return false;
    return text.slice(0, title.length).toLocaleLowerCase() === title.toLocaleLowerCase();
  });
  if (candidates.length === 0) return null;
  return candidates.reduce((best, next) => (next.title.length > best.title.length ? next : best));
}

export default defineModule("workspaces", (api) => {
  // The session list and its workspace grouping are owned by the sessions
  // module; this module only reads the projection another module published.
  const shared = api.shared.store("session-data");

  function startSession(panel, workspaceId) {
    try {
      const result = api.services.uiWorkspace.startSession(workspaceId);
      if (result !== null && typeof result === "object" && typeof result.catch === "function") {
        result.catch(() => panel.setError(api.t("createFailed")));
      }
      panel.close({ restoreFocus: false });
      return true;
    } catch {
      panel.setError(api.t("createFailed"));
      return false;
    }
  }

  return {
    apiVersion: 1,
    order: 20,
    labelKey: "workspacesTitle",
    locale,
    mount(panel) {
      // Enter remembers the exact workspace id, so two workspaces that share a
      // title stay unambiguous while the user keeps editing the filter.
      let pinned = null;
      const unsubscribe = shared.subscribe(() => panel.notify());

      function snapshot() {
        const data = shared.getSnapshot();
        return {
          workspaceRows: data?.workspaceRows ?? [],
          rowFor: data?.rowFor ?? null,
          currentId: data?.currentId ?? null,
        };
      }

      function remember(workspace) {
        const token = `+${workspace.title} `;
        pinned = { workspaceId: workspace.workspaceId, token };
        return token;
      }

      /** First row the caret should land on after Enter opens a workspace. */
      function scopeStartKey(workspace, currentId) {
        const current = workspace.sessions.find((entry) => entry.id === currentId);
        if (current) return `s:${current.id}`;
        const first = workspace.sessions[0];
        return first ? `s:${first.id}` : `c:${workspace.workspaceId}`;
      }

      function listView(parsed, panel) {
        const { workspaceRows } = snapshot();
        const rows = filterEntries(workspaceRows, parsed.filter).map(({ entry, positions }) => ({
          key: `w:${entry.workspaceId}`,
          title: entry.title,
          positions,
          meta: [{ text: entry.path, className: "dqs-workspace-path" }],
          trailing: api.t("count", { count: entry.count }),
          className: "dqs-workspace-row",
          run() {
            panel.setQuery(remember(entry), {
              selectedKey: scopeStartKey(entry, snapshot().currentId),
            });
          },
          shiftRun() {
            startSession(panel, entry.workspaceId);
          },
        }));
        return {
          placeholder: api.t("placeholderWorkspaces"),
          listLabel: api.t("listLabelWorkspaces"),
          searchAria: api.t("searchAriaWorkspaces"),
          rows,
          emptyText: rows.length === 0 ? api.t("emptyWorkspaces") : null,
          note: null,
          hints: [
            { keys: ["Enter"], label: api.t("hintViewSessions") },
            { keys: ["Shift+Enter"], label: api.t("hintNewSession") },
            { keys: ["Esc"], label: api.t("hintClose") },
          ],
          count: api.t("countWorkspaces", { count: rows.length }),
        };
      }

      function scopeView(parsed, panel) {
        const { workspace } = parsed;
        const data = snapshot();
        const sessionRows =
          data.rowFor === null
            ? []
            : filterEntries(workspace.sessions, parsed.filter).map(({ entry, positions }) =>
                data.rowFor(entry, panel, { showWorkspace: false, positions }),
              );
        const rows = [
          {
            key: `c:${workspace.workspaceId}`,
            action: true,
            icon: "+",
            title: api.t("newSession"),
            titleClassName: "dqs-create-label",
            className: "dqs-create-row",
            meta: [],
            run() {
              startSession(panel, workspace.workspaceId);
            },
          },
          ...sessionRows,
        ];
        const note =
          sessionRows.length === 0
            ? workspace.sessions.length === 0
              ? api.t("emptyWorkspaceSessions")
              : api.t("empty")
            : null;
        return {
          placeholder: api.t("placeholderScope"),
          listLabel: api.t("listLabelScope"),
          searchAria: api.t("searchAria"),
          rows,
          emptyText: null,
          note,
          hints: [
            { keys: ["Enter"], label: api.t("hintOpen") },
            { keys: ["Esc"], label: api.t("hintClose") },
          ],
          count: api.t("count", { count: sessionRows.length }),
        };
      }

      return {
        matchers: [
          {
            id: "workspaces",
            priority: 10,
            match(query) {
              if (!query.startsWith("+")) return null;
              const { workspaceRows } = snapshot();
              if (pinned !== null && !query.startsWith(pinned.token)) pinned = null;
              const rest = query.slice(1);
              const pinnedWorkspace =
                pinned === null
                  ? undefined
                  : workspaceRows.find((workspace) => workspace.workspaceId === pinned.workspaceId);
              if (pinnedWorkspace && query.startsWith(pinned.token)) {
                return {
                  mode: "scope",
                  workspace: pinnedWorkspace,
                  filter: query.slice(pinned.token.length),
                };
              }
              const matched = matchScopeTitle(rest, workspaceRows);
              if (matched !== null) {
                return {
                  mode: "scope",
                  workspace: matched,
                  filter: rest.slice(matched.title.length + 1),
                };
              }
              return { mode: "list", filter: rest };
            },
            view(state, panel) {
              return state.mode === "list"
                ? listView(state, panel)
                : scopeView(state, panel);
            },
          },
        ],
        dispose: unsubscribe,
      };
    },
  };
});
