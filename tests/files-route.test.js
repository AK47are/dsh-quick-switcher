import assert from "node:assert/strict";
import test from "node:test";
import { createRoutes, pickView } from "../src/routes/index.js";
import { createFilesRoute } from "../src/routes/files.js";

const t = (key, vars) => (vars === undefined ? key : `${key}:${vars.count}`);

const items = [
  { path: "src/App.tsx", kind: "file" },
  { path: "src", kind: "directory" },
  { path: "README.md", kind: "file" },
];

function context(files, currentId = "s1") {
  return { currentId, files, t, now: 0 };
}

/** Let a debounced load run its timer and settle the promise chain. */
async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function routeWith(notify, debounceMs = 0) {
  return createFilesRoute({ notify, debounceMs });
}

test("the files route claims only @ queries", () => {
  const route = routeWith(() => {});
  assert.equal(route.parse("+x", context({})), null);
  assert.deepEqual(route.parse("@src", context({})), {
    filter: "src",
    sessionId: "s1",
  });
  assert.deepEqual(route.parse("@", context({}, null)), {
    filter: "",
    sessionId: null,
  });
});

test("without a current session the view asks for one and never searches", async () => {
  let calls = 0;
  const route = routeWith(() => {});
  const ctx = context(
    {
      search() {
        calls += 1;
        return Promise.resolve({ ok: true, items });
      },
    },
    null,
  );
  const view = route.view(route.parse("@", ctx), ctx);
  assert.equal(view.rows.length, 0);
  assert.equal(view.emptyText, "filesNoSession");
  view.load();
  await flush();
  assert.equal(calls, 0);
});

test("a settled query projects rows, count, and loading states", async () => {
  let notified = 0;
  const route = routeWith(() => {
    notified += 1;
  });
  const ctx = context({
    search(sessionId, query) {
      assert.equal(sessionId, "s1");
      assert.equal(query, "sr");
      return Promise.resolve({ ok: true, items });
    },
  });

  const loading = route.view(route.parse("@sr", ctx), ctx);
  assert.equal(loading.rows.length, 0);
  assert.equal(loading.emptyText, "filesLoading");
  loading.load();
  await flush();
  assert.equal(notified, 1);

  const view = route.view(route.parse("@sr", ctx), ctx);
  assert.deepEqual(
    view.rows.map((row) => row.key),
    ["f:src/App.tsx", "d:src", "f:README.md"],
  );
  assert.equal(view.count, "countFiles:3");
  assert.equal(view.emptyText, null);
  assert.equal(view.rows[0].title, "App.tsx");
  assert.equal(view.rows[0].meta[0].text, "src");
  assert.equal(view.rows[1].title, "src/");
  assert.equal(view.rows[2].meta[0].text, "./");
});

test("file rows open the preview and directory rows drill into the query", async () => {
  const route = routeWith(() => {});
  const ctx = context({
    search: () => Promise.resolve({ ok: true, items }),
  });
  const view = route.view(route.parse("@", ctx), ctx);
  view.load();
  await flush();
  const settled = route.view(route.parse("@", ctx), ctx);
  const file = settled.rows.find((row) => row.key === "f:src/App.tsx");
  const directory = settled.rows.find((row) => row.key === "d:src");
  const activation = {};

  assert.deepEqual(file.run(activation), {
    type: "file",
    path: "src/App.tsx",
    focus: "previous",
  });
  assert.deepEqual(file.shiftRun(activation), {
    type: "file",
    path: "src/App.tsx",
    focus: "preview",
  });
  assert.deepEqual(directory.run(activation), { type: "query", query: "@src/" });
  assert.deepEqual(directory.shiftRun(activation), {
    type: "query",
    query: "@src/",
  });
});

test("a plain fragment highlights the file name but a path does not", async () => {
  const route = routeWith(() => {});
  const ctx = context({
    search: () => Promise.resolve({ ok: true, items }),
  });
  route.view(route.parse("@app", ctx), ctx).load();
  await flush();
  const matched = route.view(route.parse("@app", ctx), ctx);
  assert.equal(matched.rows[0].positions.size, 3);

  const withSlashParsed = route.parse("@src/ap", ctx);
  route.view(withSlashParsed, ctx).load();
  await flush();
  assert.equal(route.view(withSlashParsed, ctx).rows[0].positions, null);
});

test("a failed lookup reports the failure instead of pretending there are no files", async () => {
  const route = routeWith(() => {});
  const ctx = context({ search: () => Promise.resolve({ ok: false }) });
  const parsed = route.parse("@x", ctx);
  route.view(parsed, ctx).load();
  await flush();
  assert.equal(route.view(parsed, ctx).emptyText, "filesFailed");
});

test("settled queries are cached and in flight queries are deduped", async () => {
  let calls = 0;
  const route = routeWith(() => {});
  const ctx = context({
    search() {
      calls += 1;
      return Promise.resolve({ ok: true, items });
    },
  });
  const parsed = route.parse("@a", ctx);
  route.view(parsed, ctx).load();
  route.view(parsed, ctx).load();
  await flush();
  route.view(parsed, ctx).load();
  await flush();
  assert.equal(calls, 1);
});

test("dispose aborts the query in flight", async () => {
  let signal;
  const route = routeWith(() => {});
  const ctx = context({
    search(_sessionId, _query, nextSignal) {
      signal = nextSignal;
      return new Promise(() => {});
    },
  });
  route.view(route.parse("@slow", ctx), ctx).load();
  await flush();
  assert.equal(signal.aborted, false);
  route.dispose();
  assert.equal(signal.aborted, true);
});

test("the route table hands @ queries to the files route", () => {
  const routes = createRoutes();
  const view = pickView(routes, "@", context({}, null));
  assert.equal(view.placeholder, "placeholderFiles");
  assert.equal(view.emptyText, "filesNoSession");
});
