/* Row shape: a command's shortcut, its recent mark and the digit jump share
 * the capsule language, and the bordered keycap is left to the footer. The
 * test bundles the real row component with the same React and primitives
 * stubs the contract test uses, then inspects the element tree it returns. */

import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

async function loadRowView() {
  const entry = fileURLToPath(new URL("../src/core/panel/rows.js", import.meta.url));
  const stub = fileURLToPath(new URL("./react-stub.js", import.meta.url));
  const primitives = fileURLToPath(new URL("./primitives-stub.js", import.meta.url));
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    format: "esm",
    platform: "node",
    logLevel: "silent",
    plugins: [
      {
        name: "dsh-stubs",
        setup(builder) {
          builder.onResolve({ filter: /^react$/ }, () => ({ path: stub }));
          builder.onResolve(
            { filter: /^@deepseek-ai\/dsh-client-ui-primitives$/ },
            () => ({ path: primitives }),
          );
        },
      },
    ],
  });
  const directory = await mkdtemp(join(tmpdir(), "dqs-rows-"));
  const file = join(directory, "rows.mjs");
  try {
    await writeFile(file, result.outputFiles[0].text, "utf8");
    return (await import(pathToFileURL(file).href)).RowView;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

const RowView = await loadRowView();

function childrenOf(element) {
  return (element.children ?? []).flat(Infinity).filter((child) => child !== null && typeof child === "object");
}

function findByClass(element, name) {
  const className = typeof element.props?.className === "string" ? element.props.className : "";
  if (className.split(" ").includes(name)) return element;
  for (const child of childrenOf(element)) {
    const found = findByClass(child, name);
    if (found !== null) return found;
  }
  return null;
}

function textsOf(element) {
  return (element.children ?? [])
    .flat(Infinity)
    .filter((child) => child !== null)
    .map((child) => (typeof child === "object" ? child.children.join("") : String(child)));
}

function commandRow(overrides = {}) {
  return {
    key: "x:session.new",
    title: "New session",
    meta: [],
    keys: ["Ctrl", "+", "Alt", "+", "N"],
    badge: "最近",
    className: "dqs-command-row",
    ...overrides,
  };
}

function render(row, { index = 0, platform = "windows" } = {}) {
  return RowView({
    row,
    selected: false,
    index,
    platform,
    onPointerMove: () => {},
    onActivate: () => {},
    registerRef: () => {},
  });
}

test("a command keeps its whole shortcut in one capsule", () => {
  const tree = render(commandRow());
  const shortcut = findByClass(tree, "dqs-shortcut");
  assert.equal(shortcut.type, "kbd");
  assert.equal(shortcut.props.className, "dqs-chip dqs-shortcut");
  assert.deepEqual(textsOf(shortcut), ["Ctrl", "+", "Alt", "+", "N"]);
  assert.equal(findByClass(tree, "dqs-keycap"), null);
});

test("the recent mark and the jump hint are capsules too", () => {
  const tree = render(commandRow(), { index: 6 });
  const badge = findByClass(tree, "dqs-badge");
  const jump = findByClass(tree, "dqs-jump");
  assert.equal(badge.props.className, "dqs-chip dqs-badge");
  assert.deepEqual(textsOf(badge), ["最近"]);
  assert.equal(jump.props.className, "dqs-chip dqs-jump");
  assert.deepEqual(textsOf(jump), ["Alt", "+", "7"]);
});

test("the jump capsule follows the macOS label", () => {
  const tree = render(commandRow({ keys: [], badge: undefined }), {
    index: 0,
    platform: "macos",
  });
  assert.deepEqual(textsOf(findByClass(tree, "dqs-jump")), ["⌥", "1"]);
  assert.equal(findByClass(tree, "dqs-shortcut"), null);
});

test("row ten has no jump capsule or aria shortcut", () => {
  const tree = render(commandRow({ keys: [], badge: undefined }), { index: 9 });
  assert.equal(findByClass(tree, "dqs-jump"), null);
  assert.equal(tree.props["aria-keyshortcuts"], undefined);
});
