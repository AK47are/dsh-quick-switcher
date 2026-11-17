import assert from "node:assert/strict";
import test from "node:test";
import { buildPendingContext } from "../src/modules/ask/context.js";
import {
  ASK_COPY_FEEDBACK_MS,
  ASK_TRIGGERS,
  askSuffixOf,
  askTriggerOf,
  createAskActions,
  createAskUi,
  createAskView,
  detailKeyAction,
  isEditableTarget,
  statusLabelKey,
} from "../src/modules/ask/logic.js";

const t = (key, vars) => {
  if (vars === undefined) return key;
  if (typeof vars.question === "string") return `${key}:${vars.question}`;
  if (typeof vars.count === "number") return `${key}:${vars.count}`;
  return key;
};

/** A keydown shape carrying only the fields the helper reads. */
function press(overrides = {}) {
  return {
    key: "i",
    repeat: false,
    isComposing: false,
    keyCode: 73,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    ...overrides,
  };
}

/** Everything a finished record allows; individual tests take one away. */
function keyState(overrides = {}) {
  return {
    hasBack: true,
    isEditable: false,
    isRunning: false,
    canCopy: true,
    canRegenerate: true,
    canFork: true,
    isForking: false,
    ...overrides,
  };
}

function record(id, overrides = {}) {
  return {
    id,
    sessionId: "s1",
    question: "question",
    answer: "",
    context: "",
    contextLabel: "",
    model: "",
    usage: null,
    status: "done",
    error: null,
    atSeq: 0,
    startedAt: 0,
    includeAttachments: true,
    ...overrides,
  };
}

/** Minimal store double: the view only reads records and calls a few actions. */
function fakeStore(initial = []) {
  const records = new Map(initial.map((item) => [item.id, item]));
  const store = {
    calls: [],
    aborted: [],
    stopped: [],
    regenerated: [],
    records,
    subscribe() {
      return () => {};
    },
    entriesOf(sessionId) {
      return [...records.values()].filter((item) => item.sessionId === sessionId);
    },
    find(id) {
      return records.get(id) ?? null;
    },
    ask(sessionId, question, background) {
      const created = record(`r${records.size + 1}`, {
        sessionId,
        question,
        status: "running",
        context: background?.text ?? "",
        contextLabel: background?.label ?? "",
      });
      records.set(created.id, created);
      store.calls.push({ sessionId, question, background });
      return created;
    },
    abortSession(sessionId) {
      store.aborted.push(sessionId);
    },
    stop(sessionId, id) {
      store.stopped.push({ sessionId, id });
      return true;
    },
    regenerate(sessionId, id) {
      store.regenerated.push({ sessionId, id });
      return true;
    },
  };
  return store;
}

function panelOf(overrides = {}) {
  return {
    currentSessionId: "s1",
    pending: null,
    now: 0,
    query: "",
    notifications: 0,
    queries: [],
    errors: [],
    closed: [],
    notify() {
      this.notifications += 1;
    },
    setQuery(query) {
      this.queries.push(query);
    },
    setError(text) {
      this.errors.push(text);
    },
    close(options) {
      this.closed.push(options ?? true);
    },
    ...overrides,
  };
}

function actionSpy() {
  const calls = [];
  return {
    calls,
    back: () => calls.push("back"),
    copy: (item) => calls.push(`copy:${item.id}`),
    stop: (item) => calls.push(`stop:${item.id}`),
    regenerate: (item) => calls.push(`regenerate:${item.id}`),
    fork: (item) => calls.push(`fork:${item.id}`),
  };
}

function fakeTimer() {
  let callback = null;
  return {
    setTimer(fn) {
      callback = fn;
      return 1;
    },
    clearTimer() {
      callback = null;
    },
    fire() {
      const next = callback;
      callback = null;
      next?.();
    },
    pending() {
      return callback !== null;
    },
  };
}

function askViewOf({ store = fakeStore(), ui = createAskUi(fakeTimer()), actions = actionSpy() } = {}) {
  return { store, ui, actions, view: createAskView({ api: { t }, store, ui, actions }) };
}

// Side-question records keep one action per key, and the locked input keeps
// every letter except i as text.

test("i returns to the input from anywhere in the detail", () => {
  assert.equal(detailKeyAction(press(), keyState()), "back");
  assert.equal(detailKeyAction(press({ key: "I" }), keyState()), "back");
  // The locked question field is not a text surface for this key.
  assert.equal(detailKeyAction(press(), keyState({ isEditable: true })), "back");
  // A view with no back action leaves the key to the browser.
  assert.equal(detailKeyAction(press(), keyState({ hasBack: false })), null);
});

test("Backspace is no longer a back key", () => {
  assert.equal(detailKeyAction(press({ key: "Backspace", keyCode: 8 }), keyState()), null);
});

test("the letter actions keep their eligibility rules", () => {
  assert.equal(detailKeyAction(press({ key: "s" }), keyState({ isRunning: true })), "stop");
  assert.equal(detailKeyAction(press({ key: "s" }), keyState()), null);
  assert.equal(detailKeyAction(press({ key: "c" }), keyState()), "copy");
  assert.equal(detailKeyAction(press({ key: "c" }), keyState({ canCopy: false })), null);
  assert.equal(detailKeyAction(press({ key: "r" }), keyState()), "regenerate");
  assert.equal(detailKeyAction(press({ key: "r" }), keyState({ canRegenerate: false })), null);
  assert.equal(detailKeyAction(press({ key: "f" }), keyState()), "fork");
  assert.equal(detailKeyAction(press({ key: "f" }), keyState({ canFork: false })), null);
  assert.equal(detailKeyAction(press({ key: "f" }), keyState({ isForking: true })), null);
});

test("the locked input keeps the other letters as letters", () => {
  const locked = keyState({ isEditable: true, isRunning: true });
  for (const key of ["c", "r", "f", "s"]) {
    assert.equal(detailKeyAction(press({ key }), locked), null);
  }
});

test("a held, composing, or chorded key belongs to the browser", () => {
  assert.equal(detailKeyAction(press({ repeat: true }), keyState()), null);
  assert.equal(detailKeyAction(press({ isComposing: true }), keyState()), null);
  assert.equal(detailKeyAction(press({ keyCode: 229 }), keyState()), null);
  assert.equal(detailKeyAction(press({ ctrlKey: true }), keyState()), null);
  assert.equal(detailKeyAction(press({ metaKey: true }), keyState()), null);
  assert.equal(detailKeyAction(press({ altKey: true }), keyState()), null);
});

test("unknown keys and malformed input are ignored", () => {
  assert.equal(detailKeyAction(press({ key: "x" }), keyState()), null);
  assert.equal(detailKeyAction(press({ key: "Enter" }), keyState()), null);
  assert.equal(detailKeyAction(null, keyState()), null);
  assert.equal(detailKeyAction(press(), null), null);
});

test("an editable target is the input, a contenteditable, or a select", () => {
  assert.equal(isEditableTarget(null), false);
  assert.equal(isEditableTarget("input"), false);
  assert.equal(isEditableTarget({ isContentEditable: true }), true);
  assert.equal(isEditableTarget({ closest: () => ({}) }), true);
  assert.equal(isEditableTarget({ closest: () => null }), false);
  assert.equal(isEditableTarget({ closest: 3 }), false);
});

// The list view.

test("the record helpers name the three states that need a badge", () => {
  assert.equal(statusLabelKey(record("r1", { status: "running" })), "askStatusRunning");
  assert.equal(statusLabelKey(record("r2", { status: "aborted" })), "askStatusAborted");
  assert.equal(statusLabelKey(record("r3", { status: "error" })), "askStatusError");
  assert.equal(statusLabelKey(record("r4", { status: "done" })), null);
});

test("without a current session there is nothing to ask", () => {
  const { view } = askViewOf();
  const panel = panelOf({ currentSessionId: null });

  const list = view.view({ text: "" }, panel);
  assert.equal(list.rows.length, 0);
  assert.equal(list.emptyText, "askNoSession");
  assert.equal(list.count, "countAsk:0");

  const typed = view.view({ text: "hello" }, panel);
  assert.equal(typed.rows.length, 0);
  assert.equal(typed.emptyText, "askNoSession");
  // The typed text still offers the send hint; there is simply no row to send.
  assert.deepEqual(typed.hints, [
    { keys: ["Enter"], label: "hintAskSend" },
    { keys: ["Esc"], label: "hintClose" },
  ]);
});

test("an empty list explains itself and counts the records", () => {
  const { view } = askViewOf();
  const result = view.view({ text: "" }, panelOf());
  assert.equal(result.emptyText, "emptyAsk");
  assert.equal(result.count, "countAsk:0");
  assert.equal(result.placeholder, "placeholderAsk");
  assert.equal(result.searchAria, "searchAriaAsk");
  assert.equal(result.listLabel, "listLabelAsk");
  assert.equal(result.note, null);
});

test("the trigger set is every spelling whose NFKC form is a question mark", () => {
  assert.deepEqual(ASK_TRIGGERS, ["?", "？", "﹖", "︖"]);
  for (const trigger of ASK_TRIGGERS) {
    assert.equal(trigger.normalize("NFKC"), "?");
  }
  assert.equal(askTriggerOf("？why"), "？");
  assert.equal(askTriggerOf("︖why"), "︖");
  // The leading mark is a prefix; the trailing spelling has its own helper.
  assert.equal(askTriggerOf("why？"), null);
  assert.equal(askTriggerOf(""), null);
  assert.equal(askTriggerOf(null), null);

  assert.equal(askSuffixOf("why？"), "？");
  assert.equal(askSuffixOf("why﹖"), "﹖");
  // Only the last character counts, and a suffix is not an infix.
  assert.equal(askSuffixOf("why? "), null);
  assert.equal(askSuffixOf("?why"), null);
  assert.equal(askSuffixOf(""), null);
  assert.equal(askSuffixOf(null), null);
});

test("?text puts the ask row first and sends the whole text", () => {
  const store = fakeStore();
  const { view } = askViewOf({ store });
  const panel = panelOf();
  const result = view.view({ text: "  hello world  " }, panel);

  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].key, "a:q");
  assert.equal(result.rows[0].title, "askRow:hello world");
  assert.equal(result.rows[0].action, undefined);
  assert.deepEqual(result.hints, [
    { keys: ["Enter"], label: "hintAskSend" },
    { keys: ["Esc"], label: "hintClose" },
  ]);

  result.rows[0].run();
  assert.equal(store.calls.length, 1);
  assert.equal(store.calls[0].sessionId, "s1");
  assert.equal(store.calls[0].question, "hello world");
  assert.equal(store.calls[0].background, null);
  assert.deepEqual(panel.queries, ["?hello world"]);
  assert.ok(panel.notifications > 0);

  const detail = view.view({ text: "hello world" }, panel);
  assert.deepEqual(detail.content, { kind: "ask", props: { id: "r1" } });
});

test("a question asked with a compatibility mark keeps that mark", () => {
  const store = fakeStore();
  const { view } = askViewOf({ store });
  const panel = panelOf({ query: "？hello" });
  const result = view.view({ text: "hello" }, panel);

  result.rows[0].run();
  assert.deepEqual(panel.queries, ["？hello"]);
  // The stored question never carries the mode prefix; the query keeps the mark.
  assert.equal(store.calls[0].question, "hello");
});

test("a question asked with a trailing mark keeps it at the end", () => {
  const store = fakeStore();
  const { view } = askViewOf({ store });
  const panel = panelOf({ query: "hello？" });
  const result = view.view({ text: "hello" }, panel);

  result.rows[0].run();
  assert.deepEqual(panel.queries, ["hello？"]);
  // The stored question never carries the mode mark; the suffix stays where
  // the user typed it, not rewritten into a leading halfwidth mark.
  assert.equal(store.calls[0].question, "hello");

  const detail = view.view({ text: "hello" }, panel);
  assert.deepEqual(detail.content, { kind: "ask", props: { id: "r1" } });
});

test("opening a history row from a suffix query keeps the mark at the end", () => {
  const store = fakeStore([record("r1", { question: "why?" })]);
  const { view } = askViewOf({ store });
  const panel = panelOf({ query: "hello?" });
  const list = view.view({ text: "hello" }, panel);

  list.rows[1].run();
  // The last question mark is the mode mark; the one in the record stays text.
  assert.deepEqual(panel.queries, ["why??"]);
});

test("a leading mark wins over a trailing one when rebuilding the query", () => {
  const store = fakeStore([record("r1", { question: "why?" })]);
  const { view } = askViewOf({ store });
  const panel = panelOf({ query: "?hello?" });
  const list = view.view({ text: "hello?" }, panel);

  list.rows[1].run();
  assert.deepEqual(panel.queries, ["?why?"]);
});

test("the ask row carries the pending interaction as read-only background", () => {
  const store = fakeStore();
  const { view } = askViewOf({ store });
  const panel = panelOf({ pending: { kind: "approval", toolName: "Bash", reason: "needs it" } });
  const result = view.view({ text: "why" }, panel);
  result.rows[0].run();

  assert.equal(store.calls[0].background.label, "askContextApproval · Bash");
  assert.match(store.calls[0].background.text, /Tool: Bash/);
});

test("records list newest first, each with its state", () => {
  const store = fakeStore([
    record("r2", { question: "newer", status: "running", startedAt: 5000 }),
    record("r1", { question: "older", status: "aborted", startedAt: 0 }),
  ]);
  const { view } = askViewOf({ store });
  const result = view.view({ text: "" }, panelOf({ now: 10_000 }));

  assert.deepEqual(
    result.rows.map((row) => row.key),
    ["a:h:r2", "a:h:r1"],
  );
  assert.equal(result.rows[0].badge, "askStatusRunning");
  assert.equal(result.rows[0].meta[0].text, "time.justNow");
  assert.equal(result.rows[1].badge, "askStatusAborted");
  assert.equal(result.count, "countAsk:2");
  assert.deepEqual(result.hints, [
    { keys: ["Enter"], label: "hintAskView" },
    { keys: ["Esc"], label: "hintClose" },
  ]);

  // A finished answer is the normal case and earns no badge.
  const doneStore = fakeStore([record("r9", { status: "done" })]);
  const done = askViewOf({ store: doneStore }).view.view({ text: "" }, panelOf());
  assert.equal(done.rows[0].badge, null);
});

test("a running record disables the ask row and explains itself", () => {
  const store = fakeStore([record("r1", { question: "old", status: "running" })]);
  const { view } = askViewOf({ store });
  const panel = panelOf();

  const typed = view.view({ text: "new" }, panel);
  assert.equal(typed.rows[0].key, "a:q");
  assert.equal(typed.rows[0].run, undefined);
  assert.equal(typed.rows[0].meta[0].text, "askBusy");

  const empty = view.view({ text: "" }, panel);
  assert.equal(empty.note, "askRunningNote");
});

test("a history row opens the detail, and back restores the list", () => {
  const store = fakeStore([record("r1", { question: "why?" })]);
  const { view } = askViewOf({ store });
  const panel = panelOf();
  const list = view.view({ text: "why?" }, panel);

  // The ask row comes first; the history row below it opens the detail.
  list.rows[1].run();
  assert.deepEqual(panel.queries, ["?why?"]);
  assert.equal(panel.notifications, 1);

  const detail = view.view({ text: "why?" }, panel);
  assert.deepEqual(detail.content, { kind: "ask", props: { id: "r1" } });
  assert.deepEqual(detail.footer, { kind: "ask", props: { id: "r1" } });
  assert.equal(detail.inputLocked, true);
  assert.deepEqual(detail.rows, []);
  assert.deepEqual(detail.hints, []);
  assert.equal(detail.count, "");
  assert.equal(detail.placeholder, "placeholderAsk");

  assert.equal(detail.keydown(press({ key: "i" }), panel), true);
  const back = view.view({ text: "why?" }, panel);
  assert.equal(back.content, undefined);
  assert.equal(back.footer, undefined);
  // The view only sets the lock on the detail; the shell's validator fills the
  // list default.
  assert.equal(back.inputLocked, undefined);
  assert.equal(back.rows[0].key, "a:q");
});

test("opening a history row keeps the trigger the input carries", () => {
  const store = fakeStore([record("r1", { question: "why?" })]);
  const { view } = askViewOf({ store });
  const panel = panelOf({ query: "︖current" });
  const list = view.view({ text: "current" }, panel);

  list.rows[1].run();
  assert.deepEqual(panel.queries, ["︖why?"]);
});

test("a detail whose record disappeared falls back to the list", () => {
  const store = fakeStore([record("r1", { question: "why?" })]);
  const { view } = askViewOf({ store });
  const panel = panelOf();
  view.view({ text: "why?" }, panel);
  view.view({ text: "why?" }, panel).rows[1].run();
  assert.equal(typeof view.view({ text: "why?" }, panel).content, "object");

  store.records.delete("r1");
  const result = view.view({ text: "why?" }, panel);
  assert.equal(result.content, undefined);
  assert.equal(result.footer, undefined);
  assert.equal(result.rows[0].key, "a:q");
});

test("the detail keydown routes letters and reads the live record", () => {
  const running = fakeStore([record("r1", { question: "q", status: "running", answer: "part" })]);
  const stopSpy = actionSpy();
  const stopView = askViewOf({ store: running, actions: stopSpy }).view;
  const panel = panelOf();
  stopView.view({ text: "" }, panel).rows[0].run();
  let detail = stopView.view({ text: "" }, panel);
  assert.equal(detail.keydown(press({ key: "s" }), panel), true);
  assert.deepEqual(stopSpy.calls, ["stop:r1"]);

  const done = fakeStore([record("r2", { question: "q", answer: "answer" })]);
  const doneSpy = actionSpy();
  const ui = createAskUi(fakeTimer());
  const doneView = askViewOf({ store: done, ui, actions: doneSpy }).view;
  doneView.view({ text: "" }, panelOf()).rows[0].run();
  detail = doneView.view({ text: "" }, panelOf());
  assert.equal(detail.keydown(press({ key: "c" }), panelOf()), true);
  assert.deepEqual(doneSpy.calls, ["copy:r2"]);
  detail = doneView.view({ text: "" }, panelOf());
  assert.equal(detail.keydown(press({ key: "r" }), panelOf()), true);
  detail = doneView.view({ text: "" }, panelOf());
  assert.equal(detail.keydown(press({ key: "f" }), panelOf()), true);
  assert.deepEqual(doneSpy.calls, ["copy:r2", "regenerate:r2", "fork:r2"]);

  // A fork already in flight refuses the second press.
  ui.setForking(true);
  detail = doneView.view({ text: "" }, panelOf());
  assert.equal(detail.keydown(press({ key: "f" }), panelOf()), false);

  // The locked input keeps C/R/F as letters.
  const editable = { isContentEditable: false, closest: () => ({}) };
  detail = doneView.view({ text: "" }, panelOf());
  for (const key of ["c", "r", "f", "s"]) {
    assert.equal(detail.keydown(press({ key, target: editable }), panelOf()), false);
  }
});

test("the view remembers the last session so closing can abort it", () => {
  const store = fakeStore();
  const { view } = askViewOf({ store });
  assert.equal(view.getSessionId(), null);
  view.view({ text: "" }, panelOf({ currentSessionId: "s9" }));
  assert.equal(view.getSessionId(), "s9");
  // A panel without a session must not erase the one that was shown.
  view.view({ text: "" }, panelOf({ currentSessionId: null }));
  assert.equal(view.getSessionId(), "s9");
});

// Copy and fork feedback.

test("the ui store keeps copied feedback for one window only", () => {
  const timer = fakeTimer();
  const ui = createAskUi(timer);
  let notifications = 0;
  ui.subscribe(() => {
    notifications += 1;
  });

  assert.deepEqual(ui.getSnapshot(), { copied: false, copyFailed: false, forking: false });
  ui.markCopied();
  assert.equal(ui.getSnapshot().copied, true);
  assert.equal(timer.pending(), true);
  assert.equal(notifications, 1);

  // The same value twice is not a change, though it restarts the window.
  ui.markCopied();
  assert.equal(notifications, 1);
  timer.fire();
  assert.equal(ui.getSnapshot().copied, false);
  assert.equal(notifications, 2);
});

test("a failed copy replaces the copied label and a clear drops both", () => {
  const timer = fakeTimer();
  const ui = createAskUi(timer);
  ui.markCopied();
  ui.markCopyFailed();
  assert.deepEqual(ui.getSnapshot(), { copied: false, copyFailed: true, forking: false });
  assert.equal(timer.pending(), false);

  ui.clearCopy();
  assert.deepEqual(ui.getSnapshot(), { copied: false, copyFailed: false, forking: false });
});

test("the fork flag is subscribable and dispose releases the timer", () => {
  const timer = fakeTimer();
  const ui = createAskUi(timer);
  let notifications = 0;
  ui.subscribe(() => {
    notifications += 1;
  });

  ui.setForking(true);
  assert.equal(ui.getSnapshot().forking, true);
  ui.setForking(true);
  assert.equal(notifications, 1);
  ui.setForking(false);
  assert.equal(notifications, 2);

  ui.markCopied();
  ui.dispose();
  assert.equal(timer.pending(), false);
});

test("copy writes the answer and reports it in the ui store", async () => {
  const original = globalThis.navigator.clipboard;
  const writes = [];
  globalThis.navigator.clipboard = {
    writeText: async (text) => {
      writes.push(text);
    },
  };
  try {
    const ui = createAskUi(fakeTimer());
    const actions = createAskActions({
      api: { t, services: {} },
      store: fakeStore(),
      ui,
      panel: panelOf(),
      back() {},
    });
    await actions.copy(record("r1", { answer: "the answer" }));
    assert.deepEqual(writes, ["the answer"]);
    assert.equal(ui.getSnapshot().copied, true);
    assert.equal(ui.getSnapshot().copyFailed, false);
  } finally {
    if (original === undefined) delete globalThis.navigator.clipboard;
    else globalThis.navigator.clipboard = original;
  }
});

test("a clipboard refusal becomes a visible failure, not a throw", async () => {
  const original = globalThis.navigator.clipboard;
  const originalError = console.error;
  console.error = () => {};
  globalThis.navigator.clipboard = {
    writeText: async () => {
      throw new Error("blocked");
    },
  };
  try {
    const ui = createAskUi(fakeTimer());
    const actions = createAskActions({
      api: { t, services: {} },
      store: fakeStore(),
      ui,
      panel: panelOf(),
      back() {},
    });
    await actions.copy(record("r1", { answer: "text" }));
    assert.deepEqual(ui.getSnapshot(), { copied: false, copyFailed: true, forking: false });
  } finally {
    console.error = originalError;
    if (original === undefined) delete globalThis.navigator.clipboard;
    else globalThis.navigator.clipboard = original;
  }
});

test("copying an empty answer touches neither the clipboard nor the ui", async () => {
  const original = globalThis.navigator.clipboard;
  let writes = 0;
  globalThis.navigator.clipboard = {
    writeText: async () => {
      writes += 1;
    },
  };
  try {
    const ui = createAskUi(fakeTimer());
    const actions = createAskActions({
      api: { t, services: {} },
      store: fakeStore(),
      ui,
      panel: panelOf(),
      back() {},
    });
    await actions.copy(record("r1", { answer: "" }));
    assert.equal(writes, 0);
    assert.equal(ui.getSnapshot().copied, false);
  } finally {
    if (original === undefined) delete globalThis.navigator.clipboard;
    else globalThis.navigator.clipboard = original;
  }
});

test("stop and regenerate name the record they act on", () => {
  const store = fakeStore();
  const actions = createAskActions({
    api: { t, services: {} },
    store,
    ui: createAskUi(fakeTimer()),
    panel: panelOf(),
    back() {},
  });
  actions.stop(record("r1"));
  actions.regenerate(record("r2"));
  assert.deepEqual(store.stopped, [{ sessionId: "s1", id: "r1" }]);
  assert.deepEqual(store.regenerated, [{ sessionId: "s1", id: "r2" }]);
});

test("fork opens the child session and closes without restoring focus", async () => {
  const opened = [];
  const panel = panelOf();
  const ui = createAskUi(fakeTimer());
  const actions = createAskActions({
    api: {
      t,
      services: {
        uiWorkspace: {
          openSession: (id) => {
            opened.push(id);
          },
        },
      },
    },
    store: { fork: async () => "child-1" },
    ui,
    panel,
    back() {},
  });

  await actions.fork(record("r1", { answer: "text" }));
  assert.deepEqual(opened, ["child-1"]);
  assert.deepEqual(panel.closed, [{ restoreFocus: false }]);
  assert.deepEqual(panel.errors, [null]);
  assert.equal(ui.getSnapshot().forking, false);
});

test("a failed fork keeps the panel open and reports the fork", async () => {
  const originalError = console.error;
  console.error = () => {};
  const panel = panelOf();
  const ui = createAskUi(fakeTimer());
  const actions = createAskActions({
    api: { t, services: {} },
    store: {
      fork: async () => {
        throw new Error("refused");
      },
    },
    ui,
    panel,
    back() {},
  });

  try {
    await actions.fork(record("r1", { answer: "text" }));
  } finally {
    console.error = originalError;
  }
  assert.deepEqual(panel.closed, []);
  assert.deepEqual(panel.errors, [null, "askForkFailed"]);
  assert.equal(ui.getSnapshot().forking, false);
});

test("a refused navigation keeps the panel open with the open error", async () => {
  const panel = panelOf();
  const actions = createAskActions({
    api: {
      t,
      services: {
        uiWorkspace: {
          openSession: () => {
            throw new Error("no surface");
          },
        },
      },
    },
    store: { fork: async () => "child-1" },
    ui: createAskUi(fakeTimer()),
    panel,
    back() {},
  });

  await actions.fork(record("r1", { answer: "text" }));
  assert.deepEqual(panel.closed, []);
  assert.deepEqual(panel.errors, [null, "openFailed"]);
});

test("a fork already in flight does not ask the host twice", async () => {
  let calls = 0;
  const panel = panelOf();
  const ui = createAskUi(fakeTimer());
  ui.setForking(true);
  const actions = createAskActions({
    api: { t, services: { uiWorkspace: { openSession() {} } } },
    store: {
      fork: async () => {
        calls += 1;
        return "child";
      },
    },
    ui,
    panel,
    back() {},
  });

  await actions.fork(record("r1", { answer: "text" }));
  assert.equal(calls, 0);
  assert.deepEqual(panel.closed, []);
});

// Pending-interaction background.

test("an approval pending card becomes the labelled background", () => {
  const context = buildPendingContext(
    { kind: "approval", toolName: "Bash", reason: "because" },
    t,
    "s1",
  );
  assert.equal(context.label, "askContextApproval · Bash");
  assert.match(context.text, /^Pending interaction: approval/);
  assert.match(context.text, /Tool: Bash/);
  assert.match(context.text, /Reason: because/);
  // No visible card in a plain Node process, so only the structured part ships.
  assert.doesNotMatch(context.text, /Visible content/);
});

test("a structured question keeps its header, detail, and options", () => {
  const context = buildPendingContext(
    {
      kind: "question",
      questions: [
        {
          header: "Pick",
          question: "Which one?",
          detail: "a detail",
          options: [
            { label: "A", description: "first" },
            { label: "B" },
          ],
        },
      ],
    },
    t,
    "s1",
  );
  assert.equal(context.label, "askContextQuestion");
  assert.match(context.text, /Pending interaction: question/);
  assert.match(context.text, /Question 1:/);
  assert.match(context.text, /Header: Pick/);
  assert.match(context.text, /Question: Which one\?/);
  assert.match(context.text, /Detail: a detail/);
  assert.match(context.text, /Options:/);
  assert.match(context.text, /1\. A: first/);
  assert.match(context.text, /2\. B/);
});

test("a plan review without structured questions still names itself", () => {
  const context = buildPendingContext({ kind: "plan-review" }, t, "s1");
  assert.equal(context.label, "askContextPlanReview");
  assert.equal(context.text, "Pending interaction: plan review");
});

test("no pending interaction, or an unknown one, sends no background", () => {
  assert.equal(buildPendingContext(null, t, "s1"), null);
  assert.equal(buildPendingContext(undefined, t, "s1"), null);
  assert.equal(buildPendingContext({ kind: "other" }, t, "s1"), null);
});

test("the copy feedback window is the documented 1600 ms", () => {
  assert.equal(ASK_COPY_FEEDBACK_MS, 1600);
});
