#!/usr/bin/env node
/** Reproducible synthetic retrieval evaluation. Never measures human time saved. */
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { RETRIEVAL_POLICY } from '../src/retrieval-policy.js';
import { normalizeFailure, cosineSimilarity, retrieveIncidents } from '../src/engine.js';
import { SEED_INCIDENTS } from '../src/demo-data.js';
import { embedTextsNode, MODEL_INFO } from './embed-node.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const evidencePath = path.join(root, 'evidence/evaluation.json');
const fixturePath = path.join(root, 'tests/fixtures/retrieval.json');
const args = new Set(process.argv.slice(2));
if ([...args].some((arg) => !['--calibrate', '--heldout', '--verify'].includes(arg)) || args.size > 1) {
  throw new Error('Use no flag (verify saved policy, or calibrate then evaluate), --calibrate, --heldout, or --verify.');
}
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const originalDefaults = Object.freeze({ minSimilarity: 0.78, minMargin: 0.08, topK: 3 });
const semanticGrid = Object.freeze({ scores: Array.from({ length: 26 }, (_, i) => Number((0.4 + i * 0.02).toFixed(2))), margins: [0.04, 0.08, 0.12, 0.16, 0.20] });
const lexicalGrid = Object.freeze({ scores: [0.05, 0.10, 0.15, 0.20, 0.25, 0.30, 0.35, 0.40, 0.45, 0.50], margins: [0, 0.025, 0.05, 0.10, 0.15] });
const selectionRule = 'Use calibration only. Require zero accepted wrong or novel matches; maximize correctly accepted known cases; ties prefer higher minimum score, then higher margin. No held-out labels or scores participate.';
const lexicalTokens = (value) => new Set(normalizeFailure(value).toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? []);
const jaccard = (left, right) => {
  const a = lexicalTokens(left), b = lexicalTokens(right);
  const intersection = [...a].filter((token) => b.has(token)).length;
  return a.size + b.size - intersection ? intersection / (a.size + b.size - intersection) : 0;
};
const summarizeTimings = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return { samples: values.length, meanMs: values.reduce((sum, value) => sum + value, 0) / values.length, medianMs: sorted[Math.floor(sorted.length / 2)], p95Ms: sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)], minMs: sorted[0], maxMs: sorted.at(-1) };
};
const ratio = (numerator, denominator) => denominator ? numerator / denominator : null;
const rank = (query, vectors, method) => SEED_INCIDENTS.map((incident) => ({
  id: incident.id,
  score: method === 'semantic' ? cosineSimilarity(vectors.get(query.id), vectors.get(incident.id)) : method === 'lexical' ? jaccard(query.query, incident.symptom) : Number(normalizeFailure(query.query) === normalizeFailure(incident.symptom)),
})).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));

function decide(query, vectors, method, policy) {
  const ranked = rank(query, vectors, method);
  let acceptedId = null, reason;
  if (method === 'semantic') {
    const decision = retrieveIncidents({ id: query.id, name: query.id, suite: 'synthetic evaluation', message: query.query, detail: '' }, SEED_INCIDENTS, vectors, policy);
    acceptedId = decision.candidates[0]?.incident.id ?? null;
    reason = decision.reasonCode;
  } else {
    const threshold = method === 'exact' ? 1 : policy.minSimilarity;
    const margin = method === 'exact' ? 0 : policy.minMargin;
    if (ranked[0].score < threshold) reason = 'BELOW_THRESHOLD';
    else if (ranked.length > 1 && ranked[0].score - ranked[1].score < margin) reason = 'AMBIGUOUS_NEIGHBORS';
    else { acceptedId = ranked[0].id; reason = 'CANDIDATE_ONLY'; }
  }
  return { id: query.id, kind: query.kind, expectedIncidentId: query.expectedIncidentId, acceptedId, correctAcceptance: acceptedId !== null && acceptedId === query.expectedIncidentId, reason, ranked };
}

function metrics(rows) {
  const known = rows.filter((row) => row.expectedIncidentId !== null);
  const novel = rows.filter((row) => row.expectedIncidentId === null);
  const accepted = rows.filter((row) => row.acceptedId !== null);
  const correct = accepted.filter((row) => row.correctAcceptance);
  const novelAccepted = novel.filter((row) => row.acceptedId !== null);
  const topK = (count) => known.filter((row) => row.ranked.slice(0, count).some((entry) => entry.id === row.expectedIncidentId && entry.score > 0)).length;
  return {
    total: rows.length, known: known.length, novel: novel.length,
    accepted: accepted.length, correctAccepted: correct.length, wrongAccepted: accepted.length - correct.length,
    acceptedPrecision: ratio(correct.length, accepted.length), abstentionRate: ratio(rows.length - accepted.length, rows.length),
    knownCorrectAcceptanceRate: ratio(correct.length, known.length), novelFalseMatches: novelAccepted.length,
    novelFalseMatchRate: ratio(novelAccepted.length, novel.length),
    knownTop1Retrieval: ratio(topK(1), known.length), knownTop3Retrieval: ratio(topK(3), known.length),
    knownWrongAcceptance: known.filter((row) => row.acceptedId !== null && !row.correctAcceptance).length,
    note: 'Top-k ranks are measured before abstention. Top-3 is weak evidence with only three memory candidates. Precision is null when there are no accepted candidates.',
  };
}

function selectPolicy(queries, vectors, method, grid) {
  const candidates = [];
  for (const minSimilarity of grid.scores) for (const minMargin of grid.margins) {
    const policy = { minSimilarity, minMargin, topK: 3 };
    const result = metrics(queries.map((query) => decide(query, vectors, method, policy)));
    if (result.wrongAccepted === 0) candidates.push({ policy, metrics: result });
  }
  candidates.sort((a, b) => b.metrics.correctAccepted - a.metrics.correctAccepted || b.policy.minSimilarity - a.policy.minSimilarity || b.policy.minMargin - a.policy.minMargin);
  if (!candidates.length) throw new Error(`No ${method} grid policy satisfied the predeclared zero-calibration-false-accept condition.`);
  return { ...candidates[0], gridPoliciesEvaluated: grid.scores.length * grid.margins.length };
}

const fixtureBytes = await fs.readFile(fixturePath);
const fixture = JSON.parse(fixtureBytes);
const sourceHashes = {
  fixtureSha256: sha256(fixtureBytes),
  corpusSha256: sha256(JSON.stringify(SEED_INCIDENTS)),
  engineSha256: sha256(await fs.readFile(path.join(root, 'src/engine.js'))),
  embeddingAdapterSha256: sha256(await fs.readFile(path.join(root, 'tools/embed-node.mjs'))),
  embeddingPipelineSha256: sha256(await fs.readFile(path.join(root, 'src/embedding-pipeline.js'))),
  inputPreparationSha256: sha256(await fs.readFile(path.join(root, 'src/semantic-input.js'))),
  modelInfoSha256: sha256(await fs.readFile(path.join(root, 'src/model-info.js'))),
  packageLockSha256: sha256(await fs.readFile(path.join(root, 'package-lock.json'))),
  retrievalPolicySha256: sha256(await fs.readFile(path.join(root, 'src/retrieval-policy.js'))),
  evaluatorSha256: sha256(await fs.readFile(fileURLToPath(import.meta.url))),
};
const allIds = [...SEED_INCIDENTS.map((item) => item.id), ...fixture.calibration.map((item) => item.id), ...fixture.heldOut.map((item) => item.id)];
if (new Set(allIds).size !== allIds.length) throw new Error('Fixture and incident IDs must be globally unique.');
for (const split of [fixture.calibration, fixture.heldOut]) for (const item of split) {
  if (typeof item.query !== 'string' || (item.expectedIncidentId !== null && !SEED_INCIDENTS.some((incident) => incident.id === item.expectedIncidentId))) throw new Error(`Invalid query fixture ${item.id}`);
}
const corpusText = SEED_INCIDENTS.map((incident) => normalizeFailure(incident.symptom));
const normalizedTraining = new Set(corpusText.concat(fixture.calibration.map((item) => normalizeFailure(item.query))));
if (fixture.heldOut.some((item) => normalizedTraining.has(normalizeFailure(item.query)))) throw new Error('Held-out query is an exact normalized duplicate of corpus/calibration text.');
const startupStarted = performance.now();
const corpusEmbeddings = await embedTextsNode(corpusText);
const startupMs = performance.now() - startupStarted;
const vectors = new Map(SEED_INCIDENTS.map((incident, i) => [incident.id, corpusEmbeddings[i]]));

let savedEvidence;
try { savedEvidence = JSON.parse(await fs.readFile(evidencePath, 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const verifying = args.has('--verify') || (args.size === 0 && savedEvidence?.status === 'evaluated');
if (verifying && savedEvidence?.status !== 'evaluated') throw new Error('Verification requires an existing completed evaluation and frozen policy.');
let evidence;
if (!args.has('--heldout') && !verifying) {
  const calibrationEmbeddings = await embedTextsNode(fixture.calibration.map((item) => normalizeFailure(item.query)));
  fixture.calibration.forEach((item, index) => vectors.set(item.id, calibrationEmbeddings[index]));
  const semantic = selectPolicy(fixture.calibration, vectors, 'semantic', semanticGrid);
  const lexical = selectPolicy(fixture.calibration, vectors, 'lexical', lexicalGrid);
  evidence = {
    schemaVersion: 1, status: 'calibration-frozen',
    provenance: fixture.provenance, splitPolicy: fixture.splitPolicy,
    scope: 'Three authored synthetic memories and authored synthetic language variants; no production logs, root-cause verification, human-user study, or developer-time-saved measurement.',
    sourceHashes, model: { ...MODEL_INFO, evaluatedRuntime: 'Node.js native ONNX Runtime CPU (not browser WebAssembly)' },
    environment: { node: process.version, platform: process.platform, arch: process.arch, cpu: os.cpus()[0]?.model ?? null, logicalCpus: os.cpus().length },
    corpus: { count: SEED_INCIDENTS.length, embeddingInput: 'normalizeFailure(incident.symptom); excludes title, fix, and evidence', queryInput: 'normalizeFailure(query.query)', ids: SEED_INCIDENTS.map((incident) => incident.id) },
    configuration: { originalDefaults, selectionRule, semanticGrid, lexicalGrid, semantic: semantic.policy, lexical: lexical.policy, frozenBeforeHeldOutAt: new Date().toISOString() },
    calibration: { count: fixture.calibration.length, semantic, lexical,
      originalDefaults: metrics(fixture.calibration.map((query) => decide(query, vectors, 'semantic', originalDefaults))),
      semanticRows: fixture.calibration.map((query) => decide(query, vectors, 'semantic', semantic.policy)),
      lexicalRows: fixture.calibration.map((query) => decide(query, vectors, 'lexical', lexical.policy)),
    },
    timings: { calibrationProcessModelInitializationAndCorpusEmbeddingMs: startupMs, startupNote: 'First call in this process includes model initialization and embedding three memories. Existing disk cache may avoid downloads. Not a browser cold-start or first-network-download measurement.' },
    limitations: [
      'Authored synthetic cases and a three-memory corpus are not evidence of production accuracy or saved developer time.',
      'Calibration and held-out cases share the same three authored failure families; this is a language-variant stress test, not an independently sampled distribution.',
      'The calibration set is tiny; zero observed false matches does not establish a low real-world false-match rate.',
      'Cosine similarity is not a probability, confidence, or root-cause proof. Every accepted result is only a human-review candidate.',
      'Top-3 retrieval is nearly trivial because the corpus contains only three incidents.',
      'Tokenization truncates to 256 tokens; long reports can lose causal information. This benchmark uses short individual symptoms.',
      'Node CPU timings do not establish browser performance, offline readiness, or cross-device performance.',
      'Retrieval queries are individual symptom strings. This is not an end-to-end evaluation of JUnit type/message/detail assembly or a full CI triage workflow.',
    ],
  };
  await fs.mkdir(path.dirname(evidencePath), { recursive: true });
  await fs.writeFile(evidencePath, JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify({ phase: 'calibration-frozen', policy: evidence.configuration, calibration: { semantic: semantic.metrics, lexical: lexical.metrics, originalDefaults: evidence.calibration.originalDefaults } }, null, 2));
  if (args.has('--calibrate')) process.exit(0);
} else {
  evidence = savedEvidence;
  for (const key of ['fixtureSha256', 'corpusSha256']) {
    if (evidence.sourceHashes[key] !== sourceHashes[key]) throw new Error(`Evaluation data changed: ${key}. Do not relabel previously inspected cases as new holdout data.`);
  }
  if (!verifying) {
    for (const key of ['engineSha256', 'embeddingAdapterSha256']) {
      if (evidence.sourceHashes[key] !== sourceHashes[key]) throw new Error(`Source changed after calibration: ${key}. Reconcile changes explicitly before first held-out scoring.`);
    }
  } else {
    evidence.firstHeldOutEvaluation ??= { evaluatedAt: evidence.evaluatedAt, sourceHashes: evidence.sourceHashes, model: evidence.model, results: evidence.heldOut.results, timings: evidence.timings };
    // Older verification records predate model metadata retention. The prior
    // result's model remains available until this run installs current metadata.
    evidence.firstHeldOutEvaluation.model ??= evidence.model;
    evidence.sourceHashes = sourceHashes;
    evidence.verificationHistory ??= [];
    evidence.verificationHistory.push({ startedAt: new Date().toISOString(), sourceHashes, model: { ...MODEL_INFO }, purpose: 'Implementation regression check using the original frozen policies. The previously inspected held-out cases are reused; no threshold selection is performed.' });
  }
}

// The policies were persisted before any held-out embeddings or scoring occur.
const warmTimings = [];
const semanticScoreTimings = [];
for (const query of fixture.heldOut) {
  const started = performance.now();
  const [vector] = await embedTextsNode([normalizeFailure(query.query)]);
  vectors.set(query.id, vector);
  const rankStarted = performance.now();
  decide(query, vectors, 'semantic', evidence.configuration.semantic);
  semanticScoreTimings.push(performance.now() - rankStarted);
  warmTimings.push(performance.now() - started);
}
const methods = {
  normalizedExact: { method: 'exact', policy: {} },
  lexicalJaccardCalibrated: { method: 'lexical', policy: evidence.configuration.lexical },
  semanticOriginalDefaults: { method: 'semantic', policy: evidence.configuration.originalDefaults },
  semanticCalibrated: { method: 'semantic', policy: evidence.configuration.semantic },
};
const heldOutResults = {};
for (const [name, { method, policy }] of Object.entries(methods)) {
  const started = performance.now();
  const rows = fixture.heldOut.map((query) => decide(query, vectors, method, policy));
  heldOutResults[name] = { policy, metrics: metrics(rows), scoringTotalMs: performance.now() - started, rows };
}
const exactControls = SEED_INCIDENTS.map((incident) => ({ id: `exact-control-${incident.id}`, query: incident.symptom, expectedIncidentId: incident.id, kind: 'exact-replay-control' }));
evidence.status = 'evaluated';
evidence.model = { ...MODEL_INFO, evaluatedRuntime: 'Node.js native ONNX Runtime CPU (not browser WebAssembly)' };
evidence.evaluatedAt = new Date().toISOString();
evidence.heldOut = { count: fixture.heldOut.length, results: heldOutResults };
evidence.exactReplayControl = { excludedFromHeldOutMetrics: true, metrics: metrics(exactControls.map((query) => decide(query, vectors, 'exact', {}))) };
evidence.timings = { ...evidence.timings, evaluationProcessModelInitializationAndCorpusEmbeddingMs: startupMs, warmSingleQueryEmbeddingAndRetrieval: summarizeTimings(warmTimings), warmRetrievalOnly: summarizeTimings(semanticScoreTimings), workload: 'One sequential batch-of-one inference and ranking against three pre-embedded memories per held-out query; model already initialized; the evaluator issues no concurrent inference requests, but other host load is uncontrolled.' };
evidence.observedFailures = Object.entries(heldOutResults).flatMap(([method, result]) => result.rows.filter((row) => row.acceptedId !== null && !row.correctAcceptance).map((row) => ({ method, ...row })));
if (!evidence.limitations.some((item) => item.startsWith('Retrieval queries'))) evidence.limitations.push('Retrieval queries are individual symptom strings. This is not an end-to-end evaluation of JUnit type/message/detail assembly or a full CI triage workflow.');
evidence.deployedPolicy = { ...RETRIEVAL_POLICY };
evidence.deployedPolicyMatchesFrozen = JSON.stringify(RETRIEVAL_POLICY) === JSON.stringify(evidence.configuration.semantic);
const testStarted = performance.now();
let securityRun;
try {
  const result = await promisify(execFile)(process.execPath, ['--test', '--test-reporter=tap', 'tests/adversarial.test.js'], { cwd: root, maxBuffer: 1024 * 1024 });
  securityRun = { exitCode: 0, output: result.stdout };
} catch (error) {
  securityRun = { exitCode: Number.isInteger(error.code) ? error.code : 1, output: `${error.stdout ?? ''}\n${error.stderr ?? ''}` };
}
evidence.securityTests = {
  command: 'node --test --test-reporter=tap tests/adversarial.test.js',
  completedAt: new Date().toISOString(), durationMs: performance.now() - testStarted,
  exitCode: securityRun.exitCode,
  tests: Number(securityRun.output.match(/^# tests (\d+)/m)?.[1] ?? 0),
  passed: Number(securityRun.output.match(/^# pass (\d+)/m)?.[1] ?? 0),
  failed: Number(securityRun.output.match(/^# fail (\d+)/m)?.[1] ?? 0),
  testFileSha256: sha256(await fs.readFile(path.join(root, 'tests/adversarial.test.js'))),
  scope: 'XML malformed/DTD/entity/byte-depth-field-count rejection; diagnostic-value preservation; memory import validation; inert text preservation; invalid embeddings; ambiguity abstention; no command execution.',
  limitations: 'These deterministic Node tests do not execute the browser DOM. Imported markup remains literal data, so UI output escaping must also be verified in the browser. Common-secret redaction is best effort, not a security guarantee.',
};
if (securityRun.exitCode !== 0) evidence.securityTests.failureOutput = securityRun.output;
await fs.writeFile(evidencePath, JSON.stringify(evidence, null, 2) + '\n');
const pct = (value) => value === null ? 'not defined (no accepted candidates)' : `${(value * 100).toFixed(1)}%`;
const lines = [
  '# Groundhog retrieval evaluation', '',
  ...(verifying ? ['This is a regression verification on the previously inspected held-out split, using the original frozen policies without retuning. The first held-out run is retained in JSON.', ''] : []),
  `Generated: ${evidence.evaluatedAt}. Configuration frozen: ${evidence.configuration.frozenBeforeHeldOutAt}.`, '',
  '**Synthetic evidence only.** Three authored historical memories; 13 calibration cases and 24 held-out language variants. No production logs, real developer time savings, or verified root causes are claimed.', '',
  '## Method', '',
  'The exact baseline compares normalized symptom strings. The lexical baseline uses token-set Jaccard similarity. The semantic system uses the real pinned q8 all-MiniLM-L6-v2 model. All methods use only symptom text, never the stored fix or evidence.', '',
  selectionRule, '',
  `Frozen semantic threshold: ${evidence.configuration.semantic.minSimilarity}; margin: ${evidence.configuration.semantic.minMargin}. Frozen lexical threshold: ${evidence.configuration.lexical.minSimilarity}; margin: ${evidence.configuration.lexical.minMargin}. Original semantic defaults (${originalDefaults.minSimilarity}, margin ${originalDefaults.minMargin}) are reported separately, not silently replaced.`, '',
  '## Held-out results', '',
];
for (const [name, result] of Object.entries(heldOutResults)) {
  const m = result.metrics;
  lines.push(`### ${name}`, '', `- Accepted: ${m.accepted}/${m.total}; correct accepted: ${m.correctAccepted}; wrong accepted: ${m.wrongAccepted}.`, `- Accepted precision: ${pct(m.acceptedPrecision)}; abstention: ${pct(m.abstentionRate)}.`, `- Known-case correct acceptance: ${m.correctAccepted}/${m.known} (${pct(m.knownCorrectAcceptanceRate)}).`, `- Novel false matches: ${m.novelFalseMatches}/${m.novel} (${pct(m.novelFalseMatchRate)}).`, `- Known top-1 / top-3 before abstention: ${pct(m.knownTop1Retrieval)} / ${pct(m.knownTop3Retrieval)}.`, '');
}
lines.push('## Measured runtime', '', `Runtime: Node.js ${process.version}, native ONNX Runtime CPU, ${os.cpus()[0]?.model}. Not browser WASM.`, '', `Warm single-query embedding plus retrieval, ${warmTimings.length} sequential queries: median ${evidence.timings.warmSingleQueryEmbeddingAndRetrieval.medianMs.toFixed(2)} ms; p95 ${evidence.timings.warmSingleQueryEmbeddingAndRetrieval.p95Ms.toFixed(2)} ms. Model initialization plus three corpus embeddings: ${startupMs.toFixed(2)} ms with cache state not asserted.`, '', '## Observed false accepts', '');
if (!evidence.observedFailures.length) lines.push('None observed in this small authored held-out split. This is not evidence of zero real-world risk.', '');
else for (const row of evidence.observedFailures) lines.push(`- ${row.method}: ${row.id} accepted ${row.acceptedId}; expected ${row.expectedIncidentId ?? 'abstention'}.`);
lines.push('', '## Adversarial security regression checks', '',
  `Command: ${evidence.securityTests.command}. Result: ${evidence.securityTests.passed}/${evidence.securityTests.tests} passed; ${evidence.securityTests.failed} failed; exit ${evidence.securityTests.exitCode}.`, '',
  evidence.securityTests.scope, '', evidence.securityTests.limitations, '',
  'Two normalization collisions were found during review and fixed with explicit regression tests: duration assertion values were being erased, and Unicode compatibility folding merged superscript ² with ordinary 2.', '',
  'Static UI review found escaping at inspected symptom/title/fix/evidence display sites. This source inspection is not a substitute for dynamic browser injection testing. Imported notes must not be represented as verified by the current user merely because JSON validation succeeded.', '',
  '## Limits and interpretation', '', ...evidence.limitations.map((item) => `- ${item}`), '', 'The three exact-replay controls are reported separately in JSON and excluded from held-out accuracy metrics. Their purpose is to verify that the exact baseline can retrieve unchanged memories, not to inflate results.', '', 'Detailed ranks, acceptance decisions, calibration scores, file hashes, model revision/hash and timings are in evaluation.json.', '', 'Reproduce from the project root:', '', '    NODE_USE_ENV_PROXY=1 node tools/evaluate.mjs', '', 'Or preserve the two-phase boundary explicitly:', '', '    NODE_USE_ENV_PROXY=1 node tools/evaluate.mjs --calibrate', '    NODE_USE_ENV_PROXY=1 node tools/evaluate.mjs --heldout', '', 'After implementation-only changes, reuse the frozen policies without retuning:', '', '    NODE_USE_ENV_PROXY=1 node tools/evaluate.mjs --verify', '');
await fs.writeFile(path.join(root, 'evidence/evaluation.md'), lines.join('\n'));
console.log(JSON.stringify({ phase: verifying ? 'frozen-policy-regression-verified' : 'heldout-evaluated', results: Object.fromEntries(Object.entries(heldOutResults).map(([name, result]) => [name, result.metrics])), timings: evidence.timings }, null, 2));
if (evidence.securityTests.exitCode !== 0 || !evidence.deployedPolicyMatchesFrozen) {
  console.error('Evaluation evidence was written, but adversarial checks failed or deployed policy differs from the frozen calibration policy.');
  process.exitCode = 1;
}
