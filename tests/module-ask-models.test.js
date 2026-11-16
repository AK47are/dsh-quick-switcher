import assert from "node:assert/strict";
import test from "node:test";
import {
  createCatalogLoader,
  effortNameOf,
  effortsForChoice,
  floorEffort,
  hasModel,
  lowestEffort,
  modelKey,
  modelOptionEntries,
  normalizeCatalog,
  normalizeEfforts,
  orderEfforts,
  readChoice,
  splitModelKey,
  unionEfforts,
} from "../src/modules/ask/models.js";

const deepseekEfforts = [
  { id: "off", name: "Off" },
  { id: "low", name: "Low" },
  { id: "high", name: "High" },
  { id: "max", name: "Max" },
];

const piEfforts = [
  { id: "minimal", name: "Minimal" },
  { id: "low", name: "Low" },
  { id: "xhigh", name: "XHigh" },
];

function catalogValue() {
  return {
    groups: [
      {
        id: "deepseek-official",
        name: "DeepSeek",
        models: [
          { id: "deepseek-flash", name: "Flash", reasoning: { efforts: deepseekEfforts } },
          { id: "deepseek-text", name: "Text" },
        ],
      },
      {
        id: "pi",
        name: "Pi",
        models: [{ id: "claude/opus", name: "Opus", reasoning: { efforts: piEfforts } }],
      },
    ],
    failures: [{ id: "broken", name: "Broken", message: "auth" }],
  };
}

// Ordering and the two resolution rules.

test("efforts order by the canonical rank and keep unknown ids after them", () => {
  const ordered = orderEfforts([
    { id: "turbo" },
    { id: "high", name: "High" },
    { id: "off", name: "Off" },
    { id: "turbo", name: "Duplicate" },
  ]);
  assert.deepEqual(ordered.map((effort) => effort.id), ["off", "high", "turbo"]);
  assert.equal(ordered[0].name, "Off");
  // A duplicate keeps the first display name.
  assert.equal(ordered[2].name, "turbo");
});

test("the lowest level is off when a model offers it", () => {
  assert.equal(lowestEffort(deepseekEfforts), "off");
  assert.equal(lowestEffort(piEfforts), "minimal");
  assert.equal(lowestEffort([]), null);
  assert.equal(lowestEffort(undefined), null);
});

test("an unsupported level floors to the nearest supported level below it", () => {
  assert.equal(floorEffort(deepseekEfforts, "max"), "max");
  // xhigh sits between high and max, so only high is below it.
  assert.equal(floorEffort(deepseekEfforts, "xhigh"), "high");
  assert.equal(floorEffort(piEfforts, "max"), "xhigh");
  assert.equal(floorEffort(piEfforts, "medium"), "low");
  // Below every supported level the lowest one stands in.
  assert.equal(floorEffort(piEfforts, "off"), "minimal");
  // An id this build cannot rank is unsupported, not an exact match.
  assert.equal(floorEffort(deepseekEfforts, "turbo"), "off");
  assert.equal(floorEffort(deepseekEfforts, ""), "off");
  assert.equal(floorEffort([], "high"), null);
});

test("effort names fall back to the id", () => {
  assert.equal(effortNameOf(deepseekEfforts, "high"), "High");
  assert.equal(effortNameOf(deepseekEfforts, "turbo"), "turbo");
  assert.equal(effortNameOf(normalizeEfforts([{ id: "low" }]), "low"), "low");
});

// Catalog shaping.

test("the catalog keeps provider groups, levels, and listing failures", () => {
  const catalog = normalizeCatalog(catalogValue());
  assert.deepEqual(
    catalog.groups.map((group) => group.id),
    ["deepseek-official", "pi"],
  );
  assert.deepEqual(
    catalog.groups[0].models.map((model) => model.id),
    ["deepseek-flash", "deepseek-text"],
  );
  assert.deepEqual(catalog.failures, ["Broken"]);
  assert.equal(catalog.efforts.get(modelKey("deepseek-official", "deepseek-flash")).length, 4);
  assert.deepEqual(catalog.efforts.get(modelKey("deepseek-official", "deepseek-text")), []);
});

test("a malformed catalog degrades to what it can read", () => {
  const catalog = normalizeCatalog({
    groups: [null, { id: "" }, { id: "p", models: [null, { id: "" }, { id: "m" }] }],
    failures: [null, { id: "x" }],
  });
  assert.deepEqual(catalog.groups, [{ id: "p", name: "p", models: [{ id: "m", name: "m" }] }]);
  assert.deepEqual(catalog.failures, ["x"]);
  assert.deepEqual(normalizeCatalog(null).groups, []);
});

test("the union dedupes levels across models in canonical order", () => {
  const catalog = normalizeCatalog(catalogValue());
  assert.deepEqual(
    unionEfforts(catalog).map((effort) => effort.id),
    ["off", "minimal", "low", "high", "xhigh", "max"],
  );
});

test("the effort list follows the pinned model and the union follows the session", () => {
  const catalog = normalizeCatalog(catalogValue());
  assert.deepEqual(
    effortsForChoice(catalog, { provider: "pi", model: "claude/opus" }).map((effort) => effort.id),
    ["minimal", "low", "xhigh"],
  );
  assert.deepEqual(
    effortsForChoice(catalog, null).map((effort) => effort.id),
    ["off", "minimal", "low", "high", "xhigh", "max"],
  );
  // A stored model the catalog no longer lists has no known levels; the picker
  // keeps only the lowest option and its own note, and the host fails the call.
  assert.deepEqual(effortsForChoice(catalog, { provider: "gone", model: "gone" }), []);
  // A listed model without reasoning offers no levels either.
  assert.deepEqual(effortsForChoice(catalog, { provider: "deepseek-official", model: "deepseek-text" }), []);
});

// Stored values.

test("a stored model needs both halves and otherwise follows the session", () => {
  assert.deepEqual(readChoice({ provider: "p", model: "m" }), { provider: "p", model: "m" });
  assert.equal(readChoice(null), null);
  assert.equal(readChoice({ provider: "p" }), null);
  assert.equal(readChoice({ provider: " ", model: "m" }), null);
  assert.equal(readChoice({ provider: "p", model: 7 }), null);
});

test("a select value round-trips provider and model, slashes included", () => {
  const key = modelKey("pi", "anthropic/claude/opus");
  assert.deepEqual(splitModelKey(key), { provider: "pi", model: "anthropic/claude/opus" });
  assert.equal(splitModelKey(""), null);
  assert.equal(splitModelKey("\u0000m"), null);
  assert.equal(splitModelKey("p\u0000"), null);
  assert.equal(splitModelKey(undefined), null);
});

test("a stored model is known only while the catalog lists it", () => {
  const catalog = normalizeCatalog(catalogValue());
  assert.equal(hasModel(catalog, { provider: "pi", model: "claude/opus" }), true);
  assert.equal(hasModel(catalog, { provider: "pi", model: "gone" }), false);
  assert.equal(hasModel(null, { provider: "pi", model: "claude/opus" }), false);
});

test("options carry a provider header and skip it for a single provider", () => {
  const single = normalizeCatalog({
    groups: [{ id: "p", name: "P", models: [{ id: "m", name: "M" }] }],
  });
  assert.deepEqual(modelOptionEntries(single), [
    { kind: "option", key: modelKey("p", "m"), label: "M", group: "P" },
  ]);
  assert.deepEqual(modelOptionEntries(normalizeCatalog(catalogValue())), [
    { kind: "header", key: "group:deepseek-official", label: "DeepSeek" },
    {
      kind: "option",
      key: modelKey("deepseek-official", "deepseek-flash"),
      label: "Flash",
      group: "DeepSeek",
    },
    {
      kind: "option",
      key: modelKey("deepseek-official", "deepseek-text"),
      label: "Text",
      group: "DeepSeek",
    },
    { kind: "header", key: "group:pi", label: "Pi" },
    { kind: "option", key: modelKey("pi", "claude/opus"), label: "Opus", group: "Pi" },
  ]);
  assert.deepEqual(modelOptionEntries(null), []);
});

// The remote loader.

function remoteApi(responses) {
  const state = { calls: 0 };
  const api = {
    state,
    get(name) {
      if (name !== "remote.session") return undefined;
      return {
        async modelCatalog() {
          const index = Math.min(state.calls, responses.length - 1);
          state.calls += 1;
          const next = responses[index];
          if (next instanceof Error) throw next;
          return next;
        },
      };
    },
  };
  return api;
}

test("one successful catalog read is reused for the cache window", async () => {
  const api = remoteApi([{ ok: true, value: catalogValue() }]);
  let clock = 0;
  const load = createCatalogLoader({ api, now: () => clock, ttl: 1000 });

  const first = await load();
  assert.equal(first.ok, true);
  clock = 999;
  await load();
  assert.equal(api.state.calls, 1);
  clock = 1001;
  await load();
  assert.equal(api.state.calls, 2);
});

test("a failed read is not cached and a missing remote is reported", async () => {
  const api = remoteApi([new Error("boom"), { ok: false, error: { code: "rpc" } }]);
  const load = createCatalogLoader({ api, now: () => 0, ttl: 1000 });
  assert.deepEqual(await load(), { ok: false, reason: "exception" });
  assert.deepEqual(await load(), { ok: false, reason: "remote" });
  assert.equal(api.state.calls, 2);

  const empty = createCatalogLoader({ api: { get: () => undefined }, now: () => 0 });
  assert.deepEqual(await empty(), { ok: false, reason: "remote" });
});
