import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { test } from 'node:test';
import { inspectAssetBudget, MAX_STATIC_ASSET_BYTES } from '../tools/check-asset-budget.mjs';

test('asset budget enforces the exact 25 MiB file limit recursively', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'groundhog-budget-'));
  try {
    await fs.mkdir(path.join(directory, 'assets'));
    await fs.writeFile(path.join(directory, 'index.html'), '<!doctype html>');
    const allowed = path.join(directory, 'assets', 'at-limit.wasm');
    await fs.writeFile(allowed, '');
    await fs.truncate(allowed, MAX_STATIC_ASSET_BYTES);
    let report = await inspectAssetBudget(directory);
    assert.equal(report.oversized.length, 0);
    await fs.truncate(allowed, MAX_STATIC_ASSET_BYTES + 1);
    report = await inspectAssetBudget(directory);
    assert.deepEqual(report.oversized, [{ path: path.join('assets', 'at-limit.wasm'), bytes: MAX_STATIC_ASSET_BYTES + 1 }]);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

test('asset budget cannot report success for a missing build directory', async () => {
  await assert.rejects(inspectAssetBudget(path.join(os.tmpdir(), 'groundhog-no-such-build', 'missing')), /ENOENT/);
});
