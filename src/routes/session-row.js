/* Uniform row shape for one session entry. */

import { describeStatus } from "../data/sessions.js";
import { rowTimeLabel } from "../data/format.js";

/**
 * Build the row a panel renders for one session.
 *
 * `showWorkspace` is off inside a scope, where every row already shares the
 * workspace named by the token. The row's `run` returns a dialog effect, so
 * the panel owns closing and focus restoration while the route only decides
 * which session to open.
 */
export function sessionRow(entry, ctx, { showWorkspace = false, positions = null } = {}) {
  const { t, now } = ctx;
  const { status } = entry;
  const statusText = describeStatus(status, t);
  const timeText = rowTimeLabel(entry, t, now);
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
  return {
    key: `s:${entry.id}`,
    title: entry.title,
    positions,
    meta,
    status: status.state === "idle" ? null : { state: status.state, label: statusText },
    current: entry.current === true,
    badge: entry.current === true ? t("current") : null,
    run(activation) {
      if (entry.current) return { type: "close", restoreFocus: true };
      return activation.openSession(entry.id)
        ? { type: "close", restoreFocus: false }
        : undefined;
    },
  };
}
