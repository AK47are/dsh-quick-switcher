/* Alt+digit row targeting, kept free of React so it can be unit tested. */

/**
 * Map an Alt+digit keydown to the zero-based row it selects.
 *
 * The panel numbers only the first nine rows, so `Digit0` and every other digit
 * return null. The physical key is the source of truth: `code` still names the
 * number row on layouts where a digit needs Shift, and on macOS where Alt+digit
 * types a symbol. Numpad digits are deliberately excluded because Windows
 * composes Alt+Numpad into a character at the OS level.
 *
 * Ctrl and Meta reject the combination so AltGr, which arrives as Ctrl+Alt,
 * keeps its normal text-input meaning. Shift is not consulted at all: layouts
 * such as AZERTY need Shift for a plain digit, and treating that as an
 * alternate action would fire the wrong row action.
 *
 * Real keyboard events always carry `code`; the `key` fallback only covers
 * synthetic events that omit it, and it is never used when a non-matching code
 * is present, otherwise Numpad1 would pass.
 */
export function digitRowIndex(event) {
  if (event === null || typeof event !== "object") return null;
  if (event.altKey !== true) return null;
  if (event.ctrlKey === true || event.metaKey === true) return null;

  const code = typeof event.code === "string" ? event.code : "";
  const match = /^Digit([1-9])$/u.exec(code);
  if (match !== null) return Number(match[1]) - 1;
  if (code !== "") return null;

  const key = event.key;
  if (typeof key !== "string" || !/^[1-9]$/u.test(key)) return null;
  return Number(key) - 1;
}

/**
 * Format the visible hint for one jump target.
 *
 * The hint mirrors the labels DSH already produced for the same platform
 * instead of inventing a second key style: Windows separates the modifier from
 * the digit with the same "+" entry used between bound keys, macOS uses the
 * Option symbol, and Linux keeps the two adjacent. An unknown platform keeps
 * the old "Alt 1" spelling rather than guessing a separator.
 *
 * @param {"windows"|"macos"|"linux"|undefined} platform - receiving device.
 * @param {number} digit - one-based row number, 1 through 9.
 * @returns {string[]} chip tokens; "+" is punctuation, not a key.
 */
export function jumpKeys(platform, digit) {
  const number = String(digit);
  if (platform === "macos") return ["⌥", number];
  if (platform === "windows") return ["Alt", "+", number];
  return ["Alt", number];
}
