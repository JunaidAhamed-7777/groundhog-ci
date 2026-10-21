import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const run = (...args) => spawnSync(process.execPath, ['tools/groundhog.mjs', ...args], { cwd: root, encoding: 'utf8', timeout: 10000 });

test('CLI help makes semantic download and review-only boundary explicit', () => {
  const result = run('--help');
  assert.equal(result.status, 0);
  assert.match(result.stdout, /--semantic/);
  assert.match(result.stdout, /human review/);
});

test('CLI exact mode imports actual generated exceptions and retains every failure', () => {
  const result = run('tests/fixtures/generated/captured.xml');
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.mode, 'exact-only');
  assert.equal(output.originalFailureCount, 18);
  assert.equal(output.groups.reduce((count, group) => count + group.count, 0), 18);
  assert.ok(output.groups.every((group) => group.retrieval === null));
});

test('CLI reports missing files with failure exit status, not empty success', () => {
  const result = run('tests/fixtures/nonexistent.xml');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Groundhog:/);
  assert.equal(result.stdout, '');
});

test('CLI refuses unexpected flags before reading reports', () => {
  const result = run('tests/fixtures/generated/captured.xml', '--execute-fix');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unknown argument/);
});
