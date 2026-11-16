import assert from "node:assert/strict";
import test from "node:test";
import {
  HISTORY_LIMIT,
  collectPrompts,
  createHistoryStore,
  historyEntries,
  isInputFrozen,
  previewPrompt,
} from "../src/modules/history/logic.js";

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

function questionReplyNode(key, anchorSeq, data) {
  return {
    key,
    kind: "question-reply",
    anchorSeq,
    data: {
      time: anchorSeq * 1000,
      questions: [],
      answers: [],
      ...data,
    },
  };
}

function prompt(seq, text, kind = "user") {
  return { key: `k${seq}`, seq, time: seq * 1000, kind, text };
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

test("collectPrompts projects one answer row per answered question", () => {
  const nodes = nodeStore([
    questionReplyNode("r", 7, {
      questions: [
        { id: "q1", header: "确认", question: "继续吗？" },
        { id: "q2", question: "选哪个？" },
        { id: "q3", question: "跳过？" },
      ],
      answers: [
        { id: "q1", selected: [], custom: "继续" },
        { id: "q2", selected: ["甲", "乙"] },
        { id: "q3", selected: [] },
      ],
    }),
  ]);
  assert.deepEqual(collectPrompts(["r"], nodes), [
    {
      key: "r:q1",
      seq: 7,
      time: 7000,
      kind: "answer",
      text: "继续",
      question: "确认 继续吗？",
    },
    {
      key: "r:q2",
      seq: 7,
      time: 7000,
      kind: "answer",
      text: "甲, 乙",
      question: "选哪个？",
    },
  ]);
});

test("collectPrompts appends custom answer text after selected labels", () => {
  const nodes = nodeStore([
    questionReplyNode("r", 2, {
      questions: [{ id: "q", question: "哪些？" }],
      answers: [{ id: "q", selected: ["甲"], custom: " 乙 " }],
    }),
  ]);
  assert.deepEqual(
    collectPrompts(["r"], nodes).map((entry) => entry.text),
    ["甲, 乙"],
  );
});

test("collectPrompts ignores question-reply nodes without answer text", () => {
  const nodes = nodeStore([
    questionReplyNode("r", 1, {
      questions: [{ id: "q", question: "继续吗？" }],
      answers: [],
    }),
    { key: "bad", kind: "question-reply", anchorSeq: 2, data: null },
  ]);
  assert.deepEqual(collectPrompts(["r", "bad"], nodes), []);
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

test("historyEntries folds adjacent prompts but keeps adjacent answers", () => {
  const rows = historyEntries([
    prompt(1, "same"),
    prompt(2, "same", "answer"),
    prompt(3, "same", "answer"),
  ]);
  assert.deepEqual(rows.map((entry) => entry.seq), [3, 2, 1]);
  assert.deepEqual(
    historyEntries([prompt(1, "same"), prompt(2, "same")]).map((entry) => entry.seq),
    [2],
  );
});

test("isInputFrozen covers the three phases that own the draft", () => {
  for (const phase of ["adjudicating", "submitting", "sending"]) {
    assert.equal(isInputFrozen(phase), true);
  }
  for (const phase of ["plain", "claimed", undefined]) {
    assert.equal(isInputFrozen(phase), false);
  }
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

