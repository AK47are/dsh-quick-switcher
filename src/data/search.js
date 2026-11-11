/* Ranking and highlight positions for one search field. */

export const RESULT_LIMIT = 50;

/** Return the character positions of `term` in `text`, or null. */
export function matchPositions(text, term) {
  const direct = text.indexOf(term);
  if (direct >= 0) {
    const positions = [];
    for (let index = 0; index < term.length; index += 1) positions.push(direct + index);
    return positions;
  }
  const positions = [];
  let cursor = 0;
  for (const character of term) {
    const found = text.indexOf(character, cursor);
    if (found < 0) return null;
    positions.push(found);
    cursor = found + character.length;
  }
  return positions;
}

/** Score one field for a term, including a small prefix bonus. */
export function matchField(text, term) {
  const direct = text.indexOf(term);
  if (direct >= 0) {
    return {
      score: 120 - Math.min(direct, 40) + (direct === 0 ? 30 : 0),
      positions: matchPositions(text, term),
    };
  }
  const positions = matchPositions(text, term);
  if (positions === null) return null;
  const span = positions[positions.length - 1] - positions[0] + 1;
  return {
    score: 70 - Math.min(span - term.length, 30) - Math.min(positions[0], 20),
    positions,
  };
}

/**
 * Filter and rank rows. Every whitespace-separated term must match the title
 * or the metadata, so "dsh fix" keeps only entries that mention both. Title
 * matches score three times higher and contribute highlight positions; a
 * metadata-only match never moves the title highlight.
 */
export function filterEntries(entries, query) {
  const terms = String(query ?? "")
    .trim()
    .toLocaleLowerCase()
    .split(/\s+/u)
    .filter((term) => term !== "");
  if (terms.length === 0) {
    return entries.slice(0, RESULT_LIMIT).map((entry) => ({ entry, positions: null }));
  }

  const matched = [];
  for (const entry of entries) {
    let score = 0;
    const positions = new Set();
    let matchedAll = true;
    for (const term of terms) {
      const titleMatch = matchField(entry.titleLower, term);
      if (titleMatch !== null) {
        score += titleMatch.score * 3;
        for (const position of titleMatch.positions) positions.add(position);
        continue;
      }
      const metaMatch = matchField(entry.metaLower, term);
      if (metaMatch !== null) {
        score += metaMatch.score;
        continue;
      }
      matchedAll = false;
      break;
    }
    if (!matchedAll) continue;
    score += Math.min(entry.updatedAt / 1e12, 1);
    matched.push({ entry, positions, score });
  }
  matched.sort(
    (left, right) =>
      right.score - left.score || right.entry.updatedAt - left.entry.updatedAt,
  );
  return matched
    .slice(0, RESULT_LIMIT)
    .map((row) => ({ entry: row.entry, positions: row.positions }));
}
