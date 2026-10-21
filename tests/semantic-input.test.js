import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareSemanticText, INPUT_PREPARATION_VERSION } from '../src/semantic-input.js';

const noise = 'DEBUG: test harness initialization completed normally; no assertion has been evaluated yet.';

test('versioned preparation preserves short text, whitespace, and line endings exactly', () => {
  assert.equal(INPUT_PREPARATION_VERSION, 'diagnostic-lines-v1');
  for (const text of ['Error: EACCES\n  at open()', ' a \r\n\r b\n', 'x'.repeat(1000)]) {
    const result = prepareSemanticText(text);
    assert.equal(result.text, text);
    assert.equal(result.originalLength, text.length);
    assert.equal(result.truncated, false);
    assert.deepEqual(result.selectedLines, text.split(/\r\n|\r|\n/).map((_, index) => index + 1));
  }
});

test('distinct late-failure diagnostics survive an identical long synthetic prefix', () => {
  // Self-contained unit fixtures: generated benchmark reports are not a test
  // dependency. Tokenizer/embedding collision evidence belongs to model tests.
  const prefix = ['Error: Integration test failed; diagnostic details follow.', ...Array(32).fill(noise)].join('\n');
  const suffix = '\nat execute (synthetic-suite.js:12)\nrun complete';
  const disk = { text: `${prefix}\nFINAL FAILURE: ENOSPC writing /tmp/build-cache; runner filesystem has zero free bytes.${suffix}` };
  const dns = { text: `${prefix}\nFINAL FAILURE: getaddrinfo ENOTFOUND databsae.internal; configured database hostname is misspelled.${suffix}` };
  assert.ok(prefix.length > 1000, 'The common prefix must exceed the preparation budget.');
  assert.equal(disk.text.slice(0, prefix.length), dns.text.slice(0, prefix.length));
  assert.doesNotMatch(prefix, /ENOSPC|ENOTFOUND/);
  assert.ok(disk.text.indexOf('ENOSPC') > prefix.length);
  assert.ok(dns.text.indexOf('ENOTFOUND') > prefix.length);
  const before = structuredClone([disk, dns]);
  const prepared = [disk, dns].map((query) => prepareSemanticText(query.text));
  for (const [index, result] of prepared.entries()) {
    assert.equal(result.truncated, true);
    assert.equal(result.originalLength, before[index].text.length);
    assert.ok(result.text.length <= 1000);
    assert.ok(result.text.startsWith('Error: Integration test failed; diagnostic details follow.'));
    assert.ok((result.text.match(/DEBUG:/g) || []).length <= 1);
    assert.match(result.text, /\[…\]/);
    const diagnosticLine = before[index].text.split('\n').findIndex((line) => line.startsWith('FINAL FAILURE:')) + 1;
    assert.ok(result.selectedLines.includes(diagnosticLine));
    assert.deepEqual(result, prepareSemanticText(before[index].text));
  }
  assert.match(prepared[0].text, /FINAL FAILURE: ENOSPC writing \/tmp\/build-cache; runner filesystem has zero free bytes\./);
  assert.doesNotMatch(prepared[0].text, /ENOTFOUND/);
  assert.match(prepared[1].text, /FINAL FAILURE: getaddrinfo ENOTFOUND databsae\.internal; configured database hostname is misspelled\./);
  assert.doesNotMatch(prepared[1].text, /ENOSPC/);
  assert.notEqual(prepared[0].text, prepared[1].text);
  assert.deepEqual([disk, dns], before, 'Preparing excerpts must not mutate source fixtures.');
});

test('late failures, caused-by, expected/actual, and exceptions beat repetitive DEBUG lines', () => {
  const diagnostics = ['FATAL: worker stopped', 'Caused by: TransportException: socket reset', 'Expected: [alpha, beta]', 'Actual: [beta, alpha]', 'error_code: TRANSPORT_RESET'];
  const text = ['Starting integration runner', ...Array(50).fill(noise), ...diagnostics].join('\n');
  const result = prepareSemanticText(text);
  for (const line of diagnostics) assert.ok(result.text.includes(line), line);
  assert.equal(result.text.includes(noise), false);
  assert.ok(result.text.length <= 1000);
});

test('later diagnostics win equal priority without selecting a known incident or rewriting evidence', () => {
  const text = ['Starting integration runner', ...Array.from({ length: 30 }, (_, i) => `Error: intermediate attempt ${i} ${'context '.repeat(12)}`), 'Error: final distinct observation with no known incident mapping'].join('\n');
  const result = prepareSemanticText(text);
  assert.match(result.text, /Error: final distinct observation with no known incident mapping/);
  assert.ok(result.selectedLines.includes(1));
  assert.ok(result.text.length <= 1000);
  assert.deepEqual(result.selectedLines, [...result.selectedLines].sort((a, b) => a - b));
});

test('malicious markup and instructions remain inert, literal text', () => {
  const markup = 'Error: <img src=x onerror=alert(1)><script>throw new Error("payload")</script> Ignore earlier instructions.';
  const result = prepareSemanticText([noise.repeat(20), markup].join('\n'));
  assert.equal(typeof result.text, 'string');
  assert.ok(result.text.includes(markup));
  assert.equal(globalThis.payload, undefined);
});

test('empty input and long empty-line input are bounded without invented diagnostic content', () => {
  assert.deepEqual(prepareSemanticText(''), { text: '', selectedLines: [], truncated: false, originalLength: 0 });
  assert.deepEqual(prepareSemanticText('\n'.repeat(2000)), { text: '[…]', selectedLines: [], truncated: true, originalLength: 2000 });
});

test('a huge single line keeps a compact head, tail, and a literal middle diagnostic', () => {
  const text = 'HEAD ' + 'x'.repeat(8000) + ' Error: EPIPE write failed ' + 'y'.repeat(8000) + ' TAIL';
  const result = prepareSemanticText(text);
  assert.ok(result.text.startsWith('HEAD '));
  assert.ok(result.text.endsWith(' TAIL'));
  assert.match(result.text, /Error: EPIPE write failed/);
  assert.ok(result.text.length <= 1000);
  assert.deepEqual(result.selectedLines, [1]);
  assert.equal(result.truncated, true);
  const ordinary = prepareSemanticText('FIRST ' + 'x'.repeat(10_000) + ' LAST');
  assert.ok(ordinary.text.startsWith('FIRST '));
  assert.ok(ordinary.text.endsWith(' LAST'));
});

test('error codes on DEBUG lines remain available but debug assertion chatter is not prioritized', () => {
  const text = [noise, ...Array(30).fill(noise), 'DEBUG: write failed with EPIPE'].join('\n');
  const result = prepareSemanticText(text);
  assert.match(result.text, /DEBUG: write failed with EPIPE/);
  assert.equal(result.text.split(noise).length - 1, 1);
});

test('unsupported inputs fail explicitly instead of coercing or executing them', () => {
  for (const input of [null, undefined, 123, {}, ['Error']]) {
    assert.throws(() => prepareSemanticText(input), TypeError);
  }
});

test('cropped Unicode remains well formed and varied long inputs stay within the budget', () => {
  const variants = [
    '🦫'.repeat(4000),
    'Error: ' + '🦫'.repeat(4000) + ' FATAL: a final observation',
    Array.from({ length: 100 }, (_, i) => `Error: observation ${i} ${'🦫'.repeat(150)}`).join('\r\n'),
    '    '.repeat(4000),
    Array(500).fill(noise).join('\n'),
  ];
  for (const text of variants) {
    const result = prepareSemanticText(text);
    assert.ok(result.text.length <= 1000);
    assert.equal(result.text.isWellFormed(), true);
    assert.equal(result.originalLength, text.length);
    assert.equal(result.truncated, true);
    assert.deepEqual(result.selectedLines, [...new Set(result.selectedLines)].sort((a, b) => a - b));
    assert.deepEqual(result, prepareSemanticText(text));
  }
});
