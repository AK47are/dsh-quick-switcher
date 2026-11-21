/* Absolute-path shapes shared by the workspace rows and the "=" path mode. */

/**
 * The helpers treat both separators as path syntax.
 *
 * A Windows path may be typed with forward slashes and a POSIX path must not
 * be split on backslashes, so every caller passes the grammar it detected from
 * the starting directory first. Nothing here touches the filesystem.
 */

const WINDOWS_DRIVE_PREFIX = /^[A-Za-z]:/u;
const WINDOWS_DRIVE_ONLY = /^[A-Za-z]:$/u;
const WINDOWS_ABSOLUTE = /^[A-Za-z]:[\\/]/u;
const WINDOWS_ROOT = /^[A-Za-z]:[\\/]?$/u;
const UNC_ROOT = /^\\\\[^\\/]+[\\/][^\\/]+/u;

/** Infer the separator grammar from a path, or null when it has no clue. */
export function inferStyle(path) {
  const text = String(path ?? "");
  if (text === "") return null;
  if (WINDOWS_DRIVE_PREFIX.test(text) || text.startsWith("\\\\") || text.includes("\\")) {
    return "win32";
  }
  if (text.startsWith("/")) return "posix";
  return null;
}

/** True when the path is absolute under the given grammar. */
export function isAbsolutePath(path, style) {
  const text = String(path ?? "");
  if (style === "win32") return WINDOWS_ABSOLUTE.test(text) || text.startsWith("\\\\");
  return text.startsWith("/");
}

/** The grammar's separator, chosen from what the path already uses. */
export function separatorOfPath(path) {
  return String(path ?? "").includes("\\") ? "\\" : "/";
}

/**
 * The root a path is anchored to.
 *
 * A Windows drive root keeps its slash so "C:" and "C:\" agree; a UNC share
 * root is the first two segments. Relative paths have no root.
 */
export function rootOfPath(path) {
  const text = String(path ?? "");
  if (text === "") return null;
  const drive = text.match(WINDOWS_DRIVE_PREFIX);
  if (drive !== null) return `${text.slice(0, 2)}\\`;
  const unc = text.match(UNC_ROOT);
  if (unc !== null) return unc[0];
  if (text.startsWith("/")) return "/";
  return null;
}

/** Drop trailing separators but keep a root spelling intact. */
export function stripTrailingSeparators(path) {
  const text = String(path ?? "");
  if (text === "") return "";
  if (WINDOWS_DRIVE_ONLY.test(text)) return `${text}\\`;
  if (WINDOWS_ROOT.test(text)) return `${text.slice(0, 2)}\\`;
  const stripped = text.replace(/[\\/]+$/u, "");
  if (stripped === "") return text.startsWith("/") ? "/" : text;
  return stripped;
}

/** Split off the final segment, reporting whether the path is itself a root. */
export function splitLastSegment(path) {
  const text = String(path ?? "");
  const root = rootOfPath(text);
  const body = stripTrailingSeparators(text);
  if (body === "" || body === root) {
    return { parent: root ?? "", name: "", isRoot: root !== null };
  }
  const index = Math.max(body.lastIndexOf("\\"), body.lastIndexOf("/"));
  if (index < 0) return { parent: "", name: body, isRoot: false };
  return { parent: body.slice(0, index + 1), name: body.slice(index + 1), isRoot: false };
}

/** True when the path names a filesystem root rather than a directory inside one. */
export function isRootPath(path) {
  const text = String(path ?? "");
  if (text === "") return false;
  return splitLastSegment(text).isRoot;
}

/** The parent directory, always ending with a separator. */
export function parentWithSeparator(path) {
  const text = String(path ?? "");
  if (text === "") return null;
  const split = splitLastSegment(text);
  if (split.isRoot) return withTrailingSeparator(split.parent);
  if (split.parent === "") return null;
  return withTrailingSeparator(split.parent);
}

/** Append the grammar's separator unless the path already ends with one. */
export function withTrailingSeparator(path) {
  const text = String(path ?? "");
  if (text === "") return "";
  if (WINDOWS_DRIVE_ONLY.test(text)) return `${text}\\`;
  const separator = separatorOfPath(text);
  return text.endsWith(separator) ? text : `${text}${separator}`;
}

/** Join one segment onto a directory, keeping the directory's spelling. */
export function joinPath(directory, name) {
  const dir = String(directory ?? "");
  const part = String(name ?? "").replace(/^[\\/]+/u, "");
  if (part === "") return dir;
  if (dir === "") return part;
  const separator = separatorOfPath(dir);
  const base = dir.endsWith("\\") || dir.endsWith("/") ? dir : `${dir}${separator}`;
  return `${base}${part}`;
}

/**
 * Fold a path for equality checks.
 *
 * Windows paths are case-insensitive and may mix separators; POSIX paths are
 * case-sensitive and a backslash is an ordinary filename character, so only
 * the Windows branch rewrites anything.
 */
export function normalizeForCompare(path, style) {
  let text = String(path ?? "");
  if (text === "") return "";
  if (style === "win32") text = text.replace(/\//gu, "\\").toLocaleLowerCase();
  const separator = style === "win32" ? "\\" : "/";
  while (text.length > 1 && text.endsWith(separator)) text = text.slice(0, -1);
  return text;
}
