/* Session and workspace projections shared by the sessions and workspaces modules. */

import { cleanTitle, toMillis, lastPathSegment } from "../../core/lib/format.js";
import { idKeyOf, shortIdOf } from "../../core/lib/ids.js";
import { PENDING_ORDER_LEAST_RECENT, pendingOrderOf } from "../../core/lib/pending-order.js";
import { retainedSessionId } from "../../core/panel/displayed-session.js";

/**
 * Pending interactions the sidebar projects as a warning dot.
 *
 * The sidebar ignores every other pending kind, so this table mirrors that
 * whitelist instead of treating any interaction as waiting; a future DSH kind
 * therefore stays invisible here until both surfaces learn it.
 */
const PENDING_STATUS = {
  approval: { labelKey: "statusWaitingApproval", compactKey: "statusCompactApproval" },
  "plan-review": { labelKey: "statusPlanReview", compactKey: "statusCompactPlanReview" },
  question: { labelKey: "statusWaitingAnswer", compactKey: "statusCompactAnswer" },
};

export function visiblePendingKind(status) {
  const kind = status?.pendingInteraction?.kind;
  if (typeof kind !== "string" || !Object.hasOwn(PENDING_STATUS, kind)) return null;
  return kind;
}

/**
 * Count subagents the unified status or the list baseline reports running.
 * The sidebar uses the same fallback, so a parent row shows live activity when
 * only its children are working.
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

/** Resolve one row's primary status with the sidebar's precedence. */
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
  return t(count === 1 ? "statusSubagentsOne" : "statusSubagentsOther", { count });
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

const STATE_RANK = { done: 0, warning: 1, ongoing: 2, idle: 3 };

function stateRank(status) {
  return STATE_RANK[status?.state] ?? STATE_RANK.idle;
}

/** Stable tie-break for two rows whose sort keys agree. */
function compareIds(left, right) {
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

/** Default pending order: rows the user has not opened lead by oldest content. */
function comparePendingByLeastRecentVisit(left, right) {
  const leftSeen = left.lastAccessAt > 0;
  const rightSeen = right.lastAccessAt > 0;
  if (leftSeen !== rightSeen) return leftSeen ? 1 : -1;
  const leftKey = leftSeen ? left.lastAccessAt : left.updatedAt;
  const rightKey = rightSeen ? right.lastAccessAt : right.updatedAt;
  if (leftKey !== rightKey) return leftKey - rightKey;
  return compareIds(left, right);
}

/**
 * Build the searchable session entries.
 *
 * Archived, blank, and subagent generations are excluded: the first is hidden
 * by the sidebar, the second has no conversation to switch to, and the third
 * belongs to its parent. The empty-query order is the switcher's own: the
 * previous session leads, then the status rank, then the last time the plugin
 * saw the row. The pending group is the exception under the default
 * preference; see `comparePendingByLeastRecentVisit`.
 */
export function collectSessionEntries(
  sessionList,
  workspaceList,
  statuses,
  isPanelActive,
  accessTimes,
  pendingOrder = PENDING_ORDER_LEAST_RECENT,
) {
  const order = pendingOrderOf(pendingOrder);
  const archived = new Set(
    Array.isArray(workspaceList?.archivedSessionIds) ? workspaceList.archivedSessionIds : [],
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
  const retainedId = retainedSessionId(sessionList);
  const currentId = isPanelActive ? null : retainedId;

  const entries = [];
  for (const id of sessionList?.ids ?? []) {
    const row = byId[id];
    if (!row) continue;
    if (row.blank || row.parentId || row.origin === "subagent" || archived.has(id)) continue;

    const workspace = workspaceBySession.get(id);
    const title = cleanTitle(row.displayTitle || row.title, id);
    const subagentCount = runningChildCount(sessionList, id, statuses);
    const updatedAt = toMillis(row.updatedAt);
    const lastAccessAt = accessTimes?.get?.(id) ?? 0;
    entries.push({
      id,
      idKey: idKeyOf(id),
      shortId: shortIdOf(id),
      title,
      titleLower: title.toLocaleLowerCase(),
      workspace: workspace?.title ?? "",
      path: workspace?.path ?? String(row.cwd ?? ""),
      metaLower: `${workspace?.title ?? ""} ${workspace?.path ?? row.cwd ?? ""}`.toLocaleLowerCase(),
      updatedAt,
      lastAccessAt,
      recentAt: lastAccessAt > 0 ? lastAccessAt : updatedAt,
      status: sessionStatusOf(row, statuses, subagentCount),
      current: id === currentId,
      pinned: false,
    });
  }

  let pinned = null;
  for (const entry of entries) {
    if (entry.id === currentId) continue;
    if (entry.lastAccessAt <= 0) continue;
    if (
      pinned === null ||
      entry.lastAccessAt > pinned.lastAccessAt ||
      (entry.lastAccessAt === pinned.lastAccessAt &&
        (entry.updatedAt > pinned.updatedAt ||
          (entry.updatedAt === pinned.updatedAt && entry.id < pinned.id)))
    ) {
      pinned = entry;
    }
  }
  for (const entry of entries) entry.pinned = entry === pinned;

  entries.sort((left, right) => {
    if (left.pinned !== right.pinned) return left.pinned ? -1 : 1;
    const rank = stateRank(left.status) - stateRank(right.status);
    if (rank !== 0) return rank;
    if (left.status.state === "warning" && order === PENDING_ORDER_LEAST_RECENT) {
      return comparePendingByLeastRecentVisit(left, right);
    }
    if (left.recentAt !== right.recentAt) return right.recentAt - left.recentAt;
    return compareIds(left, right);
  });
  return { entries, currentId };
}

/**
 * Build the workspace rows.
 *
 * Counts and activity come from the visible session entries only, so a
 * workspace row promises exactly what entering it shows. Member sessions keep
 * the incoming display order so a scope view lists the same sequence as the
 * main list; the workspace row itself ranks by the newest content update.
 */
export function collectWorkspaceRows(workspaceList, entries) {
  const rows = [];
  for (const item of workspaceList?.items ?? []) {
    const workspaceId = String(item?.workspaceId ?? "");
    if (workspaceId === "") continue;
    const path = String(item?.path ?? "");
    const title = cleanTitle(item?.title || lastPathSegment(path, ""), path || workspaceId);
    const memberIds = new Set(item?.sessionIds ?? []);
    const sessions = entries.filter((entry) => memberIds.has(entry.id));
    let updatedAt = 0;
    for (const session of sessions) {
      if (session.updatedAt > updatedAt) updatedAt = session.updatedAt;
    }
    rows.push({
      workspaceId,
      title,
      path,
      titleLower: title.toLocaleLowerCase(),
      metaLower: `${title} ${path}`.toLocaleLowerCase(),
      updatedAt,
      sessions,
      count: sessions.length,
    });
  }
  rows.sort(
    (left, right) => right.updatedAt - left.updatedAt || left.title.localeCompare(right.title),
  );
  return rows;
}

/** One shared snapshot for both the default list and the workspace scope. */
export function projectSessionData({
  sessionList,
  workspaceList,
  statuses,
  activePanelId,
  accessTimes,
  pendingOrder,
}) {
  const isPanelActive = activePanelId !== null && activePanelId !== undefined;
  const { entries, currentId } = collectSessionEntries(
    sessionList,
    workspaceList,
    statuses,
    isPanelActive,
    accessTimes,
    pendingOrder,
  );
  return { entries, currentId, workspaceRows: collectWorkspaceRows(workspaceList, entries) };
}
