/* Prompt history derived from the session's loaded chat window. */

/**
 * DSH keeps no prompt history of its own: the only user-authored text on the
 * client lives in the chat nodes, and those nodes cover just the window the
 * session controller has loaded. The history route therefore projects the
 * nodes it is given instead of maintaining a second storage, so a prompt that
 * falls out of the window simply disappears until `loadOlder` brings it back.
 */

/**
 * Rows the panel renders at most. One loaded window holds a few hundred
 * messages, and a history list is a pick surface rather than a transcript
 * browser; a cap keeps an empty query from building an unbounded list.
 */
export const HISTORY_LIMIT = 200;

/**
 * Characters of one prompt used for the list. Matching runs over this preview
 * as well, because a fuzzy pass over every full prompt would cost more than a
 * keystroke should; the complete text is still what lands in the input.
 */
export const HISTORY_PREVIEW_LIMIT = 240;

/**
 * Phases in which the conversation input owns the draft and refuses edits.
 * `setDraft` itself does not check them, so the panel must ask before writing;
 * the route and the bridge store share this predicate to stay in sync.
 */
export function isInputFrozen(phase) {
  return phase === "adjudicating" || phase === "submitting" || phase === "sending";
}

/** Join the text blocks of one message; images and files carry no text. */
function messageText(content) {
  if (!Array.isArray(content)) return "";
  const parts = [];
  for (const block of content) {
    if (block !== null && typeof block === "object" && block.type === "text") {
      if (typeof block.text === "string") parts.push(block.text);
    }
  }
  return parts.join("\n").trim();
}

/**
 * Project one chat window into chronological prompts.
 *
 * `order` is the presentation order of the loaded window, so iteration keeps
 * oldest first. Only `user` and `steering` nodes count as human prompts: the
 * compacted context, developer messages, and subagent traffic all share the
 * `user/message` event but project a different node kind. The source guard is
 * the same one DSH uses, so a remote client's prompt stays included while
 * injected context is not.
 *
 * Messages whose text blocks are empty are skipped: an attachment-only prompt
 * cannot be written back, and selecting it would leave the input unchanged.
 */
export function collectPrompts(order, nodes) {
  const prompts = [];
  if (!Array.isArray(order) || typeof nodes?.get !== "function") return prompts;
  for (const key of order) {
    const node = nodes.get(key);
    if (node === null || node === undefined) continue;
    if (node.kind !== "user" && node.kind !== "steering") continue;
    const data = node.data;
    if (data === null || typeof data !== "object") continue;
    if (data.source?.kind !== "user") continue;
    const text = messageText(data.content);
    if (text === "") continue;
    prompts.push({
      key: String(node.key ?? key),
      seq: Number.isFinite(data.seq) ? data.seq : 0,
      time: Number.isFinite(data.time) ? data.time : 0,
      kind: node.kind,
      text,
    });
  }
  return prompts;
}

/** Collapse whitespace and clip one prompt to its single-line list preview. */
export function previewPrompt(text, limit = HISTORY_PREVIEW_LIMIT) {
  const normalized = String(text ?? "")
    .replace(/\s+/gu, " ")
    .trim();
  if (normalized === "") return "";
  return normalized.length > limit ? normalized.slice(0, limit) : normalized;
}

/**
 * Build the searchable rows, newest first.
 *
 * Only adjacent duplicates collapse: sending the same prompt twice in a row is
 * usually a retry, but the same text separated by another prompt is a real
 * entry of its own. The cap applies after collapsing so a run of retries does
 * not eat the whole list.
 */
export function historyEntries(prompts, limit = HISTORY_LIMIT) {
  const rows = [];
  if (!Array.isArray(prompts) || prompts.length === 0) return rows;
  const cap = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : HISTORY_LIMIT;
  let previous = null;
  for (let index = prompts.length - 1; index >= 0; index -= 1) {
    const prompt = prompts[index];
    if (prompt === null || typeof prompt !== "object") continue;
    if (previous !== null && previous === prompt.text) continue;
    previous = prompt.text;
    const title = previewPrompt(prompt.text);
    if (title === "") continue;
    rows.push({
      ...prompt,
      title,
      titleLower: title.toLocaleLowerCase(),
      metaLower: "",
    });
    if (rows.length >= cap) break;
  }
  return rows;
}
