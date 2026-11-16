/* Pure shapes for the "@" file mode: workspace-relative paths and file addresses. */

/**
 * Split a workspace-relative path into its parent directory and final name.
 *
 * The Host search hands back "/"-separated paths. Backslashes are normalized
 * because a user can paste a Windows path into the query, and a trailing
 * separator is dropped so a directory candidate named "src/" still reads as
 * "src". A path without a separator has no directory part.
 */
export function splitFilePath(path) {
  const normalized = String(path ?? "")
    .replace(/\\/g, "/")
    .replace(/\/+$/, "");
  const slash = normalized.lastIndexOf("/");
  if (slash < 0) return { directory: "", name: normalized };
  return {
    directory: normalized.slice(0, slash),
    name: normalized.slice(slash + 1),
  };
}

/**
 * Encode one path segment the way the document preview decodes it.
 *
 * `encodeURIComponent` leaves nothing ambiguous except the colon, which the
 * DSH address grammar keeps literal so a Windows drive letter stays readable.
 */
function encodeSegment(segment) {
  return encodeURIComponent(segment).replace(/%3A/gi, ":");
}

/**
 * Build the address the right Sidebar uses to read one file through a Session.
 *
 * The Session id is the read authority: the preview resolves the workspace
 * relative path against that Session's working directory, so the panel never
 * needs the absolute path. Leading "./" prefixes and empty segments are
 * dropped to match the address grammar the preview parses.
 */
export function fileAddress(sessionId, path) {
  const normalized = String(path ?? "")
    .replace(/\\/g, "/")
    .replace(/^(?:\.\/)+/, "");
  const segments = normalized.split("/").filter((segment) => segment !== "");
  return `dsh-resource://file/session/${encodeSegment(String(sessionId))}/${segments
    .map(encodeSegment)
    .join("/")}`;
}
