/**
 * Resolve the mode the general open command should enter.
 *
 * The stored preference is a module id, but a stored id may outlive the module
 * it names: an external module can unregister, or the user can switch the
 * module off. Neither case rewrites the preference, because silently replacing
 * a user's choice would make it impossible to restore the original one by
 * switching the module back on. The helper reports the effective choice and
 * whether the caller may use its seed; a disabled or missing choice yields an
 * empty seed, which the panel shows as its default (or empty) list.
 *
 * @param {Array<{ id: string, isEnabled: boolean, entry: object|null }>} modules
 * @param {string|null} storedId module id recorded in settings, null when never chosen
 * @returns {{ moduleId: string|null, entry: object|null, isEnabled: boolean, seed: string }}
 */
export function resolveDefaultMode(modules, storedId) {
  const entries = modules.filter(
    (module) => module.entry !== null && module.entry !== undefined,
  );
  if (entries.length === 0) {
    return { moduleId: null, entry: null, isEnabled: false, seed: "" };
  }
  const chosen =
    storedId === null || storedId === undefined
      ? entries[0]
      : entries.find((module) => module.id === storedId) ?? null;
  if (chosen === null) {
    return { moduleId: storedId ?? null, entry: null, isEnabled: false, seed: "" };
  }
  const isEnabled = chosen.isEnabled !== false;
  return {
    moduleId: chosen.id,
    entry: chosen.entry,
    isEnabled,
    seed: isEnabled ? chosen.entry.seed : "",
  };
}

/**
 * Pick the query a panel open starts from.
 *
 * An explicit string seed always wins, including the empty string: a command
 * or another plugin that asked for the default list must not be redirected by
 * the user's default-mode preference. Only a missing or non-string seed falls
 * back to the preference.
 *
 * @param {{ seed?: unknown }|undefined} options
 * @param {Array<{ id: string, isEnabled: boolean, entry: object|null }>} modules
 * @param {string|null} storedId
 */
export function seedForOpen(options, modules, storedId) {
  if (typeof options?.seed === "string") return options.seed;
  return resolveDefaultMode(modules, storedId).seed;
}
