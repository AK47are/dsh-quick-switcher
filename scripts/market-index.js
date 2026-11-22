/* Regenerate market/index.json, the format-1 plugin index a DSH Discover tab
 * reads to list and install this bundle. The index is committed, so this
 * script appends exactly one version entry per release and validates the whole
 * document with the same package DSH itself uses before writing it. */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseMarketIndex } from "@deepseek-ai/dsh-plugin-market-index";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const indexPath = join(root, "market", "index.json");
const repoUrl = "https://github.com/AK47are/dsh-quick-switcher";
// Relative icon references resolve against this URL, so it must match the
// address users add to Discover. The main branch is the only published one.
const indexUrl = "https://raw.githubusercontent.com/AK47are/dsh-quick-switcher/main/market/index.json";
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

const plugin = {
  title: { en: "Quick switcher", zh: "快速切换器" },
  description: {
    en: "One search surface for sessions, workspaces, opening or creating a workspace from a directory path, commands, input history, main panels, workspace files, archived sessions, and a side question that never enters the main conversation.",
    zh: "统一搜索入口：切换会话、浏览工作区、按路径打开或创建工作区、运行命令、回填输入历史、跳到主面板、搜索文件、找回已归档会话，还能就当前会话侧问。",
  },
  icon: "../icon.svg",
  author: "AK47are",
  homepage: "https://github.com/AK47are/dsh-quick-switcher#readme",
  repository: { url: "https://github.com/AK47are/dsh-quick-switcher" },
};

function emptyIndex() {
  return {
    format: 1,
    title: { en: "Quick switcher", zh: "快速切换器" },
    description: {
      en: "Community plugin index for dsh-quick-switcher.",
      zh: "dsh-quick-switcher 的插件索引。",
    },
    metadata: {
      categories: { ui: { title: { en: "Interface", zh: "界面" } } },
    },
    plugins: [],
  };
}

function readIndex() {
  return existsSync(indexPath) ? JSON.parse(readFileSync(indexPath, "utf8")) : emptyIndex();
}

/**
 * The install source for this version. npm is the intended route but is not
 * published yet, so the default pins a commit: a git source makes Discover
 * installs work from a public repository, at the cost of one build-script
 * approval while pnpm runs prepare.
 */
function releaseSource() {
  if (process.env.MARKET_SOURCE === "npm") {
    return {
      publishTimestamp: Number(process.env.MARKET_PUBLISH_TIME ?? Math.floor(Date.now() / 1000)),
      source: { type: "npm" },
    };
  }
  const commit = execSync("git rev-parse HEAD", { cwd: root, encoding: "utf8" }).trim();
  const committedAt = Number(execSync("git log -1 --format=%ct", { cwd: root, encoding: "utf8" }).trim());
  return {
    publishTimestamp: Number(process.env.MARKET_PUBLISH_TIME ?? committedAt),
    source: { type: "git", url: repoUrl, commit },
  };
}

/** Replace the entry for the current package version, keeping older versions. */
function withCurrentVersion(index) {
  const existing = index.plugins.find((entry) => entry.name === pkg.name);
  const version = {
    version: pkg.version,
    ...releaseSource(),
    engines: pkg.engines?.dsh === undefined ? {} : { dsh: pkg.engines.dsh },
  };
  const versions = (existing?.versions ?? [])
    .filter((entry) => entry.version !== version.version)
    .concat(version);

  return {
    ...index,
    plugins: [
      ...index.plugins.filter((entry) => entry.name !== pkg.name),
      {
        name: pkg.name,
        ...plugin,
        metadata: { category: "ui", keywords: ["search", "session", "command palette"] },
        versions,
      },
    ],
  };
}

/**
 * Sort versions by descending SemVer precedence using the validator itself:
 * parseMarketIndex returns each plugin's versions already ordered, so read the
 * order back instead of reimplementing SemVer comparison.
 */
function sortVersions(index) {
  const parsed = parseMarketIndex(index, indexUrl);
  const order = new Map(
    parsed.plugins.find((entry) => entry.name === pkg.name).versions.map((entry, position) => [entry.version, position]),
  );
  for (const entry of index.plugins) {
    if (entry.name !== pkg.name) continue;
    entry.versions.sort((left, right) => order.get(left.version) - order.get(right.version));
  }
  return index;
}

function check(index) {
  const parsed = parseMarketIndex(index, indexUrl);
  const entry = parsed.plugins.find((candidate) => candidate.name === pkg.name);
  if (entry === undefined) {
    throw new Error(`market/index.json does not list ${pkg.name}`);
  }
  const version = entry.versions.find((candidate) => candidate.version === pkg.version);
  if (version === undefined) {
    throw new Error(`market/index.json is missing ${pkg.version}; run npm run market`);
  }
  return parsed;
}

if (process.argv.includes("--check")) {
  // Validate the committed document itself: injecting the current version
  // before checking would make a stale index pass, which is the one failure
  // this mode exists to catch.
  check(readIndex());
  console.log(`market/index.json lists ${pkg.name}@${pkg.version}`);
} else {
  const index = sortVersions(withCurrentVersion(readIndex()));
  check(index);
  writeFileSync(indexPath, JSON.stringify(index, null, 2) + "\n");
  console.log(`market/index.json written for ${pkg.name}@${pkg.version}`);
}
