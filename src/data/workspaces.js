/* Workspace projections for the "+" route. */

import { cleanTitle, lastPathSegment } from "./format.js";

/**
 * Build the workspace rows.
 *
 * A workspace is the sidebar's grouping unit: a title, a path, and the ids of
 * the sessions it owns. Counts and activity come from the visible session
 * rows only, so a workspace row promises exactly what entering it shows; an
 * archived or blank session neither counts nor sorts it.
 */
export function collectWorkspaceRows(workspaceList, entries) {
  const visible = new Map(entries.map((entry) => [entry.id, entry]));
  const rows = [];
  for (const item of workspaceList?.items ?? []) {
    const workspaceId = String(item?.workspaceId ?? "");
    if (workspaceId === "") continue;
    const path = String(item?.path ?? "");
    const title = cleanTitle(item?.title || lastPathSegment(path, ""), path || workspaceId);
    const sessions = [];
    for (const id of item?.sessionIds ?? []) {
      const entry = visible.get(id);
      if (entry) sessions.push(entry);
    }
    sessions.sort((left, right) => right.updatedAt - left.updatedAt);
    rows.push({
      workspaceId,
      title,
      path,
      titleLower: title.toLocaleLowerCase(),
      metaLower: `${title} ${path}`.toLocaleLowerCase(),
      updatedAt: sessions.length === 0 ? 0 : sessions[0].updatedAt,
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
