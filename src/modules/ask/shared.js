/* Protocol shared by the ask client and its host half. */

export const ASK_PATH = "/dsh-quick-switcher/ask";
export const FORK_PATH = "/dsh-quick-switcher/fork";

export const UNLOADED_MESSAGE = "dsh-quick-switcher was unloaded";

/** SSE event names; both halves must agree on every one. */
export const ASK_EVENTS = Object.freeze({
  start: "start",
  delta: "delta",
  usage: "usage",
  finish: "finish",
  done: "done",
  error: "error",
});
