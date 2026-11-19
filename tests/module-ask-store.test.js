import assert from "node:assert/strict";
import test from "node:test";
import {
  canFork,
  createAskStore,
} from "../src/modules/ask/logic.js";
import { ASK_PATH, FORK_PATH, UNLOADED_MESSAGE } from "../src/modules/ask/shared.js";
import { parseAskRecords, serializeAskRecords, weighAskRecords } from "../src/modules/ask/storage.js";

const t = (key) => key;

/** A record storage double that keeps the last written snapshot in memory. */
function fakeRecordStorage(initial = []) {
  const state = {
    records: initial.slice(),
    text: serializeAskRecords(initial),
    saves: 0,
    clears: 0,
  };
  return {
    state,
    // The stored text keeps `running`; loading is what turns it into aborted,
    // exactly like the real facade.
    load: () => parseAskRecords(state.text),
    save(records) {
      state.saves += 1;
      state.records = records.slice();
      state.text = serializeAskRecords(records);
      return { ok: true, records: state.records, text: state.text };
    },
    clear() {
      state.clears += 1;
      state.records = [];
      state.text = "";
    },
  };
}

/** A browser-shaped event target without a real DOM. */
function fakeWindow() {
  const document = new EventTarget();
  document.visibilityState = "visible";
  const window = new EventTarget();
  window.document = document;
  return window;
}

/** One record as it would come back from storage. */
function storedRecord(overrides = {}) {
  return {
    id: "ask-1",
    sessionId: "s1",
    question: "q",
    answer: "a",
    reasoning: "",
    includeAttachments: true,
    choice: { provider: "", model: "", effort: "lowest" },
    provider: "",
    model: "",
    effort: "",
    effortName: "",
    usage: null,
    status: "done",
    error: null,
    atSeq: 1,
    startedAt: 1000,
    ...overrides,
  };
}

function sse(...events) {
  return events.map((event) => `data: ${JSON.stringify(event)}\n\n`);
}

/**
 * A body whose reads hang after the scripted blocks, which models a live
 * connection: the store only leaves the running state on `done`, `error`, or
 * an explicit stop.
 */
function heldStream(blocks) {
  let index = 0;
  return {
    getReader: () => ({
      read: async () => {
        if (index < blocks.length) {
          return { value: new TextEncoder().encode(blocks[index++]), done: false };
        }
        return new Promise(() => {});
      },
    }),
  };
}

/** A body that ends after its blocks, which models a dropped connection. */
function closedStream(blocks) {
  let index = 0;
  return {
    getReader: () => ({
      read: async () => {
        if (index >= blocks.length) return { value: undefined, done: true };
        return { value: new TextEncoder().encode(blocks[index++]), done: false };
      },
    }),
  };
}

function responseOf(body) {
  return {
    ok: true,
    status: 200,
    body,
    json: async () => ({}),
  };
}

async function flush() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

test("the client store calls the same host paths the host half serves", () => {
  assert.equal(ASK_PATH, "/dsh-quick-switcher/ask");
  assert.equal(FORK_PATH, "/dsh-quick-switcher/fork");
});

test("an answer streams into one record and finishes", async () => {
  const store = createAskStore({
    request: async () =>
      responseOf(
        heldStream(
          sse(
            { type: "start", atSeq: 4, model: "m" },
            { type: "delta", text: "hel" },
            { type: "delta", text: "lo" },
            { type: "done" },
          ),
        ),
      ),
    now: () => 0,
  });

  const created = store.ask("s1", "  why?  ");
  assert.equal(created.status, "running");
  assert.equal(created.question, "why?");
  await flush();

  const settled = store.find(created.id);
  assert.equal(settled.answer, "hello");
  assert.equal(settled.status, "done");
  assert.equal(settled.model, "m");
  assert.equal(settled.atSeq, 4);
  assert.deepEqual(store.entriesOf("s1").map((record) => record.id), [created.id]);
});

test("a session runs one side question at a time", async () => {
  const store = createAskStore({
    request: () => new Promise(() => {}),
    now: () => 0,
  });

  const first = store.ask("s1", "one");
  assert.notEqual(first, null);
  assert.equal(store.ask("s1", "two"), null);
  assert.equal(store.entriesOf("s1").length, 1);
  // Another session is independent.
  assert.notEqual(store.ask("s2", "three"), null);
  await flush();
});

test("stopping keeps the partial answer and marks the record", async () => {
  const store = createAskStore({
    request: async () =>
      responseOf(
        heldStream(
          sse({ type: "start", atSeq: 1, model: "m" }, { type: "delta", text: "half" }),
        ),
      ),
    now: () => 0,
  });

  const record = store.ask("s1", "q");
  await flush();
  assert.equal(store.find(record.id).answer, "half");

  assert.equal(store.stop("s1", record.id), true);
  const stopped = store.find(record.id);
  assert.equal(stopped.status, "aborted");
  assert.equal(stopped.answer, "half");

  await flush();
  assert.equal(store.find(record.id).status, "aborted");
});

test("closing the panel only aborts the session it was showing", async () => {
  const store = createAskStore({
    request: () => new Promise(() => {}),
    now: () => 0,
  });
  const kept = store.ask("s1", "one");
  const closed = store.ask("s2", "two");
  store.abortSession("s2");

  assert.equal(store.find(kept.id).status, "running");
  assert.equal(store.find(closed.id).status, "aborted");
  await flush();
});

test("a dropped connection becomes an error, not a silent finish", async () => {
  const store = createAskStore({
    request: async () =>
      responseOf(closedStream(sse({ type: "delta", text: "par" }))),
    now: () => 0,
  });
  const record = store.ask("s1", "q");
  await flush();

  const settled = store.find(record.id);
  assert.equal(settled.status, "error");
  assert.equal(settled.answer, "par");
  assert.equal(settled.error, "askDisconnected");
});

test("reasoning streams into the record and survives a stop", async () => {
  const store = createAskStore({
    request: async () =>
      responseOf(
        heldStream(
          sse(
            { type: "start", atSeq: 1, model: "m" },
            { type: "reasoning", text: "think " },
            { type: "reasoning", text: "again" },
            { type: "delta", text: "ans" },
          ),
        ),
      ),
    now: () => 0,
  });

  const record = store.ask("s1", "q");
  await flush();
  const running = store.find(record.id);
  assert.equal(running.reasoning, "think again");
  assert.equal(running.answer, "ans");

  assert.equal(store.stop("s1", record.id), true);
  assert.equal(store.find(record.id).reasoning, "think again");
  await flush();
});

test("regenerating clears the answer and asks the same question again", async () => {
  const streams = [
    heldStream(
      sse(
        { type: "start", atSeq: 0 },
        { type: "reasoning", text: "old think" },
        { type: "delta", text: "old" },
        { type: "done" },
      ),
    ),
    heldStream(
      sse(
        { type: "start", atSeq: 0 },
        { type: "reasoning", text: "new think" },
        { type: "delta", text: "new" },
        { type: "done" },
      ),
    ),
  ];
  const seen = [];
  const store = createAskStore({
    request: async (path, body) => {
      seen.push({ path, body });
      return responseOf(streams.shift());
    },
    now: () => 0,
  });

  const record = store.ask("s1", "q");
  await flush();
  assert.equal(store.find(record.id).answer, "old");
  assert.equal(store.find(record.id).reasoning, "old think");

  assert.equal(store.regenerate("s1", record.id), true);
  assert.equal(store.find(record.id).answer, "");
  assert.equal(store.find(record.id).reasoning, "");
  await flush();

  assert.equal(store.find(record.id).answer, "new");
  assert.equal(store.find(record.id).reasoning, "new think");
  assert.equal(store.find(record.id).status, "done");
  assert.equal(seen.length, 2);
  assert.equal(seen[1].body.question, "q");
  assert.equal(seen[0].body.includeAttachments, true);
  assert.equal(seen[1].body.includeAttachments, true);
});

test("the attachment preference is read at question time and again on regenerate", async () => {
  let include = false;
  const seen = [];
  const store = createAskStore({
    request: async (path, body) => {
      seen.push({ path, body });
      return responseOf(heldStream(sse({ type: "done" })));
    },
    now: () => 0,
    includeAttachments: () => include,
  });

  const record = store.ask("s1", "q");
  await flush();
  assert.equal(seen[0].body.includeAttachments, false);

  // The switch is the current intent, so a change applies to the retry and the
  // record keeps the policy of its latest request.
  include = true;
  assert.equal(store.regenerate("s1", record.id), true);
  await flush();
  assert.equal(seen[1].body.includeAttachments, true);
  assert.equal(store.find(record.id).includeAttachments, true);

  const next = store.ask("s1", "q2");
  await flush();
  assert.equal(store.find(next.id).includeAttachments, true);
  assert.equal(seen[2].body.includeAttachments, true);
});

test("the pinned model and level are read again on regenerate", async () => {
  let choice = { provider: "q", model: "claude", effort: "low" };
  const seen = [];
  const store = createAskStore({
    request: async (path, body) => {
      seen.push({ path, body });
      return responseOf(
        heldStream(
          sse(
            {
              type: "start",
              atSeq: 0,
              provider: "q",
              model: "claude",
              reasoningEffort: "low",
              reasoningEffortName: "Low",
            },
            { type: "done" },
          ),
        ),
      );
    },
    now: () => 0,
    selection: () => choice,
  });

  const record = store.ask("s1", "q");
  await flush();
  assert.equal(seen[0].body.provider, "q");
  assert.equal(seen[0].body.model, "claude");
  assert.equal(seen[0].body.reasoningEffort, "low");
  assert.deepEqual(store.find(record.id).choice, { provider: "q", model: "claude", effort: "low" });
  // The effective values come from the host, not from the captured choice.
  assert.equal(store.find(record.id).provider, "q");
  assert.equal(store.find(record.id).effortName, "Low");

  // The setting changed after the first ask, so the retry follows it: no pinned
  // model and only a level. The record's captured values move with the request.
  choice = { provider: "", model: "", effort: "max" };
  assert.equal(store.regenerate("s1", record.id), true);
  await flush();
  assert.equal("provider" in seen[1].body, false);
  assert.equal("model" in seen[1].body, false);
  assert.equal(seen[1].body.reasoningEffort, "max");
  assert.deepEqual(store.find(record.id).choice, { provider: "", model: "", effort: "max" });
  // The status line still shows what the host ran, not what the setting asked.
  assert.equal(store.find(record.id).provider, "q");
  assert.equal(store.find(record.id).effortName, "Low");

  // The next question follows the same new setting.
  assert.notEqual(store.ask("s1", "q2"), null);
  await flush();
  assert.equal("provider" in seen[2].body, false);
  assert.equal("model" in seen[2].body, false);
  assert.equal(seen[2].body.reasoningEffort, "max");
});

test("the start event names the model and level the host actually used", async () => {
  const streams = [
    heldStream(
      sse(
        {
          type: "start",
          atSeq: 0,
          provider: "q",
          model: "claude",
          reasoningEffort: "off",
          reasoningEffortName: "Off",
        },
        { type: "done" },
      ),
    ),
    heldStream(
      sse(
        { type: "start", atSeq: 0, provider: "deepseek", model: "flash" },
        { type: "done" },
      ),
    ),
  ];
  const store = createAskStore({
    request: async () => responseOf(streams.shift()),
    now: () => 0,
  });

  const record = store.ask("s1", "q");
  await flush();
  const first = store.find(record.id);
  assert.equal(first.provider, "q");
  assert.equal(first.model, "claude");
  assert.equal(first.effort, "off");
  assert.equal(first.effortName, "Off");

  // A second start without a level must clear the old badge, not keep it.
  assert.equal(store.regenerate("s1", record.id), true);
  await flush();
  const second = store.find(record.id);
  assert.equal(second.provider, "deepseek");
  assert.equal(second.model, "flash");
  assert.equal(second.effort, "");
  assert.equal(second.effortName, "");
});

test("streamed text is kept on every chunk while notifications are throttled", async () => {
  let clock = 0;
  const store = createAskStore({
    request: async () => {
      const blocks = sse(
        { type: "start", atSeq: 0 },
        { type: "delta", text: "a" },
        { type: "delta", text: "b" },
        { type: "delta", text: "c" },
        { type: "done" },
      );
      let index = 0;
      const body = {
        getReader: () => ({
          read: async () => {
            clock += 10;
            if (index >= blocks.length) return new Promise(() => {});
            return { value: new TextEncoder().encode(blocks[index++]), done: false };
          },
        }),
      };
      return responseOf(body);
    },
    now: () => clock,
  });

  let notifications = 0;
  store.subscribe(() => {
    notifications += 1;
  });

  const record = store.ask("s1", "q");
  await flush();

  // 1 ask + 1 start + 1 first delta + 1 done; the two later deltas are folded.
  assert.equal(notifications, 4);
  assert.equal(store.find(record.id).answer, "abc");
});

test("fork posts the question, visible answer, prefix, and no background", async () => {
  const seen = [];
  const store = createAskStore({
    request: async (path, body) => {
      seen.push({ path, body });
      if (path === FORK_PATH) {
        return { ok: true, status: 200, json: async () => ({ sessionId: "child" }) };
      }
      return responseOf(
        heldStream(
          sse(
            { type: "start", atSeq: 4, model: "m" },
            { type: "reasoning", text: "thinking" },
            { type: "delta", text: "hi" },
            { type: "done" },
          ),
        ),
      );
    },
    now: () => 0,
  });

  const record = store.ask("s1", "why?", "background");
  await flush();
  assert.equal(canFork(store.find(record.id)), true);
  assert.equal(store.find(record.id).reasoning, "thinking");
  // The pending-interaction text is request input, not record state.
  assert.equal("context" in store.find(record.id), false);

  const child = await store.fork("s1", record.id);
  assert.equal(child, "child");
  assert.equal(seen[1].path, FORK_PATH);
  // Reasoning is a process, not part of the exchange the new session keeps,
  // and the pending card belongs to the screen the fork leaves behind.
  assert.deepEqual(seen[1].body, {
    sessionId: "s1",
    question: "why?",
    answer: "hi",
    atSeq: 4,
  });
});

test("fork refuses a record the user has nothing to continue from", async () => {
  let requests = 0;
  const store = createAskStore({
    request: async (path) => {
      requests += 1;
      if (path === FORK_PATH) throw new Error("fork must not run");
      return responseOf(heldStream(sse({ type: "start", atSeq: 2 })));
    },
    now: () => 0,
  });

  const record = store.ask("s1", "q");
  await flush();
  // No answer yet, so there is no exchange to append.
  assert.equal(await store.fork("s1", record.id), null);
  assert.equal(requests, 1);
});

test("a refused fork surfaces the host message", async () => {
  const store = createAskStore({
    request: async (path) => {
      if (path === FORK_PATH) {
        return {
          ok: false,
          status: 500,
          json: async () => ({ error: "fork failed" }),
        };
      }
      return responseOf(
        heldStream(sse({ type: "start", atSeq: 0 }, { type: "delta", text: "hi" }, { type: "done" })),
      );
    },
    now: () => 0,
  });

  const record = store.ask("s1", "q");
  await flush();
  await assert.rejects(() => store.fork("s1", record.id), /fork failed/);
});

test("dispose aborts the live request and drops every record", async () => {
  let signal;
  const store = createAskStore({
    request: (path, body, received) => {
      signal = received;
      return new Promise(() => {});
    },
    now: () => 0,
  });

  const record = store.ask("s1", "q");
  assert.equal(signal.aborted, false);
  store.dispose();
  assert.equal(signal.aborted, true);
  assert.equal(signal.reason.message, UNLOADED_MESSAGE);
  assert.equal(store.find(record.id), null);
});

test("a restored list over the byte cap is trimmed back into storage", () => {
  const initial = [];
  for (let index = 0; index < 21; index += 1) {
    initial.push(
      storedRecord({
        id: `ask-${index + 1}`,
        question: `question ${index}`,
        startedAt: 1000 + index,
      }),
    );
  }
  const storage = fakeRecordStorage(initial);
  // A cap below the whole document forces the oldest records out on load.
  const limit = weighAskRecords(initial.slice(0, 10)).bytes;
  const store = createAskStore({
    request: async () => new Promise(() => {}),
    now: () => 2000,
    recordStorage: storage,
    recordLimit: () => limit,
  });

  assert.ok(store.entriesOf("s1").length < 21);
  assert.equal(store.entriesOf("s1").length, storage.state.records.length);
  assert.equal(store.find("ask-1"), null);
});

test("records survive a reload and keep their reasoning", async () => {
  const storage = fakeRecordStorage();
  const first = createAskStore({
    request: async () =>
      responseOf(
        heldStream(
          sse(
            { type: "start", atSeq: 2, provider: "p", model: "m" },
            { type: "reasoning", text: "think" },
            { type: "delta", text: "hi" },
            { type: "done" },
          ),
        ),
      ),
    now: () => 1000,
    recordStorage: storage,
  });

  const record = first.ask("s1", "why?", "card");
  await flush();
  assert.equal(storage.state.saves > 0, true);
  assert.equal(first.find(record.id).status, "done");

  const second = createAskStore({
    request: async () => new Promise(() => {}),
    now: () => 2000,
    recordStorage: storage,
  });
  const restored = second.entriesOf("s1");
  assert.equal(restored.length, 1);
  assert.equal(restored[0].question, "why?");
  assert.equal(restored[0].answer, "hi");
  assert.equal(restored[0].reasoning, "think");
  assert.equal(restored[0].status, "done");
  assert.equal(restored[0].provider, "p");
  assert.equal(restored[0].atSeq, 2);
  assert.equal(restored[0].includeAttachments, true);
  assert.deepEqual(restored[0].choice, { provider: "", model: "", effort: "lowest" });
  // The pending card is request input, not record state.
  assert.equal("context" in restored[0], false);

  // The id counter continues instead of reusing ask-1.
  const next = second.ask("s1", "again");
  assert.equal(next.id, "ask-2");
});

test("a pagehide flush keeps the last streamed text for the next store", async () => {
  const storage = fakeRecordStorage();
  const window = fakeWindow();
  const first = createAskStore({
    request: async () =>
      responseOf(
        heldStream(
          sse(
            { type: "start", atSeq: 1 },
            { type: "reasoning", text: "think" },
            { type: "delta", text: "half" },
          ),
        ),
      ),
    now: () => 0,
    recordStorage: storage,
    eventTarget: window,
  });

  const record = first.ask("s1", "q");
  await flush();
  assert.equal(first.find(record.id).status, "running");
  // The frozen clock keeps the throttled write at the ask; the pagehide flush
  // is what lands the text the user can still see.
  assert.equal(storage.state.records[0].answer, "");
  window.dispatchEvent(new Event("pagehide"));
  assert.equal(storage.state.records[0].answer, "half");
  assert.equal(storage.state.records[0].reasoning, "think");

  first.dispose();
  const second = createAskStore({
    request: async () => new Promise(() => {}),
    now: () => 1000,
    recordStorage: storage,
  });
  const restored = second.find(record.id);
  assert.equal(restored.status, "aborted");
  assert.equal(restored.answer, "half");
  assert.equal(restored.reasoning, "think");
  second.dispose();
});

test("the byte cap drops the oldest record on the next write", async () => {
  const storage = fakeRecordStorage();
  let limit = 0;
  let clock = 0;
  const store = createAskStore({
    request: async () => responseOf(heldStream(sse({ type: "done" }))),
    now: () => clock,
    recordStorage: storage,
    recordLimit: () => limit,
  });

  const first = store.ask("s1", "first");
  await flush();
  assert.equal(store.find(first.id).status, "done");
  limit = weighAskRecords([store.find(first.id)]).bytes + 60;

  clock = 1000;
  const second = store.ask("s1", "second");
  await flush();
  assert.deepEqual(
    store.entriesOf("s1").map((record) => record.id),
    [second.id],
  );
  assert.deepEqual(
    storage.state.records.map((record) => record.id),
    [second.id],
  );
});

test("regenerating sends the context it is given, not the first attempt's", async () => {
  const seen = [];
  const store = createAskStore({
    request: async (path, body) => {
      seen.push(body);
      return responseOf(heldStream(sse({ type: "done" })));
    },
    now: () => 0,
  });

  const record = store.ask("s1", "q", "first card");
  await flush();
  assert.equal(seen[0].context, "first card");

  store.regenerate("s1", record.id, "second card");
  await flush();
  assert.equal(seen[1].context, "second card");

  // No card on screen means no context field at all.
  store.regenerate("s1", record.id, "");
  await flush();
  assert.equal("context" in seen[2], false);
});

test("clearing drops the live list and the stored document", async () => {
  const storage = fakeRecordStorage();
  let signal;
  const store = createAskStore({
    request: (path, body, received) => {
      signal = received;
      return new Promise(() => {});
    },
    now: () => 0,
    recordStorage: storage,
  });

  store.ask("s1", "q");
  await flush();
  assert.equal(store.entriesOf("s1").length, 1);
  store.clearRecords();
  assert.equal(signal.aborted, true);
  assert.equal(store.entriesOf("s1").length, 0);
  assert.equal(storage.state.clears, 1);
  assert.deepEqual(storage.state.records, []);
});

test("dispose writes the last state before dropping memory", async () => {
  const storage = fakeRecordStorage();
  let signal;
  const store = createAskStore({
    request: (path, body, received) => {
      signal = received;
      return new Promise(() => {});
    },
    now: () => 0,
    recordStorage: storage,
  });

  const record = store.ask("s1", "q");
  const savesBefore = storage.state.saves;
  store.dispose();
  assert.equal(signal.aborted, true);
  assert.equal(storage.state.saves > savesBefore, true);
  assert.equal(storage.state.records.length, 1);
  assert.equal(storage.state.records[0].status, "running");
  assert.equal(store.find(record.id), null);
});
