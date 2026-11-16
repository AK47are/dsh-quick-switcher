/**
 * Which conversation the main area is showing.
 *
 * DSH exposes retention as a reference count rather than a "last viewed"
 * pointer. When several rows are retained, the sidebar highlights the first one
 * in snapshot order, so the panel context uses the same expression and its
 * `currentSessionId` always agrees with the sidebar's current row. A main panel
 * covering the conversation releases nothing, so the caller passes the active
 * panel id and this helper is simply not consulted.
 *
 * This is the one session-shaped fact the core owns: every module needs the
 * displayed conversation, and none of them should have to recompute it.
 */
export function retainedSessionId(sessionList) {
  const byId = sessionList?.byId ?? {};
  for (const row of Object.values(byId)) {
    if ((row?.retainedBy?.mainView ?? 0) > 0) return row.id ?? null;
  }
  return null;
}
