import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCommandEntries,
  commandContext,
  commandRegion,
  resolveCommand,
} from "../src/data/commands.js";
import {
  RECENT_LIMIT,
  createRecentCommands,
  parseRecentCommands,
  pushRecentCommand,
} from "../src/data/recent.js";
import { createCommandsRoute } from "../src/routes/commands.js";

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

test("command search matches labels first and aliases second", () => {
  const route = createCommandsRoute();
  const entries = buildCommandEntries(catalog, []);
  const byLabel = route.view(route.parse(">sett"), context(entries));
  assert.deepEqual(
    byLabel.rows.map((row) => row.key),
    ["x:settings.open"],
  );
  assert.ok(byLabel.rows[0].positions.size > 0);

  const byAlias = route.view(route.parse(">pref"), context(entries));
  assert.deepEqual(
    byAlias.rows.map((row) => row.key),
    ["x:settings.open"],
  );
  assert.equal(byAlias.rows[0].positions.size, 0);
});

test("the command route shows keycaps, the recent badge, and the run effect", () => {
  const route = createCommandsRoute();
  const entries = buildCommandEntries(catalog, ["session.new"]);
  const view = route.view(route.parse(">"), context(entries));
  assert.equal(view.placeholder, "placeholderCommands");
  assert.equal(view.count, "countCommands:3");
  assert.deepEqual(
    view.rows.map((row) => row.key),
    ["x:session.new", "x:settings.open", "x:shortcuts.open"],
  );
  assert.deepEqual(view.rows[0].keys, ["Ctrl", "+", "N"]);
  assert.equal(view.rows[0].meta[0].text, "new chat");
  assert.equal(view.rows[1].meta[0].text, "preferences");
  assert.equal(view.rows[0].badge, "recentBadge");
  assert.equal(view.rows[1].badge, undefined);
  assert.deepEqual(view.rows[1].run(), { type: "command", id: "settings.open" });
});

test("the command route explains loading, an empty catalog, and no match", () => {
  const route = createCommandsRoute();
  assert.equal(
    route.view(route.parse(">"), context([], true)).emptyText,
    "loadingCommands",
  );
  assert.equal(
    route.view(route.parse(">"), context([])).emptyText,
    "emptyCommands",
  );
  const entries = buildCommandEntries(catalog, []);
  assert.equal(
    route.view(route.parse(">zzz"), context(entries)).emptyText,
    "emptyCommandMatches",
  );
});

test("only a leading > claims the query", () => {
  const route = createCommandsRoute();
  assert.deepEqual(route.parse(">set"), { filter: "set" });
  assert.deepEqual(route.parse(">"), { filter: "" });
  assert.equal(route.parse("set"), null);
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
