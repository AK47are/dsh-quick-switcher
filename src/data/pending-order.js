/* The two orders the pending group can take. */

/**
 * The default. Sessions the plugin has never shown come first, ordered by
 * their session activity; the sessions the user has already opened queue
 * behind them by their oldest visit. Both keys ascend, so opening a row can
 * only move it down. That is what keeps one pending session the user cannot
 * act on from pushing the others out of the way.
 */
export const PENDING_ORDER_LEAST_RECENT = "least-recent";

/**
 * The rule every other status group uses: the newest visit first, with
 * `updatedAt` standing in for a session the plugin never observed.
 */
export const PENDING_ORDER_MOST_RECENT = "most-recent";

/**
 * Normalize a stored or passed value.
 *
 * The preference is read from a browser document that older versions wrote
 * without this field, and callers pass nothing when they want the default, so
 * one function owns the fallback instead of every reader repeating it.
 * @param {unknown} value
 * @returns {string} one of the two order ids
 */
export function pendingOrderOf(value) {
  return value === PENDING_ORDER_MOST_RECENT
    ? PENDING_ORDER_MOST_RECENT
    : PENDING_ORDER_LEAST_RECENT;
}
