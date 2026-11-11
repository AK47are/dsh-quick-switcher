/* Session projections shared by the sidebar and the switcher. */

import { cleanTitle, toMillis } from "./format.js";

/**
 * Pending interactions that the sidebar projects as a warning dot.
 *
 * The sidebar ignores every other pending kind, so this table mirrors that
 * whitelist instead of treating any interaction as waiting; a future DSH
 * kind therefore stays invisible here until both surfaces learn it.
 */
const PENDING_STATUS = {
  approval: {
    labelKey: "statusWaitingApproval",
    compactKey: "statusCompactApproval",
  },
  "plan-review": {
    labelKey: "statusPlanReview",
    compactKey: "statusCompactPlanReview",
  },
  question: {
    labelKey: "statusWaitingAnswer",
    compactKey: "statusCompactAnswer",
  },
};

/** Return the sidebar-visible pending kind for one unified status snapshot. */
export function visiblePendingKind(status) {
  const kind = status?.pendingInteraction?.kind;
  if (typeof kind !== "string" || !Object.hasOwn(PENDING_STATUS, kind)) return null;
  return kind;
}

/**
 * Count subagents the unified status or the list baseline reports running.
 *
 * The sidebar uses the same fallback, so a parent row shows live activity
 * when only its children are working.
 */
export function runningChildCount(list, parentId, statuses) {
  const catalog = list?.projectionsBySession?.[parentId]?.values?.subagentCatalog;
  if (!Array.isArray(catalog)) return 0;
  let count = 0;
  for (const child of catalog) {
    const status = statuses?.get?.(child.id);
    const running = status?.running ?? list?.byId?.[child.id]?.running;
    if (running === true) count += 1;
  }
  return count;
}

/**
 * Resolve one row's primary status with the sidebar's precedence: pending
 * interaction, then own running activity, then running subagents, then an
 * unread completion reminder. Idle rows render no dot.
 */
export function sessionStatusOf(row, statuses, subagentCount) {
  const status = statuses?.get?.(row.id);
  const pendingKind = visiblePendingKind(status);
  if (pendingKind !== null) {
    return {
      state: "warning",
      kind: "pending",
      labelKey: PENDING_STATUS[pendingKind].labelKey,
      compactKey: PENDING_STATUS[pendingKind].compactKey,
      subagentCount,
    };
  }
  if ((status?.running ?? row.running) === true) {
    return {
      state: "ongoing",
      kind: "running",
      labelKey: "statusRunning",
      compactKey: null,
      subagentCount,
    };
  }
  if (subagentCount > 0) {
    return {
      state: "ongoing",
      kind: "subagents",
      labelKey: null,
      compactKey: null,
      subagentCount,
    };
  }
  if (status?.completionUnread === true) {
    return {
      state: "done",
      kind: "completed",
      labelKey: "statusCompleted",
      compactKey: null,
      subagentCount,
    };
  }
  return {
    state: "idle",
    kind: "idle",
    labelKey: "statusIdle",
    compactKey: null,
    subagentCount,
  };
}

/** Localized subagent activity label for the current count. */
function subagentLabel(count, t) {
  return t(count === 1 ? "statusSubagentsOne" : "statusSubagentsOther", {
    count,
  });
}

/**
 * One row's accessible status text. The primary label leads; a running
 * subagent count follows when it is not already the primary state.
 */
export function describeStatus(status, t) {
  if (status.kind === "subagents") return subagentLabel(status.subagentCount, t);
  const label = t(status.labelKey);
  if (status.kind === "idle" || status.subagentCount === 0) return label;
  return `${label} · ${subagentLabel(status.subagentCount, t)}`;
}

/**
 * Build the searchable session rows.
 *
 * Archived, blank, and subagent generations are excluded: the first is
 * intentionally hidden by the sidebar, the second has no conversation to
 * switch to, and the third belongs to its parent rather than the user's
 * own session list.
 *
 * Each row receives the unified status snapshot rather than its own copy:
 * the sidebar and this list then agree on current, running, pending, and
 * completed state for the same moment. The current marker follows the
 * sidebar's panel check: a main panel covers the conversation without
 * releasing its retention, so no row is current while a panel is active.
 */
export function collectSessionEntries(sessionList, workspaceList, statuses, isPanelActive) {
  const archived = new Set(
    Array.isArray(workspaceList?.archivedSessionIds)
      ? workspaceList.archivedSessionIds
      : [],
  );
  const workspaceBySession = new Map();
  for (const workspace of workspaceList?.items ?? []) {
    for (const id of workspace.sessionIds ?? []) {
      if (!workspaceBySession.has(id)) {
        workspaceBySession.set(id, {
          title: String(workspace.title ?? ""),
          path: String(workspace.path ?? ""),
        });
      }
    }
  }

  const byId = sessionList?.byId ?? {};
  // The sidebar highlights the first row still retained by the main view;
  // this is the same expression, so both surfaces mark exactly one current.
  const currentId = isPanelActive
    ? null
    : Object.values(byId).find((row) => (row.retainedBy?.mainView ?? 0) > 0)?.id ?? null;

  const entries = [];
  for (const id of sessionList?.ids ?? []) {
    const row = byId[id];
    if (!row) continue;
    if (row.blank || row.parentId || row.origin === "subagent" || archived.has(id)) continue;

    const workspace = workspaceBySession.get(id);
    const title = cleanTitle(row.displayTitle || row.title, id);
    const subagentCount = runningChildCount(sessionList, id, statuses);
    entries.push({
      id,
      title,
      titleLower: title.toLocaleLowerCase(),
      workspace: workspace?.title ?? "",
      path: workspace?.path ?? String(row.cwd ?? ""),
      metaLower: `${workspace?.title ?? ""} ${workspace?.path ?? row.cwd ?? ""}`.toLocaleLowerCase(),
      updatedAt: toMillis(row.updatedAt),
      status: sessionStatusOf(row, statuses, subagentCount),
      current: id === currentId,
    });
  }
  entries.sort((left, right) => right.updatedAt - left.updatedAt);
  return { entries, currentId };
}
