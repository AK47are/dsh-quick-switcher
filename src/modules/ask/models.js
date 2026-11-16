/* Side question model catalog, its options, and reasoning-effort ordering. */

/**
 * Canonical order of the reasoning-effort ids the shipped DSH adapters use.
 *
 * DSH itself has no shared effort vocabulary: every adapter owns its ids and
 * validates them against its own list, and an unsupported id makes the call
 * fail. This order is how the plugin compares ids across adapters, so "lowest"
 * and "nearest lower level" mean the same thing on a DeepSeek route
 * (off/low/high/max) and a pi-ai route (off/minimal/low/medium/high/xhigh/max).
 * An adapter-specific id outside this list keeps its declared position after
 * the known ids.
 */
export const EFFORT_ORDER = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

/** The settings value that means "use the model's lowest supported level". */
export const LOWEST_EFFORT = "lowest";

/** Separator between provider and model inside one select value. */
const KEY_SEPARATOR = "\u0000";

/** How long one successful catalog read stays usable for the settings page. */
export const CATALOG_TTL_MS = 60000;

/** One select value for a provider and model pair. */
export function modelKey(provider, model) {
  return `${provider}${KEY_SEPARATOR}${model}`;
}

/** Read a select value back; null when it is not a provider and model pair. */
export function splitModelKey(key) {
  if (typeof key !== "string") return null;
  const index = key.indexOf(KEY_SEPARATOR);
  if (index <= 0) return null;
  const provider = key.slice(0, index);
  const model = key.slice(index + 1);
  if (provider === "" || model === "") return null;
  return { provider, model };
}

/** Rank of one effort id inside the canonical order; -1 when unknown. */
export function effortRank(id) {
  return EFFORT_ORDER.indexOf(id);
}

/**
 * Drop duplicate and malformed entries, keeping the adapter's display name.
 *
 * The catalog and `resolveModelInfo` both hand out `{ id, name }` entries, but
 * only the id is guaranteed; the name falls back to the id so the detail can
 * always print something.
 */
export function normalizeEfforts(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const efforts = [];
  for (const entry of raw) {
    if (entry === null || typeof entry !== "object") continue;
    if (typeof entry.id !== "string" || entry.id === "") continue;
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    efforts.push({
      id: entry.id,
      name: typeof entry.name === "string" && entry.name !== "" ? entry.name : entry.id,
    });
  }
  return efforts;
}

/**
 * Sort efforts from lowest to highest thinking.
 *
 * Known ids follow the canonical order; ids this build does not know keep their
 * declared order after the known ones, which is the closest honest position.
 */
export function orderEfforts(raw) {
  const efforts = normalizeEfforts(raw);
  const known = efforts
    .filter((effort) => effortRank(effort.id) >= 0)
    .sort((left, right) => effortRank(left.id) - effortRank(right.id));
  const unknown = efforts.filter((effort) => effortRank(effort.id) < 0);
  return [...known, ...unknown];
}

/** The lowest level a model offers, or null when it offers reasoning at all. */
export function lowestEffort(raw) {
  const ordered = orderEfforts(raw);
  return ordered.length === 0 ? null : ordered[0].id;
}

/**
 * Pick the supported level closest below a request.
 *
 * An exact match wins. Otherwise the highest supported level at or below the
 * request is used; when every supported level is above it, the lowest one
 * stands in. An id this build cannot rank counts as unsupported, so it also
 * lands on the lowest level instead of failing the whole question.
 */
export function floorEffort(raw, requested) {
  const ordered = orderEfforts(raw);
  if (ordered.length === 0) return null;
  if (typeof requested !== "string" || requested === "") return ordered[0].id;
  if (ordered.some((effort) => effort.id === requested)) return requested;
  const wanted = effortRank(requested);
  if (wanted < 0) return ordered[0].id;
  let picked = ordered[0];
  for (const effort of ordered) {
    const rank = effortRank(effort.id);
    if (rank >= 0 && rank <= wanted) picked = effort;
  }
  return picked.id;
}

/** The display name of one effort id, falling back to the id itself. */
export function effortNameOf(raw, id) {
  const effort = normalizeEfforts(raw).find((entry) => entry.id === id);
  return effort === undefined ? id : effort.name;
}

/**
 * Normalize the remote's model catalog into what the settings controls need.
 *
 * The shape matches `session.modelCatalog()`: provider groups with models, each
 * model optionally carrying `reasoning.efforts`. Provider listing failures are
 * kept as their display names so the settings page can say which provider could
 * not be listed instead of silently showing a shorter list.
 */
export function normalizeCatalog(value) {
  const groups = [];
  const efforts = new Map();
  const failures = [];
  const rawGroups = Array.isArray(value?.groups) ? value.groups : [];
  for (const group of rawGroups) {
    if (group === null || typeof group !== "object") continue;
    const provider = typeof group.id === "string" ? group.id : "";
    if (provider === "") continue;
    const models = [];
    const rawModels = Array.isArray(group.models) ? group.models : [];
    for (const model of rawModels) {
      if (model === null || typeof model !== "object") continue;
      const id = typeof model.id === "string" ? model.id : "";
      if (id === "") continue;
      models.push({
        id,
        name: typeof model.name === "string" && model.name !== "" ? model.name : id,
      });
      efforts.set(modelKey(provider, id), normalizeEfforts(model.reasoning?.efforts));
    }
    if (models.length === 0) continue;
    groups.push({
      id: provider,
      name: typeof group.name === "string" && group.name !== "" ? group.name : provider,
      models,
    });
  }
  const rawFailures = Array.isArray(value?.failures) ? value.failures : [];
  for (const failure of rawFailures) {
    if (failure === null || typeof failure !== "object") continue;
    const name =
      typeof failure.name === "string" && failure.name !== ""
        ? failure.name
        : typeof failure.id === "string"
          ? failure.id
          : "";
    if (name !== "") failures.push(name);
  }
  return { groups, efforts, failures };
}

/** Whether one stored model choice still exists in the catalog. */
export function hasModel(catalog, choice) {
  const provider = typeof choice?.provider === "string" ? choice.provider : "";
  const model = typeof choice?.model === "string" ? choice.model : "";
  if (catalog === null || catalog === undefined) return false;
  if (provider === "" || model === "") return false;
  return catalog.efforts.has(modelKey(provider, model));
}

/**
 * Build the model menu's rows: one header per provider, then its models.
 *
 * The model list needs a provider header without the native `<optgroup>` italic,
 * so the settings picker renders these rows itself. A header is emitted only
 * when more than one provider is listed; with a single provider it would be
 * noise. `key` is also the option value, so the caller can build the row list
 * without re-encoding the pair, and `group` lets the menu filter match a
 * provider name as well as a model name.
 */
export function modelOptionEntries(catalog) {
  const groups = catalog?.groups ?? [];
  const entries = [];
  for (const group of groups) {
    if (groups.length > 1) {
      entries.push({ kind: "header", key: `group:${group.id}`, label: group.name });
    }
    for (const model of group.models) {
      entries.push({
        kind: "option",
        key: modelKey(group.id, model.id),
        label: model.name,
        group: group.name,
      });
    }
  }
  return entries;
}

/** Every level offered by any model, for the "follow the session" choice. */
export function unionEfforts(catalog) {
  if (catalog === null || catalog === undefined) return [];
  const all = [];
  for (const list of catalog.efforts.values()) all.push(...list);
  return orderEfforts(all);
}

/**
 * The levels the effort picker offers for one model choice.
 *
 * A stored choice that is no longer in the catalog falls back to the union,
 * because the session model it follows is unknown to the settings page.
 */
export function effortsForChoice(catalog, choice) {
  const provider = typeof choice?.provider === "string" ? choice.provider : "";
  const model = typeof choice?.model === "string" ? choice.model : "";
  if (catalog === null || catalog === undefined) return [];
  if (provider === "" || model === "") return unionEfforts(catalog);
  return orderEfforts(catalog.efforts.get(modelKey(provider, model)) ?? []);
}

/**
 * Read a stored settings value as a model choice.
 *
 * A custom settings field is not validated by the store, so a hand-edited or
 * older value has to be read defensively: anything without both a provider and
 * a model means "follow the session".
 */
export function readChoice(value) {
  if (value === null || typeof value !== "object") return null;
  const provider = typeof value.provider === "string" ? value.provider.trim() : "";
  const model = typeof value.model === "string" ? value.model.trim() : "";
  if (provider === "" || model === "") return null;
  return { provider, model };
}

/**
 * Load the model catalog from the Host through the shared Remote channel.
 *
 * `session.modelCatalog` needs no per-session data and is provided by DSH's
 * session controller, which this plugin already injects on the host side. The
 * namespace service appears only after its descriptors arrive, so a missing
 * service is a normal state that the settings page reports instead of throwing.
 * One successful read is reused for a short window so opening the page twice
 * does not re-list every provider; failures are not cached.
 */
export function createCatalogLoader({ api, now = Date.now, ttl = CATALOG_TTL_MS } = {}) {
  let cached = null;
  return async function load() {
    const at = now();
    if (cached !== null && at - cached.at < ttl) return cached.result;
    const remote =
      api !== null && api !== undefined && typeof api.get === "function"
        ? api.get("remote.session")
        : undefined;
    if (remote === null || remote === undefined || typeof remote.modelCatalog !== "function") {
      return { ok: false, reason: "remote" };
    }
    try {
      const response = await remote.modelCatalog();
      if (response === null || typeof response !== "object" || response.ok !== true) {
        return { ok: false, reason: "remote" };
      }
      const result = { ok: true, catalog: normalizeCatalog(response.value) };
      cached = { at, result };
      return result;
    } catch (error) {
      console.error("[dsh-quick-switcher] model catalog read failed", error);
      return { ok: false, reason: "exception" };
    }
  };
}
