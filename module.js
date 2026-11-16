/**
 * Public module contract for dsh-quick-switcher.
 *
 * Other client plugins import this file to declare a module, then hand the
 * returned definition to the running plugin's `quickSwitcher` service. The
 * file stays dependency free so an external bundle can import it without
 * pulling in the panel, React, or any DSH service.
 *
 * The setup function runs once when the module is registered, not when this
 * file is imported. Everything it returns is validated by the registry before
 * any contribution is applied.
 */

/** Version of the module contract the running plugin accepts. */
export const API_VERSION = 1;

/** Module and matcher ids stay readable in logs, mode state and settings paths. */
const ID_PATTERN = /^[a-z][a-z0-9-]*$/u;

/**
 * Declare a module.
 *
 * The id comes before setup because the setup API is scoped to it: translation
 * keys, settings reads and log prefixes all resolve through the id. The
 * returned definition is the value `quickSwitcher.register` accepts; callers
 * that do not import this file can pass the same `{ id, setup }` shape.
 *
 * @param {string} id stable module id, lowercase letters, digits and hyphens
 * @param {(api: ModuleApi) => ModuleSpec} setup runs once at registration
 * @returns {ModuleDefinition}
 */
export function defineModule(id, setup) {
  if (typeof id !== "string" || !ID_PATTERN.test(id)) {
    throw new TypeError(
      `dsh-quick-switcher: module id must match ${ID_PATTERN.source}, got ${JSON.stringify(id)}`,
    );
  }
  if (typeof setup !== "function") {
    throw new TypeError(`dsh-quick-switcher: module "${id}" setup must be a function`);
  }
  return Object.freeze({ id, setup });
}

/**
 * @typedef {object} ModuleDefinition
 * @property {string} id
 * @property {(api: ModuleApi) => ModuleSpec} setup
 */

/**
 * Build a matcher from a leading trigger.
 *
 * The common case is a prefix: `prefixMatcher(">", { id, view })` claims every
 * query that starts with ">" and hands the rest to the view as `{ filter }`.
 * Pass `map` for a different state shape, and `priority` when another module
 * can claim the same query. A matcher built here is a plain object, so a module
 * may still write `match` by hand for suffix, regex or stateful triggers.
 *
 * @param {string} prefix
 * @param {{
 *   id: string,
 *   view: (state: unknown, panel: PanelContext) => PanelView,
 *   priority?: number,
 *   map?: (text: string, panel: PanelContext) => unknown,
 * }} options
 * @returns {Matcher}
 */
export function prefixMatcher(prefix, options) {
  if (typeof prefix !== "string") {
    throw new TypeError("dsh-quick-switcher: prefixMatcher needs a string prefix");
  }
  const { id, view, priority = 0, map } = options ?? {};
  if (typeof id !== "string" || id === "") {
    throw new TypeError("dsh-quick-switcher: prefixMatcher needs a matcher id");
  }
  if (typeof view !== "function") {
    throw new TypeError(`dsh-quick-switcher: prefixMatcher "${id}" needs a view function`);
  }
  if (map !== undefined && typeof map !== "function") {
    throw new TypeError(`dsh-quick-switcher: prefixMatcher "${id}" map must be a function`);
  }
  const stateOf = map ?? ((text) => ({ filter: text }));
  return {
    id,
    priority,
    match(query, panel) {
      if (typeof query !== "string" || !query.startsWith(prefix)) return null;
      return stateOf(query.slice(prefix.length), panel);
    },
    view,
  };
}

/**
 * Static capabilities handed to every module setup once per plugin load.
 *
 * @typedef {object} ModuleApi
 * @property {string} id
 * @property {(key: string, params?: Record<string, unknown>) => string} t
 * @property {Record<string, unknown>} services injected DSH services
 * @property {(name: string) => unknown} get optional service lookup
 * @property {ModuleSettingsScope} settings
 * @property {ModulePanelController} panel
 * @property {ModuleShared} shared
 * @property {(callback: () => unknown, label?: string) => () => void} effect
 * @property {{ info: Function, warn: Function, error: Function }} log
 */

/**
 * Named stores a module may publish to or read from without importing the
 * module that owns the data. A name nobody published yet reads as null.
 *
 * @typedef {object} ModuleShared
 * @property {(name: string) => SharedStore} store
 */

/**
 * @typedef {object} SharedStore
 * @property {string} name
 * @property {() => unknown} getSnapshot
 * @property {(value: unknown) => void} publish
 * @property {(listener: (value: unknown) => void) => () => void} subscribe
 */

/**
 * @typedef {object} ModuleSettingsScope
 * @property {(fieldId: string) => unknown} get
 * @property {(fieldId: string, value: unknown) => void} set
 * @property {(listener: () => void) => () => void} subscribe
 */

/**
 * @typedef {object} ModulePanelController
 * @property {(options?: { seed?: string }) => void} open
 * @property {() => void} close
 * @property {() => void} toggle
 * @property {() => boolean} isOpen
 * @property {() => { open: boolean, seed: string, generation: number, mode: string|null, query: string }} getState
 * @property {(listener: () => void) => () => void} subscribe
 * @property {() => Array<{ id: string, order: number, matchers: string[] }>} list
 */

/**
 * @typedef {object} ModuleSpec
 * @property {number} [apiVersion]
 * @property {number} [order]
 * @property {string} [labelKey]
 * @property {Record<string, Record<string, string>>} [locale]
 * @property {ModuleSettingsDecl} [settings]
 * @property {ModuleCommand[]} [commands]
 * @property {ModuleSlot[]} [slots]
 * @property {Record<string, ModuleViewRenderer>} [views]
 * @property {(panel: PanelContext) => ModuleMount} [mount]
 */

/**
 * @typedef {object} ModuleMount
 * @property {Function[]} [providers]
 * @property {Matcher[]} [matchers]
 * @property {() => void} [dispose]
 *
 * Extra fields on the returned object are kept and handed to this module's
 * providers and content renderers as `instance`, so a detail view can read the
 * module's own store, UI state and actions.
 */

/**
 * @typedef {object} Matcher
 * @property {string} id globally unique, also the mode id published to the controller
 * @property {number} [priority] higher claims first, default 0
 * @property {(query: string, panel: PanelContext) => unknown} match null declines
 * @property {(state: unknown, panel: PanelContext) => PanelView} view
 */

/**
 * @typedef {object} PanelContext
 * @property {string|null} currentSessionId
 * @property {string|null} activePanelId
 * @property {unknown} pending
 * @property {number} now
 * @property {string} query
 * @property {(key: string, params?: object) => string} t
 * @property {Record<string, unknown>} services
 * @property {(name: string) => unknown} get
 * @property {(options?: { restoreFocus?: boolean }) => void} close
 * @property {(query: string, options?: { selectedKey?: string }) => void} setQuery
 * @property {() => void} focusInput
 * @property {() => void} notify
 * @property {(text: string|null) => void} setNotice
 * @property {(text: string|null) => void} setError
 * @property {Element|null} previousFocus
 */

/**
 * @typedef {object} PanelView
 * @property {string} [placeholder]
 * @property {string} [searchAria]
 * @property {string} [listLabel]
 * @property {PanelRow[]} rows
 * @property {string|null} [emptyText]
 * @property {string|null} [note]
 * @property {Array<{ keys: string[], label: string }>} [hints]
 * @property {string} [count]
 * @property {() => void} [load]
 * @property {ContentDescriptor} [content]
 * @property {ContentDescriptor} [footer]
 * @property {boolean} [inputLocked]
 * @property {(event: KeyboardEvent, panel: PanelContext) => boolean} [keydown]
 */

/**
 * @typedef {object} PanelRow
 * @property {string|number} key
 * @property {string} title
 * @property {Set<number>|null} [positions]
 * @property {Array<{ text: string, className?: string }>} [meta]
 * @property {string} [className]
 * @property {string} [titleClassName]
 * @property {string} [icon]
 * @property {string[]} [keys] keycaps shown at the row's trailing edge
 * @property {string|null} [badge]
 * @property {{ state: string, label?: string }|null} [status]
 * @property {string|null} [trailing]
 * @property {boolean} [action] excluded from the initial caret
 * @property {() => void} [run]
 * @property {() => void} [shiftRun]
 */

/**
 * @typedef {object} ContentDescriptor
 * @property {string} kind
 * @property {object} [props]
 */

/**
 * @typedef {object} ModuleViewRenderer
 * @property {Function} [content]
 * @property {Function} [footer]
 */

/**
 * @typedef {object} ModuleSettingsDecl
 * @property {string} labelKey
 * @property {string} [descriptionKey]
 * @property {SettingsGroup[]} groups
 */

/**
 * @typedef {object} SettingsGroup
 * @property {string} [id]
 * @property {string} [labelKey]
 * @property {SettingsField[]} fields
 */

/**
 * @typedef {object} SettingsField
 * @property {string} id unique inside the module
 * @property {"boolean"|"choice"|"number"|"custom"} type
 * @property {unknown} default
 * @property {string} [labelKey]
 * @property {string} [descriptionKey]
 * @property {string} [hintKey]
 * @property {number} [min]
 * @property {number} [max]
 * @property {number} [step]
 * @property {Array<{ value: string|number, labelKey: string }>} [options]
 * @property {Function} [render]
 */

/**
 * @typedef {object} ModuleCommand
 * @property {string} id
 * @property {() => string} label
 * @property {string[]} [aliases]
 * @property {object} [defaults]
 * @property {string[]} [regions]
 * @property {string[]} [modals]
 * @property {() => { status: string, run?: () => void, reason?: string }} resolve
 */

/**
 * @typedef {object} ModuleSlot
 * @property {string} name
 * @property {string} id
 * @property {number} [order]
 * @property {string} [locale]
 * @property {() => object} [inject]
 * @property {Function} component
 */
