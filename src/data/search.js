/* Whole-query fuzzy ranking shared by every route. */

export const RESULT_LIMIT = 50;

/**
 * Score gap between a primary-field match and a secondary-field match.
 *
 * The fallback only decides whether a row appears at all when its title does
 * not match; it must never let a workspace or alias hit outrank a real title
 * hit, so the constant is far larger than any possible fuzzy score.
 */
const SECONDARY_PENALTY = 10000;

const MATCH = 10;
const ADJACENT = 12;
const BOUNDARY = 14;
const GAP = 1;
const LATE_START = 1;
const LATE_START_CAP = 20;

/** True for characters that can continue a word inside a title, path, or id. */
function isWordChar(character) {
  return /[\p{L}\p{N}_]/u.test(character);
}

/**
 * Lowercase text and drop whitespace, keeping a map back to the original
 * indexes. Queries and candidates both go through this step, so spaces never
 * decide whether one typo-free phrase matches another.
 */
function compact(text) {
  const source = String(text ?? "");
  const characters = [];
  const indexes = [];
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (/\s/u.test(character)) continue;
    characters.push(character.toLocaleLowerCase());
    indexes.push(index);
  }
  return { source, characters, indexes };
}

/**
 * Best subsequence alignment of `needle` inside one compacted candidate.
 *
 * Consecutive characters and word starts score higher; every skipped
 * character and a late first match cost a little. The first row scores every
 * legal start, and each later row keeps the best prefix score in O(1), so the
 * whole match is O(needle length * candidate length). Backpointers are kept
 * only to reconstruct highlight positions for the winning alignment.
 */
function matchCompact(haystack, needle) {
  const n = haystack.characters.length;
  const m = needle.length;
  if (m === 0) return { score: 0, positions: [] };
  if (m > n) return null;

  const boundary = new Uint8Array(n);
  for (let index = 0; index < n; index += 1) {
    const at = haystack.indexes[index];
    boundary[index] =
      at === 0 || !isWordChar(haystack.source[at - 1]) ? 1 : 0;
  }

  const backs = Array.from({ length: m }, () => new Int32Array(n).fill(-1));
  let previous = new Float64Array(n).fill(Number.NEGATIVE_INFINITY);
  let bestEnd = -1;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (let index = 0; index < n; index += 1) {
    if (haystack.characters[index] !== needle[0]) continue;
    const score =
      MATCH +
      boundary[index] * BOUNDARY -
      Math.min(index, LATE_START_CAP) * LATE_START;
    previous[index] = score;
    if (score > bestScore) {
      bestScore = score;
      bestEnd = index;
    }
  }
  if (bestEnd < 0) return null;

  for (let level = 1; level < m; level += 1) {
    const current = new Float64Array(n).fill(Number.NEGATIVE_INFINITY);
    let bestPrefix = Number.NEGATIVE_INFINITY;
    let bestPrefixAt = -1;
    bestScore = Number.NEGATIVE_INFINITY;
    bestEnd = -1;

    for (let index = 0; index < n; index += 1) {
      const before = index - 1;
      if (before >= 0 && previous[before] !== Number.NEGATIVE_INFINITY) {
        const value = previous[before] + before * GAP;
        if (value > bestPrefix) {
          bestPrefix = value;
          bestPrefixAt = before;
        }
      }
      if (haystack.characters[index] !== needle[level]) continue;

      let score = Number.NEGATIVE_INFINITY;
      let back = -1;
      if (bestPrefix !== Number.NEGATIVE_INFINITY) {
        score =
          bestPrefix -
          (index - 1) * GAP +
          MATCH +
          boundary[index] * BOUNDARY;
        back = bestPrefixAt;
      }
      if (before >= 0 && previous[before] !== Number.NEGATIVE_INFINITY) {
        const adjacent =
          previous[before] + MATCH + ADJACENT + boundary[index] * BOUNDARY;
        if (adjacent > score) {
          score = adjacent;
          back = before;
        }
      }
      if (score === Number.NEGATIVE_INFINITY) continue;

      current[index] = score;
      backs[level][index] = back;
      if (score > bestScore) {
        bestScore = score;
        bestEnd = index;
      }
    }

    if (bestEnd < 0) return null;
    previous = current;
  }

  const positions = [];
  let index = bestEnd;
  for (let level = m - 1; level >= 0; level -= 1) {
    positions.push(haystack.indexes[index]);
    index = backs[level][index];
  }
  positions.reverse();
  return { score: bestScore, positions };
}

/**
 * Match one query as a whole against one candidate.
 *
 * Whitespace is ignored on both sides, so "fix par" matches "fixparser" and
 * the other way around. Returns the highlight indexes into the original text,
 * or null when the query is not a subsequence.
 */
export function fuzzyMatch(text, query) {
  return matchCompact(compact(text), compact(query).characters);
}

/**
 * Filter and rank rows for one query.
 *
 * The query is one fuzzy sequence rather than a list of terms. `titleLower`
 * is the primary field: a hit there keeps its highlight positions. A row whose
 * primary field misses still participates when `metaLower` (workspace, path,
 * or command aliases) matches, at a fixed penalty and without a title
 * highlight. Empty input keeps the route's own order; every route supplies its
 * base order before calling this function.
 */
export function filterEntries(entries, query) {
  const trimmed = String(query ?? "").trim();
  if (trimmed === "") {
    return entries
      .slice(0, RESULT_LIMIT)
      .map((entry) => ({ entry, positions: null }));
  }

  const needle = compact(trimmed).characters;
  if (needle.length === 0) {
    return entries
      .slice(0, RESULT_LIMIT)
      .map((entry) => ({ entry, positions: null }));
  }

  const matched = [];
  for (const entry of entries) {
    const primary = matchCompact(
      compact(entry.titleLower ?? entry.title ?? ""),
      needle,
    );
    if (primary !== null) {
      matched.push({
        entry,
        positions: new Set(primary.positions),
        score: primary.score,
      });
      continue;
    }
    const secondary = matchCompact(compact(entry.metaLower ?? ""), needle);
    if (secondary !== null) {
      matched.push({
        entry,
        positions: new Set(),
        score: secondary.score - SECONDARY_PENALTY,
      });
    }
  }
  matched.sort((left, right) => right.score - left.score);
  return matched
    .slice(0, RESULT_LIMIT)
    .map(({ entry, positions }) => ({ entry, positions }));
}
