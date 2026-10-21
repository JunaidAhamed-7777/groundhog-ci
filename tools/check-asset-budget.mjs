import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const MAX_STATIC_ASSET_BYTES = 25 * 1024 * 1024;

export async function inspectAssetBudget(directory, limit = MAX_STATIC_ASSET_BYTES) {
  const assets = [];
  async function walk(current) {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const location = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(location);
      else if (entry.isFile()) assets.push({ path: path.relative(directory, location), bytes: (await fs.stat(location)).size });
      else throw new Error(`Unsupported static asset type: ${location}`);
    }
  }
  await walk(directory);
  return { limit, assets, oversized: assets.filter((asset) => asset.bytes > limit) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const report = await inspectAssetBudget(path.resolve(process.argv[2] ?? 'dist'));
  console.log(JSON.stringify(report, null, 2));
  if (report.oversized.length) {
    console.error('Static asset limit exceeded: every published file must be at most 25 MiB.');
    process.exitCode = 1;
  }
}
