/* Value normalization and time formatting shared by the panel and the routes. */

/** Normalize an updatedAt value that may be milliseconds or an ISO string. */
export function toMillis(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

/** Collapse whitespace in a title and fall back when nothing is left. */
export function cleanTitle(value, fallback) {
  const text = String(value ?? "").replace(/\s+/gu, " ").trim();
  return text === "" ? fallback : text;
}

/** Last path segment, used as a workspace title when DSH has none. */
export function lastPathSegment(path, fallback) {
  const parts = String(path ?? "")
    .split(/[\\/]+/u)
    .filter((part) => part !== "");
  return parts.length === 0 ? fallback : parts[parts.length - 1];
}

/** Human relative time with a localized fallback to an absolute date. */
export function relativeTime(millis, t, now) {
  if (!millis) return "";
  const diff = Math.max(0, now - millis);
  const minute = 60_000;
  const hour = 3_600_000;
  const day = 86_400_000;
  if (diff < minute) return t("time.justNow");
  if (diff < hour) return t("time.minutes", { count: Math.floor(diff / minute) });
  if (diff < day) return t("time.hours", { count: Math.floor(diff / hour) });
  if (diff < day * 2) return t("time.yesterday");
  if (diff < day * 30) return t("time.days", { count: Math.floor(diff / day) });
  return new Date(millis).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/**
 * Relative time, or the sidebar's compact pending label while waiting.
 *
 * The switcher sorts empty-query rows by `recentAt` (last time the session
 * was shown, falling back to `updatedAt`), so the label shows that same value
 * and the visible time always explains the order above it.
 */
export function rowTimeLabel(entry, t, now) {
  if (entry.status.compactKey !== null) return t(entry.status.compactKey);
  const recentAt = entry.recentAt > 0 ? entry.recentAt : entry.updatedAt;
  return recentAt ? relativeTime(recentAt, t, now) : "";
}
