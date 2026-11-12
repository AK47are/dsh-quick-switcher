/* Workspace projections for the "+" route. */

import { cleanTitle, lastPathSegment } from "./format.js";

/**
 * Build the workspace rows.
 *
 * A workspace is the sidebar's grouping unit: a title, a path, and the ids of
 * the sessions it owns. Counts and activity come from the visible session
 * rows only, so a workspace row promises exactly what entering it shows; an
 * archived or blank session neither counts nor sorts it.
 *
 * Member sessions keep the incoming display order (the switcher's retained,
 * status, access order) so a scope view lists the same sequence as the main
 * list. The workspace row itself still ranks by the newest content update:
 * its position answers "which project moved last", not "where was I last".
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
  // Most recently active workspace first; empty workspaces keep a stable
  // alphabetical order, so the tail does not shuffle on every refresh.
  rows.sort(
    (left, right) =>
      right.updatedAt - left.updatedAt || left.title.localeCompare(right.title),
  );
  return rows;
}
