import assert from "node:assert/strict";
import test from "node:test";
import {
  HISTORY_LIMIT,
  collectPrompts,
  historyEntries,
  isInputFrozen,
  previewPrompt,
} from "../src/data/history.js";
import { createHistoryStore } from "../src/history-store.js";
import { createOpenStore } from "../src/open-store.js";
import { createHistoryRoute } from "../src/routes/history.js";
import { createSessionsRoute } from "../src/routes/sessions.js";

const t = (key, vars) => (vars === undefined ? key : `${key}:${vars.count}`);

function nodeStore(nodes) {
  const map = new Map(nodes.map((node) => [node.key, node]));
  return { get: (key) => map.get(key) };
}

function userNode(key, seq, text, overrides = {}) {
  return {
    key,
    kind: "user",
    data: {
      kind: "user",
      messageId: `m${seq}`,
      seq,
      time: seq * 1000,
      content: [{ type: "text", text }],
      source: { kind: "user" },
      ...overrides.data,
    },
    ...overrides.node,
  };
}

function prompt(seq, text, kind = "user") {
  return { key: `k${seq}`, seq, time: seq * 1000, kind, text };
}

function historyState(overrides = {}) {
  return {
    sessionId: "s1",
    prompts: [],
    draft: "",
    phase: "plain",
    hasMore: false,
    loadingOlder: false,
    ...overrides,
  };
}

function context(history, now = 10_000) {
  return { history, t, now };
}

function viewOf(history, query = "!") {
  const route = createHistoryRoute();
  return route.view(route.parse(query), context(history));
}

test("collectPrompts keeps human text and drops context or attachment-only messages", () => {
  const nodes = nodeStore([
    userNode("a", 1, "First prompt"),
    { key: "b", kind: "context", data: { seq: 2, time: 2000, content: [], source: { kind: "compact-checkpoint" } } },
    {
      key: "c",
      kind: "user",
      data: { seq: 3, time: 3000, content: [{ type: "image", attachment: { id: "x" } }], source: { kind: "user" } },
    },
    userNode("d", 4, "Steer this", { node: { kind: "steering" } }),
    userNode("e", 5, "   "),
    userNode("f", 6, "Injected", { data: { source: { kind: "agent-instructions" } } }),
  ]);
  const prompts = collectPrompts(["a", "b", "c", "d", "e", "f"], nodes);
  assert.deepEqual(
    prompts.map((entry) => [entry.key, entry.seq, entry.kind, entry.text]),
    [
      ["a", 1, "user", "First prompt"],
      ["d", 4, "steering", "Steer this"],
    ],
  );
});

test("collectPrompts joins text blocks and tolerates a missing window", () => {
  const node = userNode("a", 1, "one");
  node.data.content = [
    { type: "text", text: "one" },
    { type: "image", attachment: { id: "x" } },
    { type: "text", text: "two" },
  ];
  assert.deepEqual(
    collectPrompts(["a"], nodeStore([node])).map((entry) => entry.text),
    ["one\ntwo"],
  );
  assert.deepEqual(collectPrompts(undefined, undefined), []);
});

test("previewPrompt collapses whitespace and clips the single-line preview", () => {
  assert.equal(previewPrompt("  hello \n world  "), "hello world");
  assert.equal(previewPrompt("   "), "");
  assert.equal(previewPrompt("x".repeat(300), 10).length, 10);
});

test("historyEntries is newest first and only folds adjacent duplicates", () => {
  const rows = historyEntries([
    prompt(1, "same"),
    prompt(2, "same"),
    prompt(3, "other"),
    prompt(4, "same"),
  ]);
  assert.deepEqual(
    rows.map((entry) => [entry.seq, entry.title]),
    [
      [4, "same"],
      [3, "other"],
      [2, "same"],
    ],
  );
  assert.deepEqual(
    historyEntries([prompt(1, "a"), prompt(2, "b"), prompt(3, "c")], 2).map(
      (entry) => entry.seq,
    ),
    [3, 2],
  );
  assert.equal(HISTORY_LIMIT, 200);
});

test("isInputFrozen covers the three phases that own the draft", () => {
  for (const phase of ["adjudicating", "submitting", "sending"]) {
    assert.equal(isInputFrozen(phase), true);
  }
  for (const phase of ["plain", "claimed", undefined]) {
    assert.equal(isInputFrozen(phase), false);
  }
});

test("the default list advertises the history prefix in its hints", () => {
  const view = createSessionsRoute().view({ filter: "" }, { sessionEntries: [], t });
  assert.equal(view.hints.some((hint) => hint.keys[0] === "!"), true);
});

test("bang claims history and leaves the other prefixes alone", () => {
  const route = createHistoryRoute();
  assert.deepEqual(route.parse("!fix"), { filter: "fix" });
  assert.deepEqual(route.parse("!"), { filter: "" });
  assert.equal(route.parse(">history"), null);
  assert.equal(route.parse("+work"), null);
  assert.equal(route.parse(""), null);
});

test("history rows are newest first and mark steering", () => {
  const view = viewOf(
    historyState({
      prompts: [prompt(1, "old"), prompt(2, "new"), prompt(3, "steer", "steering")],
    }),
  );
  assert.deepEqual(
    view.rows.map((row) => [row.title, row.badge]),
    [
      ["steer", "historySteeringBadge"],
      ["new", null],
      ["old", null],
    ],
  );
  assert.equal(view.rows[0].meta[0].text, "time.justNow");
  assert.equal(view.count, "countHistory:3");
  assert.deepEqual(view.rows[1].run(), { type: "history", text: "new" });
});

test("a non-empty draft leads and hides the newest prompt it duplicates", () => {
  const view = viewOf(
    historyState({
      draft: "draft text",
      prompts: [prompt(1, "older"), prompt(2, "draft text")],
    }),
  );
  assert.deepEqual(
    view.rows.map((row) => [row.title, row.badge]),
    [
      ["draft text", "historyDraftBadge"],
      ["older", null],
    ],
  );
  assert.deepEqual(view.rows[0].run(), { type: "history", text: "draft text" });
});

test("an empty draft adds no draft row and no duplicate check", () => {
  const view = viewOf(historyState({ prompts: [prompt(1, "only")] }));
  assert.deepEqual(view.rows.map((row) => row.title), ["only"]);
});

test("hasMore adds the load row and loadingOlder disables it", () => {
  const ready = viewOf(
    historyState({ prompts: [prompt(1, "p")], hasMore: true }),
  );
  assert.deepEqual(
    ready.rows.map((row) => [row.key, row.action === true, row.title]),
    [
      ["h:p:k1", false, "p"],
      ["h:o", true, "historyLoadEarlier"],
    ],
  );
  assert.deepEqual(ready.rows[1].run(), { type: "history-older" });

  const loading = viewOf(
    historyState({ prompts: [prompt(1, "p")], hasMore: true, loadingOlder: true }),
  );
  assert.equal(loading.rows[1].title, "historyLoading");
  assert.equal(loading.rows[1].run, undefined);
});

test("a frozen input disables the fill rows and explains why", () => {
  const view = viewOf(
    historyState({
      draft: "d",
      prompts: [prompt(1, "p")],
      phase: "sending",
    }),
  );
  assert.equal(view.rows[0].run, undefined);
  assert.equal(view.rows[1].run, undefined);
  assert.equal(view.note, "historyFrozen");
  assert.deepEqual(view.hints, [{ keys: ["Esc"], label: "hintClose" }]);
});

test("the load row disappears once the visible list hits its cap", () => {
  const many = Array.from({ length: HISTORY_LIMIT }, (_, index) =>
    prompt(index + 1, `prompt ${index + 1}`),
  );
  const capped = viewOf(historyState({ prompts: many, hasMore: true }));
  assert.equal(capped.rows.length, HISTORY_LIMIT);
  assert.equal(capped.rows.some((row) => row.action === true), false);

  const almost = viewOf(
    historyState({ prompts: many.slice(0, HISTORY_LIMIT - 1), hasMore: true }),
  );
  assert.equal(almost.rows.at(-1).key, "h:o");
});

test("empty states distinguish no session, no prompts, and no matches", () => {
  assert.equal(viewOf(historyState({ sessionId: null })).emptyText, "historyNoSession");
  assert.equal(viewOf(historyState()).emptyText, "emptyHistory");
  assert.equal(
    viewOf(historyState({ prompts: [prompt(1, "p")] }), "!zzz").emptyText,
    "emptyHistoryMatches",
  );
});

test("the store refuses writes without a session and while frozen", () => {
  const store = createHistoryStore();
  let written = null;
  let loads = 0;
  assert.equal(store.hasSession(), false);
  assert.equal(store.apply("text"), false);

  store.attach("s1", {
    setDraft: (text) => {
      written = text;
    },
    loadOlder: () => {
      loads += 1;
    },
  });
  assert.equal(store.hasSession(), true);
  store.publish({ prompts: [prompt(1, "p")], draft: "d", phase: "plain" });
  assert.equal(store.apply("text"), true);
  assert.equal(written, "text");

  store.publish({ phase: "sending" });
  assert.equal(store.apply("again"), false);

  store.loadOlder();
  assert.equal(loads, 1);

  store.detach("s1");
  assert.equal(store.hasSession(), false);
  assert.equal(store.apply("text"), false);
});

test("the store keeps the prompt array when the same messages republish", () => {
  const store = createHistoryStore();
  store.attach("s1", { setDraft: () => {}, loadOlder: () => {} });
  const first = [prompt(1, "p")];
  store.publish({ prompts: first });
  store.publish({ prompts: [prompt(1, "p")], draft: "typed" });
  assert.equal(store.getSnapshot().prompts, first);
  assert.equal(store.getSnapshot().draft, "typed");
});

test("the open store seeds history and toggles from the active route", () => {
  const store = createOpenStore();
  assert.deepEqual(store.getSnapshot(), {
    open: false,
    seed: "",
    prefix: "",
    captureDraft: true,
    generation: 0,
  });

  store.toggle();
  assert.equal(store.getSnapshot().open, true);
  assert.equal(store.getSnapshot().seed, "");
  assert.equal(store.getSnapshot().prefix, "");

  store.requestHistory();
  assert.equal(store.getSnapshot().open, true);
  assert.equal(store.getSnapshot().seed, "!");
  assert.equal(store.getSnapshot().prefix, "!");

  store.requestHistory();
  assert.equal(store.getSnapshot().open, false);

  store.requestHistory();
  assert.equal(store.getSnapshot().open, true);
  assert.equal(store.getSnapshot().seed, "!");
  assert.equal(store.getSnapshot().captureDraft, true);
  assert.equal(store.getSnapshot().generation, 4);

  store.close();
  store.requestHistory(false);
  assert.equal(store.getSnapshot().open, true);
  assert.equal(store.getSnapshot().captureDraft, false);
});

test("the open store trusts the reported prefix over the seed", () => {
  const store = createOpenStore();
  store.toggle();
  store.setPrefix("!");
  assert.equal(store.getSnapshot().prefix, "!");
  store.requestHistory();
  assert.equal(store.getSnapshot().open, false);

  store.requestHistory();
  store.setPrefix("");
  store.requestHistory();
  assert.equal(store.getSnapshot().open, true);
  assert.equal(store.getSnapshot().seed, "!");
  assert.equal(store.getSnapshot().prefix, "!");
});
