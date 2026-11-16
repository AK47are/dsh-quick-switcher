/**
 * Module dictionaries merged over one core dictionary.
 *
 * DSH's locale service owns the active language; this translator only needs to
 * know the id so it can walk the same fallback order the service uses: exact
 * tag, base tag, en, then zh. A missing key returns the key itself, which makes
 * a forgotten dictionary entry visible in the panel instead of rendering
 * "undefined".
 */

export function createTranslator({ locale, dictionaries = {} } = {}) {
  const modules = new Map();
  const listeners = new Set();

  function language() {
    try {
      const snapshot = locale?.getSnapshot?.();
      return typeof snapshot?.active === "string" ? snapshot.active : "en";
    } catch {
      return "en";
    }
  }

  function candidates(active) {
    const base = String(active).split("-")[0];
    return [...new Set([active, base, "en", "zh"])];
  }

  function lookup(table, active, key) {
    if (table === undefined || table === null) return undefined;
    for (const candidate of candidates(active)) {
      const dictionary = table[candidate];
      if (dictionary !== undefined && Object.hasOwn(dictionary, key)) {
        return dictionary[key];
      }
    }
    return undefined;
  }

  function interpolate(text, params) {
    if (params === undefined || params === null) return text;
    return text.replace(/\{(\w+)\}/gu, (match, name) =>
      Object.hasOwn(params, name) ? String(params[name]) : match,
    );
  }

  /**
   * Translate one key. `moduleId` null means the core dictionary.
   * @param {string|null} moduleId
   * @param {string} key
   * @param {Record<string, unknown>} [params]
   */
  function t(moduleId, key, params) {
    const active = language();
    let text = moduleId === null ? undefined : lookup(modules.get(moduleId), active, key);
    if (text === undefined) text = lookup(dictionaries, active, key);
    if (text === undefined) return key;
    return interpolate(text, params);
  }

  function add(moduleId, table) {
    if (modules.has(moduleId)) {
      throw new Error(`dsh-quick-switcher: locale for module "${moduleId}" is already registered`);
    }
    modules.set(moduleId, table);
    emit();
    return () => {
      modules.delete(moduleId);
      emit();
    };
  }

  function subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function emit() {
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch (error) {
        console.error("[dsh-quick-switcher] locale listener failed", error);
      }
    }
  }

  return { t, add, subscribe, language };
}
