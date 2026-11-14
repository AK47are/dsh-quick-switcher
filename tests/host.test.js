import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { apply } from "../index.js";

/** One live session with a two-message history: text is kept, tool calls drop. */
function createAgent() {
  return {
    model: { current: () => ({ provider: "p", model: "m" }) },
    session: {
      id: "s1",
      seq: 5,
      deriveMessages() {
        return [
          { role: "user", content: [{ type: "text", text: "hello" }] },
          { role: "assistant", content: [{ type: "tool-call", text: "x" }] },
        ];
      },
      requestContext: () => ({ contextWindow: 100_000 }),
      requestHeader: () => ({ config: { provider: "p", model: "m" } }),
    },
  };
}

function createContext({ agent, llm, sessionController } = {}) {
  const routes = new Map();
  const agents = new Map();
  if (agent !== undefined) agents.set("s1", agent);
  const ctx = {
    effect(fn) {
      fn();
    },
    webServer: {
      register({ path, handler }) {
        routes.set(path, handler);
        return () => routes.delete(path);
      },
    },
    agents: { get: (id) => agents.get(id) },
    llm,
    sessionController,
  };
  return { ctx, routes, agents };
}

function createRequest({ method = "POST", headers = {} } = {}) {
  const request = new EventEmitter();
  request.method = method;
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
  response.ended = false;
  response.writeHead = (status, headers) => {
    response.status = status;
    response.headers = headers;
  };
  response.flushHeaders = () => {};
  response.write = (chunk) => {
    response.chunks.push(chunk);
    return true;
  };
  response.end = (chunk) => {
    if (typeof chunk === "string") response.chunks.push(chunk);
    response.ended = true;
  };
  return response;
}

/** Send one JSON body through a fake request and await the handler. */
async function post(handler, body) {
  const request = createRequest();
  const response = createResponse();
  const pending = handler(request, response);
  request.emit("data", Buffer.from(JSON.stringify(body)));
  request.emit("end");
  await pending;
  return response;
}

function eventsOf(response) {
  return response.chunks
    .join("")
    .split("\n\n")
    .filter((block) => block !== "")
    .map((block) => JSON.parse(block.slice(5)));
}

test("the ask route streams start, deltas, usage, finish, and done", async () => {
  async function* stream() {
    yield { type: "text-delta", text: "side " };
    yield { type: "text-delta", text: "answer" };
    yield { type: "usage", usage: { inputTokens: 3, outputTokens: 4 } };
    yield { type: "finish", reason: "stop" };
  }
  const { ctx, routes } = createContext({
    agent: createAgent(),
    llm: { stream: () => stream() },
  });
  apply(ctx);
  const handler = routes.get("/dsh-quick-switcher/ask");
  assert.equal(typeof handler, "function");

  const response = await post(handler, { sessionId: "s1", question: "  why?  " });
  assert.equal(response.status, 200);
  assert.equal(response.headers["content-type"], "text/event-stream; charset=utf-8");

  const events = eventsOf(response);
  assert.deepEqual(
    events.map((event) => event.type),
    ["start", "delta", "delta", "usage", "finish", "done"],
  );
  assert.equal(events[0].atSeq, 4);
  assert.equal(events[0].model, "m");
  assert.equal(events[1].text, "side ");
  assert.equal(response.ended, true);
});

test("the ask route refuses a foreign origin and a non-POST method", async () => {
  const { ctx, routes } = createContext({ agent: createAgent(), llm: {} });
  apply(ctx);
  const handler = routes.get("/dsh-quick-switcher/ask");

  const foreign = createRequest({ headers: { origin: "http://evil.example" } });
  const refused = createResponse();
  await handler(foreign, refused);
  assert.equal(refused.status, 403);

  const get = createRequest({ method: "GET" });
  const notAllowed = createResponse();
  await handler(get, notAllowed);
  assert.equal(notAllowed.status, 405);
});

test("a question without a live session answers 404", async () => {
  const { ctx, routes } = createContext({ llm: {} });
  apply(ctx);
  const response = await post(routes.get("/dsh-quick-switcher/ask"), {
    sessionId: "gone",
    question: "why?",
  });
  assert.equal(response.status, 404);
});

test("one running question per session answers 409", async () => {
  async function* stream() {
    await new Promise(() => {});
  }
  const { ctx, routes } = createContext({
    agent: createAgent(),
    llm: { stream: () => stream() },
  });
  apply(ctx);
  const handler = routes.get("/dsh-quick-switcher/ask");

  // The first answer never settles, which keeps its session marked running.
  const first = createRequest();
  const firstResponse = createResponse();
  handler(first, firstResponse);
  first.emit("data", Buffer.from(JSON.stringify({ sessionId: "s1", question: "one" })));
  first.emit("end");
  await new Promise((resolve) => setImmediate(resolve));

  const second = await post(handler, { sessionId: "s1", question: "two" });
  assert.equal(second.status, 409);
});

test("the fork route records the exchange and returns the child id", async () => {
  const appended = [];
  const child = {
    session: {
      append(kind, message) {
        appended.push({ kind, message });
      },
    },
  };
  const { ctx, routes, agents } = createContext({
    agent: createAgent(),
    llm: {},
    sessionController: {
      async fork({ sessionId, atSeq }) {
        assert.equal(sessionId, "s1");
        assert.equal(atSeq, 4);
        return { sessionId: "child" };
      },
    },
  });
  apply(ctx);
  agents.set("child", child);

  const response = await post(routes.get("/dsh-quick-switcher/fork"), {
    sessionId: "s1",
    question: "why?",
    answer: "because",
    atSeq: 4,
    context: "Pending interaction: approval",
  });
  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(response.chunks.join("")), { sessionId: "child" });

  assert.equal(appended.length, 1);
  assert.equal(appended[0].kind, "user/message");
  assert.equal(appended[0].message.source.kind, "user");
  const text = appended[0].message.content[0].text;
  assert.match(text, /【侧问】\nwhy\?/u);
  assert.match(text, /【侧问回答】\nbecause/u);
  assert.match(text, /【侧问背景】/u);
});

test("fork without a session controller answers 501", async () => {
  const { ctx, routes } = createContext({ agent: createAgent(), llm: {} });
  apply(ctx);
  const response = await post(routes.get("/dsh-quick-switcher/fork"), {
    sessionId: "s1",
    question: "why?",
    answer: "because",
  });
  assert.equal(response.status, 501);
});
