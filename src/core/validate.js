/* Module and contribution validation shared by the registry and its tests. */

import { API_VERSION } from "../../module.js";

const ID_PATTERN = /^[a-z][a-z0-9-]*$/u;
// Settings paths are camelCase in the contract (`ask.includeAttachments`), so
// field ids accept capitals and no separators; a group id is a path segment and
// keeps the kebab form used by module ids.
const GROUP_ID_PATTERN = /^[a-z][a-z0-9-]*$/u;
const FIELD_ID_PATTERN = /^[a-z][a-zA-Z0-9]*$/u;
const FIELD_TYPES = new Set(["boolean", "choice", "number", "custom"]);

function fail(moduleId, message) {
  throw new TypeError(`dsh-quick-switcher: module "${moduleId}" ${message}`);
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function optionalString(moduleId, value, name) {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value === "") fail(moduleId, `${name} must be a non-empty string`);
  return value;
}

function optionalFiniteNumber(moduleId, value, name) {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail(moduleId, `${name} must be a finite number`);
  }
  return value;
}

/**
 * Validate what a module setup returned and fill the defaults the registry
 * relies on. Throws on the first problem so registration never applies a
 * partially valid declaration.
 * @param {string} moduleId
 * @param {unknown} spec
 */
export function validateSpec(moduleId, spec) {
  if (!isPlainObject(spec)) fail(moduleId, "setup must return an object");

  const apiVersion = spec.apiVersion ?? API_VERSION;
  if (apiVersion !== API_VERSION) {
    fail(moduleId, `apiVersion must be ${API_VERSION}`);
  }

  const order = spec.order ?? 100;
  if (typeof order !== "number" || !Number.isFinite(order)) {
    fail(moduleId, "order must be a finite number");
  }

  const labelKey = optionalString(moduleId, spec.labelKey, "labelKey");
  const descriptionKey = optionalString(moduleId, spec.descriptionKey, "descriptionKey");
  const dependencies = validateDependencies(moduleId, spec.dependencies);
  const entry = spec.entry === undefined ? null : validateEntry(moduleId, spec.entry);
  const locale = validateLocale(moduleId, spec.locale);
  const settings =
    spec.settings === undefined ? null : validateSettings(moduleId, spec.settings);
  const commands =
    spec.commands === undefined ? [] : validateCommands(moduleId, spec.commands);
  const slots = spec.slots === undefined ? [] : validateSlots(moduleId, spec.slots);
  const views = spec.views === undefined ? null : validateViews(moduleId, spec.views);

  if (spec.mount !== undefined && typeof spec.mount !== "function") {
    fail(moduleId, "mount must be a function");
  }

  return {
    apiVersion,
    order,
    labelKey,
    descriptionKey,
    dependencies,
    entry,
    locale,
    settings,
    commands,
    slots,
    views,
    mount: spec.mount,
  };
}

/**
 * A module names the modules whose data it reads so the settings page can warn
 * when one of them is switched off. Unknown ids are allowed: the dependency may
 * belong to a plugin that is installed later, and a missing module is not a
 * registration error.
 */
function validateDependencies(moduleId, dependencies) {
  if (dependencies === undefined) return [];
  if (!Array.isArray(dependencies)) fail(moduleId, "dependencies must be an array");
  const seen = new Set();
  return dependencies.map((id, index) => {
    if (typeof id !== "string" || !ID_PATTERN.test(id)) {
      fail(moduleId, `dependency ${index} id ${JSON.stringify(id)} is invalid`);
    }
    if (id === moduleId) fail(moduleId, "a module cannot depend on itself");
    if (seen.has(id)) fail(moduleId, `dependency "${id}" is declared twice`);
    seen.add(id);
    return id;
  });
}

/**
 * Validate the direct-open declaration that turns into a generated command.
 * The seed may be empty because the default session list is reached by an empty
 * query; every other seed is a query prefix the matcher owns.
 */
function validateEntry(moduleId, entry) {
  if (!isPlainObject(entry)) fail(moduleId, "entry must be an object");
  if (typeof entry.seed !== "string") fail(moduleId, "entry.seed must be a string");
  const mode = optionalString(moduleId, entry.mode, "entry.mode");
  if (mode !== undefined && !ID_PATTERN.test(mode)) {
    fail(moduleId, `entry.mode ${JSON.stringify(mode)} is invalid`);
  }
  const labelKey = optionalString(moduleId, entry.labelKey, "entry.labelKey");
  const aliases = entry.aliases ?? [];
  if (!Array.isArray(aliases) || aliases.some((alias) => typeof alias !== "string")) {
    fail(moduleId, "entry.aliases must be a string array");
  }
  const defaults = entry.defaults ?? {};
  if (!isPlainObject(defaults)) fail(moduleId, "entry.defaults must be an object");
  return { seed: entry.seed, mode, labelKey, aliases, defaults };
}

function validateLocale(moduleId, locale) {
  if (locale === undefined) return null;
  if (!isPlainObject(locale)) fail(moduleId, "locale must be an object");
  const normalized = {};
  for (const [language, dictionary] of Object.entries(locale)) {
    if (!isPlainObject(dictionary)) {
      fail(moduleId, `locale "${language}" must be an object`);
    }
    const next = {};
    for (const [key, value] of Object.entries(dictionary)) {
      if (typeof value !== "string") {
        fail(moduleId, `locale "${language}" key "${key}" must be a string`);
      }
      next[key] = value;
    }
    normalized[language] = next;
  }
  return normalized;
}

function validateSettings(moduleId, settings) {
  if (!isPlainObject(settings)) fail(moduleId, "settings must be an object");
  if (typeof settings.labelKey !== "string" || settings.labelKey === "") {
    fail(moduleId, "settings.labelKey must be a non-empty string");
  }
  if (!Array.isArray(settings.groups) || settings.groups.length === 0) {
    fail(moduleId, "settings.groups must be a non-empty array");
  }

  const groupIds = new Set();
  const fieldIds = new Set();
  const groups = settings.groups.map((group, index) => {
    if (!isPlainObject(group)) fail(moduleId, `settings group ${index} must be an object`);
    const id = group.id;
    if (id !== undefined) {
      if (typeof id !== "string" || !GROUP_ID_PATTERN.test(id)) {
        fail(moduleId, `settings group id ${JSON.stringify(id)} is invalid`);
      }
      if (groupIds.has(id)) fail(moduleId, `settings group "${id}" is declared twice`);
      groupIds.add(id);
    }
    const labelKey = optionalString(moduleId, group.labelKey, `settings group ${index} labelKey`);
    if (!Array.isArray(group.fields) || group.fields.length === 0) {
      fail(moduleId, `settings group ${index} needs a non-empty fields array`);
    }
    const fields = group.fields.map((field, fieldIndex) =>
      validateField(moduleId, field, fieldIds, index, fieldIndex),
    );
    return { id, labelKey, fields };
  });

  return {
    labelKey: settings.labelKey,
    descriptionKey: optionalString(moduleId, settings.descriptionKey, "settings.descriptionKey"),
    groups,
  };
}

function validateField(moduleId, field, fieldIds, groupIndex, fieldIndex) {
  if (!isPlainObject(field)) {
    fail(moduleId, `settings field ${groupIndex}.${fieldIndex} must be an object`);
  }
  if (typeof field.id !== "string" || !FIELD_ID_PATTERN.test(field.id)) {
    fail(moduleId, `settings field id ${JSON.stringify(field.id)} is invalid`);
  }
  if (fieldIds.has(field.id)) {
    fail(moduleId, `settings field "${field.id}" is declared twice`);
  }
  fieldIds.add(field.id);
  if (!FIELD_TYPES.has(field.type)) {
    fail(moduleId, `settings field "${field.id}" has unknown type ${JSON.stringify(field.type)}`);
  }

  let min;
  let max;
  let step;
  let options;
  if (field.type === "boolean" && typeof field.default !== "boolean") {
    fail(moduleId, `settings field "${field.id}" needs a boolean default`);
  } else if (field.type === "number") {
    if (typeof field.default !== "number" || !Number.isFinite(field.default)) {
      fail(moduleId, `settings field "${field.id}" needs a finite number default`);
    }
    min = optionalFiniteNumber(moduleId, field.min, `settings field "${field.id}" min`);
    max = optionalFiniteNumber(moduleId, field.max, `settings field "${field.id}" max`);
    step = optionalFiniteNumber(moduleId, field.step, `settings field "${field.id}" step`);
    if (min !== undefined && max !== undefined && min > max) {
      fail(moduleId, `settings field "${field.id}" min is greater than max`);
    }
    if (min !== undefined && field.default < min) {
      fail(moduleId, `settings field "${field.id}" default is below min`);
    }
    if (max !== undefined && field.default > max) {
      fail(moduleId, `settings field "${field.id}" default is above max`);
    }
    if (step !== undefined && step <= 0) {
      fail(moduleId, `settings field "${field.id}" step must be positive`);
    }
  } else if (field.type === "choice") {
    if (!Array.isArray(field.options) || field.options.length === 0) {
      fail(moduleId, `settings field "${field.id}" needs options`);
    }
    const values = new Set();
    options = field.options.map((option, index) => {
      if (!isPlainObject(option)) {
        fail(moduleId, `settings field "${field.id}" option ${index} must be an object`);
      }
      const type = typeof option.value;
      if (type !== "string" && type !== "number") {
        fail(moduleId, `settings field "${field.id}" option ${index} value must be a string or number`);
      }
      if (values.has(option.value)) {
        fail(moduleId, `settings field "${field.id}" option value ${JSON.stringify(option.value)} is duplicated`);
      }
      values.add(option.value);
      if (typeof option.labelKey !== "string" || option.labelKey === "") {
        fail(moduleId, `settings field "${field.id}" option ${index} needs a labelKey`);
      }
      return { value: option.value, labelKey: option.labelKey };
    });
    if (!values.has(field.default)) {
      fail(moduleId, `settings field "${field.id}" default is not one of its options`);
    }
  } else if (field.type === "custom") {
    if (typeof field.render !== "function") {
      fail(moduleId, `settings field "${field.id}" needs a render function`);
    }
  }

  if (field.labelKey !== undefined && (typeof field.labelKey !== "string" || field.labelKey === "")) {
    fail(moduleId, `settings field "${field.id}" labelKey must be a non-empty string`);
  }
  // A custom field may ask for the full row; the settings page turns this into
  // its stacked row class. Keeping the value here matters: the field object is
  // rebuilt from a whitelist, so a property not returned below never reaches
  // the renderer.
  if (field.layout !== undefined && field.layout !== "stack" && field.layout !== "row") {
    fail(moduleId, `settings field "${field.id}" layout must be "stack" or "row"`);
  }

  return {
    id: field.id,
    type: field.type,
    default: field.default,
    labelKey: field.labelKey,
    descriptionKey: optionalString(moduleId, field.descriptionKey, `settings field "${field.id}" descriptionKey`),
    hintKey: optionalString(moduleId, field.hintKey, `settings field "${field.id}" hintKey`),
    layout: field.layout,
    min,
    max,
    step,
    options,
    render: field.render,
  };
}

function validateCommands(moduleId, commands) {
  if (!Array.isArray(commands)) fail(moduleId, "commands must be an array");
  const ids = new Set();
  return commands.map((command, index) => {
    if (!isPlainObject(command)) fail(moduleId, `command ${index} must be an object`);
    if (typeof command.id !== "string" || command.id === "") {
      fail(moduleId, `command ${index} needs a non-empty id`);
    }
    if (ids.has(command.id)) fail(moduleId, `command "${command.id}" is declared twice`);
    ids.add(command.id);
    if (typeof command.label !== "function") {
      fail(moduleId, `command "${command.id}" needs a label function`);
    }
    if (typeof command.resolve !== "function") {
      fail(moduleId, `command "${command.id}" needs a resolve function`);
    }
    const aliases = command.aliases ?? [];
    if (!Array.isArray(aliases) || aliases.some((alias) => typeof alias !== "string")) {
      fail(moduleId, `command "${command.id}" aliases must be a string array`);
    }
    return { ...command, aliases };
  });
}

function validateSlots(moduleId, slots) {
  if (!Array.isArray(slots)) fail(moduleId, "slots must be an array");
  return slots.map((slot, index) => {
    if (!isPlainObject(slot)) fail(moduleId, `slot ${index} must be an object`);
    if (typeof slot.name !== "string" || slot.name === "") {
      fail(moduleId, `slot ${index} needs a name`);
    }
    if (typeof slot.id !== "string" || slot.id === "") {
      fail(moduleId, `slot ${index} needs an id`);
    }
    if (typeof slot.component !== "function") {
      fail(moduleId, `slot "${slot.id}" needs a component`);
    }
    if (slot.inject !== undefined && typeof slot.inject !== "function") {
      fail(moduleId, `slot "${slot.id}" inject must be a function`);
    }
    return { ...slot };
  });
}

function validateViews(moduleId, views) {
  if (!isPlainObject(views)) fail(moduleId, "views must be an object");
  const entries = Object.entries(views);
  if (entries.length === 0) fail(moduleId, "views must declare at least one kind");
  const normalized = {};
  for (const [kind, renderer] of entries) {
    if (kind === "") fail(moduleId, "view kind cannot be empty");
    if (!isPlainObject(renderer)) fail(moduleId, `view "${kind}" must be an object`);
    const content = renderer.content;
    const footer = renderer.footer;
    if (content === undefined && footer === undefined) {
      fail(moduleId, `view "${kind}" needs a content or footer component`);
    }
    if (content !== undefined && typeof content !== "function") {
      fail(moduleId, `view "${kind}" content must be a component`);
    }
    if (footer !== undefined && typeof footer !== "function") {
      fail(moduleId, `view "${kind}" footer must be a component`);
    }
    normalized[kind] = { content, footer };
  }
  return normalized;
}

/**
 * Validate one panel mount. A missing surface is legal: a module may contribute
 * only settings, commands, slots or views.
 * @param {string} moduleId
 * @param {unknown} surface
 */
export function validateMount(moduleId, surface) {
  if (surface === undefined || surface === null) {
    return { providers: [], matchers: [], dispose: null };
  }
  if (!isPlainObject(surface)) fail(moduleId, "mount must return an object");

  const providers = surface.providers ?? [];
  if (!Array.isArray(providers) || providers.some((provider) => typeof provider !== "function")) {
    fail(moduleId, "mount providers must be component functions");
  }

  const matchers = surface.matchers ?? [];
  if (!Array.isArray(matchers)) fail(moduleId, "mount matchers must be an array");
  const ids = new Set();
  const normalizedMatchers = matchers.map((matcher, index) => {
    if (!isPlainObject(matcher)) fail(moduleId, `matcher ${index} must be an object`);
    if (typeof matcher.id !== "string" || !ID_PATTERN.test(matcher.id)) {
      fail(moduleId, `matcher id ${JSON.stringify(matcher.id)} is invalid`);
    }
    if (ids.has(matcher.id)) fail(moduleId, `matcher "${matcher.id}" is declared twice`);
    ids.add(matcher.id);
    if (typeof matcher.match !== "function") {
      fail(moduleId, `matcher "${matcher.id}" needs a match function`);
    }
    if (typeof matcher.view !== "function") {
      fail(moduleId, `matcher "${matcher.id}" needs a view function`);
    }
    const priority = matcher.priority ?? 0;
    if (typeof priority !== "number" || !Number.isFinite(priority)) {
      fail(moduleId, `matcher "${matcher.id}" priority must be a finite number`);
    }
    // Several matchers may publish one mode, so this id is validated as a mode
    // id rather than required to match the matcher id. A missing alias means
    // the matcher's own id, which keeps every existing matcher unchanged.
    const mode = optionalString(moduleId, matcher.mode, `matcher "${matcher.id}" mode`);
    if (mode !== undefined && !ID_PATTERN.test(mode)) {
      fail(moduleId, `matcher "${matcher.id}" mode ${JSON.stringify(mode)} is invalid`);
    }
    return {
      id: matcher.id,
      priority,
      mode: mode ?? matcher.id,
      match: matcher.match,
      view: matcher.view,
    };
  });

  const dispose = surface.dispose;
  if (dispose !== undefined && typeof dispose !== "function") {
    fail(moduleId, "mount dispose must be a function");
  }

  // Additional fields belong to the module: the shell passes the whole surface
  // to that module's providers and content renderers as `instance`, which is how
  // a detail component reaches its store and actions.
  return { ...surface, providers, matchers: normalizedMatchers, dispose: dispose ?? null };
}

function validateDescriptor(moduleId, matcherId, value, field) {
  if (value === undefined || value === null) return null;
  if (!isPlainObject(value)) {
    fail(moduleId, `matcher "${matcherId}" ${field} must be an object`);
  }
  if (typeof value.kind !== "string" || value.kind === "") {
    fail(moduleId, `matcher "${matcherId}" ${field} needs a kind`);
  }
  if (value.props !== undefined && !isPlainObject(value.props)) {
    fail(moduleId, `matcher "${matcherId}" ${field} props must be an object`);
  }
  return { kind: value.kind, props: value.props ?? {} };
}

/**
 * Validate one view and fill the keys the shell reads. Duplicate row keys are
 * rejected here so the shell never has to guess which row the selection means.
 * @param {string} moduleId
 * @param {string} matcherId
 * @param {unknown} view
 */
export function validateView(moduleId, matcherId, view) {
  if (!isPlainObject(view)) fail(moduleId, `matcher "${matcherId}" view must be an object`);

  const rows = view.rows ?? [];
  if (!Array.isArray(rows)) fail(moduleId, `matcher "${matcherId}" rows must be an array`);
  const keys = new Set();
  const normalizedRows = rows.map((row, index) => {
    if (!isPlainObject(row)) {
      fail(moduleId, `matcher "${matcherId}" row ${index} must be an object`);
    }
    if (row.key === undefined || row.key === null) {
      fail(moduleId, `matcher "${matcherId}" row ${index} needs a key`);
    }
    if (keys.has(row.key)) {
      fail(moduleId, `matcher "${matcherId}" returned duplicate row key ${String(row.key)}`);
    }
    keys.add(row.key);
    if (typeof row.title !== "string") {
      fail(moduleId, `matcher "${matcherId}" row ${String(row.key)} needs a string title`);
    }
    if (row.run !== undefined && typeof row.run !== "function") {
      fail(moduleId, `matcher "${matcherId}" row ${String(row.key)} run must be a function`);
    }
    if (row.shiftRun !== undefined && typeof row.shiftRun !== "function") {
      fail(moduleId, `matcher "${matcherId}" row ${String(row.key)} shiftRun must be a function`);
    }
    if (row.positions !== undefined && row.positions !== null && !(row.positions instanceof Set)) {
      fail(moduleId, `matcher "${matcherId}" row ${String(row.key)} positions must be a Set or null`);
    }
    if (row.meta !== undefined && !Array.isArray(row.meta)) {
      fail(moduleId, `matcher "${matcherId}" row ${String(row.key)} meta must be an array`);
    }
    if (row.action !== undefined && typeof row.action !== "boolean") {
      fail(moduleId, `matcher "${matcherId}" row ${String(row.key)} action must be a boolean`);
    }
    return row;
  });

  const hints = view.hints ?? [];
  if (!Array.isArray(hints)) fail(moduleId, `matcher "${matcherId}" hints must be an array`);
  for (const hint of hints) {
    if (!isPlainObject(hint)) fail(moduleId, `matcher "${matcherId}" hint must be an object`);
    if (!Array.isArray(hint.keys) || hint.keys.some((key) => typeof key !== "string")) {
      fail(moduleId, `matcher "${matcherId}" hint keys must be a string array`);
    }
    if (typeof hint.label !== "string") {
      fail(moduleId, `matcher "${matcherId}" hint label must be a string`);
    }
  }

  if (view.load !== undefined && typeof view.load !== "function") {
    fail(moduleId, `matcher "${matcherId}" load must be a function`);
  }
  if (view.keydown !== undefined && typeof view.keydown !== "function") {
    fail(moduleId, `matcher "${matcherId}" keydown must be a function`);
  }
  if (view.back !== undefined && typeof view.back !== "function") {
    fail(moduleId, `matcher "${matcherId}" back must be a function`);
  }

  return {
    placeholder: view.placeholder ?? "",
    searchAria: view.searchAria ?? "",
    listLabel: view.listLabel ?? "",
    rows: normalizedRows,
    emptyText: view.emptyText ?? null,
    note: view.note ?? null,
    hints,
    count: view.count ?? "",
    load: view.load,
    content: validateDescriptor(moduleId, matcherId, view.content, "content"),
    footer: validateDescriptor(moduleId, matcherId, view.footer, "footer"),
    inputLocked: view.inputLocked === true,
    back: view.back,
    keydown: view.keydown,
  };
}
