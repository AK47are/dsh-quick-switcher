/* Uniform session row shared by the default list and the workspace scope. */

import { rowTimeLabel } from "../../core/lib/format.js";
import { describeStatus } from "./projection.js";

/**
 * Build the row a panel renders for one session entry.
 *
 * `showWorkspace` is off inside a scope, where every row already shares the
 * workspace named by the token. The row's `run` closes the panel itself, so
 * the module owns both the navigation and the focus policy; the shell only
 * calls the closure.
 */
export function createSessionRow({ t, openSession }) {
  return function sessionRow(entry, panel, { showWorkspace = false, positions = null } = {}) {
    const { status } = entry;
    const statusText = describeStatus(status, t);
    const timeText = rowTimeLabel(entry, t, panel.now);
    const meta = [];
    if (showWorkspace && entry.workspace !== "") {
      meta.push({ text: entry.workspace, className: "dqs-workspace" });
    }
    if (timeText !== "") {
      meta.push({
        text: timeText,
        className: status.compactKey === null ? "dqs-time" : "dqs-time dqs-time-compact",
      });
    }
    // The short id explains why an id query kept this row and lets the user
    // compare it with a copied id; a row whose id is too short renders none.
    if (entry.shortId) {
      meta.push({ text: entry.shortId, className: "dqs-session-id" });
    }
    let badge = null;
    if (entry.current === true) badge = t("current");
    else if (entry.pinned === true) badge = t("previous");

    return {
      key: `s:${entry.id}`,
      title: entry.title,
      positions,
      meta,
      status: status.state === "idle" ? null : { state: status.state, label: statusText },
      badge,
      run() {
        if (entry.current) {
          panel.close();
          return;
        }
        if (openSession(panel, entry.id)) panel.close({ restoreFocus: false });
      },
    };
  };
}
