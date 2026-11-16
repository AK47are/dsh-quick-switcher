import assert from "node:assert/strict";
import test from "node:test";
import { validateMount, validateSpec, validateView } from "../src/core/validate.js";

function settingsOf(overrides = {}) {
  return {
    labelKey: "alpha.settings",
    groups: [
      {
        fields: [{ id: "flag", type: "boolean", default: true, labelKey: "alpha.flag" }],
      },
    ],
    ...overrides,
  };
}

function viewOf(overrides = {}) {
  return { rows: [{ key: "a", title: "A" }], ...overrides };
}

test("a bare spec gets the defaults the registry relies on", () => {
  const spec = validateSpec("alpha", {});
  assert.equal(spec.apiVersion, 1);
  assert.equal(spec.order, 100);
  assert.equal(spec.labelKey, undefined);
  assert.equal(spec.descriptionKey, undefined);
  assert.deepEqual(spec.dependencies, []);
  assert.equal(spec.entry, null);
  assert.equal(spec.locale, null);
  assert.equal(spec.settings, null);
  assert.deepEqual(spec.commands, []);
  assert.deepEqual(spec.slots, []);
  assert.equal(spec.views, null);
  assert.equal(spec.mount, undefined);
});

test("the entry declaration validates its seed, mode, aliases and defaults", () => {
  const spec = validateSpec("alpha", {
    entry: { seed: "!", aliases: ["历史"], defaults: {} },
  });
  assert.deepEqual(spec.entry, {
    seed: "!",
    mode: undefined,
    labelKey: undefined,
    aliases: ["历史"],
    defaults: {},
  });
  assert.equal(validateSpec("alpha", { entry: { seed: "" } }).entry.seed, "");
  assert.throws(() => validateSpec("alpha", { entry: null }), /entry must be an object/);
  assert.throws(() => validateSpec("alpha", { entry: {} }), /seed/);
  assert.throws(() => validateSpec("alpha", { entry: { seed: "!", mode: "Bad" } }), /entry.mode/);
  assert.throws(() => validateSpec("alpha", { entry: { seed: "!", aliases: [1] } }), /aliases/);
  assert.throws(() => validateSpec("alpha", { entry: { seed: "!", defaults: [] } }), /defaults/);
});

test("dependencies are unique module ids and cannot name the module itself", () => {
  assert.deepEqual(validateSpec("alpha", {}).dependencies, []);
  assert.deepEqual(validateSpec("alpha", { dependencies: ["sessions"] }).dependencies, ["sessions"]);
  // An unknown id stays allowed: the dependency may arrive with a plugin installed later.
  assert.deepEqual(validateSpec("alpha", { dependencies: ["later"] }).dependencies, ["later"]);
  assert.throws(() => validateSpec("alpha", { dependencies: "sessions" }), /array/);
  assert.throws(() => validateSpec("alpha", { dependencies: ["Bad"] }), /invalid/);
  assert.throws(() => validateSpec("alpha", { dependencies: ["alpha"] }), /itself/);
  assert.throws(() => validateSpec("alpha", { dependencies: ["x", "x"] }), /declared twice/);
});

test("a module description is a non-empty optional string", () => {
  assert.equal(validateSpec("alpha", {}).descriptionKey, undefined);
  assert.equal(
    validateSpec("alpha", { descriptionKey: "alpha.description" }).descriptionKey,
    "alpha.description",
  );
  assert.throws(() => validateSpec("alpha", { descriptionKey: "" }), /descriptionKey/);
});

test("the api version and the numeric metadata are checked", () => {
  assert.throws(() => validateSpec("alpha", { apiVersion: 2 }), /apiVersion/);
  assert.throws(() => validateSpec("alpha", { order: "first" }), /order/);
  assert.throws(() => validateSpec("alpha", { order: Number.POSITIVE_INFINITY }), /order/);
  assert.throws(() => validateSpec("alpha", { labelKey: "" }), /labelKey/);
  assert.throws(() => validateSpec("alpha", null), /setup must return an object/);
});

test("a locale dictionary is flat strings only", () => {
  const spec = validateSpec("alpha", { locale: { zh: { title: "甲" }, en: { title: "A" } } });
  assert.deepEqual(spec.locale, { zh: { title: "甲" }, en: { title: "A" } });
  assert.throws(() => validateSpec("alpha", { locale: { zh: "甲" } }), /locale/);
  assert.throws(() => validateSpec("alpha", { locale: { zh: { title: 1 } } }), /must be a string/);
});

test("settings need a label, at least one group, and unique ids", () => {
  assert.deepEqual(validateSpec("alpha", { settings: settingsOf() }).settings.groups.length, 1);
  assert.throws(() => validateSpec("alpha", { settings: { groups: [] } }), /labelKey/);
  assert.throws(
    () => validateSpec("alpha", { settings: settingsOf({ groups: [] }) }),
    /non-empty array/,
  );
  assert.throws(
    () =>
      validateSpec("alpha", {
        settings: settingsOf({
          groups: [
            { id: "g", fields: [{ id: "a", type: "boolean", default: true }] },
            { id: "g", fields: [{ id: "b", type: "boolean", default: true }] },
          ],
        }),
      }),
    /declared twice/,
  );
  assert.throws(
    () =>
      validateSpec("alpha", {
        settings: settingsOf({
          groups: [
            { fields: [{ id: "a", type: "boolean", default: true }] },
            { fields: [{ id: "a", type: "boolean", default: false }] },
          ],
        }),
      }),
    /declared twice/,
  );
});

test("settings ids accept the camelCase field names the settings paths use", () => {
  const spec = validateSpec("alpha", {
    settings: settingsOf({
      groups: [
        {
          id: "search-group",
          fields: [
            { id: "includeAttachments", type: "boolean", default: true, labelKey: "a" },
            { id: "pendingOrder", type: "number", default: 1, labelKey: "b" },
          ],
        },
      ],
    }),
  });
  assert.equal(spec.settings.groups[0].fields[0].id, "includeAttachments");
  assert.equal(spec.settings.groups[0].id, "search-group");
  assert.throws(
    () =>
      validateSpec("alpha", {
        settings: settingsOf({
          groups: [{ fields: [{ id: "pending-order", type: "boolean", default: true }] }],
        }),
      }),
    /field id/,
  );
  assert.throws(
    () =>
      validateSpec("alpha", {
        settings: settingsOf({
          groups: [{ fields: [{ id: "Bad.Field", type: "boolean", default: true }] }],
        }),
      }),
    /field id/,
  );
});

test("each field type validates its own default and range", () => {
  assert.throws(
    () =>
      validateSpec("alpha", {
        settings: settingsOf({
          groups: [{ fields: [{ id: "a", type: "boolean", default: "yes" }] }],
        }),
      }),
    /boolean default/,
  );
  assert.throws(
    () =>
      validateSpec("alpha", {
        settings: settingsOf({
          groups: [{ fields: [{ id: "a", type: "number", default: 5, min: 10, max: 1 }] }],
        }),
      }),
    /greater than max/,
  );
  assert.throws(
    () =>
      validateSpec("alpha", {
        settings: settingsOf({
          groups: [{ fields: [{ id: "a", type: "number", default: 5, min: 10 }] }],
        }),
      }),
    /below min/,
  );
  assert.throws(
    () =>
      validateSpec("alpha", {
        settings: settingsOf({
          groups: [
            {
              fields: [
                {
                  id: "a",
                  type: "choice",
                  default: "x",
                  options: [{ value: "y", labelKey: "y" }],
                },
              ],
            },
          ],
        }),
      }),
    /not one of its options/,
  );
  assert.throws(
    () =>
      validateSpec("alpha", {
        settings: settingsOf({
          groups: [{ fields: [{ id: "a", type: "custom", default: 1 }] }],
        }),
      }),
    /render/,
  );
  const custom = validateSpec("alpha", {
    settings: settingsOf({
      groups: [{ fields: [{ id: "a", type: "custom", default: 1, render: () => null }] }],
    }),
  });
  assert.equal(custom.settings.groups[0].fields[0].type, "custom");
});

test("commands and slots keep their DSH metadata after validation", () => {
  const spec = validateSpec("alpha", {
    commands: [
      {
        id: "alpha.run",
        label: () => "Run",
        resolve: () => ({ status: "handled" }),
        aliases: ["go"],
        defaults: { "web:linux": null },
      },
    ],
    slots: [{ name: "shell.overlay", id: "alpha", component: () => null }],
  });
  assert.deepEqual(spec.commands[0].aliases, ["go"]);
  assert.equal(spec.commands[0].defaults["web:linux"], null);
  assert.equal(spec.slots[0].name, "shell.overlay");
  assert.throws(
    () => validateSpec("alpha", { commands: [{ id: "a", label: () => "x" }] }),
    /resolve/,
  );
  assert.throws(
    () =>
      validateSpec("alpha", {
        commands: [
          { id: "a", label: () => "x", resolve: () => ({}) },
          { id: "a", label: () => "y", resolve: () => ({}) },
        ],
      }),
    /declared twice/,
  );
  assert.throws(() => validateSpec("alpha", { slots: [{ name: "x", id: "y" }] }), /component/);
});

test("views must name a content or footer component per kind", () => {
  const spec = validateSpec("alpha", { views: { ask: { content: () => null } } });
  assert.equal(typeof spec.views.ask.content, "function");
  assert.throws(() => validateSpec("alpha", { views: {} }), /at least one kind/);
  assert.throws(() => validateSpec("alpha", { views: { ask: {} } }), /content or footer/);
  assert.throws(() => validateSpec("alpha", { views: { ask: { content: 1 } } }), /component/);
});

test("a mount keeps providers, matchers and dispose and rejects bad shapes", () => {
  const match = () => ({});
  const view = () => viewOf();
  const surface = validateMount("alpha", {
    providers: [() => null],
    matchers: [{ id: "alpha", priority: 2, match, view }],
    dispose() {},
  });
  assert.equal(surface.providers.length, 1);
  assert.equal(surface.matchers[0].priority, 2);
  assert.equal(typeof surface.dispose, "function");

  assert.deepEqual(validateMount("alpha", undefined), {
    providers: [],
    matchers: [],
    dispose: null,
  });
  assert.throws(() => validateMount("alpha", { providers: [null] }), /providers/);
  assert.throws(
    () => validateMount("alpha", { matchers: [{ id: "a", match, view }, { id: "a", match, view }] }),
    /declared twice/,
  );
  assert.throws(() => validateMount("alpha", { matchers: [{ id: "a", match }] }), /view/);
  assert.throws(
    () => validateMount("alpha", { matchers: [{ id: "a", match, view, priority: "high" }] }),
    /priority/,
  );
  assert.throws(() => validateMount("alpha", { dispose: 1 }), /dispose/);
});

test("a view fills defaults and rejects duplicate row keys", () => {
  const view = validateView("alpha", "alpha", viewOf());
  assert.equal(view.inputLocked, false);
  assert.equal(view.emptyText, null);
  assert.deepEqual(view.hints, []);
  assert.equal(view.content, null);
  assert.equal(view.footer, null);

  assert.throws(
    () =>
      validateView("alpha", "alpha", {
        rows: [
          { key: "a", title: "A" },
          { key: "a", title: "B" },
        ],
      }),
    /duplicate row key/,
  );
  assert.throws(() => validateView("alpha", "alpha", { rows: [{ key: "a" }] }), /title/);
  assert.throws(
    () => validateView("alpha", "alpha", { rows: [{ key: "a", title: "A", positions: [1] }] }),
    /positions/,
  );
  assert.throws(
    () => validateView("alpha", "alpha", { rows: [{ key: "a", title: "A", action: "yes" }] }),
    /action/,
  );
  assert.throws(
    () => validateView("alpha", "alpha", { rows: [], hints: [{ keys: "Enter", label: "x" }] }),
    /keys/,
  );
  assert.throws(
    () => validateView("alpha", "alpha", { rows: [], content: { props: {} } }),
    /kind/,
  );
  assert.throws(
    () => validateView("alpha", "alpha", { rows: [], content: { kind: "ask", props: 1 } }),
    /props/,
  );
  assert.throws(
    () => validateView("alpha", "alpha", { rows: [], keydown: 1 }),
    /keydown/,
  );
});

test("a view keeps row closures and the content descriptor", () => {
  const run = () => {};
  const view = validateView("alpha", "alpha", {
    rows: [{ key: "a", title: "A", run, action: true, positions: new Set([0]) }],
    content: { kind: "alpha", props: { id: 1 } },
    footer: { kind: "alpha" },
    inputLocked: true,
    keydown: () => true,
    count: "1",
  });
  assert.equal(view.rows[0].run, run);
  assert.equal(view.rows[0].action, true);
  assert.equal(view.content.kind, "alpha");
  assert.deepEqual(view.content.props, { id: 1 });
  assert.deepEqual(view.footer.props, {});
  assert.equal(view.inputLocked, true);
  assert.equal(typeof view.keydown, "function");
  assert.equal(view.count, "1");
});
