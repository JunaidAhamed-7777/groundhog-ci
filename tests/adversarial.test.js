import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ENGINE_LIMITS, parseJUnit, normalizeFailure, groupFailures,
  validateMemory, retrieveIncidents, cosineSimilarity,
} from '../src/engine.js';

// Every input in this file is authored synthetic test data, never a real log.
const junit = (content) => `<testsuite name="synthetic"><testcase name="case">${content}</testcase></testsuite>`;
const failure = (id, message) => ({ id, name: 'synthetic case', suite: 'synthetic', message, detail: '' });
const incident = (overrides = {}) => ({
  id: 'synthetic-incident', title: 'Synthetic incident', symptom: 'Synthetic symptom',
  fix: 'Review this synthetic fix', evidence: 'Synthetic evidence',
  createdAt: '2026-10-19T00:00:00.000Z', ...overrides,
});

// These are security boundaries, not merely parser happy paths.
test('JUnit rejects external entities, entity expansion, and declaration variants', () => {
  const attacks = [
    '<!DOCTYPE testsuite SYSTEM "file:///etc/passwd"><testsuite/>',
    '<!DOCTYPE testsuite [<!ENTITY secret SYSTEM "https://example.invalid/secret">]><testsuite><testcase><failure>&secret;</failure></testcase></testsuite>',
    '<!DOCTYPE testsuite [<!ENTITY a "boom"><!ENTITY b "&a;&a;&a;">]><testsuite/>',
    '<!ENTITY secret "value"><testsuite/>',
  ];
  for (const xml of attacks) assert.throws(() => parseJUnit(xml), { code: 'UNSAFE_XML' });
});

test('JUnit rejects malformed documents instead of silently accepting partial results', () => {
  const malformed = [
    '<testsuite><testcase><failure>truncated',
    '<testsuite><testcase></testsuite>',
    '<testsuite/><testsuite/>',
    '<testsuite name="one" name="two"/>',
    '<testsuite name=unquoted/>',
    junit('<failure>&unknown;</failure>'),
    junit('<failure>&#0;</failure>'),
    junit('<failure>raw & ampersand</failure>'),
    junit('<failure>bad ]]> text</failure>'),
    '<testsuite><!-- invalid -- comment --></testsuite>',
  ];
  for (const xml of malformed) assert.throws(() => parseJUnit(xml), { code: 'INVALID_XML' });
});

test('JUnit bounds byte size, nesting depth, field length, and failure count', () => {
  assert.throws(() => parseJUnit(`<testsuite>${'é'.repeat(ENGINE_LIMITS.maxInputBytes / 2)}</testsuite>`), { code: 'INPUT_TOO_LARGE' });
  assert.throws(() => parseJUnit(`<testsuite>${'<suite>'.repeat(ENGINE_LIMITS.maxXmlDepth)}${'</suite>'.repeat(ENGINE_LIMITS.maxXmlDepth)}</testsuite>`), { code: 'INPUT_TOO_LARGE' });
  assert.throws(() => parseJUnit(junit(`<failure>${'x'.repeat(ENGINE_LIMITS.maxTextLength + 1)}</failure>`)), { code: 'INPUT_TOO_LARGE' });
  assert.throws(() => parseJUnit(`<testsuite>${'<testcase><failure>x</failure></testcase>'.repeat(ENGINE_LIMITS.maxFailures + 1)}</testsuite>`), { code: 'INPUT_TOO_LARGE' });
});

test('JUnit preserves encoded markup as inert text and does not double-decode entities', () => {
  const parsed = parseJUnit(junit('<failure message="&lt;img src=x onerror=alert(1)&gt;"><![CDATA[<script>alert("synthetic")</script>]]> &amp;lt;tag&amp;gt;</failure>'));
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].message, '<img src=x onerror=alert(1)>');
  assert.equal(parsed[0].detail, '<script>alert("synthetic")</script> &lt;tag&gt;');
  // Text is intentionally retained. The UI must render it through textContent or escaping.
});

test('Normalization preserves assertion numbers, HTTP status codes, ports, and dependency versions', () => {
  const pairs = [
    ['expected 41 but received 42', 'expected 41 but received 43'],
    ['HTTP response 401 unauthorized', 'HTTP response 403 forbidden'],
    ['ECONNREFUSED localhost:5432', 'ECONNREFUSED localhost:6379'],
    ['Missing package@1.2.3', 'Missing package@1.2.4'],
  ];
  for (const [left, right] of pairs) assert.notEqual(normalizeFailure(left), normalizeFailure(right));
});

test('Normalization does not erase duration assertion values', () => {
  assert.notEqual(normalizeFailure('AssertionError: expected timeout 100 ms, received 500 ms'), normalizeFailure('AssertionError: expected timeout 200 ms, received 500 ms'));
});

test('Normalization does not fold distinct Unicode assertion values together', () => {
  assert.notEqual(normalizeFailure('AssertionError: expected "²" but received "2"'), normalizeFailure('AssertionError: expected "2" but received "2"'));
});

test('Grouping is deterministic, keeps different status errors separate, and does not mutate inputs', () => {
  const values = [failure('a', 'HTTP 404: missing item'), failure('b', 'HTTP 500: internal error'), failure('c', 'HTTP 404: missing item')];
  const original = structuredClone(values);
  const groups = groupFailures(values);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups.map((group) => group.count), [2, 1]);
  assert.deepEqual(groupFailures(values), groups);
  assert.deepEqual(values, original);
});

test('Memory rejects pollution-shaped identifiers and strips unknown fields', () => {
  for (const id of ['__proto__', 'constructor', 'prototype']) assert.equal(validateMemory({ version: 1, incidents: [incident({ id })] }).valid, false);
  const input = JSON.parse('{"version":1,"__proto__":{"polluted":true},"incidents":[]}');
  const safe = validateMemory(input);
  assert.equal(safe.valid, true);
  assert.equal(Object.hasOwn(safe.memory, '__proto__'), false);
  assert.equal({}.polluted, undefined);
  const extra = validateMemory({ version: 1, incidents: [incident({ vector: [1, 0], executable: 'never run this' })] });
  assert.equal(extra.valid, true);
  assert.equal(Object.hasOwn(extra.memory.incidents[0], 'vector'), false);
  assert.equal(Object.hasOwn(extra.memory.incidents[0], 'executable'), false);
});

test('Memory rejects duplicate IDs, non-finite dates, and oversized exports', () => {
  assert.equal(validateMemory({ version: 1, incidents: [incident(), incident()] }).valid, false);
  assert.equal(validateMemory({ version: 1, incidents: [incident({ createdAt: 'not-a-date' })] }).valid, false);
  assert.equal(validateMemory(' '.repeat(ENGINE_LIMITS.maxInputBytes + 1)).valid, false);
});

test('Imported evidence keeps literal markup, making output escaping an explicit UI responsibility', () => {
  const payload = '<img src=x onerror="globalThis.injected=true">';
  const result = validateMemory({ version: 1, incidents: [incident({ title: payload, fix: payload, evidence: payload })] });
  assert.equal(result.valid, true);
  assert.equal(result.memory.incidents[0].evidence, payload);
  assert.equal(result.memory.incidents[0].fix, payload);
});

test('Missing, zero, non-finite, and mismatched vectors never produce a candidate', () => {
  const query = failure('query', 'Synthetic symptom');
  const memories = [incident()];
  for (const map of [new Map(), new Map([['query', [0, 0]], ['synthetic-incident', [1, 0]]]), new Map([['query', [NaN, 1]], ['synthetic-incident', [1, 0]]]), new Map([['query', [1, 0]], ['synthetic-incident', [1, 0, 0]]])]) {
    const result = retrieveIncidents(query, memories, map);
    assert.equal(result.status, 'abstained');
    assert.deepEqual(result.candidates, []);
  }
  assert.equal(cosineSimilarity([Infinity, 0], [1, 0]), 0);
  assert.equal(cosineSimilarity([1e308, 1e308], [1e308, 1e308]), 1);
});

test('Identical nearest neighbors trigger ambiguity abstention rather than arbitrary confidence', () => {
  const memories = [incident({ id: 'a' }), incident({ id: 'b' })];
  const result = retrieveIncidents(failure('query', 'Synthetic symptom'), memories, new Map([['query', [1, 0]], ['a', [1, 0]], ['b', [1, 0]]]));
  assert.equal(result.status, 'abstained');
  assert.equal(result.reasonCode, 'AMBIGUOUS_NEIGHBORS');
  assert.deepEqual(result.candidates, []);
});

test('High similarity remains candidate-only and does not execute stored fix text', () => {
  const memory = incident({ fix: 'globalThis.groundhogSyntheticExecuted = true' });
  const result = retrieveIncidents(failure('query', 'Synthetic symptom'), [memory], new Map([['query', [1, 0]], ['synthetic-incident', [1, 0]]]));
  assert.equal(result.status, 'candidate-only');
  assert.equal(result.candidates[0].incident.fix, memory.fix);
  assert.equal(globalThis.groundhogSyntheticExecuted, undefined);
});
