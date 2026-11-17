/* Prove that the published tarball can load its own host entry. The source tree
 * works from a checkout, so only packing, extracting and importing the result
 * catches an entry that still depends on files the package does not ship. */

import { execFileSync, execSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const temp = mkdtempSync(join(tmpdir(), "dqs-pack-"));

try {
  execSync(`npm pack --pack-destination "${temp}"`, { cwd: root, stdio: "ignore" });
  const archive = readdirSync(temp).find((name) => name.endsWith(".tgz"));
  if (archive === undefined) throw new Error("npm pack produced no tarball");
  execFileSync("tar", ["-xzf", join(temp, archive), "-C", temp], { stdio: "ignore" });

  const required = [
    "package.json",
    "host.js",
    "client.js",
    "module.js",
    "LICENSE",
    "market/index.json",
  ];
  for (const name of required) {
    readFileSync(join(temp, "package", name));
  }
  // The entries are self-contained; source files in the tarball would mean a
  // bundle regressed into importing src/.
  if (existsSync(join(temp, "package", "src"))) {
    throw new Error("the packed package ships src/, so an entry is not self-contained");
  }

  const loaded = await import(pathToFileURL(join(temp, "package", "host.js")).href);
  if (typeof loaded.apply !== "function" || !Array.isArray(loaded.inject)) {
    throw new Error("the packed host entry does not export apply and inject");
  }
  console.log(`packed package loads: host entry exports apply and ${loaded.inject.length} injected services`);
} finally {
  rmSync(temp, { recursive: true, force: true });
}
