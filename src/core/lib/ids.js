/* Canonical form of a session id, shared by the row display and the search. */

/**
 * Characters a query needs before it may match a session id.
 *
 * DSH mints ids as `session-<uuid>`, and a uuid only contains 0-9a-f, so a
 * one-letter query would prefix-match a large share of the session list and
 * drown the title hits the switcher exists for. Four characters also cover the
 * first half of the short code a row shows, which is what a user retypes.
 */
export const ID_PREFIX_MIN = 4;

/** Length of the short code the session row shows next to the time. */
export const SHORT_ID_LENGTH = 8;

/**
 * The comparison key of one session id.
 *
 * The id arrives as `session-<uuid>`, but the part a user copies from a row or
 * a log is the uuid, and people paste it with or without hyphens. Dropping the
 * prefix and every hyphen therefore lets a full copy, a bare uuid, and the
 * visible short code share one prefix comparison. An id without the DSH prefix
 * keeps its own characters, so custom ids still key on themselves.
 */
export function idKeyOf(value) {
  const text = String(value ?? "")
    .trim()
    .toLocaleLowerCase();
  const bare = text.startsWith("session-") ? text.slice("session-".length) : text;
  return bare.replace(/[\s-]+/gu, "");
}

/**
 * The short code displayed under a session title.
 *
 * Only keys long enough to be searched get a code, so every code a row shows
 * can actually be typed into the input; a custom id shorter than the match
 * floor renders no code instead of an unsearchable fragment.
 */
export function shortIdOf(value) {
  const key = idKeyOf(value);
  return key.length >= ID_PREFIX_MIN ? key.slice(0, SHORT_ID_LENGTH) : "";
}
