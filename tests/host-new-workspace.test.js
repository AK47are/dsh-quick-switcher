import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import hostModule from "../src/modules/new-workspace/host.js";
import { LIST_PATH, MKDIR_PATH } from "../src/modules/new-workspace/shared.js";

function createRoutes() {
  const routes = new Map();
  const api = {
    id: "new-workspace",
    webServer: {
      register({ path, handler }) {
        routes.set(path, handler);
        return () => routes.delete(path);
      },
    },
    agents: {},
    llm: {},
    sessionController: {},
    on: () => () => {},
    effect: (callback) => {
      const dispose = callback();
      return typeof dispose === "function" ? dispose : () => {};
    },
    log: { info() {}, warn() {}, error() {} },
  };
  const spec = hostModule.setup(api);
  for (const route of spec.routes) routes.set(route.path, route.handler);
  return routes;
}

function createRequest({ method = "GET", path = "/", headers = {} } = {}) {
  const request = new EventEmitter();
  request.method = method;
  request.url = path;
  request.headers = {
    host: "127.0.0.1:3080",
    origin: "http://127.0.0.1:3080",
    ...headers,
  };
  request.destroy = () => {};
  return request;
}

function createResponse() {
  const response = new EventEmitter();
  response.status = 0;
  response.headers = {};
  response.chunks = [];
  response.writeHead = (status, headers) => {
    response.status = status;
    response.headers = headers;
  };
  response.end = (chunk) => {
    if (typeof chunk === "string") response.chunks.push(chunk);
  };
  return response;
}

async function send(handler, { method = "GET", path = "/", headers, body } = {}) {
  const request = createRequest({ method, path, headers });
  const response = createResponse();
  const pending = handler(request, response);
  if (body !== undefined) request.emit("data", Buffer.from(JSON.stringify(body)));
  request.emit("end");
  await pending;
  const text = response.chunks.join("");
  return { response, body: text === "" ? null : JSON.parse(text) };
}

async function withRoot(fn) {
  const root = await mkdtemp(join(tmpdir(), "dqs-new-workspace-"));
  try {
    return await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function listUrl(path) {
  return `${LIST_PATH}?path=${encodeURIComponent(path)}`;
}

test("the list route answers subdirectories with hidden entries and no files", async () => {
  const routes = createRoutes();
  await withRoot(async (root) => {
    await mkdir(join(root, "alpha"));
    await mkdir(join(root, "beta"));
    await mkdir(join(root, ".hidden"));
    await writeFile(join(root, "note.txt"), "x");

    const { response, body } = await send(routes.get(LIST_PATH), {
      method: "GET",
      path: listUrl(root),
    });
    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(typeof body.path, "string");
    assert.equal(body.separator, process.platform === "win32" ? "\\" : "/");
    assert.equal(body.platform, process.platform);
    assert.equal(typeof body.home, "string");
    const names = body.entries.map((entry) => entry.name).sort();
    assert.deepEqual(names, [".hidden", "alpha", "beta"]);
    const hidden = body.entries.find((entry) => entry.name === ".hidden");
    assert.equal(hidden.hidden, true);
    assert.equal(body.entries.some((entry) => entry.name === "note.txt"), false);
  });
});

test("the list route reports a missing directory, a file, and a relative path", async () => {
  const routes = createRoutes();
  await withRoot(async (root) => {
    await writeFile(join(root, "note.txt"), "x");
    const missing = await send(routes.get(LIST_PATH), {
      path: listUrl(join(root, "nope")),
    });
    assert.equal(missing.response.status, 200);
    assert.deepEqual(
      { ok: missing.body.ok, code: missing.body.code },
      { ok: false, code: "missing" },
    );

    const file = await send(routes.get(LIST_PATH), {
      path: listUrl(join(root, "note.txt")),
    });
    assert.deepEqual({ ok: file.body.ok, code: file.body.code }, {
      ok: false,
      code: "not-directory",
    });

    const relative = await send(routes.get(LIST_PATH), { path: listUrl("relative/path") });
    assert.equal(relative.response.status, 400);
    assert.equal(relative.body.code, "invalid");
  });
});

test("the list route refuses another origin and a non-GET method", async () => {
  const routes = createRoutes();
  const foreign = await send(routes.get(LIST_PATH), {
    path: listUrl("/"),
    headers: { origin: "http://evil.example" },
  });
  assert.equal(foreign.response.status, 403);

  const post = await send(routes.get(LIST_PATH), { method: "POST", path: listUrl("/") });
  assert.equal(post.response.status, 405);
});

test("the mkdir route creates a missing directory tree", async () => {
  const routes = createRoutes();
  await withRoot(async (root) => {
    const target = join(root, "new", "deep");
    const { response, body } = await send(routes.get(MKDIR_PATH), {
      method: "POST",
      path: MKDIR_PATH,
      body: { path: target },
    });
    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal((await stat(target)).isDirectory(), true);
  });
});

test("the mkdir route refuses a relative path and a foreign origin", async () => {
  const routes = createRoutes();
  const relative = await send(routes.get(MKDIR_PATH), {
    method: "POST",
    path: MKDIR_PATH,
    body: { path: "relative/path" },
  });
  assert.equal(relative.response.status, 400);
  assert.equal(relative.body.code, "invalid");

  const foreign = await send(routes.get(MKDIR_PATH), {
    method: "POST",
    path: MKDIR_PATH,
    body: { path: "C:\\anything" },
    headers: { origin: "http://evil.example" },
  });
  assert.equal(foreign.response.status, 403);

  const get = await send(routes.get(MKDIR_PATH), { method: "GET", path: MKDIR_PATH });
  assert.equal(get.response.status, 405);
});
