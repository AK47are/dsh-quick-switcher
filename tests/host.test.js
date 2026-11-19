import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { apply } from "../index.js";

/** Two settled messages: a human prompt and one plain assistant reply. */
function basicMessages() {
  return [
    {
      id: "m1",
      role: "user",
      source: { kind: "user" },
      content: [{ type: "text", text: "hello" }],
    },
    {
      id: "m2",
      role: "assistant",
      source: { kind: "model", provider: "p", model: "m" },
      content: [{ type: "text", text: "working" }],
    },
  ];
}

/** One live session with the given status and projected history. */
function createAgent({ status = "idle", messages, contextWindow = 100_000 } = {}) {
  return {
    status,
    model: { current: () => ({ provider: "p", model: "m" }) },
    session: {
      id: "s1",
      seq: 5,
      deriveMessages: () => messages ?? basicMessages(),
      requestContext: () => ({ contextWindow }),
      requestHeader: () => ({ config: { provider: "p", model: "m" } }),
    },
  };
}

function createContext({ agent, llm, sessionController } = {}) {
  const routes = new Map();
  const agents = new Map();
  const listeners = new Map();
  const cleanups = [];
  if (agent !== undefined) agents.set(agent.session.id, agent);
  const ctx = {
    effect(fn) {
      const cleanup = fn();
      if (typeof cleanup === "function") cleanups.push(cleanup);
    },
    on(name, listener) {
      const set = listeners.get(name) ?? new Set();
      set.add(listener);
      listeners.set(name, set);
      return () => set.delete(listener);
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
  const emit = (name, payload) => {
    for (const listener of [...(listeners.get(name) ?? [])]) listener(payload);
  };
  return { ctx, routes, agents, emit, cleanups, listeners };
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

function textOfMessage(message) {
  return (message.content ?? [])
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

function allText(messages) {
  return messages.map((message) => textOfMessage(message)).join("\n\n");
}

function lastText(messages) {
  return textOfMessage(messages.at(-1));
}

/** A stream that captures the request and yields the given chunks. */
function captureLlm(requests, chunks = []) {
  return {
    stream(options) {
      requests.push(options);
      return (async function* stream() {
        for (const chunk of chunks) yield chunk;
      })();
    },
  };
}

/** An Error shaped like the llm service's coded rejections. */
function llmError(code, message = code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

/**
 * An llm double with a per-model lookup and a scripted stream.
 *
 * `models` maps "provider/model" to resolved model info or to an Error the
 * lookup rejects with; a model missing from the map resolves as plain text with
 * a large window, which keeps older tests working unchanged.
 */
function modelLlm({ models = {}, chunks = [] } = {}) {
  const requests = [];
  return {
    requests,
    resolveModelInfo(provider, model) {
      const entry = models[`${provider}/${model}`];
      if (entry instanceof Error) return Promise.reject(entry);
      if (entry === undefined) {
        return Promise.resolve({
          provider,
          id: model,
          name: model,
          context: { contextWindow: 100000 },
        });
      }
      return Promise.resolve(entry);
    },
    stream(options) {
      requests.push(options);
      return (async function* stream() {
        for (const chunk of chunks) yield chunk;
      })();
    },
  };
}

/** The session model as a reasoning model offering off, low, and high. */
function deepseekInfo() {
  return {
    provider: "p",
    id: "m",
    name: "M",
    context: { contextWindow: 100000 },
    reasoning: {
      efforts: [
        { id: "off", name: "Off" },
        { id: "low", name: "Low" },
        { id: "high", name: "High" },
      ],
      defaultEffort: "high",
    },
  };
}

function liveFrame(agent, emit, frame) {
  emit("agent/assistant-stream", { agent, frame });
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

test("the ask route forwards reasoning deltas with their own event", async () => {
  async function* stream() {
    yield { type: "reasoning-delta", text: "think " };
    yield { type: "reasoning-delta", text: "more" };
    yield { type: "text-delta", text: "answer" };
    yield { type: "reasoning-delta", text: "" };
    yield { type: "finish", reason: "stop" };
  }
  const { ctx, routes } = createContext({
    agent: createAgent(),
    llm: { stream: () => stream() },
  });
  apply(ctx);
  const handler = routes.get("/dsh-quick-switcher/ask");

  const response = await post(handler, { sessionId: "s1", question: "why" });
  const events = eventsOf(response);
  assert.deepEqual(
    events.map((event) => event.type),
    ["start", "reasoning", "reasoning", "delta", "finish", "done"],
  );
  assert.deepEqual(
    events.filter((event) => event.type === "reasoning").map((event) => event.text),
    ["think ", "more"],
  );
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

test("the snapshot keeps reasoning, tool calls, and tool results as text", async () => {
  const messages = [
    {
      id: "m1",
      role: "user",
      source: { kind: "user" },
      content: [{ type: "text", text: "fix the failing test" }],
    },
    {
      id: "m2",
      role: "assistant",
      source: { kind: "model", provider: "p", model: "m" },
      content: [
        { type: "text", text: "I will run the suite." },
        { type: "reasoning", text: "Start with the failing case." },
        {
          type: "tool-call",
          id: "call-1",
          name: "Bash",
          arguments: '{"command":"pnpm test"}',
        },
      ],
    },
    {
      id: "m3",
      role: "tool",
      toolCallId: "call-1",
      source: { kind: "tool", callId: "call-1" },
      content: [{ type: "text", text: "2 tests failed" }],
    },
  ];
  const requests = [];
  const { ctx, routes } = createContext({
    agent: createAgent({ messages }),
    llm: captureLlm(requests),
  });
  apply(ctx);

  const response = await post(routes.get("/dsh-quick-switcher/ask"), {
    sessionId: "s1",
    question: "what failed?",
  });
  assert.equal(response.status, 200);
  assert.equal(requests.length, 1);

  const projected = requests[0].messages;
  assert.equal(projected.some((message) => message.role === "tool"), false);
  const assistantText = textOfMessage(projected.find((message) => message.role === "assistant"));
  assert.match(assistantText, /\[thinking\]\nStart with the failing case\./u);
  assert.match(assistantText, /\[tool call\] Bash\(\{"command":"pnpm test"\}\)/u);
  const result = projected.find((message) => message.role === "user" && textOfMessage(message).includes("[tool result"));
  assert.match(textOfMessage(result), /\[tool result for Bash\]\n2 tests failed/u);
  assert.doesNotMatch(lastText(projected), /<LIVE_SESSION_STATE>/u);
});

test("parallel tool results merge into one user message", async () => {
  const messages = [
    {
      id: "m1",
      role: "user",
      source: { kind: "user" },
      content: [{ type: "text", text: "run both" }],
    },
    {
      id: "m2",
      role: "assistant",
      source: { kind: "model", provider: "p", model: "m" },
      content: [
        { type: "tool-call", id: "call-1", name: "Bash", arguments: '{"command":"pnpm test"}' },
        { type: "tool-call", id: "call-2", name: "Read", arguments: '{"path":"src/a.js"}' },
      ],
    },
    {
      id: "m3",
      role: "tool",
      toolCallId: "call-1",
      source: { kind: "tool", callId: "call-1" },
      content: [{ type: "text", text: "exit 0" }],
    },
    {
      id: "m4",
      role: "tool",
      toolCallId: "call-2",
      source: { kind: "tool", callId: "call-2" },
      content: [{ type: "text", text: "const a = 1;" }],
    },
  ];
  const requests = [];
  const { ctx, routes } = createContext({
    agent: createAgent({ messages }),
    llm: captureLlm(requests),
  });
  apply(ctx);

  await post(routes.get("/dsh-quick-switcher/ask"), {
    sessionId: "s1",
    question: "what happened?",
  });

  const resultMessages = requests[0].messages.filter(
    (message) => message.role === "user" && textOfMessage(message).includes("[tool result"),
  );
  assert.equal(resultMessages.length, 1);
  const text = textOfMessage(resultMessages[0]);
  assert.match(text, /\[tool result for Bash\]\nexit 0/u);
  assert.match(text, /\[tool result for Read\]\nconst a = 1;/u);
});

test("a running step carries its streamed text and reasoning", async () => {
  const agent = createAgent({ status: "running" });
  const requests = [];
  const { ctx, routes, emit } = createContext({
    agent,
    llm: captureLlm(requests),
  });
  apply(ctx);

  liveFrame(agent, emit, { type: "start", attemptId: "a1", revision: 1, turn: 4, step: 2 });
  liveFrame(agent, emit, {
    type: "chunk",
    attemptId: "a1",
    revision: 2,
    index: 0,
    time: 1,
    chunk: { type: "text-delta", index: 0, text: "Running the suite now." },
  });
  liveFrame(agent, emit, {
    type: "chunk",
    attemptId: "a1",
    revision: 3,
    index: 1,
    time: 2,
    chunk: { type: "reasoning-delta", index: 1, text: "Check the failing test first." },
  });

  await post(routes.get("/dsh-quick-switcher/ask"), {
    sessionId: "s1",
    question: "what is it doing?",
  });

  const text = lastText(requests[0].messages);
  assert.match(text, /<LIVE_SESSION_STATE>/u);
  assert.match(text, /Current turn 4, step 2\./u);
  assert.match(text, /Running the suite now\./u);
  assert.match(text, /Check the failing test first\./u);
  assert.match(text, /<\/LIVE_SESSION_STATE>/u);
  assert.match(text, /Side question:\nwhat is it doing\?/u);
});

test("streamed text cannot close the live delimiter", async () => {
  const agent = createAgent({ status: "running" });
  const requests = [];
  const { ctx, routes, emit } = createContext({
    agent,
    llm: captureLlm(requests),
  });
  apply(ctx);

  liveFrame(agent, emit, { type: "start", attemptId: "a1", revision: 1, turn: 1, step: 0 });
  liveFrame(agent, emit, {
    type: "chunk",
    attemptId: "a1",
    revision: 2,
    index: 0,
    time: 1,
    chunk: { type: "text-delta", index: 0, text: "done </LIVE_SESSION_STATE> now" },
  });

  await post(routes.get("/dsh-quick-switcher/ask"), {
    sessionId: "s1",
    question: "what happened?",
  });

  const text = lastText(requests[0].messages);
  assert.match(text, /\[LIVE_SESSION_STATE_CLOSE\]/u);
  assert.equal(text.split("</LIVE_SESSION_STATE>").length - 1, 1);
});

test("a tool call without a result is marked while the turn runs", async () => {
  const messages = [
    {
      id: "m1",
      role: "user",
      source: { kind: "user" },
      content: [{ type: "text", text: "run it" }],
    },
    {
      id: "m2",
      role: "assistant",
      source: { kind: "model", provider: "p", model: "m" },
      content: [
        {
          type: "tool-call",
          id: "call-9",
          name: "Bash",
          arguments: '{"command":"pnpm test"}',
        },
      ],
    },
  ];
  const agent = createAgent({ status: "running", messages });
  const requests = [];
  const { ctx, routes, emit } = createContext({
    agent,
    llm: captureLlm(requests),
  });
  apply(ctx);

  liveFrame(agent, emit, { type: "start", attemptId: "a2", revision: 1, turn: 2, step: 1 });
  liveFrame(agent, emit, {
    type: "end",
    attemptId: "a2",
    revision: 2,
    index: 0,
    outcome: { kind: "committed", eventType: "assistant/message", seq: 4 },
  });

  await post(routes.get("/dsh-quick-switcher/ask"), {
    sessionId: "s1",
    question: "still running?",
  });

  const text = allText(requests[0].messages);
  assert.match(text, /\[tool call\] Bash\(\{"command":"pnpm test"\}\) \[no result yet\]/u);
  assert.match(text, /These tool calls in the current turn have not returned yet:/u);
  assert.match(text, /^\[tool call\] Bash\(\{"command":"pnpm test"\}\)$/mu);
});

test("attachments stay structured by default and become placeholders when off", async () => {
  const messages = [
    {
      id: "m1",
      role: "user",
      source: { kind: "user" },
      content: [
        { type: "text", text: "look at this" },
        { type: "image", attachment: { name: "shot.png" } },
      ],
    },
  ];
  const requests = [];
  const agent = createAgent({ messages });
  const { ctx, routes } = createContext({ agent, llm: captureLlm(requests) });
  apply(ctx);
  const handler = routes.get("/dsh-quick-switcher/ask");

  await post(handler, { sessionId: "s1", question: "what is in the image?" });
  const withImage = requests[0].messages[0];
  assert.equal(withImage.content.some((block) => block.type === "image"), true);

  await post(handler, {
    sessionId: "s1",
    question: "what is in the image?",
    includeAttachments: false,
  });
  const withoutImage = requests[1].messages[0];
  assert.equal(withoutImage.content.some((block) => block.type === "image"), false);
  assert.match(textOfMessage(withoutImage), /\[image: shot\.png\]/u);
});

test("a snapshot that cannot fit the window answers 413", async () => {
  const agent = createAgent({ status: "running", contextWindow: 4097 });
  const { ctx, routes, emit } = createContext({
    agent,
    llm: captureLlm([]),
  });
  apply(ctx);
  liveFrame(agent, emit, { type: "start", attemptId: "a1", revision: 1, turn: 1, step: 0 });
  liveFrame(agent, emit, {
    type: "chunk",
    attemptId: "a1",
    revision: 2,
    index: 0,
    time: 1,
    chunk: { type: "text-delta", index: 0, text: "x".repeat(20000) },
  });

  const response = await post(routes.get("/dsh-quick-switcher/ask"), {
    sessionId: "s1",
    question: "why?",
  });
  assert.equal(response.status, 413);
  assert.match(JSON.parse(response.chunks.join("")).error, /too large/u);
});

test("a pinned model runs with the lowest supported level", async () => {
  const llm = modelLlm({
    models: {
      "q/claude": {
        provider: "q",
        id: "claude",
        name: "Claude",
        context: { contextWindow: 100000 },
        reasoning: {
          efforts: [
            { id: "high", name: "High" },
            { id: "max", name: "Max" },
          ],
        },
      },
    },
    chunks: [{ type: "text-delta", text: "ok" }, { type: "finish", reason: { kind: "stop" } }],
  });
  const { ctx, routes } = createContext({ agent: createAgent(), llm });
  apply(ctx);

  const response = await post(routes.get("/dsh-quick-switcher/ask"), {
    sessionId: "s1",
    question: "why?",
    provider: "q",
    model: "claude",
    reasoningEffort: "lowest",
  });
  assert.equal(response.status, 200);
  assert.equal(llm.requests[0].provider, "q");
  assert.equal(llm.requests[0].model, "claude");
  assert.equal(llm.requests[0].reasoningEffort, "high");

  const start = eventsOf(response)[0];
  assert.equal(start.provider, "q");
  assert.equal(start.model, "claude");
  assert.equal(start.reasoningEffort, "high");
  assert.equal(start.reasoningEffortName, "High");
});

test("the session level is not reused and an unsupported level floors down", async () => {
  const llm = modelLlm({
    models: { "p/m": deepseekInfo() },
    chunks: [{ type: "finish", reason: { kind: "stop" } }],
  });
  const agent = createAgent();
  // The session thinks at high; the side question still takes the lowest level.
  agent.model = { current: () => ({ provider: "p", model: "m", reasoningEffort: "high" }) };
  const { ctx, routes } = createContext({ agent, llm });
  apply(ctx);
  const handler = routes.get("/dsh-quick-switcher/ask");

  await post(handler, { sessionId: "s1", question: "one" });
  assert.equal(llm.requests[0].reasoningEffort, "off");

  await post(handler, { sessionId: "s1", question: "two", reasoningEffort: "xhigh" });
  assert.equal(llm.requests[1].reasoningEffort, "high");

  const start = eventsOf(await post(handler, { sessionId: "s1", question: "three" }))[0];
  assert.equal(start.reasoningEffort, "off");
  assert.equal(start.reasoningEffortName, "Off");
});

test("a model without reasoning gets no level", async () => {
  const llm = modelLlm({
    models: { "q/text": { provider: "q", id: "text", context: { contextWindow: 100000 } } },
    chunks: [{ type: "finish", reason: { kind: "stop" } }],
  });
  const { ctx, routes } = createContext({ agent: createAgent(), llm });
  apply(ctx);

  const response = await post(routes.get("/dsh-quick-switcher/ask"), {
    sessionId: "s1",
    question: "why?",
    provider: "q",
    model: "text",
    reasoningEffort: "low",
  });
  assert.equal(response.status, 200);
  assert.equal("reasoningEffort" in llm.requests[0], false);
  assert.equal("reasoningEffort" in eventsOf(response)[0], false);
});

test("a pinned model that is gone answers 409 and never calls the provider", async () => {
  const llm = modelLlm({ models: { "q/gone": llmError("NO_ADAPTER", "no adapter") } });
  const { ctx, routes } = createContext({ agent: createAgent(), llm });
  apply(ctx);

  const response = await post(routes.get("/dsh-quick-switcher/ask"), {
    sessionId: "s1",
    question: "why?",
    provider: "q",
    model: "gone",
  });
  assert.equal(response.status, 409);
  const error = JSON.parse(response.chunks.join("")).error;
  assert.match(error, /"q\/gone" is not available/u);
  assert.match(error, /side question settings/u);
  assert.equal(llm.requests.length, 0);
});

test("half a pinned model is a client error", async () => {
  const llm = modelLlm({});
  const { ctx, routes } = createContext({ agent: createAgent(), llm });
  apply(ctx);
  const handler = routes.get("/dsh-quick-switcher/ask");

  const providerOnly = await post(handler, { sessionId: "s1", question: "why?", provider: "q" });
  assert.equal(providerOnly.status, 400);
  const modelOnly = await post(handler, { sessionId: "s1", question: "why?", model: "m" });
  assert.equal(modelOnly.status, 400);
  assert.equal(llm.requests.length, 0);
});

test("an adapter failure becomes an error event, not an empty answer", async () => {
  const llm = modelLlm({
    models: { "p/m": deepseekInfo() },
    chunks: [
      {
        type: "finish",
        reason: { kind: "error", failure: { code: "UNSUPPORTED_REASONING_EFFORT" } },
      },
    ],
  });
  const { ctx, routes } = createContext({ agent: createAgent(), llm });
  apply(ctx);

  const response = await post(routes.get("/dsh-quick-switcher/ask"), {
    sessionId: "s1",
    question: "why?",
  });
  assert.deepEqual(
    eventsOf(response).map((event) => event.type),
    ["start", "finish", "error"],
  );
  assert.match(eventsOf(response).at(-1).message, /UNSUPPORTED_REASONING_EFFORT/u);
});

test("a pinned model's window bounds the snapshot", async () => {
  const llm = modelLlm({
    models: { "q/small": { provider: "q", id: "small", context: { contextWindow: 5000 } } },
  });
  const { ctx, routes } = createContext({ agent: createAgent(), llm });
  apply(ctx);

  // The session window would fit this question; the pinned model's would not.
  const response = await post(routes.get("/dsh-quick-switcher/ask"), {
    sessionId: "s1",
    question: "x".repeat(13000),
    provider: "q",
    model: "small",
  });
  assert.equal(response.status, 413);
  assert.equal(llm.requests.length, 0);
});

test("unloading removes the live listeners", () => {
  const { ctx, listeners, cleanups } = createContext({ agent: createAgent(), llm: {} });
  apply(ctx);
  assert.equal(listeners.get("agent/assistant-stream")?.size, 1);
  for (const cleanup of cleanups) cleanup();
  assert.equal(listeners.get("agent/assistant-stream")?.size, 0);
  assert.equal(listeners.get("agent/status")?.size, 0);
  assert.equal(listeners.get("agent/disposed")?.size, 0);
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
  // The pending card is request input for the side model, not part of the
  // exchange the new session keeps; an extra body field is ignored.
  assert.doesNotMatch(text, /【侧问背景】/u);
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
