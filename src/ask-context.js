/* Read-only background captured from the pending interaction card. */

/**
 * Bound the visible card before it reaches the request.
 *
 * The host accepts more, but the card is only a supplement to the structured
 * question: a long tool output must not crowd the conversation snapshot out of
 * the model window, and the panel should never send a payload it cannot show.
 */
const MAX_CONTEXT_CHARS = 8000;

/**
 * Build the background for the interaction the shown session is waiting on.
 *
 * The side request carries plain text only, so the approval command and the
 * tool call are gone. The structured pending object and the visible card are
 * therefore the only way the model learns what the user is looking at. The text
 * is labelled read-only by the host later; nothing here is trusted as an
 * instruction.
 *
 * `pending` is DSH's unified status value for the current session. It is read
 * from the same source the sidebar uses, so a new interaction kind shows up
 * here as soon as DSH reports it.
 */
export function buildPendingContext(pending, t, sessionId) {
  if (pending === null || pending === undefined || typeof pending !== "object") {
    return null;
  }
  const kind = pending.kind;
  if (kind === "approval") {
    const lines = ["Pending interaction: approval"];
    const toolName = typeof pending.toolName === "string" ? pending.toolName.trim() : "";
    if (toolName !== "") lines.push(`Tool: ${toolName}`);
    const reason = typeof pending.reason === "string" ? pending.reason.trim() : "";
    const body = readCardText(sessionId, "[data-approval-scroll]");
    if (reason !== "") lines.push(`Reason: ${reason}`);
    if (body !== "") lines.push("Visible content:", body);
    return {
      text: clipContext(lines.join("\n")),
      label: `${t("askContextApproval")}${toolName === "" ? "" : ` · ${toolName}`}`,
    };
  }
  if (kind === "question" || kind === "plan-review") {
    const label = kind === "question" ? t("askContextQuestion") : t("askContextPlanReview");
    const lines = [
      `Pending interaction: ${kind === "question" ? "question" : "plan review"}`,
    ];
    const questions = formatQuestions(pending.questions);
    if (questions !== "") {
      lines.push(questions);
    } else {
      const body = readCardText(
        sessionId,
        kind === "question" ? "[data-question-scroll]" : "[data-plan-review-key]",
      );
      if (body !== "") lines.push("Visible content:", body);
    }
    return { text: clipContext(lines.join("\n")), label };
  }
  return null;
}

/**
 * Render the structured question list the card is built from.
 *
 * This is preferred over the card text because the card drops detail while
 * collapsing options, and because the structured copy does not depend on which
 * tab or accordion happens to be open.
 */
function formatQuestions(questions) {
  if (!Array.isArray(questions) || questions.length === 0) return "";
  const lines = [];
  for (let index = 0; index < questions.length; index += 1) {
    const question = questions[index];
    if (question === null || typeof question !== "object") continue;
    lines.push(`Question ${index + 1}:`);
    if (typeof question.header === "string" && question.header.trim() !== "") {
      lines.push(`Header: ${question.header.trim()}`);
    }
    if (typeof question.question === "string" && question.question.trim() !== "") {
      lines.push(`Question: ${question.question.trim()}`);
    }
    if (typeof question.detail === "string" && question.detail.trim() !== "") {
      lines.push(`Detail: ${question.detail.trim()}`);
    }
    const options = Array.isArray(question.options) ? question.options : [];
    if (options.length > 0) lines.push("Options:");
    for (let optionIndex = 0; optionIndex < options.length; optionIndex += 1) {
      const option = options[optionIndex];
      if (option === null || typeof option !== "object") continue;
      const label = typeof option.label === "string" ? option.label : "";
      const description = typeof option.description === "string" ? option.description : "";
      if (label === "" && description === "") continue;
      lines.push(
        `${optionIndex + 1}. ${label}${description === "" ? "" : `: ${description}`}`,
      );
    }
  }
  return lines.join("\n");
}

/**
 * Read the visible body of the pending card inside the shown session.
 *
 * Retained conversations keep their own pending cards mounted but hidden, so a
 * document-wide query could read a different session's card. The scope is the
 * conversation root carrying this session id, preferring the visible one.
 */
function readCardText(sessionId, selector) {
  try {
    let scope = null;
    for (const node of document.querySelectorAll("[data-conversation-session]")) {
      if (node.getAttribute("data-conversation-session") !== sessionId) continue;
      if (
        scope === null ||
        (scope.getClientRects().length === 0 && node.getClientRects().length > 0)
      ) {
        scope = node;
      }
    }
    if (scope === null) return "";
    const card = scope.querySelector(selector);
    if (card === null) return "";
    const inner = typeof card.innerText === "string" ? card.innerText : "";
    if (inner.trim() !== "") return inner.trim();
    return typeof card.textContent === "string" ? card.textContent.trim() : "";
  } catch {
    // A missing card is not an error: the question is still worth asking, it
    // just travels without background.
    return "";
  }
}

/** Truncate the background with a marker the model and the reader can see. */
function clipContext(text) {
  if (text.length <= MAX_CONTEXT_CHARS) return text;
  return `${text.slice(0, MAX_CONTEXT_CHARS)}\n……（背景已截断）`;
}
