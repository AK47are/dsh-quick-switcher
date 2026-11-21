/**
 * Host half of the new-workspace mode.
 *
 * DSH's own directory browser only exists when the host composes the browse
 * directory picker. The loopback desktop host composes the native picker
 * instead, so `uiWorkspace.listDirectory` answers `directory-picker/
 * unavailable` there. This module therefore reads the filesystem directly for
 * two narrow jobs the mode needs: list the subdirectories of an absolute path,
 * and create a missing directory tree before DSH registers it.
 *
 * Both routes answer same-origin JSON only. They accept fully qualified paths
 * (a Windows drive or UNC share, or a POSIX absolute path) because DSH's own
 * `workspaces.create` rejects everything else, and they never create anything
 * unless a mkdir request asks for it by name.
 */
import { mkdir, readdir, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { isSameOrigin, messageOf, readJsonBody, sendJson } from "../../core/host/http.js";
import { defineHostModule } from "../../core/host/module.js";
import { LIST_PATH, MAX_ENTRIES, MAX_PATH_CHARS, MKDIR_PATH } from "./shared.js";

/** POST bodies carry one path, so anything larger is a malformed request. */
const MAX_MKDIR_BODY_BYTES = 8192;

/**
 * A fully qualified path is the only kind DSH can register.
 *
 * Windows also rejects a rooted path without a drive (`\foo`) here because it
 * depends on the process's current drive, which is not something a workspace
 * path may do.
 */
function isFullyQualified(path) {
  const text = String(path ?? "");
  if (process.platform !== "win32") return text.startsWith("/");
  return /^[A-Za-z]:[\\/]/u.test(text) || /^\\\\[^\\/]+[\\/][^\\/]+/u.test(text);
}

/** Translate one filesystem failure into the shape the client renders. */
function failureOf(error) {
  const code = typeof error?.code === "string" ? error.code : "";
  if (code === "ENOENT") {
    return { ok: false, code: "missing", message: "the directory does not exist" };
  }
  if (code === "ENOTDIR" || code === "EEXIST") {
    return { ok: false, code: "not-directory", message: "the path is not a directory" };
  }
  if (code === "EACCES" || code === "EPERM") {
    return { ok: false, code: "denied", message: "permission denied" };
  }
  return { ok: false, code: "io", message: messageOf(error) };
}

/** Follow a symlink or junction one level; only real directories are candidates. */
async function isDirectoryEntry(parent, dirent) {
  if (dirent.isDirectory()) return true;
  if (!dirent.isSymbolicLink()) return false;
  try {
    return (await stat(join(parent, dirent.name))).isDirectory();
  } catch {
    return false;
  }
}

/**
 * List the subdirectories of one absolute directory.
 *
 * `realpath` is resolved first so the client, the workspace list and DSH all
 * compare the same canonical spelling. Entries are capped and sorted here, so
 * the client only filters the segment the user is typing.
 */
async function listDirectory(target) {
  let canonical;
  try {
    canonical = await realpath(target);
  } catch (error) {
    return failureOf(error);
  }
  let info;
  try {
    info = await stat(canonical);
  } catch (error) {
    return failureOf(error);
  }
  if (!info.isDirectory()) {
    return { ok: false, code: "not-directory", message: "the path is not a directory" };
  }
  let dirents;
  try {
    dirents = await readdir(canonical, { withFileTypes: true });
  } catch (error) {
    return failureOf(error);
  }

  const entries = [];
  let truncated = false;
  for (const dirent of dirents) {
    if (entries.length >= MAX_ENTRIES) {
      truncated = true;
      break;
    }
    if (!(await isDirectoryEntry(canonical, dirent))) continue;
    entries.push({
      name: dirent.name,
      path: join(canonical, dirent.name),
      hidden: dirent.name.startsWith("."),
    });
  }
  entries.sort((left, right) =>
    left.name.localeCompare(right.name, undefined, { sensitivity: "base" }),
  );

  const parent = dirname(canonical);
  return {
    ok: true,
    path: canonical,
    parent: parent === canonical ? null : parent,
    separator: sep,
    platform: process.platform,
    home: homedir(),
    entries,
    truncated,
  };
}

/** GET /dsh-quick-switcher/paths?path=<absolute> */
async function listRoute(request, response) {
  if (request.method !== "GET") {
    return sendJson(response, 405, { error: "GET required" }, { allow: "GET" });
  }
  if (!isSameOrigin(request)) return sendJson(response, 403, { error: "untrusted origin" });

  let url;
  try {
    url = new URL(request.url ?? "/", "http://localhost");
  } catch {
    return sendJson(response, 400, { error: "invalid request url" });
  }
  const raw = url.searchParams.get("path") ?? "";
  if (raw.length > MAX_PATH_CHARS) {
    return sendJson(response, 400, { ok: false, code: "invalid", message: "path is too long" });
  }
  if (raw.trim() !== "" && !isFullyQualified(raw)) {
    return sendJson(response, 400, {
      ok: false,
      code: "invalid",
      message: "path must be absolute",
    });
  }
  const target = raw.trim() === "" ? homedir() : resolve(raw);
  return sendJson(response, 200, await listDirectory(target));
}

/** POST /dsh-quick-switcher/paths/mkdir with `{ path }` */
async function mkdirRoute(request, response) {
  if (request.method !== "POST") {
    return sendJson(response, 405, { error: "POST required" }, { allow: "POST" });
  }
  if (!isSameOrigin(request)) return sendJson(response, 403, { error: "untrusted origin" });

  let body;
  try {
    body = await readJsonBody(request, MAX_MKDIR_BODY_BYTES);
  } catch (error) {
    const status = typeof error?.status === "number" ? error.status : 400;
    return sendJson(response, status, { error: messageOf(error) });
  }
  const raw = typeof body?.path === "string" ? body.path : "";
  if (raw.trim() === "" || raw.length > MAX_PATH_CHARS || !isFullyQualified(raw)) {
    return sendJson(response, 400, {
      ok: false,
      code: "invalid",
      message: "path must be absolute",
    });
  }

  const target = resolve(raw);
  try {
    await mkdir(target, { recursive: true });
  } catch (error) {
    return sendJson(response, 200, failureOf(error));
  }
  let canonical = target;
  try {
    canonical = await realpath(target);
  } catch {
    // The directory was just created, so a failed realpath is unusual; the
    // resolved spelling is still a usable registration path.
  }
  return sendJson(response, 200, { ok: true, path: canonical });
}

export default defineHostModule("new-workspace", () => ({
  routes: [
    { path: LIST_PATH, handler: listRoute },
    { path: MKDIR_PATH, handler: mkdirRoute },
  ],
}));
