import assert from "node:assert/strict";
import test from "node:test";
import { createPanelController } from "../src/core/panel/controller.js";

test("open seeds the query and bumps the generation", () => {
  const controller = createPanelController();
  assert.deepEqual(controller.getState(), {
    open: false,
    seed: "",
    generation: 0,
    mode: null,
    query: "",
  });
  controller.open({ seed: "!" });
  assert.deepEqual(controller.getState(), {
    open: true,
    seed: "!",
    generation: 1,
    mode: null,
    query: "!",
  });
  controller.open();
  assert.equal(controller.getState().generation, 2);
  assert.equal(controller.getState().seed, "");
  assert.equal(controller.getState().query, "");
});

test("a reseed while open keeps the panel open and bumps the generation", () => {
  const controller = createPanelController();
  const seen = [];
  controller.subscribe(() => seen.push(controller.getState()));
  controller.open();
  controller.open({ seed: "?" });
  assert.equal(seen.length, 2);
  assert.equal(seen[1].open, true);
  assert.equal(seen[1].generation, 2);
  assert.equal(seen[1].seed, "?");
  assert.equal(seen[1].query, "?");
});

test("close resets the snapshot and an already closed panel does not publish", () => {
  const controller = createPanelController();
  let notifications = 0;
  controller.subscribe(() => (notifications += 1));
  controller.close();
  assert.equal(notifications, 0);
  controller.open();
  controller.close();
  assert.equal(notifications, 2);
  assert.deepEqual(controller.getState(), {
    open: false,
    seed: "",
    generation: 2,
    mode: null,
    query: "",
  });
});

test("toggle flips the open flag from either side", () => {
  const controller = createPanelController();
  controller.toggle();
  assert.equal(controller.isOpen(), true);
  controller.toggle();
  assert.equal(controller.isOpen(), false);
});

test("mode and query stay silent while the panel is closed", () => {
  const controller = createPanelController();
  let notifications = 0;
  controller.subscribe(() => (notifications += 1));
  controller.setMode("history");
  controller.setQuery("!");
  assert.equal(notifications, 0);
  assert.equal(controller.getState().mode, null);
  controller.open();
  controller.setMode("history");
  controller.setMode("history");
  controller.setQuery("?");
  controller.setQuery("?");
  assert.equal(notifications, 3);
  assert.equal(controller.getState().mode, "history");
  assert.equal(controller.getState().query, "?");
});

test("setMode accepts an empty mode as null", () => {
  const controller = createPanelController();
  controller.open();
  controller.setMode("history");
  controller.setMode("");
  assert.equal(controller.getState().mode, null);
});

test("a disposed controller ignores every later mutation", () => {
  const controller = createPanelController();
  controller.open();
  controller.dispose();
  controller.close();
  controller.open();
  controller.setMode("history");
  assert.equal(controller.getState().open, true);
  assert.equal(controller.getState().mode, null);
});
