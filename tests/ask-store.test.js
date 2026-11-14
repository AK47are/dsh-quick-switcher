import assert from "node:assert/strict";
import test from "node:test";
import { createAskStore } from "../src/ask-store.js";

const t = (key) => key;

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

test("regenerating clears the answer and asks the same question again", async () => {
  const streams = [
    heldStream(sse({ type: "start", atSeq: 0 }, { type: "delta", text: "old" }, { type: "done" })),
    heldStream(sse({ type: "start", atSeq: 0 }, { type: "delta", text: "new" }, { type: "done" })),
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

  assert.equal(store.regenerate("s1", record.id), true);
  assert.equal(store.find(record.id).answer, "");
  await flush();

  assert.equal(store.find(record.id).answer, "new");
  assert.equal(store.find(record.id).status, "done");
  assert.equal(seen.length, 2);
  assert.equal(seen[1].body.question, "q");
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

test("one session keeps at most twenty records, newest first", async () => {
  const store = createAskStore({
    request: async () => responseOf(heldStream(sse({ type: "done" }))),
    now: () => 0,
  });

  for (let index = 0; index < 21; index += 1) {
    assert.notEqual(store.ask("s1", `q${index}`), null);
    await flush();
  }

  const entries = store.entriesOf("s1");
  assert.equal(entries.length, 20);
  assert.equal(entries[0].question, "q20");
  assert.equal(entries[19].question, "q1");
});

test("at most eight sessions keep records", async () => {
  const store = createAskStore({
    request: async () => responseOf(heldStream(sse({ type: "done" }))),
    now: () => 0,
  });

  for (let index = 0; index < 9; index += 1) {
    assert.notEqual(store.ask(`s${index}`, "q"), null);
    await flush();
  }

  assert.equal(store.entriesOf("s0").length, 0);
  for (let index = 1; index < 9; index += 1) {
    assert.equal(store.entriesOf(`s${index}`).length, 1);
  }
});
