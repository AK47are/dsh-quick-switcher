import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCommandEntries,
  commandContext,
  commandRegion,
  resolveCommand,
} from "../src/modules/commands/logic.js";
import {
  RECENT_LIMIT,
  createRecentCommands,
  parseRecentCommands,
  pushRecentCommand,
} from "../src/modules/commands/recent.js";

const catalog = [
  {
    id: "session.new",
    label: "New session",
    aliases: ["new chat"],
    keys: ["Ctrl", "+", "N"],
  },
  {
    id: "settings.open",
    label: "Settings",
    aliases: ["preferences"],
    keys: ["Ctrl", "+", "Comma"],
  },
  {
    id: "shortcuts.open",
    label: "Shortcuts",
    aliases: ["keyboard shortcuts"],
    keys: [],
  },
];

const t = (key, vars) => (vars === undefined ? key : `${key}:${vars.count}`);

function context(commandEntries, commandsLoading = false) {
  return { commandEntries, commandsLoading, t };
}

function fakeStorage(initial = null) {
  let value = initial;
  return {
    getItem: () => value,
    setItem: (_key, next) => {
      value = next;
    },
    get value() {
      return value;
    },
  };
}

function command(resolve) {
  return { resolve };
}

test("commands list recents first, then the catalog by name", () => {
  const entries = buildCommandEntries(catalog, ["session.new"]);
  assert.deepEqual(
    entries.map((entry) => [entry.id, entry.isRecent]),
    [
      ["session.new", true],
      ["settings.open", false],
      ["shortcuts.open", false],
    ],
  );
  assert.deepEqual(entries[0].keys, ["Ctrl", "+", "N"]);
  assert.equal(entries[0].aliasesText, "new chat");
});

test("command rows show Latin aliases but hide translations and the label itself", () => {
  const [entry] = buildCommandEntries(
    [
      {
        id: "settings.open",
        label: "打开设置",
        aliases: ["settings", "Settings", "设置", "preferences"],
      },
    ],
    [],
  );
  assert.equal(entry.aliasesText, "settings · preferences");

  const [sameAsLabel] = buildCommandEntries(
    [{ id: "settings.open", label: "Settings", aliases: ["settings", "preferences"] }],
    [],
  );
  assert.equal(sameAsLabel.aliasesText, "preferences");

  const [chineseOnly] = buildCommandEntries(
    [{ id: "settings.open", label: "打开设置", aliases: ["设置"] }],
    [],
  );
  assert.equal(chineseOnly.aliasesText, "");
});

test("recents keep their order, skip unknown ids, and never repeat", () => {
  const entries = buildCommandEntries(catalog, [
    "shortcuts.open",
    "missing",
    "session.new",
    "shortcuts.open",
  ]);
  assert.deepEqual(
    entries.map((entry) => entry.id),
    ["shortcuts.open", "session.new", "settings.open"],
  );
});

test("resolveCommand forwards handled runs and keeps blocked reasons", () => {
  const run = () => {};
  const handled = resolveCommand(
    { commands: new Map([["id", command(() => ({ status: "handled", run }))]]) },
    "id",
    {},
  );
  assert.equal(handled.status, "handled");
  assert.equal(handled.run, run);

  assert.deepEqual(
    resolveCommand(
      {
        commands: new Map([
          ["id", command(() => ({ status: "blocked", reason: "no session" }))],
        ]),
      },
      "id",
      {},
    ),
    { status: "blocked", reason: "no session" },
  );
  assert.deepEqual(
    resolveCommand(
      { commands: new Map([["id", command(() => ({ status: "blocked" }))]]) },
      "id",
      {},
    ),
    { status: "blocked", reason: null },
  );
});

test("resolveCommand contains missing, passing, and throwing commands", () => {
  assert.equal(resolveCommand(undefined, "id", {}).status, "missing");
  assert.equal(
    resolveCommand(
      { commands: new Map([["id", command(() => ({ status: "pass" }))]]) },
      "id",
      {},
    ).status,
    "pass",
  );
  assert.equal(
    resolveCommand(
      {
        commands: new Map([
          ["id", command(() => ({ status: "handled" }))],
        ]),
      },
      "id",
      {},
    ).status,
    "pass",
  );
  const failure = resolveCommand(
    {
      commands: new Map([
        [
          "id",
          command(() => {
            throw new Error("boom");
          }),
        ],
      ]),
    },
    "id",
    {},
  );
  assert.equal(failure.status, "failed");
  assert.equal(failure.error.message, "boom");
});

test("command context restores the pre-open focus and pretends no modal is open", () => {
  const textarea = { closest: () => null };
  assert.deepEqual(commandContext(textarea), {
    target: textarea,
    region: "page",
    modal: null,
    source: "menu",
  });

  const inner = { closest: () => null };
  const host = { matches: () => false, shadowRoot: { activeElement: inner } };
  assert.equal(commandContext(host).target, inner);

  assert.equal(commandRegion({ closest: (selector) => (selector.includes("textarea") ? {} : null) }), "editable");
  assert.equal(commandRegion({ closest: (selector) => (selector === ".xterm" ? {} : null) }), "terminal");
  assert.equal(commandRegion(null), "page");
});

test("recent parsing drops malformed values and duplicates", () => {
  assert.deepEqual(parseRecentCommands('["a","b","a","",3]'), ["a", "b"]);
  assert.deepEqual(parseRecentCommands("not json"), []);
  assert.deepEqual(parseRecentCommands('{"a":1}'), []);
  assert.deepEqual(parseRecentCommands(""), []);

  const many = JSON.stringify(
    Array.from({ length: RECENT_LIMIT + 5 }, (_, index) => `id-${index}`),
  );
  assert.equal(parseRecentCommands(many).length, RECENT_LIMIT);
});

test("record moves one id to the front and persists it", () => {
  const storage = fakeStorage('["old"]');
  const recent = createRecentCommands(storage);
  assert.deepEqual(recent.read(), ["old"]);
  assert.deepEqual(recent.record("new"), ["new", "old"]);
  assert.deepEqual(JSON.parse(storage.value), ["new", "old"]);

  assert.deepEqual(pushRecentCommand(["a", "b"], "b"), ["b", "a"]);
  assert.deepEqual(
    pushRecentCommand(["a"], "b", 0),
    [],
  );
});

test("a denied storage keeps the recent list usable in memory", () => {
  const storage = {
    getItem: () => {
      throw new Error("denied");
    },
    setItem: () => {
      throw new Error("denied");
    },
  };
  const recent = createRecentCommands(storage);
  assert.deepEqual(recent.read(), []);
  assert.deepEqual(recent.record("id"), ["id"]);
});

