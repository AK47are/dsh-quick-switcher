import assert from "node:assert/strict";
import test from "node:test";
import { createAskRoute } from "../src/routes/ask.js";

const t = (key, vars) => {
  if (vars === undefined) return key;
  if (typeof vars.question === "string") return `${key}:${vars.question}`;
  if (typeof vars.count === "number") return `${key}:${vars.count}`;
  return key;
};

function context(overrides = {}) {
  return { currentId: "s1", pending: null, t, now: 0, ...overrides };
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
    ...overrides,
  };
}

/** Minimal store double: the route only reads records and calls `ask`. */
function makeStore(initial = []) {
  const records = new Map();
  let counter = 0;
  for (const item of initial) records.set(item.id, item);
  const store = {
    calls: [],
    aborted: [],
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
      counter += 1;
      const created = record(`r${counter}`, {
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
  };
  return store;
}

test("the ask route claims only ? queries", () => {
  const route = createAskRoute({ store: makeStore(), notify: () => {} });
  assert.equal(route.parse("+x"), null);
  assert.equal(route.parse("@x"), null);
  assert.deepEqual(route.parse("?hi"), { text: "hi" });
  assert.deepEqual(route.parse("?"), { text: "" });
});

test("without a current session there is nothing to ask", () => {
  const route = createAskRoute({ store: makeStore(), notify: () => {} });
  const ctx = context({ currentId: null });
  const list = route.view(route.parse("?"), ctx);
  assert.equal(list.rows.length, 0);
  assert.equal(list.emptyText, "askNoSession");

  const typed = route.view(route.parse("?hello"), ctx);
  assert.equal(typed.rows.length, 0);
  assert.equal(typed.emptyText, "askNoSession");
});

test("an empty list explains itself and counts the records", () => {
  const route = createAskRoute({ store: makeStore(), notify: () => {} });
  const view = route.view(route.parse("?"), context());
  assert.equal(view.emptyText, "emptyAsk");
  assert.equal(view.count, "countAsk:0");
  assert.equal(view.rows.length, 0);
});

test("?text puts the ask row first and sends the whole text", () => {
  const store = makeStore();
  const route = createAskRoute({ store, notify: () => {} });
  const parsed = route.parse("?  hello world  ");
  const view = route.view(parsed, context());

  assert.equal(view.rows.length, 1);
  assert.equal(view.rows[0].key, "a:q");
  assert.equal(view.rows[0].title, "askRow:hello world");
  assert.equal(view.rows[0].action, undefined);

  const effect = view.rows[0].run({});
  assert.deepEqual(effect, { type: "query", query: "?hello world" });
  assert.equal(store.calls.length, 1);
  assert.equal(store.calls[0].sessionId, "s1");
  assert.equal(store.calls[0].question, "hello world");
  assert.equal(store.calls[0].background, null);
});

test("records list newest first, each with its state", () => {
  const store = makeStore([
    record("r2", { question: "newer", status: "running", startedAt: 5000 }),
    record("r1", { question: "older", status: "aborted", startedAt: 0 }),
  ]);
  const route = createAskRoute({ store, notify: () => {} });
  const view = route.view(route.parse("?"), context({ now: 10_000 }));

  assert.deepEqual(
    view.rows.map((row) => row.key),
    ["a:h:r2", "a:h:r1"],
  );
  assert.equal(view.rows[0].badge, "askStatusRunning");
  assert.equal(view.rows[0].meta[0].text, "time.justNow");
  assert.equal(view.rows[1].badge, "askStatusAborted");
  assert.equal(view.count, "countAsk:2");

  // A finished answer is the normal case and earns no badge.
  const doneRoute = createAskRoute({
    store: makeStore([record("r9", { status: "done" })]),
    notify: () => {},
  });
  const doneView = doneRoute.view(doneRoute.parse("?"), context());
  assert.equal(doneView.rows[0].badge, null);
});

test("a running record disables the ask row and explains itself", () => {
  const store = makeStore([
    record("r1", { question: "old", status: "running" }),
  ]);
  const route = createAskRoute({ store, notify: () => {} });

  const typed = route.view(route.parse("?new"), context());
  assert.equal(typed.rows[0].key, "a:q");
  assert.equal(typed.rows[0].run, undefined);
  assert.equal(typed.rows[0].meta[0].text, "askBusy");

  const empty = route.view(route.parse("?"), context());
  assert.equal(empty.note, "askRunningNote");
});

test("a history row opens the detail, and back restores the list", () => {
  let notified = 0;
  const store = makeStore([record("r1", { question: "why?" })]);
  const route = createAskRoute({ store, notify: () => { notified += 1; } });
  const ctx = context();
  const parsed = route.parse("?why?");

  const list = route.view(parsed, ctx);
  // The ask row comes first; the history row below it opens the detail.
  const effect = list.rows[1].run({});
  assert.deepEqual(effect, { type: "query", query: "?why?" });
  assert.equal(notified, 1);

  const detail = route.view(parsed, ctx);
  assert.deepEqual(detail.content, { kind: "ask", id: "r1" });
  assert.deepEqual(detail.footer, { kind: "ask", id: "r1" });
  assert.equal(detail.inputLocked, true);
  assert.equal(detail.rows.length, 0);
  assert.equal(detail.placeholder, "placeholderAsk");

  detail.back();
  const back = route.view(parsed, ctx);
  assert.equal(back.content, undefined);
  assert.equal(back.footer, undefined);
  assert.equal(back.inputLocked, undefined);
  assert.equal(back.rows[0].key, "a:q");
});

test("dispose aborts the session the panel last showed", () => {
  const store = makeStore();
  const route = createAskRoute({ store, notify: () => {} });
  route.view(route.parse("?"), context());
  route.dispose();
  assert.deepEqual(store.aborted, ["s1"]);
});
