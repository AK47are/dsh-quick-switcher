/* Session projections shared by the sidebar and the switcher. */

import { cleanTitle, toMillis } from "./format.js";
import { idKeyOf, shortIdOf } from "./ids.js";
import {
  PENDING_ORDER_LEAST_RECENT,
  pendingOrderOf,
} from "./pending-order.js";

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
 * The first session the main view still retains.
 *
 * DSH exposes retention as a reference count rather than a "last viewed"
 * pointer. When several rows are retained, the sidebar itself highlights the
 * first one in snapshot order, so the switcher uses the same expression and
 * its pinned row always agrees with the sidebar's current row.
 */
export function retainedSessionId(sessionList) {
  const byId = sessionList?.byId ?? {};
  for (const row of Object.values(byId)) {
    if ((row?.retainedBy?.mainView ?? 0) > 0) return row.id ?? null;
  }
  return null;
}

/**
 * Empty-query status groups, most important first.
 *
 * These are DSH's own StateDot states: done is the green completion dot,
 * warning the pending interaction dot, and ongoing the spinner (own activity
 * or running subagents). Idle rows carry no dot and close the list.
 */
const STATE_RANK = { done: 0, warning: 1, ongoing: 2, idle: 3 };

function stateRank(status) {
  return STATE_RANK[status?.state] ?? STATE_RANK.idle;
}

/** Stable tie-break for two rows whose sort keys agree. */
function compareIds(left, right) {
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

/**
 * Order one pending group under the default preference.
 *
 * The pending group is the one list whose order decides what to act on next, so
 * it leads with the rows the user has not opened yet instead of the newest
 * visit. Rows the plugin never showed come first, ordered by their session
 * activity; the opened rows queue behind them by their oldest visit. Both keys
 * ascend, so recording a visit can only move a row down, and a session that
 * turns out to be unactionable never pushes the rows the user has not checked
 * yet away.
 */
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
 *
 * The empty-query order is the switcher's own. The previous session leads:
 * the most recently accessed visible session other than the one the main
 * view is currently showing, which on a main panel page is simply the last
 * conversation. The rest follow the status rank, and rows of one rank follow
 * `recentAt`: the last time the plugin saw the session shown, or `updatedAt`
 * for a session it has never observed. The pinned row appears once and is
 * therefore absent from its own status position. Search results keep the
 * route's relevance order instead; this list is the base for both, so its
 * order is the only tie the routes inherit.
 *
 * The pending group is the exception. Under the default preference it ignores
 * `recentAt`: rows the plugin never showed lead by `updatedAt`, and the opened
 * rows follow by `lastAccessAt`, both ascending, so a visit only moves a row
 * down. The user's setting can flip the group back to the list-wide rule. The
 * pinned row still leads the whole list, so the previous session stays
 * reachable even while it waits on the user.
 *
 * A row also carries the canonical id key and the short code derived from it.
 * The row renders the short code and the search compares the full key, so both
 * read the same normalization and a code on screen always stays searchable.
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
      // The row shows the short code and the search compares the full key, so
      // both come from one normalization instead of two ad-hoc transformations.
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

  // DSH exposes retention for the row the main view shows, not a visit
  // stack. The previous session therefore comes from the plugin's own access
  // map: the newest access other than the current row. With no history there
  // is no honest candidate, so nothing is pinned and the list starts at the
  // status order.
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
