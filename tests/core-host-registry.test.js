import assert from "node:assert/strict";
import test from "node:test";
import { defineHostModule } from "../src/core/host/module.js";
import { createHostRegistry } from "../src/core/host/registry.js";

function createContext() {
  const routes = new Map();
  const listeners = new Map();
  return {
    ctx: {
      webServer: {
        register({ kind, path, handler }) {
          routes.set(path, { kind, handler });
          return () => routes.delete(path);
        },
      },
      agents: {},
      llm: {},
      sessionController: {},
      on(name, handler, options) {
        listeners.set(name, { handler, options });
        return () => listeners.delete(name);
      },
      effect(callback) {
        const dispose = callback();
        return typeof dispose === "function" ? dispose : () => {};
      },
    },
    routes,
    listeners,
  };
}

test("the host registry mounts exact routes, global listeners and teardown", () => {
  const harness = createContext();
  const disposed = [];
  const registry = createHostRegistry({ ctx: harness.ctx });

  registry.apply([
    defineHostModule("alpha", (api) => {
      assert.equal(api.id, "alpha");
      assert.equal(api.webServer, harness.ctx.webServer);
      assert.equal(api.agents, harness.ctx.agents);
      return {
        routes: [{ path: "/alpha", handler: () => "route" }],
        listeners: [
          { name: "agent/status", handler: () => "listener", options: { global: true } },
        ],
        dispose: () => disposed.push("module"),
      };
    }),
  ]);

  assert.deepEqual(
    [...harness.routes.entries()].map(([path, route]) => [path, route.kind]),
    [["/alpha", "exact"]],
  );
  assert.equal(harness.listeners.get("agent/status").options.global, true);

  registry.dispose();
  assert.deepEqual(disposed, ["module"]);
  assert.equal(harness.routes.size, 0);
  assert.equal(harness.listeners.size, 0);

  registry.dispose();
  assert.deepEqual(disposed, ["module"]);
});

test("a failing host module is logged and skipped without blocking the next one", () => {
  const harness = createContext();
  const errors = [];
  const registry = createHostRegistry({
    ctx: harness.ctx,
    log: { info() {}, warn() {}, error: (...args) => errors.push(args) },
  });

  registry.apply([
    defineHostModule("broken", () => {
      throw new Error("boom");
    }),
    defineHostModule("healthy", () => ({
      routes: [{ path: "/healthy", handler: () => {} }],
    })),
  ]);

  assert.equal(errors.length, 1);
  assert.match(String(errors[0][0]), /broken/);
  assert.ok(harness.routes.has("/healthy"));
  registry.dispose();
});
