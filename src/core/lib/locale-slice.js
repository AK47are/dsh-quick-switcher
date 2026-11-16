/**
 * Copy only the keys a module's own dictionary needs.
 *
 * During the migration the dictionaries still live in the old shared file;
 * each module slices the keys it owns so its locale contribution is already
 * scoped to the module. The old file disappears in the last stage and the
 * sliced strings move into the module unchanged.
 */
export function pickLocale(zh, en, keys) {
  return { zh: pick(zh, keys), en: pick(en, keys) };
}

function pick(dictionary, keys) {
  const next = {};
  for (const key of keys) {
    if (Object.hasOwn(dictionary, key)) next[key] = dictionary[key];
  }
  return next;
}
