/* Translator handed to the renderer of one content view or footer. */

/**
 * Build the translator a content view or footer receives.
 *
 * A view kind belongs to the module that registered it, so its copy lives in
 * that module's dictionary and `translate` is the function that resolves it.
 * The shared dictionary stays the fallback inside `translate`, which is why
 * keys such as the close hint still resolve from a module view. A missing view
 * keeps the shell's own translator so the fallback message still renders.
 */
export function viewTranslator(translate, fallback, lookup) {
  if (lookup === null) return fallback;
  return (key, params) => translate(lookup.moduleId, key, params);
}
