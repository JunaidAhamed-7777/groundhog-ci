import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ENGINE_LIMITS, EngineError, parseJUnit, normalizeFailure, groupFailures,
  cosineSimilarity, retrieveIncidents, redactSecrets, validateMemory,
} from '../src/engine.js';
import { RETRIEVAL_POLICY } from '../src/retrieval-policy.js';

const failure = (overrides = {}) => ({ id: 'f-1', name: 'connects', suite: 'database', message: 'ECONNREFUSED on port 5432', detail: 'at connect (/runner/app/db.js:12:4)', ...overrides });
const incident = (overrides = {}) => ({ id: 'i-1', title: 'Database was not ready', symptom: 'ECONNREFUSED on port 5432', fix: 'Wait for the database health check before tests.', evidence: 'Verified in CI run #104 after adding the health check.', createdAt: '2026-10-21T04:00:00.000Z', ...overrides });
const junit = (body) => `<testsuite name="unit">${body}</testsuite>`;
const throwsCode = (fn, code) => assert.throws(fn, (error) => error instanceof EngineError && error.code === code);

test('JUnit emits failures and errors while omitting passed and skipped cases', () => {
  const result = parseJUnit(junit('<testcase name="ok"/><testcase name="skip"><skipped/></testcase><testcase name="bad"><failure message="expected 2, got 3">stack</failure></testcase><testcase name="crash"><error type="TypeError">undefined</error></testcase>'));
  assert.equal(result.length, 2);
  assert.equal(result[0].name, 'bad');
  assert.equal(result[0].suite, 'unit');
  assert.equal(result[0].message, 'expected 2, got 3');
  assert.equal(result[0].detail, 'stack');
  assert.equal(result[1].message, 'TypeError');
});

test('JUnit preserves namespaced tags, nested suite paths, and class names', () => {
  const result = parseJUnit('<j:testsuites xmlns:j="urn:junit"><j:testsuite name="outer"><j:testsuite name="inner"><j:testcase name="a"><j:failure message="x"/></j:testcase><j:testcase name="b" classname="app.Unit"><j:error/></j:testcase></j:testsuite></j:testsuite></j:testsuites>');
  assert.deepEqual(result.map(({ suite }) => suite), ['outer / inner', 'app.Unit']);
});

test('JUnit decodes predefined, decimal, and hexadecimal entities', () => {
  const [result] = parseJUnit(junit('<testcase name="a &amp; b"><failure message="&quot;bad&quot; &lt; 3">&#65;&#x42;&apos;</failure></testcase>'));
  assert.equal(result.name, 'a & b');
  assert.equal(result.message, '"bad" < 3');
  assert.equal(result.detail, "AB'");
});

test('JUnit accepts XML declaration, BOM, comments, CDATA, and > in attributes', () => {
  const [result] = parseJUnit('\uFEFF<?xml version="1.0"?><testsuite><!-- note --><testcase name="case"><failure message="a > b"><![CDATA[<script>not executable</script> & raw]]></failure></testcase></testsuite>');
  assert.equal(result.message, 'a > b');
  assert.equal(result.detail, '<script>not executable</script> & raw');
});

test('JUnit keeps body markup as inert text, not active UI', () => {
  const [result] = parseJUnit(junit('<testcase><failure>&lt;img src=x onerror=alert(1)&gt;</failure></testcase>'));
  assert.equal(result.detail, '<img src=x onerror=alert(1)>');
  assert.equal(typeof result.detail, 'string');
});

test('JUnit returns a deterministic unique ID per emitted failure', () => {
  const xml = junit('<testcase name="same"><failure message="bad"/><failure message="bad"/></testcase>');
  const first = parseJUnit(xml);
  assert.deepEqual(first, parseJUnit(xml));
  assert.notEqual(first[0].id, first[1].id);
});

test('JUnit handles missing attributes and reports with no failures', () => {
  assert.deepEqual(parseJUnit('<testsuites/>'), []);
  const [result] = parseJUnit('<testsuite><testcase><failure/></testcase></testsuite>');
  assert.equal(result.name, 'Unnamed test');
  assert.equal(result.suite, 'JUnit');
  assert.equal(result.message, 'Test failed');
});

test('JUnit rejects invalid roots and missing input types', () => {
  throwsCode(() => parseJUnit('<html/>'), 'INVALID_JUNIT');
  throwsCode(() => parseJUnit(null), 'INVALID_INPUT');
  throwsCode(() => parseJUnit(''), 'INVALID_XML');
});

test('JUnit rejects mismatched, incomplete, and multiple root elements', () => {
  for (const xml of ['<testsuite><testcase></testsuite>', '<testsuite>', '<testsuite/><testsuite/>', '<testsuite/>outside', '<testsuite><failure']) {
    throwsCode(() => parseJUnit(xml), 'INVALID_XML');
  }
});

test('JUnit rejects malformed, duplicate, and unquoted attributes', () => {
  for (const xml of ['<testsuite name=a/>', '<testsuite name="a" name="b"/>', '<testsuite name "a"/>', '<testsuite name="a"other="b"/>', '<testsuite name="a<b"/>', '<testsuite / >']) {
    throwsCode(() => parseJUnit(xml), 'INVALID_XML');
  }
});

test('JUnit rejects external entities and DTD expansion without resolving them', () => {
  for (const xml of ['<!DOCTYPE testsuite SYSTEM "https://example.com/evil.dtd"><testsuite/>', '<!DOCTYPE testsuite [<!ENTITY x SYSTEM "file:///etc/passwd">]><testsuite/>', '<testsuite><!ENTITY x "x"></testsuite>']) {
    throwsCode(() => parseJUnit(xml), 'UNSAFE_XML');
  }
});

test('JUnit rejects unknown, unescaped, and invalid code-point entities', () => {
  for (const entity of ['&notdefined;', '&', '&#0;', '&#xD800;', '&#x110000;', '&amp']) {
    throwsCode(() => parseJUnit(junit(`<testcase><failure>${entity}</failure></testcase>`)), 'INVALID_XML');
  }
});

test('JUnit rejects invalid comments, declarations, and CDATA', () => {
  for (const xml of ['<testsuite><!-- x -- y --></testsuite>', '<testsuite><!--x---></testsuite>', '<testsuite><!--missing</testsuite>', '<testsuite><![CDATA[missing</testsuite>', '<testsuite>bad ]]></testsuite>', '<testsuite><?xml version="1.0"?></testsuite>', '<?xml?><testsuite/>', '<?xml version="2.0"?><testsuite/>']) {
    throwsCode(() => parseJUnit(xml), 'INVALID_XML');
  }
});

test('JUnit enforces byte size, text size, nesting, and invalid-character limits', () => {
  throwsCode(() => parseJUnit('x'.repeat(ENGINE_LIMITS.maxInputBytes + 1)), 'INPUT_TOO_LARGE');
  throwsCode(() => parseJUnit(junit('é'.repeat(ENGINE_LIMITS.maxInputBytes / 2))), 'INPUT_TOO_LARGE');
  throwsCode(() => parseJUnit(junit(`<testcase><failure>${'x'.repeat(ENGINE_LIMITS.maxTextLength + 1)}</failure></testcase>`)), 'INPUT_TOO_LARGE');
  throwsCode(() => parseJUnit('<testsuite>'.repeat(65) + '</testsuite>'.repeat(65)), 'INPUT_TOO_LARGE');
  throwsCode(() => parseJUnit('<testsuite>\u0000</testsuite>'), 'INVALID_XML');
});

test('JUnit redacts credentials before returning a failure', () => {
  const [result] = parseJUnit(junit('<testcase name="PASSWORD=secret"><failure message="API_KEY=topsecret">Bearer abc.def.ghi</failure></testcase>'));
  const serialized = JSON.stringify(result);
  assert.ok(!serialized.includes('topsecret'));
  assert.ok(!serialized.includes('abc.def.ghi'));
  assert.ok(!serialized.includes('PASSWORD=secret'));
});

test('normalization removes ANSI, run timestamps, source positions, and whitespace', () => {
  assert.equal(normalizeFailure('\u001b[31mError\u001b[0m  \r\n2026-10-20T12:02:01.123Z at run (/home/runner/src/app.js:18:2)\n'), 'Error\n<timestamp> at run (<path>/app.js:<line>)');
  assert.equal(normalizeFailure('at run (C:\\build\\src\\app.ts:99:4)'), 'at run (<path>/app.ts:<line>)');
});

test('normalization retains error codes, status codes, assertion values, and durations', () => {
  for (const [a, b] of [['ECONNREFUSED', 'ETIMEDOUT'], ['HTTP 401', 'HTTP 403'], ['expected 2 got 3', 'expected 2 got 4'], ['expected timeout 100 ms', 'expected timeout 500 ms'], ['port 5432', 'port 5433']]) {
    assert.notEqual(normalizeFailure(a), normalizeFailure(b));
  }
});

test('normalization removes labeled volatile timing, UUIDs, PIDs, and addresses', () => {
  const normalized = normalizeFailure('duration: 34 ms; took 1.3 seconds; pid=5433; run_id=123e4567-e89b-12d3-a456-426614174000; memory address=0x0123456789');
  assert.equal(normalized, 'duration: <duration>; took <duration>; pid <pid>; run_id=<uuid>; memory address=<address>');
});

test('normalization preserves distinct quoted timestamp, UUID, and hex assertions', () => {
  for (const [a, b] of [
    ['AssertionError: expected "2026-10-21T10:00:00Z" but received "2026-10-22T10:00:00Z"', 'AssertionError: expected "2026-10-23T10:00:00Z" but received "2026-10-24T10:00:00Z"'],
    ['expected "123e4567-e89b-12d3-a456-426614174000"', 'expected "123e4567-e89b-12d3-a456-426614174111"'],
    ['expected "0x123456"', 'expected "0x654321"'],
    ['expected "at src/app.js:12:4"', 'expected "at src/app.js:22:4"'],
    ['expected "a  b"', 'expected "a b"'],
  ]) {
    assert.equal(normalizeFailure(a), a);
    assert.equal(normalizeFailure(b), b);
    assert.notEqual(normalizeFailure(a), normalizeFailure(b));
  }
});

test('normalization preserves unlabeled values and unquoted assertion metadata', () => {
  for (const text of [
    '2026-10-21T10:00:00Z', 'record 123e4567-e89b-12d3-a456-426614174000', 'value 0x123456',
    'expected timestamp=2026-10-21T10:00:00Z', 'expected run_id=123e4567-e89b-12d3-a456-426614174000',
    'expected memory address=0x123456', 'actual duration: 34 ms', 'expected pid=5433',
    '- 2026-10-21T10:00:00Z', '+ 2026-10-22T10:00:00Z', 'stored location /tmp/app.js:12:4',
  ]) assert.equal(normalizeFailure(text), text);
});

test('normalization recognizes log metadata without changing nearby diagnostic values', () => {
  const a = '[2026-10-21T10:00:00Z] ERROR connection lost\nrequest_id=123e4567-e89b-12d3-a456-426614174000\nlogged_at=2026-10-21T10:00:00Z\nvalue 0x123456';
  const b = '[2026-10-22T11:00:00Z] ERROR connection lost\nrequest_id=123e4567-e89b-12d3-a456-426614174111\nlogged_at=2026-10-22T11:00:00Z\nvalue 0x123456';
  assert.equal(normalizeFailure(a), normalizeFailure(b));
  assert.ok(normalizeFailure(a).includes('value 0x123456'));
});

test('normalization groups metadata-only timestamp and PID lines without erasing assertions', () => {
  const first = '2026-10-21T00:00:00Z pid=2201';
  const second = '2026-10-21T00:00:01Z pid=9103';
  assert.equal(normalizeFailure(first), '<timestamp> pid <pid>');
  assert.equal(normalizeFailure(second), '<timestamp> pid <pid>');
  assert.equal(normalizeFailure(normalizeFailure(first)), normalizeFailure(first));
  assert.equal(groupFailures([
    failure({ id: 'f-1', detail: `at connect (/first/run/db.js:12:4)\n${first}` }),
    failure({ id: 'f-2', detail: `at connect (/other/run/db.js:98:7)\n${second}` }),
  ]).length, 1);
  for (const diagnostic of [`expected ${first}`, `"${first}"`, `${first} value=42`]) {
    assert.equal(normalizeFailure(diagnostic), diagnostic);
  }
});

test('normalization preserves escaped and multiline quoted diagnostic whitespace', () => {
  const text = 'expected "first\\" line\r\n  duration: 34 ms\r\n\r\n  last"\r\n';
  assert.equal(normalizeFailure(text), text);
  const backticks = '`run_id=123e4567-e89b-12d3-a456-426614174000`';
  assert.equal(normalizeFailure(backticks), backticks);
  assert.equal(normalizeFailure("can't connect\n  at connect (/tmp/app.js:12:4)"), "can't connect\nat connect (<path>/app.js:<line>)");
});

test('grouping keeps different literal assertions in separate exact groups', () => {
  const failures = [
    failure({ id: 'f-1', message: 'expected "2026-10-21T10:00:00Z"', detail: '' }),
    failure({ id: 'f-2', message: 'expected "2026-10-22T10:00:00Z"', detail: '' }),
    failure({ id: 'f-3', message: 'expected "2026-10-21T10:00:00Z"', detail: '' }),
  ];
  const groups = groupFailures(failures);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups.map(({ count }) => count), [2, 1]);
});

test('normalization is idempotent and rejects invalid or oversized values', () => {
  const value = normalizeFailure('  Error\r\n API_KEY=secret at app.js:23:4  ');
  assert.equal(normalizeFailure(value), value);
  throwsCode(() => normalizeFailure({}), 'INVALID_INPUT');
  throwsCode(() => normalizeFailure('x'.repeat(ENGINE_LIMITS.maxTextLength * 2 + 2)), 'INPUT_TOO_LARGE');
});

test('grouping combines only identical normalized signatures and preserves member evidence', () => {
  const result = groupFailures([failure(), failure({ id: 'f-2', detail: 'at connect (/another/checkout/db.js:61:9)' }), failure({ id: 'f-3', message: 'ETIMEDOUT on port 5432' })]);
  assert.equal(result.length, 2);
  assert.equal(result[0].count, 2);
  assert.deepEqual(result[0].failures.map(({ id }) => id), ['f-1', 'f-2']);
  assert.equal(result[0].representative.id, 'f-1');
  assert.equal(result[0].failures[1].detail, 'at connect (/another/checkout/db.js:61:9)');
});

test('grouping falls back to test name for empty failures and is nonmutating', () => {
  const input = Object.freeze(failure({ message: '', detail: '' }));
  const result = groupFailures([input]);
  assert.equal(result[0].signature, 'connects');
  assert.notEqual(result[0].representative, input);
  assert.deepEqual(groupFailures([]), []);
});

test('grouping accepts a signature containing two maximum-length failure fields', () => {
  const result = groupFailures([failure({ message: 'm'.repeat(ENGINE_LIMITS.maxTextLength), detail: 'd'.repeat(ENGINE_LIMITS.maxTextLength) })]);
  assert.equal(result[0].signature.length, ENGINE_LIMITS.maxTextLength * 2 + 1);
});

test('grouping rejects malformed records and duplicate IDs', () => {
  throwsCode(() => groupFailures(null), 'INVALID_INPUT');
  throwsCode(() => groupFailures([failure({ detail: null })]), 'INVALID_INPUT');
  throwsCode(() => groupFailures([failure(), failure()]), 'DUPLICATE_ID');
  throwsCode(() => groupFailures([failure({ id: '' })]), 'INVALID_INPUT');
});

test('cosine similarity supports same, orthogonal, and opposite vectors', () => {
  assert.equal(cosineSimilarity([1, 2], [1, 2]), 1);
  assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
  assert.equal(cosineSimilarity([1, 0], [-1, 0]), -1);
  assert.ok(Math.abs(cosineSimilarity([1, 1], [1, 0]) - Math.SQRT1_2) < 1e-12);
});

test('cosine similarity supports typed arrays and numerically extreme finite values', () => {
  assert.equal(cosineSimilarity(new Float32Array([1, 0]), new Float64Array([2, 0])), 1);
  assert.equal(cosineSimilarity([1e300, 1e300], [1e-300, 1e-300]), 1);
});

test('cosine similarity safely returns zero for unusable vectors', () => {
  for (const [a, b] of [[[], []], [[0, 0], [1, 0]], [[1], [1, 2]], [[NaN], [1]], [[Infinity], [1]], [['1'], [1]], [null, [1]], [new DataView(new ArrayBuffer(4)), [1]], [new BigInt64Array([1n]), [1]]]) {
    assert.equal(cosineSimilarity(a, b), 0);
  }
});

test('retrieval yields candidate-only with cosine scores and explicit verification language', () => {
  const incidents = [incident(), incident({ id: 'i-2' })];
  const result = retrieveIncidents(failure(), incidents, { 'f-1': [1, 0], 'i-1': [1, 0], 'i-2': [0, 1] });
  assert.equal(result.status, 'candidate-only');
  assert.equal(result.method, 'semantic');
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].incident.id, 'i-1');
  assert.equal(result.candidates[0].score, 1);
  assert.equal(result.candidates[0].rank, 1);
  assert.match(result.reason, /verify/);
  assert.equal(result.threshold, RETRIEVAL_POLICY.minSimilarity);
  assert.equal(result.margin, RETRIEVAL_POLICY.minMargin);
  assert.deepEqual(RETRIEVAL_POLICY, { minSimilarity: 0.68, minMargin: 0.20, topK: 3 });
  assert.ok(Object.isFrozen(RETRIEVAL_POLICY));
});

test('retrieval abstains below the frozen similarity threshold', () => {
  const result = retrieveIncidents(failure(), [incident()], new Map([['f-1', [1, 0]], ['i-1', [0.6, Math.sqrt(1 - 0.6 ** 2)]]]));
  assert.equal(result.reasonCode, 'BELOW_THRESHOLD');
  assert.equal(result.status, 'abstained');
  assert.deepEqual(result.candidates, []);
});

test('retrieval abstains on ambiguous close or tied neighbors', () => {
  for (const other of [[1, 0], [0.95, Math.sqrt(1 - 0.95 ** 2)]]) {
    const result = retrieveIncidents(failure(), [incident(), incident({ id: 'i-2' })], { 'f-1': [1, 0], 'i-1': [1, 0], 'i-2': other });
    assert.equal(result.reasonCode, 'AMBIGUOUS_NEIGHBORS');
    assert.deepEqual(result.candidates, []);
  }
});

test('retrieval has clear abstentions for absent, zero, and incompatible embeddings', () => {
  assert.equal(retrieveIncidents(failure(), [incident()], {}).reasonCode, 'NO_QUERY_VECTOR');
  assert.equal(retrieveIncidents(failure(), [incident()], { 'f-1': [0, 0] }).reasonCode, 'NO_QUERY_VECTOR');
  assert.equal(retrieveIncidents(failure(), [incident()], { 'f-1': [1, 0], 'i-1': [1, 0, 0] }).reasonCode, 'NO_INCIDENT_VECTORS');
  assert.equal(retrieveIncidents(failure(), [], { 'f-1': [1, 0] }).reasonCode, 'NO_INCIDENT_VECTORS');
});

test('retrieval returns at most three ordered candidates above threshold', () => {
  const incidents = Array.from({ length: 5 }, (_, i) => incident({ id: `i-${i + 1}` }));
  const embeddingMap = { 'f-1': [1, 0] };
  [1, 0.79, 0.74, 0.70, 0.6].forEach((score, i) => { embeddingMap[`i-${i + 1}`] = [score, Math.sqrt(1 - score ** 2)]; });
  const result = retrieveIncidents(failure(), incidents, embeddingMap);
  assert.deepEqual(result.candidates.map(({ incident: entry }) => entry.id), ['i-1', 'i-2', 'i-3']);
  assert.deepEqual(result.candidates.map(({ rank }) => rank), [1, 2, 3]);
});

test('retrieval never treats inherited prototype values as embeddings', () => {
  const embeddings = { 'f-1': [1, 0] };
  const result = retrieveIncidents(failure(), [incident({ id: 'toString' })], embeddings);
  assert.equal(result.reasonCode, 'NO_INCIDENT_VECTORS');
});

test('retrieval validates options and incident identity', () => {
  for (const options of [{ minSimilarity: 2 }, { minSimilarity: NaN }, { minMargin: -1 }, { topK: 4 }, { topK: 0 }, { topK: 1.5 }, null]) {
    throwsCode(() => retrieveIncidents(failure(), [], {}, options), 'INVALID_OPTIONS');
  }
  throwsCode(() => retrieveIncidents(failure(), [incident(), incident()], { 'f-1': [1] }), 'DUPLICATE_ID');
});

test('secret redaction handles common assignments, authorization, and command flags', () => {
  const text = 'OPENAI_API_KEY=supersecret DB_PASSWORD="hello there" AWS_SECRET_ACCESS_KEY=awssecret Bearer abc.def.ghi Basic Zm9vOmJhcg== --token tokenvalue --password="space secret"';
  const safe = redactSecrets(text);
  for (const secret of ['supersecret', 'hello there', 'awssecret', 'abc.def.ghi', 'Zm9vOmJhcg==', 'tokenvalue', 'space secret']) assert.ok(!safe.includes(secret), secret);
  assert.match(safe, /\[REDACTED\]/);
});

test('secret redaction handles URL credentials, query parameters, and private keys', () => {
  const safe = redactSecrets('https://alice:pass123@example.com/?token=abc123&ok=1 postgres://db:pass456@localhost/app\n-----BEGIN PRIVATE KEY-----\nprivatebits\n-----END PRIVATE KEY-----');
  for (const secret of ['alice', 'pass123', 'abc123', 'pass456', 'privatebits']) assert.ok(!safe.includes(secret), secret);
  assert.ok(safe.includes('ok=1'));
  assert.ok(safe.includes('example.com'));
});

test('secret redaction handles recognized unlabelled credential formats and JSON', () => {
  const tokens = ['ghp_' + 'a'.repeat(36), 'github_pat_' + 'b'.repeat(30), 'sk-proj-' + 'c'.repeat(25), 'AKIA' + 'D'.repeat(16), 'xoxb-12345678901-secret'];
  const safe = redactSecrets(tokens.join(' ') + ' {"api_key":"jsonsecret"}');
  tokens.forEach((token) => assert.ok(!safe.includes(token)));
  assert.ok(!safe.includes('jsonsecret'));
});

test('secret redaction consumes escaped quotes and truncated private keys', () => {
  const safe = redactSecrets('PASSWORD="first\\"second" --token="third\\"fourth"\n-----BEGIN RSA PRIVATE KEY-----\ntruncated-private-data');
  for (const word of ['first', 'second', 'third', 'fourth', 'truncated-private-data']) assert.ok(!safe.includes(word), word);
});

test('secret redaction is idempotent and leaves ordinary diagnostic text intact', () => {
  const text = 'HTTP 403; expected 3; password validation failed; token parser raised SyntaxError';
  assert.equal(redactSecrets(text), text);
  const safe = redactSecrets('API_KEY=secret Bearer secret');
  assert.equal(redactSecrets(safe), safe);
});

test('memory validates an empty or complete versioned envelope', () => {
  assert.deepEqual(validateMemory({ version: 1, incidents: [] }), { valid: true, errors: [], memory: { version: 1, incidents: [] } });
  const result = validateMemory(JSON.stringify({ version: 1, incidents: [incident()] }));
  assert.equal(result.valid, true);
  assert.deepEqual(result.memory.incidents[0], incident());
});

test('memory redacts sensitive values and drops unknown fields without mutating input', () => {
  const original = incident({ evidence: 'API_KEY=privatevalue', unknown: 'should not import' });
  const result = validateMemory({ version: 1, incidents: [original], embeddings: { secret: [] } });
  assert.equal(result.valid, true);
  assert.ok(!JSON.stringify(result.memory).includes('privatevalue'));
  assert.equal(result.memory.incidents[0].unknown, undefined);
  assert.equal(result.memory.embeddings, undefined);
  assert.equal(original.evidence, 'API_KEY=privatevalue');
});

test('memory rejects malformed JSON, arrays, null, and unknown schema versions', () => {
  for (const data of ['{', [], null, {}, { version: 2, incidents: [] }, { version: 1, incidents: {} }]) {
    const result = validateMemory(data);
    assert.equal(result.valid, false);
    assert.equal(result.memory, null);
    assert.ok(result.errors.length > 0);
  }
});

test('memory requires meaningful complete fields and unique IDs', () => {
  for (const bad of [incident({ title: '' }), incident({ fix: null }), incident({ evidence: '  ' }), incident({ title: 'x'.repeat(301) }), incident({ id: '__proto__' })]) {
    assert.equal(validateMemory({ version: 1, incidents: [bad] }).valid, false);
  }
  assert.equal(validateMemory({ version: 1, incidents: [incident(), incident()] }).valid, false);
});

test('memory rejects oversized strings and excessive entries', () => {
  assert.equal(validateMemory('x'.repeat(ENGINE_LIMITS.maxInputBytes + 1)).valid, false);
  assert.equal(validateMemory({ version: 1, incidents: Array(ENGINE_LIMITS.maxIncidents + 1).fill(null) }).valid, false);
  assert.equal(validateMemory({ version: 1, incidents: [incident({ symptom: 'x'.repeat(100_001) })] }).valid, false);
});

test('memory requires parseable ISO timestamps with a timezone', () => {
  for (const date of ['yesterday', '2026-10-21', '2026-10-21T00:00:00', '2026-13-21T00:00:00Z', '2026-02-30T00:00:00Z', '2026-02-29T00:00:00Z', '2026-10-21T24:00:00Z']) {
    assert.equal(validateMemory({ version: 1, incidents: [incident({ createdAt: date })] }).valid, false);
  }
  assert.equal(validateMemory({ version: 1, incidents: [incident({ createdAt: '2026-10-21T01:30:00+01:30' })] }).valid, true);
  assert.equal(validateMemory({ version: 1, incidents: [incident({ createdAt: '2024-02-29T01:30:00Z' })] }).valid, true);
});

test('memory safely rejects cycles and does not leak invalid payloads through errors', () => {
  const cyclic = { version: 1, incidents: [] };
  cyclic.self = cyclic;
  assert.equal(validateMemory(cyclic).valid, false);
  const result = validateMemory({ version: 1, incidents: [incident({ fix: { password: 'do-not-leak' } })] });
  assert.ok(!JSON.stringify(result.errors).includes('do-not-leak'));
});
