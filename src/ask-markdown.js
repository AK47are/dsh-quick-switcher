/* Small Markdown renderer for one side-question answer. */

import React from "react";

const h = React.createElement;

/**
 * Inline code, bold, and http(s) links are the only interpreted syntax; every
 * other character stays literal, so no HTML is ever injected. The pattern is
 * applied per text run rather than per document, which keeps a stray backtick
 * from swallowing the rest of the answer.
 */
const INLINE_PATTERN = /(`[^`\n]+`|\*\*[^*\n]+\*\*|\[[^\]\n]+\]\(https?:\/\/[^)\s]+\))/g;

function renderInline(text) {
  const nodes = [];
  let index = 0;
  let key = 0;
  let match;
  INLINE_PATTERN.lastIndex = 0;
  while ((match = INLINE_PATTERN.exec(text)) !== null) {
    if (match.index > index) nodes.push(text.slice(index, match.index));
    const token = match[0];
    if (token.startsWith("`")) {
      nodes.push(
        h("code", { key: key++, className: "dqs-ask-inline-code" }, token.slice(1, -1)),
      );
    } else if (token.startsWith("**")) {
      nodes.push(h("strong", { key: key++ }, token.slice(2, -2)));
    } else {
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
      nodes.push(
        h(
          "a",
          {
            key: key++,
            href: link[2],
            target: "_blank",
            rel: "noreferrer noopener",
            className: "dqs-ask-link",
          },
          link[1],
        ),
      );
    }
    index = match.index + token.length;
  }
  if (index < text.length) nodes.push(text.slice(index));
  return nodes.length === 0 ? [text] : nodes;
}

/**
 * Split one plain-text chunk into headings, lists, quotes, and paragraphs.
 *
 * Paragraph lines are joined with a space, which is what Markdown soft breaks
 * mean; lists keep one line per item so a model that wraps a numbered answer
 * still renders one row per step.
 */
function renderTextBlock(chunk, keyBase) {
  const lines = chunk.split("\n");
  const out = [];
  let paragraph = [];
  let index = 0;
  const flush = () => {
    if (paragraph.length === 0) return;
    out.push(
      h(
        "p",
        { key: keyBase + out.length, className: "dqs-ask-p" },
        renderInline(paragraph.join(" ")),
      ),
    );
    paragraph = [];
  };
  while (index < lines.length) {
    const line = lines[index];
    if (line.trim() === "") {
      flush();
      index += 1;
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading !== null) {
      flush();
      // Answers live inside a card whose title is the question, so Markdown
      // levels shift down: an h1 in the answer is an h3 on the page.
      const level = Math.min(6, heading[1].length + 2);
      out.push(
        h(
          `h${level}`,
          { key: keyBase + out.length, className: "dqs-ask-h" },
          renderInline(heading[2]),
        ),
      );
      index += 1;
      continue;
    }
    if (/^\s*[-*+]\s+/.test(line)) {
      flush();
      const items = [];
      while (index < lines.length && /^\s*[-*+]\s+/.test(lines[index])) {
        items.push(
          h(
            "li",
            { key: items.length },
            renderInline(lines[index].replace(/^\s*[-*+]\s+/, "")),
          ),
        );
        index += 1;
      }
      out.push(
        h("ul", { key: keyBase + out.length, className: "dqs-ask-list" }, items),
      );
      continue;
    }
    if (/^\s*\d+[.)]\s+/.test(line)) {
      flush();
      const items = [];
      while (index < lines.length && /^\s*\d+[.)]\s+/.test(lines[index])) {
        items.push(
          h(
            "li",
            { key: items.length },
            renderInline(lines[index].replace(/^\s*\d+[.)]\s+/, "")),
          ),
        );
        index += 1;
      }
      out.push(
        h("ol", { key: keyBase + out.length, className: "dqs-ask-list" }, items),
      );
      continue;
    }
    if (/^>\s?/.test(line)) {
      flush();
      const quoted = [];
      while (index < lines.length && /^>\s?/.test(lines[index])) {
        quoted.push(lines[index].replace(/^>\s?/, ""));
        index += 1;
      }
      out.push(
        h(
          "blockquote",
          { key: keyBase + out.length, className: "dqs-ask-quote" },
          renderInline(quoted.join(" ")),
        ),
      );
      continue;
    }
    paragraph.push(line.trim());
    index += 1;
  }
  flush();
  return out;
}

/**
 * Render one answer. Fenced blocks stay literal and are cut out first, so the
 * text between fences is the only part the block parser ever sees.
 */
export function renderMarkdown(text) {
  const out = [];
  const fence = /```([^\n`]*)\n?([\s\S]*?)```/g;
  let index = 0;
  let key = 0;
  let match;
  while ((match = fence.exec(text)) !== null) {
    if (match.index > index) {
      out.push(...renderTextBlock(text.slice(index, match.index), key));
      key += 1000;
    }
    out.push(h("pre", { key: key++, className: "dqs-ask-pre" }, h("code", null, match[2])));
    index = match.index + match[0].length;
  }
  if (index < text.length) out.push(...renderTextBlock(text.slice(index), key));
  return out;
}
