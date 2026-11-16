/**
 * The module registry: one place that knows which modules exist, what they
 * contribute, and how a query picks one of their views.
 *
 * The registry is deliberately free of DSH and React. Everything it needs from
 * the runtime arrives as a dependency object, which keeps the ordering and
 * lifecycle rules testable with plain fakes. Static contributions (locale,
 * settings, commands, slots, views) are applied once at registration; matchers
 * and providers are created per panel mount because they may own per-panel
 * state.
 */

import { isModuleDefinition } from "./module.js";
import { validateMount, validateSpec, validateView } from "./validate.js";
import { API_VERSION } from "../../module.js";

function once(callback, log) {
  let done = false;
  return () => {
    if (done) return;
    done = true;
    try {
      callback?.();
    } catch (error) {
      log.error("[dsh-quick-switcher] contribution cleanup failed", error);
    }
  };
}

function wrapError(error, id, phase) {
  const message = error instanceof Error ? error.message : String(error);
  return new Error(`dsh-quick-switcher: module "${id}" ${phase} failed: ${message}`, {
    cause: error,
  });
}

/**
 * @param {object} deps
 * @param {(moduleId: string|null, key: string, params?: object) => string} deps.t
 * @param {{ declare: Function, scope: Function }} deps.settings
 * @param {{ add: Function }} deps.locale
 * @param {{ add: Function }} deps.commands
 * @param {{ add: Function }} deps.slots
 * @param {object} [deps.services]
 * @param {(name: string) => unknown} [deps.get]
 * @param {object} [deps.panel] the panel controller API
 * @param {(callback: () => unknown, label?: string) => () => void} [deps.effect]
 * @param {{ error: Function, warn: Function }} [deps.log]
 */
export function createRegistry(deps = {}) {
  const {
    t,
    settings,
    locale,
    commands,
    slots,
    services = {},
    get = () => undefined,
    panel = null,
    log = console,
  } = deps;
  const effect =
    deps.effect ??
    ((callback) => {
      const dispose = callback();
      return typeof dispose === "function" ? dispose : () => {};
    });

  /** Insertion-ordered records; iteration order is fixed by id lookup. */
  const records = new Map();
  const views = new Map();
  const listeners = new Set();
  let sequence = 0;
  let disposed = false;

  function sortedRecords() {
    return [...records.values()].sort(
      (left, right) => left.order - right.order || left.sequence - right.sequence,
    );
  }

  function notify() {
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch (error) {
        log.error("[dsh-quick-switcher] registry listener failed", error);
      }
    }
  }

  function subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function checkViewKinds(id, spec) {
    if (spec.views === null) return;
    for (const kind of Object.keys(spec.views)) {
      if (views.has(kind)) {
        throw new Error(
          `dsh-quick-switcher: module "${id}" declares view kind "${kind}", which is already registered`,
        );
      }
    }
  }

  /**
   * Register one module definition and return its disposer.
   *
   * Static contributions are applied in order and rolled back when any of them
   * throws, so a failed registration never leaves a half-registered module in
   * the panel or the settings page.
   */
  function register(definition) {
    if (disposed) {
      throw new Error("dsh-quick-switcher: the module registry is disposed");
    }
    if (!isModuleDefinition(definition)) {
      throw new TypeError(
        "dsh-quick-switcher: register() needs a { id, setup } definition, or one built by defineModule()",
      );
    }
    const id = definition.id;
    if (records.has(id)) {
      throw new Error(`dsh-quick-switcher: module "${id}" is already registered`);
    }

    const disposers = [];
    const keep = (disposer) => {
      const wrapped = once(disposer, log);
      disposers.push(wrapped);
      return wrapped;
    };
    const scope = settings.scope(id);

    const api = {
      id,
      t: (key, params) => t(id, key, params),
      services,
      get,
      settings: scope,
      panel,
      effect: (callback, label) => keep(effect(callback, label ?? `quick-switcher: ${id}`)),
      log: {
        info: (...args) => log.info?.(`[dsh-quick-switcher:${id}]`, ...args),
        warn: (...args) => log.warn?.(`[dsh-quick-switcher:${id}]`, ...args),
        error: (...args) => log.error?.(`[dsh-quick-switcher:${id}]`, ...args),
      },
    };

    let raw;
    try {
      raw = definition.setup(api);
    } catch (error) {
      for (const disposer of [...disposers].reverse()) disposer();
      throw wrapError(error, id, "setup");
    }

    let spec;
    try {
      spec = validateSpec(id, raw);
      checkViewKinds(id, spec);
    } catch (error) {
      for (const disposer of [...disposers].reverse()) disposer();
      throw error;
    }

    try {
      if (spec.locale !== null) keep(locale.add(id, spec.locale));
      if (spec.settings !== null) keep(settings.declare(id, spec.settings));
      if (spec.commands.length > 0) keep(commands.add(id, spec.commands));
      if (spec.slots.length > 0) keep(slots.add(id, spec.slots));
      if (spec.views !== null) {
        for (const [kind, renderer] of Object.entries(spec.views)) {
          views.set(kind, { moduleId: id, renderer });
        }
      }
    } catch (error) {
      for (const disposer of [...disposers].reverse()) disposer();
      throw wrapError(error, id, "registration");
    }

    const record = {
      id,
      order: spec.order,
      spec,
      sequence: sequence++,
      disposers,
      matcherIds: [],
    };
    records.set(id, record);

    const dispose = () => {
      if (records.get(id) !== record) return;
      records.delete(id);
      for (const [kind, entry] of views) {
        if (entry.moduleId === id) views.delete(kind);
      }
      for (const disposer of [...disposers].reverse()) disposer();
      notify();
    };
    record.dispose = dispose;
    notify();
    return dispose;
  }

  function modules() {
    return sortedRecords().map((record) => ({
      id: record.id,
      order: record.order,
      spec: record.spec,
      matcherIds: [...record.matcherIds],
    }));
  }

  function settingsGroups() {
    return sortedRecords()
      .filter((record) => record.spec.settings !== null)
      .map((record) => ({
        moduleId: record.id,
        order: record.order,
        settings: record.spec.settings,
      }));
  }

  function viewsOf(kind) {
    return views.get(kind) ?? null;
  }

  function list() {
    return sortedRecords().map((record) => ({
      id: record.id,
      order: record.order,
      matchers: [...record.matcherIds],
    }));
  }

  function defaultView() {
    return {
      placeholder: t(null, "corePlaceholder"),
      searchAria: t(null, "coreSearchAria"),
      listLabel: t(null, "coreListLabel"),
      rows: [],
      emptyText: t(null, "coreEmpty"),
      note: null,
      hints: [{ keys: ["Esc"], label: t(null, "hintClose") }],
      count: "",
      load: undefined,
      content: null,
      footer: null,
      inputLocked: false,
      keydown: undefined,
    };
  }

  /**
   * Mount every module for one open panel. The returned handle diffs against
   * the live registry: a module registered while the panel is open is mounted
   * on the next sync, a removed module is disposed, and untouched modules keep
   * their per-panel state (a running side answer is not interrupted).
   */
  function mount(panelContext) {
    if (disposed) {
      throw new Error("dsh-quick-switcher: the module registry is disposed");
    }
    const mounted = new Map();
    const reported = new Set();
    let ordered = [];
    let closed = false;

    function report(record, matcher, phase, error) {
      const key = `${record.id}:${matcher.id}:${phase}`;
      if (reported.has(key)) return;
      reported.add(key);
      log.error(
        `[dsh-quick-switcher] matcher "${record.id}:${matcher.id}" failed during ${phase}`,
        error,
      );
    }

    function disposeEntry(entry) {
      try {
        entry.surface?.dispose?.();
      } catch (error) {
        log.error(`[dsh-quick-switcher] module "${entry.record.id}" mount dispose failed`, error);
      }
      entry.record.matcherIds = [];
      entry.surface = null;
      entry.matchers = [];
    }

    function rebuild() {
      const next = [];
      const seen = new Set();
      let declaration = 0;
      for (const record of sortedRecords()) {
        const entry = mounted.get(record.id);
        if (entry === undefined || entry.surface === null) continue;
        for (const matcher of entry.surface.matchers) {
          if (seen.has(matcher.id)) {
            log.error(
              `[dsh-quick-switcher] matcher "${matcher.id}" from module "${record.id}" is already owned by another module`,
            );
            continue;
          }
          seen.add(matcher.id);
          next.push({
            moduleId: record.id,
            order: record.order,
            declaration: declaration++,
            id: matcher.id,
            priority: matcher.priority,
            match: matcher.match,
            view: matcher.view,
            record,
          });
        }
      }
      next.sort(
        (left, right) =>
          right.priority - left.priority ||
          left.order - right.order ||
          left.declaration - right.declaration,
      );
      ordered = next;
    }

    function sync() {
      if (closed) return;
      for (const [id, entry] of mounted) {
        if (records.get(id) !== entry.record) {
          disposeEntry(entry);
          mounted.delete(id);
        }
      }
      for (const record of sortedRecords()) {
        if (mounted.has(record.id)) continue;
        const entry = { record, surface: null, matchers: [] };
        mounted.set(record.id, entry);
        if (typeof record.spec.mount !== "function") continue;
        let raw;
        try {
          raw = record.spec.mount(panelContext);
          entry.surface = validateMount(record.id, raw);
          entry.matchers = entry.surface.matchers;
          record.matcherIds = entry.matchers.map((matcher) => matcher.id);
        } catch (error) {
          // A mount that fails validation may already have created resources;
          // its own dispose is the only way to release them, because the
          // registry never accepted the surface.
          if (raw !== undefined && raw !== null && typeof raw.dispose === "function") {
            try {
              raw.dispose();
            } catch (cleanupError) {
              log.error(
                `[dsh-quick-switcher] module "${record.id}" mount cleanup failed`,
                cleanupError,
              );
            }
          }
          log.error(`[dsh-quick-switcher] module "${record.id}" failed to mount`, error);
        }
      }
      rebuild();
    }

    function resolve(query) {
      for (const matcher of ordered) {
        let state;
        try {
          state = matcher.match(query, panelContext);
        } catch (error) {
          report(matcher.record, matcher, "match", error);
          continue;
        }
        if (state === null || state === undefined || state === false) continue;
        let view;
        try {
          view = matcher.view(state, panelContext);
        } catch (error) {
          report(matcher.record, matcher, "view", error);
          continue;
        }
        try {
          return {
            view: validateView(matcher.moduleId, matcher.id, view),
            moduleId: matcher.moduleId,
            matcherId: matcher.id,
          };
        } catch (error) {
          report(matcher.record, matcher, "view shape", error);
        }
      }
      return { view: defaultView(), moduleId: null, matcherId: null };
    }

    function providers() {
      const next = [];
      for (const record of sortedRecords()) {
        const entry = mounted.get(record.id);
        if (entry === undefined || entry.surface === null) continue;
        for (const Component of entry.surface.providers) {
          next.push({ moduleId: record.id, Component, instance: entry.surface });
        }
      }
      return next;
    }

    function contentFor(kind) {
      const entry = views.get(kind);
      if (entry === undefined) return null;
      const mountEntry = mounted.get(entry.moduleId);
      return {
        kind,
        renderer: entry.renderer,
        moduleId: entry.moduleId,
        instance: mountEntry?.surface ?? null,
      };
    }

    function matchers() {
      return ordered.map((matcher) => ({
        moduleId: matcher.moduleId,
        id: matcher.id,
        priority: matcher.priority,
      }));
    }

    const unsubscribe = subscribe(() => {
      if (closed) return;
      sync();
      panelContext.notify();
    });

    function dispose() {
      if (closed) return;
      closed = true;
      unsubscribe();
      for (const entry of [...mounted.values()].reverse()) disposeEntry(entry);
      mounted.clear();
      ordered = [];
    }

    sync();
    return { sync, resolve, providers, contentFor, matchers, dispose };
  }

  function disposeAll() {
    if (disposed) return;
    disposed = true;
    for (const record of [...records.values()]) record.dispose?.();
    records.clear();
    views.clear();
    listeners.clear();
  }

  return {
    apiVersion: API_VERSION,
    register,
    mount,
    subscribe,
    modules,
    settingsGroups,
    viewsOf,
    list,
    disposeAll,
  };
}
