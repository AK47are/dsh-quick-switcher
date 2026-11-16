/**
 * One browser-local document for every module's settings.
 *
 * Modules declare fields; they never see the storage document or its keys. The
 * store resolves a field to `[module, group?, field]`, validates what it reads,
 * and deep-merges writes so keys written by another version or another module
 * survive. The document stays under the 0.8.0 storage key; the two flat
 * preferences written before the module split are migrated on first read.
 */

const STORAGE_KEY = "dsh.quick-switcher.v1";

/**
 * Core-owned preferences live under a key no module can occupy. Module ids
 * start with a lowercase letter, so the double underscore stays reserved and a
 * module named "core" or "switches" cannot collide with this subtree.
 */
const CORE_KEY = "__core";
const DEFAULT_MODE_KEY = "defaultMode";
const SWITCHES_KEY = "switches";
const EXPANDED_KEY = "expanded";

/** Flat preference names from 0.8.0 and the paths they moved to. */
const LEGACY_PATHS = {
  includeAttachments: ["ask", "includeAttachments"],
  pendingOrder: ["sessions", "pendingOrder"],
};

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (isPlainObject(value)) {
    const next = {};
    for (const [key, inner] of Object.entries(value)) next[key] = clone(inner);
    return next;
  }
  return value;
}

function readPath(document, path) {
  let cursor = document;
  for (const key of path) {
    if (!isPlainObject(cursor) || !Object.hasOwn(cursor, key)) return undefined;
    cursor = cursor[key];
  }
  return cursor;
}

function writePath(document, path, value) {
  let cursor = document;
  for (const key of path.slice(0, -1)) {
    if (!isPlainObject(cursor[key])) cursor[key] = {};
    cursor = cursor[key];
  }
  cursor[path[path.length - 1]] = value;
}

function safeLocalStorage() {
  try {
    if (typeof window === "undefined") return undefined;
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

/**
 * Clamp a stored number into the declared range. A non-number falls back to the
 * default, so a hand-edited document cannot make a field render "NaN".
 */
function normalize(field, value) {
  if (value === undefined) return field.default;
  if (field.type === "boolean") {
    return typeof value === "boolean" ? value : field.default;
  }
  if (field.type === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) return field.default;
    let next = value;
    if (field.min !== undefined && next < field.min) next = field.min;
    if (field.max !== undefined && next > field.max) next = field.max;
    return next;
  }
  if (field.type === "choice") {
    return field.options.some((option) => option.value === value) ? value : field.default;
  }
  return value;
}

export function createSettingsStore({ storage, eventTarget = globalThis } = {}) {
  const backend = storage ?? safeLocalStorage();
  const declarations = new Map();
  const listeners = new Set();
  let sequence = 0;
  let closed = false;

  function readDocument(target) {
    try {
      const raw = target?.getItem(STORAGE_KEY);
      if (raw === null || raw === undefined) return {};
      const parsed = JSON.parse(raw);
      return isPlainObject(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  function migrate(input) {
    const next = clone(isPlainObject(input) ? input : {});
    let changed = false;
    for (const [legacyKey, path] of Object.entries(LEGACY_PATHS)) {
      if (!Object.hasOwn(next, legacyKey)) continue;
      if (readPath(next, path) === undefined) {
        writePath(next, path, next[legacyKey]);
      }
      delete next[legacyKey];
      changed = true;
    }
    return { document: next, changed };
  }

  function persist(value) {
    try {
      backend?.setItem(STORAGE_KEY, JSON.stringify(value));
    } catch {
      // A blocked or full localStorage still lets a choice apply this session.
    }
  }

  function emit() {
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch (error) {
        console.error("[dsh-quick-switcher] settings listener failed", error);
      }
    }
  }

  function onStorage(event) {
    if (closed) return;
    if (event.key !== null && event.key !== STORAGE_KEY) return;
    const next = migrate(readDocument(backend));
    document = next.document;
    if (next.changed) persist(document);
    emit();
  }

  let document = {};
  const initial = migrate(readDocument(backend));
  document = initial.document;
  if (initial.changed) persist(document);
  eventTarget?.addEventListener?.("storage", onStorage);

  function valueOf(moduleId, fieldId) {
    const entry = declarations.get(moduleId)?.fields.get(fieldId);
    if (entry === undefined) return undefined;
    return normalize(entry.field, readPath(document, entry.path));
  }

  function setValue(moduleId, fieldId, value) {
    const entry = declarations.get(moduleId)?.fields.get(fieldId);
    if (entry === undefined) {
      throw new Error(
        `dsh-quick-switcher: settings field "${fieldId}" is not declared for module "${moduleId}"`,
      );
    }
    const next = normalize(entry.field, value);
    document = clone(document);
    writePath(document, entry.path, next);
    persist(document);
    emit();
  }

  function subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  /**
   * Whether a module participates in the panel. A missing value means on, so a
   * fresh install and a newly registered module both start enabled; an explicit
   * false survives a temporary unregister because the document is not keyed by
   * the live registry.
   */
  function moduleSwitch(moduleId) {
    return readPath(document, [CORE_KEY, SWITCHES_KEY, moduleId]) !== false;
  }

  function setModuleSwitch(moduleId, shouldEnable) {
    if (typeof moduleId !== "string" || moduleId === "") {
      throw new TypeError("dsh-quick-switcher: setModuleSwitch needs a module id");
    }
    if (typeof shouldEnable !== "boolean") {
      throw new TypeError("dsh-quick-switcher: setModuleSwitch needs a boolean");
    }
    if (moduleSwitch(moduleId) === shouldEnable) return;
    document = clone(document);
    writePath(document, [CORE_KEY, SWITCHES_KEY, moduleId], shouldEnable);
    persist(document);
    emit();
  }

  /**
   * The mode the general open command enters when no explicit seed is given.
   * Null means the user never chose, so the panel falls back to the first
   * registered entry instead of the core hard-coding a module id.
   */
  function defaultMode() {
    const value = readPath(document, [CORE_KEY, DEFAULT_MODE_KEY]);
    return typeof value === "string" && value !== "" ? value : null;
  }

  function setDefaultMode(moduleId) {
    if (typeof moduleId !== "string" || moduleId === "") {
      throw new TypeError("dsh-quick-switcher: setDefaultMode needs a module id");
    }
    if (defaultMode() === moduleId) return;
    document = clone(document);
    writePath(document, [CORE_KEY, DEFAULT_MODE_KEY], moduleId);
    persist(document);
    emit();
  }

  /**
   * Whether a settings section is open. Missing means open, so the first visit
   * shows every section and a user who never touched a disclosure keeps the
   * full page. The state is stored with the rest of the preferences so it
   * survives navigation, a reload and another tab.
   */
  function isSectionExpanded(sectionId) {
    return readPath(document, [CORE_KEY, EXPANDED_KEY, sectionId]) !== false;
  }

  function setSectionExpanded(sectionId, isExpanded) {
    if (typeof sectionId !== "string" || sectionId === "") {
      throw new TypeError("dsh-quick-switcher: setSectionExpanded needs a section id");
    }
    if (typeof isExpanded !== "boolean") {
      throw new TypeError("dsh-quick-switcher: setSectionExpanded needs a boolean");
    }
    if (isSectionExpanded(sectionId) === isExpanded) return;
    document = clone(document);
    writePath(document, [CORE_KEY, EXPANDED_KEY, sectionId], isExpanded);
    persist(document);
    emit();
  }

  /**
   * Register one module's settings and return the disposer that removes the
   * declaration. Stored values survive a dispose so a temporary unregister
   * does not throw away a user's choice.
   */
  function declare(moduleId, settings) {
    if (declarations.has(moduleId)) {
      throw new Error(`dsh-quick-switcher: settings for module "${moduleId}" are already declared`);
    }
    const fields = new Map();
    for (const group of settings.groups) {
      for (const field of group.fields) {
        const path = group.id === undefined ? [moduleId, field.id] : [moduleId, group.id, field.id];
        fields.set(field.id, { field, groupId: group.id, path });
      }
    }
    const entry = { settings, fields, sequence: sequence++ };
    declarations.set(moduleId, entry);
    emit();
    return () => {
      if (declarations.get(moduleId) !== entry) return;
      declarations.delete(moduleId);
      emit();
    };
  }

  function scope(moduleId) {
    return {
      get: (fieldId) => valueOf(moduleId, fieldId),
      set: (fieldId, value) => setValue(moduleId, fieldId, value),
      subscribe,
    };
  }

  /**
   * Declared groups in registration order. The settings page sorts them by the
   * module order the registry reports.
   */
  function groups() {
    return [...declarations.entries()].map(([moduleId, entry]) => ({
      moduleId,
      sequence: entry.sequence,
      ...entry.settings,
    }));
  }

  function fieldOf(moduleId, fieldId) {
    return declarations.get(moduleId)?.fields.get(fieldId) ?? null;
  }

  function dispose() {
    if (closed) return;
    closed = true;
    eventTarget?.removeEventListener?.("storage", onStorage);
    declarations.clear();
    listeners.clear();
  }

  return {
    declare,
    scope,
    groups,
    fieldOf,
    get: valueOf,
    subscribe,
    moduleSwitch,
    setModuleSwitch,
    defaultMode,
    setDefaultMode,
    isSectionExpanded,
    setSectionExpanded,
    dispose,
    document: () => clone(document),
  };
}

export { CORE_KEY, STORAGE_KEY };
