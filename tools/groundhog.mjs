#!/usr/bin/env node
import { readFile, stat } from 'node:fs/promises';
import { parseJUnit, groupFailures, validateMemory, retrieveIncidents, normalizeFailure } from '../src/engine.js';

const args = process.argv.slice(2);
if (args.includes('--help') || args.length === 0) {
  console.log('Groundhog: review recurring CI symptoms, never execute a fix.\n\nUsage: node tools/groundhog.mjs report.xml [memory.json] [--semantic]\n\nExact grouping is the default. --semantic explicitly downloads the pinned open model\nif uncached and performs CPU inference locally. Notebook files use version: 1.\nResults are JSON; all semantic suggestions require human review.');
  process.exit(0);
}

async function boundedRead(filename) {
  const info = await stat(filename);
  if (!info.isFile() || info.size > 2 * 1024 * 1024) throw new Error('Inputs must be regular files no larger than 2 MiB.');
  return readFile(filename, 'utf8');
}

try {
  const paths = args.filter((arg) => !arg.startsWith('--'));
  if (paths.length > 2 || args.some((arg) => arg.startsWith('--') && arg !== '--semantic')) throw new Error('Unknown argument. Use --help.');
  const failures = parseJUnit(await boundedRead(paths[0]));
  const groups = groupFailures(failures);
  let incidents = [];
  if (paths[1]) {
    const result = validateMemory(await boundedRead(paths[1]));
    if (!result.valid) throw new Error(result.errors.join(' '));
    incidents = result.memory.incidents;
  }
  const semantic = args.includes('--semantic');
  const vectors = new Map();
  if (semantic && groups.length && incidents.length) {
    if (groups.length + incidents.length > 1000) throw new Error('Semantic mode supports up to 1,000 combined groups and memories per run. Split larger inputs.');
    console.error('Loading the open model locally; only model assets may be downloaded.');
    const { embedTextsNode } = await import('./embed-node.mjs');
    const items = [...groups.map((group) => ({ id: group.representative.id, text: group.signature })), ...incidents.map((incident) => ({ id: incident.id, text: normalizeFailure(incident.symptom) }))];
    const embeddings = await embedTextsNode(items.map((item) => item.text));
    items.forEach((item, index) => vectors.set(item.id, embeddings[index]));
  }
  console.log(JSON.stringify({
    version: 1,
    mode: semantic ? 'semantic-requested' : 'exact-only',
    warning: 'Repeated symptoms and semantic similarity do not establish a common root cause. Review every suggestion.',
    originalFailureCount: failures.length,
    exactGroupCount: groups.length,
    groups: groups.map((group) => ({
      ...group,
      retrieval: semantic ? retrieveIncidents(group.representative, incidents, vectors) : null,
    })),
  }, null, 2));
} catch (error) {
  console.error(`Groundhog: ${error.message}`);
  process.exitCode = 1;
}
