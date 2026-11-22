/* Query parsing for the "=" path mode. */

import {
  inferStyle,
  isAbsolutePath,
  joinPath,
  rootOfPath,
  splitLastSegment,
  stripTrailingSeparators,
} from "../../core/lib/paths.js";

const WINDOWS_DRIVE_ONLY = /^[A-Za-z]:$/u;
const WINDOWS_ROOTED = /^[\\/]/u;

/**
 * Split the text after "=" into the directory to list and the segment to filter.
 *
 * The mode has three shapes:
 *
 * - `fragment`: the text names a partial segment. The parent directory is listed
 *   and the last segment filters it, so typing "pro" keeps listing the parent
 *   instead of refetching on every keystroke.
 * - `intent`: the text ends with a separator, or is an absolute root. It names
 *   the directory itself, so the list shows that directory as the commit target
 *   plus its children.
 * - `none`: no starting directory is known yet, or the text is not absolute and
 *   there is nothing to resolve it against.
 *
 * A relative text is resolved against the starting directory. That keeps the
 * mode usable after the user deletes the seeded prefix, without inventing a
 * separate grammar.
 */
export function parseCreateQuery(text, options = {}) {
  const raw = typeof text === "string" ? text : "";
  const startDir =
    typeof options.startDir === "string" && options.startDir !== "" ? options.startDir : null;
  const style = options.style === "win32" ? "win32" : "posix";

  if (raw === "") {
    if (startDir === null) return { kind: "none", reason: "missing-start" };
    return {
      kind: "fragment",
      style,
      absolute: true,
      directory: startDir,
      fragment: "",
      target: null,
    };
  }

  // A bare drive spec is already a directory target: "D:" means "D:\".
  if (style === "win32" && WINDOWS_DRIVE_ONLY.test(raw)) {
    return intentFor(`${raw}\\`, style, true);
  }

  let full = raw;
  const absolute = isAbsolutePath(raw, style);
  if (!absolute) {
    if (startDir === null) return { kind: "none", reason: "not-absolute", fragment: raw };
    if (style === "win32" && WINDOWS_ROOTED.test(raw)) {
      // "\foo" is rooted on the starting directory's drive rather than absolute.
      const root = rootOfPath(startDir) ?? startDir;
      full = joinPath(root, raw);
    } else {
      full = joinPath(startDir, raw);
    }
  }

  if (/[\\/]$/u.test(full)) {
    return intentFor(stripTrailingSeparators(full), style, absolute);
  }
  if (style === "win32" && WINDOWS_DRIVE_ONLY.test(full)) {
    return intentFor(`${full}\\`, style, true);
  }
  const split = splitLastSegment(full);
  // A UNC share root has no final segment to filter; it is the target itself.
  if (split.isRoot) return intentFor(split.parent, style, true);
  if (split.parent === "") return { kind: "none", reason: "invalid" };
  return {
    kind: "fragment",
    style,
    absolute,
    directory: split.parent,
    fragment: split.name,
    target: null,
  };
}

function intentFor(directory, style, absolute) {
  return {
    kind: "intent",
    style,
    absolute,
    directory,
    fragment: "",
    target: directory,
  };
}

/**
 * Pick the separator grammar before the host has answered once.
 *
 * The starting directory is the reliable clue; the user agent only has to cover
 * a profile where no workspace is open and the home directory is not known yet.
 */
export function guessStyle(startDir) {
  const inferred = inferStyle(startDir);
  if (inferred !== null) return inferred;
  const agent = globalThis.navigator?.userAgent ?? "";
  return /windows/iu.test(agent) ? "win32" : "posix";
}
