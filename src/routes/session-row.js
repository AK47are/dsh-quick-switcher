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
  // The short id is the visible half of the session id: it explains why an id
  // query kept this row and lets the user compare it with a copied id. It sits
  // after the time so workspace and recency keep their usual place, and a row
  // whose id is too short to search renders no code at all.
  if (entry.shortId) {
    meta.push({ text: entry.shortId, className: "dqs-session-id" });
  }
  // The pinned row is the session the user was in before the current one, so
  // it carries the same kind of label the current row does. The data layer
  // keeps the current session out of the pin, so the two never compete; if
  // they ever did, the current marker is the one to trust.
  let badge = null;
  if (entry.current === true) badge = t("current");
  else if (entry.pinned === true) badge = t("previous");

  return {
    key: `s:${entry.id}`,
    title: entry.title,
    positions,
    meta,
    status: status.state === "idle" ? null : { state: status.state, label: statusText },
    current: entry.current === true,
    badge,
    run(activation) {
      if (entry.current) return { type: "close", restoreFocus: true };
      return activation.openSession(entry.id)
        ? { type: "close", restoreFocus: false }
        : undefined;
    },
  };
}
