/**
 * Lossy, deterministic model-input selection, not a failure classifier.
 * Keep the original log separately; selectedLines refers to that original text.
 */
export const INPUT_PREPARATION_VERSION = 'diagnostic-lines-v1';

const MAX_CHARACTERS = 1_000;
const LINE_MARKER = ' […] ';
const GAP_MARKER = '[…]';
const NOISE_PREFIX = /^\s*(?:(?:\[[^\]\r\n]*\]|\S*\d\S*)\s+)?(?:DEBUG|TRACE)\b/i;
const DIAGNOSTICS = [
  // Syntax cues only. No incident IDs, known diagnoses, or fix vocabulary.
  { weight: 5, pattern: /\bE[A-Z][A-Z0-9_]{2,}\b/g },
  { weight: 5, pattern: /\b(?:FATAL|caused[ -]by|error[ _-]?code)\b/gi },
  { weight: 4, pattern: /\b(?:[\w.]*Error|[\w.]*Exception|errors?|exceptions?|fail(?:ed|ure|ures)?)\b/gi },
  { weight: 3, pattern: /\b(?:expected|actual|received|assertion)\b/gi },
];

function diagnostic(line) {
  let weight = 0;
  let anchor = -1;
  const noise = NOISE_PREFIX.test(line);
  for (const rule of DIAGNOSTICS) {
    rule.pattern.lastIndex = 0;
    for (const match of line.matchAll(rule.pattern)) {
      // A DEBUG line mentioning "assertion" or "error handling" is not itself
      // a failure. Still keep an explicit code or labelled diagnostic there.
      if (noise && rule.weight < 5 && !/\b(?:error|exception|failure|fatal)\s*:/i.test(line)) continue;
      if (rule.weight > weight || (rule.weight === weight && match.index > anchor)) {
        weight = rule.weight;
        anchor = match.index;
      }
    }
  }
  return { weight, anchor };
}

function cropLine(line, budget, anchor = -1) {
  if (line.length <= budget) return line;
  // Include the beginning and end even on unstructured, single-line logs.
  // A diagnostic in the middle gets its own literal window, not a rewrite.
  const prefix = Math.min(64, Math.floor(budget / 3));
  const suffix = Math.min(64, Math.floor(budget / 3));
  const middle = budget - prefix - suffix - LINE_MARKER.length * 2;
  const center = anchor < 0 ? prefix : Math.max(0, anchor - 24);
  const ranges = [[0, prefix], [center, Math.min(line.length, center + middle)], [line.length - suffix, line.length]];
  ranges.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const [start, end] of ranges) {
    const previous = merged.at(-1);
    if (previous && start <= previous[1]) previous[1] = Math.max(previous[1], end);
    else merged.push([start, end]);
  }
  return merged.map(([start, end]) => {
    // Do not turn a valid surrogate pair into malformed Unicode at a cut.
    const high = (index) => line.charCodeAt(index) >= 0xd800 && line.charCodeAt(index) <= 0xdbff;
    const low = (index) => line.charCodeAt(index) >= 0xdc00 && line.charCodeAt(index) <= 0xdfff;
    if (low(start) && high(start - 1)) start += 1;
    if (high(end - 1) && low(end)) end -= 1;
    return line.slice(start, end);
  }).join(LINE_MARKER);
}

function render(selected, lineCount) {
  const entries = [...selected].sort((a, b) => a[0] - b[0]);
  const pieces = [];
  let previous = 0;
  for (const [number, text] of entries) {
    if (number > previous + 1) pieces.push(GAP_MARKER);
    pieces.push(text);
    previous = number;
  }
  if (previous < lineCount) pieces.push(GAP_MARKER);
  return pieces.join('\n');
}

/**
 * @param {string} text Original plain text (redact/normalize separately).
 * @returns {{text: string, selectedLines: number[], truncated: boolean, originalLength: number}}
 * selectedLines uses 1-based original line numbers, in source order. A selected
 * line may itself be cropped with an explicit […] marker. originalLength and
 * the 1,000-character limit count JavaScript UTF-16 code units, not model tokens.
 */
export function prepareSemanticText(text) {
  if (typeof text !== 'string') throw new TypeError('prepareSemanticText expects a string.');
  const lines = text === '' ? [] : text.split(/\r\n|\r|\n/);
  if (text.length <= MAX_CHARACTERS) {
    return { text, selectedLines: lines.map((_, index) => index + 1), truncated: false, originalLength: text.length };
  }

  const records = lines.map((value, index) => ({ value, number: index + 1, ...diagnostic(value) }));
  const selected = new Map();
  const selectedValues = new Map();
  function add(record, budget = 320) {
    if (!record || !record.value.trim()) return false;
    const key = record.value.trim();
    if (selectedValues.has(key) && selectedValues.get(key) !== record.number) return false;
    const existing = selected.get(record.number);
    let excerpt = cropLine(record.value, budget, record.anchor);
    selected.set(record.number, excerpt);
    const excess = render(selected, lines.length).length - MAX_CHARACTERS;
    if (excess > 0 && budget - excess >= 80) {
      excerpt = cropLine(record.value, budget - excess, record.anchor);
      selected.set(record.number, excerpt);
    }
    if (render(selected, lines.length).length > MAX_CHARACTERS) {
      if (existing === undefined) selected.delete(record.number);
      else selected.set(record.number, existing);
      return false;
    }
    selectedValues.set(key, record.number);
    return true;
  }

  // Reserve a compact orientation line, then give useful late diagnostics the
  // budget before incidental stack frames or repeated initialization chatter.
  add(records.find((record) => record.value.trim()), 160);
  const diagnostics = records.filter((record) => record.weight > 0)
    .sort((a, b) => b.weight - a.weight || b.number - a.number);
  const retainedDiagnostics = [];
  for (const record of diagnostics) {
    if (add(record)) retainedDiagnostics.push(record);
    if (retainedDiagnostics.length >= 6) break;
  }
  // Context adjacent to a retained failure often contains an assertion value
  // or explanation. Do not fill unused space with DEBUG/TRACE boilerplate.
  for (const record of retainedDiagnostics) {
    const next = records[record.number];
    if (next && !selected.has(next.number) && !NOISE_PREFIX.test(next.value)) add(next, 180);
  }
  for (const record of records.slice().reverse().filter((record) => record.value.trim() && !NOISE_PREFIX.test(record.value)).slice(0, 2)) {
    if (!selected.has(record.number)) add(record, 180);
  }

  return {
    text: render(selected, lines.length),
    selectedLines: [...selected.keys()].sort((a, b) => a - b),
    truncated: true,
    originalLength: text.length,
  };
}
