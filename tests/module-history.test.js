import assert from "node:assert/strict";
import test from "node:test";
import {
  HISTORY_LIMIT,
  collectPrompts,
  createHistoryStore,
  createHistoryView,
  historyEntries,
  isInputFrozen,
  previewPrompt,
} from "../src/modules/history/logic.js";

const t = (key, params) =>
  params !== undefined && Object.hasOwn(params, "count") ? `${key}:${params.count}` : key;

function panelOf(overrides = {}) {
  return {
    now: 5000,
    setNotice(text) {
      this.notice = text;
    },
    setError(text) {
      this.error = text;
    },
    notify() {},
    ...overrides,
  };
}

function nodesOf(entries) {
  return new Map(entries.map(([key, node]) => [key, { key, ...node }]));
}

function userNode(text, seq = 1, time = 1000) {
  return {
    kind: "user",
    data: { source: { kind: "user" }, seq, time, content: [{ type: "text", text }] },
  };
}

function answerNode(questions, answers, time = 3000) {
  return {
    kind: "question-reply",
    anchorSeq: 9,
    data: { questions, answers, time },
  };
}

test("the chat window projects prompts and recorded answers in order", () => {
  const nodes = nodesOf([
    ["a", userNode("Hello")],
    ["b", { kind: "steering", data: { source: { kind: "user" }, seq: 2, time: 2000, content: [{ type: "text", text: "Wait" }] } }],
    ["c", { kind: "user", data: { source: { kind: "system" }, content: [{ type: "text", text: "injected" }] } }],
    ["d", { kind: "user", data: { source: { kind: "user" }, content: [{ type: "image" }] } }],
    [
      "e",
      answerNode(
        [
          { id: "q1", header: "Plan", question: "Proceed?" },
          { id: "q2", question: "Skip" },
          { id: "q3", header: "Name", question: "Which?" },
        ],
        [
          { id: "q1", selected: ["Yes"] },
          { id: "q3", selected: ["A"], custom: "B" },
        ],
      ),
    ],
  ]);
  const prompts = collectPrompts(["a", "b", "c", "d", "e"], nodes);
  assert.deepEqual(
    prompts.map((prompt) => [prompt.kind, prompt.text]),
    [
      ["user", "Hello"],
      ["steering", "Wait"],
      ["answer", "Yes"],
      ["answer", "A, B"],
    ],
  );
  assert.equal(prompts[3].question, "Name Which?");
});

test("history entries are newest first and fold only adjacent retries", () => {
  const prompts = [
    { key: "1", kind: "user", text: "one", seq: 1, time: 1 },
    { key: "2", kind: "user", text: "two", seq: 2, time: 2 },
    { key: "3", kind: "user", text: "two", seq: 3, time: 3 },
    { key: "4", kind: "answer", text: "yes", seq: 4, time: 4 },
    { key: "5", kind: "answer", text: "yes", seq: 5, time: 5 },
    { key: "6", kind: "user", text: "two", seq: 6, time: 6 },
  ];
  const rows = historyEntries(prompts, HISTORY_LIMIT);
  assert.deepEqual(
    rows.map((row) => `${row.kind}:${row.text}`),
    ["user:two", "answer:yes", "answer:yes", "user:two", "user:one"],
  );
  assert.equal(rows[0].title, "two");
  assert.equal(previewPrompt("  a\n b  "), "a b");
  assert.equal(previewPrompt("x".repeat(300)).length, 240);
  assert.equal(isInputFrozen("sending"), true);
  assert.equal(isInputFrozen("plain"), false);
});

test("the store merges patches, attaches writes and refuses frozen input", () => {
  const store = createHistoryStore();
  const writes = [];
  store.attach("s1", {
    setDraft: (text) => writes.push(text),
    loadOlder: async () => "page",
  });
  assert.equal(store.hasSession(), true);
  assert.equal(store.getSnapshot().sessionId, "s1");
  store.publish({ prompts: [{ key: "a", text: "Hello" }], draft: "hi" });
  assert.equal(store.getSnapshot().draft, "hi");
  assert.equal(store.apply("Hello"), true);
  assert.deepEqual(writes, ["Hello"]);
  store.publish({ phase: "sending" });
  assert.equal(store.apply("Nope"), false);
  assert.equal(store.apply(""), false);
  store.detach("s1");
  assert.equal(store.hasSession(), false);
  return store.loadOlder().then(
    () => assert.fail("expected a rejection"),
    (error) => assert.match(error.message, /no session/),
  );
});

test("the history view builds the draft row, answer rows and the older-page row", async () => {
  const store = createHistoryStore();
  const writes = [];
  store.attach("s1", {
    setDraft: (text) => writes.push(text),
    loadOlder: async () => {},
  });
  store.publish({
    sessionId: "s1",
    prompts: [
      { key: "p1", seq: 1, time: 1000, kind: "user", text: "Hello" },
      { key: "p2", seq: 2, time: 2000, kind: "steering", text: "Wait" },
      { key: "p3", seq: 3, time: 3000, kind: "answer", text: "Yes", question: "Proceed?" },
    ],
    draft: "live draft",
    phase: "plain",
    hasMore: true,
    loadingOlder: false,
  });
  const view = createHistoryView({ api: { t }, store, draftAtOpen: "draft at open" });
  const panel = panelOf();
  const result = view({ filter: "" }, panel);
  assert.equal(result.rows[0].key, "h:d");
  assert.equal(result.rows[0].badge, "historyDraftBadge");
  assert.equal(result.rows.length, 5);
  assert.equal(result.rows[1].badge, "historyAnswerBadge");
  assert.equal(result.rows[2].badge, "historySteeringBadge");
  assert.equal(result.rows[3].badge, null);
  assert.equal(result.rows[1].meta[0].text, "time.justNow");
  assert.equal(result.count, "countHistory:4");
  assert.equal(result.hints[0].label, "hintFill");

  result.rows[0].run();
  assert.deepEqual(writes, ["draft at open"]);
  assert.equal(panel.notice, "historyApplied");
  assert.equal(panel.error, null);

  const older = result.rows.at(-1);
  assert.equal(older.key, "h:o");
  assert.equal(older.action, true);
  assert.equal(older.title, "historyLoadEarlier");
  await older.run();
});

test("a frozen input disables every write and explains itself", () => {
  const store = createHistoryStore();
  store.attach("s1", { setDraft() {}, loadOlder: async () => {} });
  store.publish({
    sessionId: "s1",
    prompts: [{ key: "p1", seq: 1, time: 1000, kind: "user", text: "Hello" }],
    draft: "",
    phase: "sending",
    hasMore: false,
    loadingOlder: false,
  });
  const view = createHistoryView({ api: { t }, store, draftAtOpen: "" });
  const result = view({ filter: "" }, panelOf());
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].run, undefined);
  assert.equal(result.note, "historyFrozen");
  assert.deepEqual(result.hints, [{ keys: ["Esc"], label: "hintClose" }]);
});

test("a filter that matches nothing keeps the action rows and notes the miss", () => {
  const store = createHistoryStore();
  store.attach("s1", { setDraft() {}, loadOlder: async () => {} });
  store.publish({
    sessionId: "s1",
    prompts: [{ key: "p1", seq: 1, time: 1000, kind: "user", text: "Hello" }],
    draft: "draft",
    phase: "plain",
    hasMore: true,
    loadingOlder: false,
  });
  const view = createHistoryView({ api: { t }, store, draftAtOpen: "draft" });
  const result = view({ filter: "zzz" }, panelOf());
  assert.deepEqual(
    result.rows.map((row) => row.key),
    ["h:d", "h:o"],
  );
  assert.equal(result.note, "emptyHistoryMatches");
});

test("applying the text fails with a visible error when no bridge is attached", () => {
  const store = createHistoryStore();
  store.publish({
    sessionId: null,
    prompts: [],
    draft: "",
    phase: "plain",
    hasMore: false,
    loadingOlder: false,
  });
  const view = createHistoryView({ api: { t }, store, draftAtOpen: "orphan" });
  const panel = panelOf();
  const result = view({ filter: "" }, panel);
  result.rows[0].run();
  assert.equal(panel.notice, null);
  assert.equal(panel.error, "historyApplyFailed");
});
