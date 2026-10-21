/**
 * Groundhog's dependency-free failure memory engine.
 *
 * Similarity is a ranking signal, not a probability or verification of a fix.
 * This module never executes commands or automatically applies a stored fix.
 */

import { RETRIEVAL_POLICY } from './retrieval-policy.js';

export const ENGINE_LIMITS = Object.freeze({
  maxInputBytes: 2 * 1024 * 1024,
  maxTextLength: 100_000,
  maxFailures: 10_000,
  maxIncidents: 5_000,
  maxXmlDepth: 64,
  maxXmlNodes: 50_000,
  maxVectorDimensions: 16_384,
});

export class EngineError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'EngineError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new EngineError(code, message);
}

function assertText(value, label = 'Text', limit = ENGINE_LIMITS.maxTextLength) {
  if (typeof value !== 'string') fail('INVALID_INPUT', `${label} must be a string.`);
  if (value.length > limit) fail('INPUT_TOO_LARGE', `${label} exceeds the size limit.`);
  return value;
}

function assertInputSize(text) {
  if (text.length > ENGINE_LIMITS.maxInputBytes ||
      new TextEncoder().encode(text).length > ENGINE_LIMITS.maxInputBytes) {
    fail('INPUT_TOO_LARGE', 'Input exceeds the 2 MiB size limit.');
  }
}

function hashText(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/** Best-effort credential redaction, not a guarantee that arbitrary logs are safe. */
export function redactSecrets(text) {
  assertText(text, 'Text', ENGINE_LIMITS.maxInputBytes);
  return text
    .replace(/-----BEGIN (?:[A-Z ]*PRIVATE KEY)-----[\s\S]*?(?:-----END (?:[A-Z ]*PRIVATE KEY)-----|$)/g, '[REDACTED PRIVATE KEY]')
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, '$1 [REDACTED]')
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-(?:proj-|ant-api\d+-)?[A-Za-z0-9_-]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|AKIA[A-Z0-9]{16})\b/g, '[REDACTED]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[REDACTED]')
    .replace(/((?:https?|postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqps?):\/\/)[^\s/@:]+:[^\s/@]+@/gi, '$1[REDACTED]@')
    .replace(/([?&](?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|password|secret)=)[^&#\s]*/gi, '$1[REDACTED]')
    .replace(/((?:["']?\b(?:[A-Z][A-Z0-9]*[_-])*(?:API[_-]?KEY|SECRET[_-]?ACCESS[_-]?KEY|ACCESS[_-]?KEY[_-]?ID|PRIVATE[_-]?KEY|SECRET[_-]?KEY|ACCESS[_-]?TOKEN|REFRESH[_-]?TOKEN|AUTH[_-]?TOKEN|TOKEN|SECRET|CLIENT[_-]?SECRET|PASSWORD|PASSWD|PWD|CREDENTIALS?)\b["']?)\s*[:=]\s*)(?:\[REDACTED(?: PRIVATE KEY)?\]|"(?:\\.|[^"\\\r\n])*"|'(?:\\.|[^'\\\r\n])*'|[^\s,;}\]\r\n]+)/gi,
      (match, prefix) => `${prefix}[REDACTED]`)
    .replace(/(--(?:api[-_]?key|access[-_]?token|token|secret|password|passwd)(?:=|\s+))(?:"(?:\\.|[^"\\\r\n])*"|'(?:\\.|[^'\\\r\n])*'|[^\s]+)/gi, '$1[REDACTED]');
}

const RUN_TIMESTAMP = '\\d{4}-\\d{2}-\\d{2}[T ]\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?(?:Z|[+-]\\d{2}:?\\d{2})?';

function normalizeRunMetadata(line) {
  line = line.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '').trim().replace(/[\t ]+/g, ' ');
  // A timestamp is noise only when it is an explicit log prefix or labeled metadata.
  line = line
    // This complete line contains only run metadata, not an inline assertion value.
    .replace(new RegExp(`^${RUN_TIMESTAMP}\\s+(?:pid|process id)\\s*[:=]\\s*\\d+$`, 'i'), '<timestamp> pid <pid>')
    .replace(new RegExp(`^\\[${RUN_TIMESTAMP}\\](?=\\s)`), '[<timestamp>]')
    .replace(new RegExp(`^${RUN_TIMESTAMP}(?=\\s+(?:TRACE|DEBUG|INFO|WARN|WARNING|ERROR|FATAL|at)\\b)`, 'i'), '<timestamp>')
    .replace(new RegExp(`(^|[;|]\\s*)((?:run[-_ ]?timestamp|timestamp|logged[-_ ]?at|started[-_ ]?at|finished[-_ ]?at)\\s*[:=]\\s*)${RUN_TIMESTAMP}\\b`, 'gi'), '$1$2<timestamp>')
    .replace(/(^|[;|]\s*)((?:run|request|trace|span|job|build|correlation)[-_ ]?id\s*[:=]\s*)[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi, '$1$2<uuid>')
    .replace(/(^|[;|]\s*)((?:memory[-_ ]?address|pointer|ptr)\s*[:=]\s*)0x[0-9a-f]{6,}\b/gi, '$1$2<address>')
    .replace(/(^|[;|]\s*)((?:elapsed|duration|took|finished in|completed in)\s*[:=]?\s*)\d+(?:\.\d+)?\s*(?:milliseconds?|msecs?|ms|seconds?|secs?)\b/gi, '$1$2<duration>')
    .replace(/(^|[;|]\s*)(?:pid|process id)\s*[:=]?\s*\d+\b/gi, '$1pid <pid>');
  // Source coordinates are volatile in stack frames, not in arbitrary assertions.
  if (/^(?:(?:<timestamp>|\[<timestamp>\])\s+)?at\s/.test(line)) {
    line = line
      .replace(/((?:[A-Za-z]:[\\/]|\.?\.?\/)[^\s()<>"']*[\\/])([^\\/\s():<>"']+\.[A-Za-z0-9]+):\d+(?::\d+)?/g, '<path>/$2:<line>')
      .replace(/\b([\w.-]+\.(?:[cm]?[jt]sx?|py|go|rs|java|rb|cs|cpp|c|h)):\d+(?::\d+)?\b/g, '$1:<line>');
  }
  return line;
}

/**
 * Normalize recognizable run metadata, never arbitrary timestamp/UUID/hex values.
 * Quoted, assertion, and diff lines remain literal after required secret redaction.
 * Under-normalizing an unusual log is safer than collapsing distinct assertions.
 */
export function normalizeFailure(text) {
  // A failure signature can contain both a maximum-length message and detail.
  assertText(text, 'Failure text', ENGINE_LIMITS.maxTextLength * 2 + 1);
  const pieces = redactSecrets(text).split(/(\r\n|\r|\n)/);
  const lines = [];
  let quote = null;
  for (let index = 0; index < pieces.length; index += 2) {
    const line = pieces[index];
    let quoted = quote !== null;
    for (let i = 0; i < line.length; i += 1) {
      const char = line[i];
      if (quote) {
        if (char === '\\') i += 1;
        else if (char === quote) quote = null;
      } else if (char === '"' || char === "'" || char === '`') {
        // An apostrophe inside a word is not the start of a quoted diagnostic.
        if (char === "'" && /[\p{L}\p{N}_]/u.test(line[i - 1] || '') && /[\p{L}\p{N}_]/u.test(line[i + 1] || '')) continue;
        quote = char;
        quoted = true;
      }
    }
    const diagnostic = /\b(?:assert(?:ion)?(?:error|failed)?|expected|received|actual|want(?:ed)?|got|should|snapshot|diff)\b|(?:={2,3}|!={1,2})/i.test(line) || /^\s*[+<>-](?:\s|$)/.test(line);
    const literal = quoted || diagnostic;
    const value = literal ? line : normalizeRunMetadata(line);
    if (value || literal) lines.push({ value, literal, ending: pieces[index + 1] || '' });
  }
  return lines.map(({ value, literal, ending }, index) => value +
    (index < lines.length - 1 ? literal ? ending || '\n' : '\n' : literal ? ending : '')).join('');
}

function validXmlCodePoint(code) {
  return code === 9 || code === 10 || code === 13 ||
    (code >= 0x20 && code <= 0xd7ff) || (code >= 0xe000 && code <= 0xfffd) ||
    (code >= 0x10000 && code <= 0x10ffff);
}

function decodeEntities(text) {
  return text.replace(/&([^;&<\s]+);|&/g, (match, name) => {
    const predefined = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
    if (Object.hasOwn(predefined, name)) return predefined[name];
    if (name && /^(?:#\d+|#x[\da-f]+)$/i.test(name)) {
      const hex = /^#x/i.test(name);
      const code = Number.parseInt(name.slice(hex ? 2 : 1), hex ? 16 : 10);
      if (validXmlCodePoint(code)) return String.fromCodePoint(code);
    }
    fail('INVALID_XML', 'XML contains an invalid or unsupported entity.');
  });
}

const XML_NAME = /^[A-Za-z_][\w.:-]*/;

function parseOpenTag(source) {
  const selfClosing = source.endsWith('/');
  if (selfClosing) source = source.slice(0, -1);
  const nameMatch = source.match(XML_NAME);
  if (!nameMatch) fail('INVALID_XML', 'XML contains an invalid element name.');
  const name = nameMatch[0];
  const attributes = Object.create(null);
  let cursor = name.length;
  while (cursor < source.length) {
    if (!/\s/.test(source[cursor])) fail('INVALID_XML', 'XML attributes must be separated by whitespace.');
    while (/\s/.test(source[cursor] ?? '') && cursor < source.length) cursor += 1;
    if (cursor === source.length) break;
    const attrMatch = source.slice(cursor).match(XML_NAME);
    if (!attrMatch) fail('INVALID_XML', 'XML contains an invalid attribute.');
    const key = attrMatch[0];
    if (Object.hasOwn(attributes, key)) fail('INVALID_XML', 'XML contains duplicate attributes.');
    cursor += key.length;
    while (cursor < source.length && /\s/.test(source[cursor])) cursor += 1;
    if (source[cursor++] !== '=') fail('INVALID_XML', 'XML attribute values require an equals sign.');
    while (cursor < source.length && /\s/.test(source[cursor])) cursor += 1;
    const quote = source[cursor++];
    if (quote !== '"' && quote !== "'") fail('INVALID_XML', 'XML attribute values must be quoted.');
    const end = source.indexOf(quote, cursor);
    if (end < 0) fail('INVALID_XML', 'XML contains an unterminated attribute.');
    const value = source.slice(cursor, end);
    if (value.includes('<')) fail('INVALID_XML', 'XML attribute values cannot contain an unescaped less-than sign.');
    attributes[key] = decodeEntities(value);
    cursor = end + 1;
  }
  return { name, attributes, content: [], selfClosing };
}

/**
 * A bounded JUnit XML reader. No DOM, DTD, custom entities, or network access.
 * It deliberately accepts a small well-formed XML subset used by JUnit reports.
 */
function parseXml(xml) {
  assertText(xml, 'JUnit XML', ENGINE_LIMITS.maxInputBytes);
  assertInputSize(xml);
  if (!xml.trim()) fail('INVALID_XML', 'JUnit XML is empty.');
  for (const char of xml) {
    if (!validXmlCodePoint(char.codePointAt(0))) fail('INVALID_XML', 'XML contains an invalid character.');
  }
  xml = xml.replace(/^\uFEFF/, '');
  const stack = [];
  let root = null;
  let cursor = 0;
  let nodes = 0;
  function appendText(text, cdata = false) {
    if (!stack.length) {
      if (text.trim()) fail('INVALID_XML', 'XML has text outside its root element.');
      return;
    }
    if (!cdata && text.includes(']]>')) fail('INVALID_XML', 'XML contains an invalid CDATA terminator.');
    stack.at(-1).content.push(cdata ? text : decodeEntities(text));
  }
  while (cursor < xml.length) {
    if (xml[cursor] !== '<') {
      const next = xml.indexOf('<', cursor);
      const end = next < 0 ? xml.length : next;
      appendText(xml.slice(cursor, end));
      cursor = end;
      continue;
    }
    if (xml.startsWith('<!--', cursor)) {
      const end = xml.indexOf('-->', cursor + 4);
      const comment = xml.slice(cursor + 4, end);
      if (end < 0 || comment.includes('--') || comment.endsWith('-')) fail('INVALID_XML', 'XML contains an invalid comment.');
      cursor = end + 3;
      continue;
    }
    if (xml.startsWith('<![CDATA[', cursor)) {
      if (!stack.length) fail('INVALID_XML', 'CDATA must be inside an element.');
      const end = xml.indexOf(']]>', cursor + 9);
      if (end < 0) fail('INVALID_XML', 'XML contains an unterminated CDATA section.');
      appendText(xml.slice(cursor + 9, end), true);
      cursor = end + 3;
      continue;
    }
    if (xml.startsWith('<!', cursor)) fail('UNSAFE_XML', 'DTD declarations and external or custom entities are not supported.');
    if (xml.startsWith('<?', cursor)) {
      const end = xml.indexOf('?>', cursor + 2);
      if (end < 0) fail('INVALID_XML', 'XML contains an unterminated processing instruction.');
      const instruction = xml.slice(cursor + 2, end);
      const target = instruction.match(XML_NAME)?.[0];
      if (!target || (/^xml$/i.test(target) && (cursor !== 0 || target !== 'xml'))) {
        fail('INVALID_XML', 'XML contains an invalid processing instruction.');
      }
      if (target === 'xml' && !/^xml\s+version\s*=\s*(["'])1\.0\1(?:\s+encoding\s*=\s*(["'])[A-Za-z][A-Za-z0-9._-]*\2)?(?:\s+standalone\s*=\s*(["'])(?:yes|no)\3)?\s*$/.test(instruction)) {
        fail('INVALID_XML', 'XML contains an invalid or unsupported declaration.');
      }
      cursor = end + 2;
      continue;
    }
    let end = cursor + 1;
    let quote = null;
    for (; end < xml.length; end += 1) {
      const char = xml[end];
      if (quote) { if (char === quote) quote = null; }
      else if (char === '"' || char === "'") quote = char;
      else if (char === '>') break;
    }
    if (end === xml.length) fail('INVALID_XML', 'XML contains an unterminated tag.');
    const source = xml.slice(cursor + 1, end);
    if (source.startsWith('/')) {
      const name = source.slice(1).trimEnd();
      if (!/^[A-Za-z_][\w.:-]*$/.test(name) || stack.at(-1)?.name !== name) {
        fail('INVALID_XML', 'XML contains mismatched closing tags.');
      }
      stack.pop();
    } else {
      const node = parseOpenTag(source);
      nodes += 1;
      if (nodes > ENGINE_LIMITS.maxXmlNodes) fail('INPUT_TOO_LARGE', 'XML contains too many elements.');
      if (stack.length >= ENGINE_LIMITS.maxXmlDepth) fail('INPUT_TOO_LARGE', 'XML nesting exceeds the depth limit.');
      if (stack.length) stack.at(-1).content.push(node);
      else if (root) fail('INVALID_XML', 'XML must have exactly one root element.');
      else root = node;
      if (!node.selfClosing) stack.push(node);
    }
    cursor = end + 1;
  }
  if (stack.length || !root) fail('INVALID_XML', 'XML is incomplete.');
  return root;
}

const localName = (node) => node.name.split(':').at(-1);
const children = (node) => node.content.filter((part) => typeof part !== 'string');
const nodeText = (node) => node.content.map((part) => typeof part === 'string' ? part : nodeText(part)).join('');

/** Parse failed/error test cases; successful and skipped test cases are omitted. */
export function parseJUnit(xml) {
  const root = parseXml(xml);
  if (!['testsuites', 'testsuite'].includes(localName(root))) fail('INVALID_JUNIT', 'Expected a testsuite or testsuites root.');
  const failures = [];
  function walk(node, suites = []) {
    const kind = localName(node);
    const path = kind === 'testsuite' && node.attributes.name ? [...suites, node.attributes.name] : suites;
    if (kind === 'testcase') {
      const name = node.attributes.name || 'Unnamed test';
      const suite = node.attributes.classname || path.join(' / ') || 'JUnit';
      for (const problem of children(node).filter((child) => ['failure', 'error'].includes(localName(child)))) {
        if (failures.length >= ENGINE_LIMITS.maxFailures) fail('INPUT_TOO_LARGE', 'JUnit contains too many failures.');
        const type = problem.attributes.type || '';
        const rawMessage = problem.attributes.message || '';
        const detail = nodeText(problem).trim();
        const message = type && !rawMessage.includes(type) ? `${type}${rawMessage ? `: ${rawMessage}` : ''}` : rawMessage || detail.split('\n')[0] || 'Test failed';
        for (const value of [name, suite, message, detail]) assertText(value, 'JUnit failure field');
        const safe = { name: redactSecrets(name), suite: redactSecrets(suite), message: redactSecrets(message), detail: redactSecrets(detail) };
        failures.push({ id: `failure-${failures.length + 1}-${hashText(JSON.stringify(safe))}`, ...safe });
      }
      return;
    }
    for (const child of children(node)) walk(child, path);
  }
  walk(root);
  return failures;
}

function isRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertFailure(failure, seenIds) {
  if (!isRecord(failure)) fail('INVALID_INPUT', 'Every failure must be an object.');
  for (const field of ['id', 'name', 'suite', 'message', 'detail']) assertText(failure[field], `Failure ${field}`);
  if (!failure.id.trim()) fail('INVALID_INPUT', 'Failure IDs must not be empty.');
  if (seenIds?.has(failure.id)) fail('DUPLICATE_ID', 'Failure IDs must be unique.');
  seenIds?.add(failure.id);
}

/** Deterministic exact grouping after normalization, preserving first-seen order. */
export function groupFailures(failures) {
  if (!Array.isArray(failures)) fail('INVALID_INPUT', 'Failures must be an array.');
  if (failures.length > ENGINE_LIMITS.maxFailures) fail('INPUT_TOO_LARGE', 'Too many failures.');
  const groups = new Map();
  const seenIds = new Set();
  const groupIds = new Set();
  for (const failure of failures) {
    assertFailure(failure, seenIds);
    const safe = Object.fromEntries(Object.entries(failure).filter(([key]) => ['id', 'name', 'suite', 'message', 'detail'].includes(key)).map(([key, value]) => [key, key === 'id' ? value : redactSecrets(value)]));
    const signature = normalizeFailure([safe.message, safe.detail].filter(Boolean).join('\n') || safe.name);
    let group = groups.get(signature);
    if (!group) {
      const baseId = `group-${hashText(signature)}`;
      let id = baseId;
      let suffix = 1;
      while (groupIds.has(id)) id = `${baseId}-${suffix++}`;
      groupIds.add(id);
      group = { id, signature, representative: safe, failures: [], count: 0 };
      groups.set(signature, group);
    }
    group.failures.push(safe);
    group.count += 1;
  }
  return [...groups.values()];
}

function vectorValues(vector) {
  if (!Array.isArray(vector) && !(ArrayBuffer.isView(vector) && !(vector instanceof DataView))) return null;
  if (!vector.length || vector.length > ENGINE_LIMITS.maxVectorDimensions) return null;
  for (const value of vector) if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return vector;
}

/** Returns 0 for absent, invalid, mismatched, or zero vectors. */
export function cosineSimilarity(a, b) {
  a = vectorValues(a);
  b = vectorValues(b);
  if (!a || !b || a.length !== b.length) return 0;
  // Scale first to avoid overflow/underflow for otherwise valid finite vectors.
  let scaleA = 0;
  let scaleB = 0;
  for (let i = 0; i < a.length; i += 1) {
    scaleA = Math.max(scaleA, Math.abs(a[i]));
    scaleB = Math.max(scaleB, Math.abs(b[i]));
  }
  if (!scaleA || !scaleB) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i] / scaleA;
    const y = b[i] / scaleB;
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  return Math.max(-1, Math.min(1, dot / Math.sqrt(normA * normB)));
}

function getEmbedding(map, id) {
  return map instanceof Map ? map.get(id) : isRecord(map) && Object.hasOwn(map, id) ? map[id] : undefined;
}

/** Conservative retrieval. All returned fixes are unverified candidates for human review. */
export function retrieveIncidents(failure, incidents, embeddingMap, options = {}) {
  assertFailure(failure);
  if (!Array.isArray(incidents)) fail('INVALID_INPUT', 'Incidents must be an array.');
  if (incidents.length > ENGINE_LIMITS.maxIncidents) fail('INPUT_TOO_LARGE', 'Too many incidents.');
  if (!isRecord(options)) fail('INVALID_OPTIONS', 'Retrieval options must be an object.');
  const threshold = options.minSimilarity ?? RETRIEVAL_POLICY.minSimilarity;
  const margin = options.minMargin ?? RETRIEVAL_POLICY.minMargin;
  const topK = options.topK ?? RETRIEVAL_POLICY.topK;
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1 ||
      !Number.isFinite(margin) || margin < 0 || margin > 1 ||
      !Number.isInteger(topK) || topK < 1 || topK > 3) {
    fail('INVALID_OPTIONS', 'Use minSimilarity and minMargin from 0 to 1, and topK from 1 to 3.');
  }
  const base = { status: 'abstained', candidates: [], method: 'none', threshold, margin, bestScore: null, runnerUpScore: null };
  const query = vectorValues(getEmbedding(embeddingMap, failure.id));
  if (!query || cosineSimilarity(query, query) === 0) return { ...base, reasonCode: 'NO_QUERY_VECTOR', reason: 'No usable local embedding is available for this failure.' };
  const seen = new Set();
  const ranked = [];
  for (const incident of incidents) {
    if (!isRecord(incident) || typeof incident.id !== 'string' || !incident.id.trim()) fail('INVALID_INPUT', 'Every incident requires an ID.');
    if (seen.has(incident.id)) fail('DUPLICATE_ID', 'Incident IDs must be unique.');
    seen.add(incident.id);
    const vector = vectorValues(getEmbedding(embeddingMap, incident.id));
    if (!vector || vector.length !== query.length || cosineSimilarity(vector, vector) === 0) continue;
    ranked.push({ incident, score: cosineSimilarity(query, vector) });
  }
  ranked.sort((a, b) => b.score - a.score || (a.incident.id < b.incident.id ? -1 : a.incident.id > b.incident.id ? 1 : 0));
  if (!ranked.length) return { ...base, reasonCode: 'NO_INCIDENT_VECTORS', reason: 'No compatible incident embeddings are available.' };
  const result = { ...base, method: 'semantic', bestScore: ranked[0].score, runnerUpScore: ranked[1]?.score ?? null };
  if (result.bestScore < threshold) return { ...result, reasonCode: 'BELOW_THRESHOLD', reason: 'The closest incident is below the similarity threshold. No fix is suggested.' };
  if (ranked.length > 1 && result.bestScore - result.runnerUpScore < margin) return { ...result, reasonCode: 'AMBIGUOUS_NEIGHBORS', reason: 'The nearest incidents are too similar in score to choose safely. No fix is suggested.' };
  return {
    ...result,
    status: 'candidate-only',
    reasonCode: 'CANDIDATES_FOUND',
    reason: 'Historical candidates only. Review the evidence and verify applicability before trying a fix.',
    candidates: ranked.filter(({ score }) => score >= threshold).slice(0, topK).map((candidate, index) => ({ ...candidate, rank: index + 1 })),
  };
}

function isIsoDateTime(text) {
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|([+-])(\d{2}):(\d{2}))$/);
  if (!match || !Number.isFinite(Date.parse(text))) return false;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, , zoneHour = '0', zoneMinute = '0'] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1] &&
    Number(hourText) <= 23 && Number(minuteText) <= 59 && Number(secondText) <= 59 &&
    Number(zoneHour) <= 23 && Number(zoneMinute) <= 59;
}

/** Strict, versioned, bounded import validation. Unknown fields are not imported. */
export function validateMemory(data) {
  const errors = [];
  try {
    if (typeof data === 'string') {
      assertInputSize(data);
      try { data = JSON.parse(data); }
      catch { return { valid: false, errors: ['Memory is not valid JSON.'], memory: null }; }
    } else {
      let serialized;
      try { serialized = JSON.stringify(data); }
      catch { return { valid: false, errors: ['Memory must contain serializable JSON data.'], memory: null }; }
      if (typeof serialized === 'string') assertInputSize(serialized);
    }
    if (!isRecord(data)) return { valid: false, errors: ['Memory must be an object.'], memory: null };
    if (data.version !== 1) errors.push('Memory version must be 1.');
    if (!Array.isArray(data.incidents)) errors.push('Memory incidents must be an array.');
    if (errors.length) return { valid: false, errors, memory: null };
    if (data.incidents.length > ENGINE_LIMITS.maxIncidents) return { valid: false, errors: ['Memory contains too many incidents.'], memory: null };
    const ids = new Set();
    const incidents = [];
    const fieldLimits = { id: 200, title: 300, symptom: 100_000, fix: 100_000, evidence: 100_000, createdAt: 40 };
    for (const [index, incident] of data.incidents.entries()) {
      if (errors.length >= 20) { errors.push('Additional invalid incidents were omitted from this error list.'); break; }
      if (!isRecord(incident)) { errors.push(`Incident ${index + 1} must be an object.`); continue; }
      const entry = {};
      const previousErrors = errors.length;
      for (const [field, limit] of Object.entries(fieldLimits)) {
        const value = incident[field];
        if (typeof value !== 'string' || !value.trim() || value.length > limit) {
          errors.push(`Incident ${index + 1}: ${field} must be a nonempty string of at most ${limit} characters.`);
        } else entry[field] = ['id', 'createdAt'].includes(field) ? value.trim() : redactSecrets(value).trim();
      }
      if (typeof entry.id === 'string') {
        if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(entry.id) || ['__proto__', 'constructor', 'prototype'].includes(entry.id)) errors.push(`Incident ${index + 1}: id contains unsupported characters or a reserved name.`);
        if (ids.has(entry.id)) errors.push(`Incident ${index + 1}: id is duplicated.`);
        ids.add(entry.id);
      }
      if (entry.createdAt && !isIsoDateTime(entry.createdAt)) {
        errors.push(`Incident ${index + 1}: createdAt must be an ISO date-time with a time zone.`);
      }
      if (errors.length === previousErrors) incidents.push(entry);
    }
    return errors.length ? { valid: false, errors, memory: null } : { valid: true, errors: [], memory: { version: 1, incidents } };
  } catch (error) {
    return { valid: false, errors: [error instanceof EngineError ? error.message : 'Memory could not be validated.'], memory: null };
  }
}
