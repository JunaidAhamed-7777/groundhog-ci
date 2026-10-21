#!/usr/bin/env node
/** Fixed-policy synthetic stress evaluation. Never calibrates or edits the application. */
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { parseJUnit, groupFailures, normalizeFailure, cosineSimilarity, retrieveIncidents, validateMemory } from '../src/engine.js';
import { RETRIEVAL_POLICY } from '../src/retrieval-policy.js';
import { prepareSemanticText, INPUT_PREPARATION_VERSION } from '../src/semantic-input.js';
import { embedTextsNode, loadTokenizerNode, MODEL_INFO } from './embed-node.mjs';
import { env } from '@huggingface/transformers';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const fixturePath = path.join(root, 'tests/fixtures/stress-memory.json');
const evidencePath = path.join(root, 'evidence/stress-evaluation.json');
const markdownPath = path.join(root, 'evidence/stress-evaluation.md');
const mode = process.argv[2];
if (process.argv.length !== 3 || !['--freeze', '--run', '--verify', '--verify-wasm'].includes(mode)) {
  throw new Error('Use --freeze to publish the protocol before scoring, --run for its first evaluation, --verify for a native CPU regression, or --verify-wasm for CPU-WASM under Node (not browser UI).');
}
const wasmAdapter = mode === '--verify-wasm' ? await import('./embed-wasm-node.mjs') : null;
const embedForRun = wasmAdapter?.embedTextsWasm ?? embedTextsNode;
const evaluatedRuntime = wasmAdapter?.WASM_RUNTIME_INFO.runtime ?? 'Node.js native ONNX Runtime CPU, not browser WebAssembly';
const sha = (text) => crypto.createHash('sha256').update(text).digest('hex');
const ratio = (a, b) => b ? a / b : null;
const xmlEscape = (value) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
const pct = (value) => value === null ? 'undefined (no accepted results)' : `${(100 * value).toFixed(1)}%`;
const timings = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return { samples: values.length, medianMs: sorted[Math.floor(sorted.length / 2)] ?? null, p95Ms: sorted[Math.ceil(sorted.length * .95) - 1] ?? null, minMs: sorted[0] ?? null, maxMs: sorted.at(-1) ?? null, meanMs: values.length ? values.reduce((a, b) => a + b, 0) / values.length : null };
};
const filesToHash = ['tests/fixtures/stress-memory.json', 'tools/stress-evaluate.mjs', 'tools/embed-node.mjs', 'src/engine.js', 'src/retrieval-policy.js', 'src/model-info.js', 'src/embedding-pipeline.js', 'src/semantic-input.js', 'tools/embed-wasm-node.mjs', 'package.json', 'package-lock.json'];
async function hashes() { return Object.fromEntries(await Promise.all(filesToHash.map(async (file) => [file, sha(await fs.readFile(path.join(root, file)))]))); }
const fixture = JSON.parse(await fs.readFile(fixturePath, 'utf8'));
assert.deepEqual(RETRIEVAL_POLICY, fixture.protocol.semanticPolicy, 'The deployed policy must remain the originally frozen 0.68/0.20 policy.');
assert.equal(fixture.incidents.length, 20);
assert.equal(fixture.cases.length, 65);
assert.equal(validateMemory({ version: 1, incidents: fixture.incidents }).valid, true);
assert.equal(new Set([...fixture.incidents, ...fixture.cases].map((item) => item.id)).size, 85);
for (const item of fixture.cases) assert.ok(item.expectedIncidentId === null || fixture.incidents.some((memory) => memory.id === item.expectedIncidentId));
const sources = await hashes();
let evidence;
try { evidence = JSON.parse(await fs.readFile(evidencePath, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }

function renderProtocol() {
  return ['# Groundhog larger-memory stress evaluation', '', '**Authored synthetic stress data, not production evidence. No real developer time savings are measured.**', '',
    `Protocol frozen: ${evidence.frozenAt}. Status: ${evidence.status}.`, '', '## Predeclared protocol', '',
    fixture.provenance, '', '- 20 distinct historical memories, 40 known variants, 20 deliberately close novel causes, and 5 separate long-log/negation probes.',
    '- Every query becomes two generated JUnit failures. Parse, normalize and group them using the actual engine before embedding each group signature.',
    '- Memory embeddings contain only normalized symptoms. Labels, IDs, titles, fixes and evidence are never passed to the model.',
    '- Fixed semantic threshold 0.68 and margin 0.20; fixed lexical Jaccard threshold 0.20 and margin 0.05. Both originate from the earlier three-memory calibration, not this dataset.',
    '- Report known top-1/top-3 ranking over 20 memories before abstention, accepted precision and known coverage, novel false acceptance, exact grouping, truncation and runtime.',
    '- Novel examples explicitly identify a different underlying cause, even when a diagnostic code overlaps. Labels are authored hypotheses rather than outcomes of real failed tests.',
    '- Report stress probes separately from the 60 ordinary cases. Exact-replay controls are separate and cannot inflate variant accuracy.',
    '- No threshold search, relabeling, score-based case removal or application changes. Retain first-run results; later runs are regression verification, not fresh held-out evidence.',
    ...(evidence.preScoringAmendments?.length ? ['- A cache-only tokenizer configuration error was corrected before any model score. The original freeze hashes, error and amendment are retained in JSON; data and thresholds did not change.'] : []), '',
    'Reproduce with the existing cached pinned model:', '', '    node tools/stress-evaluate.mjs --freeze', '    node tools/stress-evaluate.mjs --run', '',
    'For an already completed run:', '', '    node tools/stress-evaluate.mjs --verify', '    node tools/stress-evaluate.mjs --verify-wasm', '',
    'The evaluator refuses network downloads. Populate the normal pinned model cache with the project model setup if it is not already present. It uses the unmodified embed-node adapter for all embedding calls.', ''];
}
if (mode === '--freeze') {
  if (evidence) throw new Error('A frozen protocol already exists. Do not replace inspected data with a new holdout under the same identity.');
  evidence = { schemaVersion: 1, status: 'protocol-frozen-before-scoring', frozenAt: new Date().toISOString(), provenance: fixture.provenance, protocol: fixture.protocol, sourceHashesAtFreeze: sources, firstRun: null, verificationRuns: [] };
  await fs.mkdir(path.dirname(evidencePath), { recursive: true });
  await fs.writeFile(evidencePath, JSON.stringify(evidence, null, 2) + '\n');
  await fs.writeFile(markdownPath, renderProtocol().join('\n'));
  console.log(JSON.stringify({ phase: evidence.status, frozenAt: evidence.frozenAt, fixtureSha256: sources['tests/fixtures/stress-memory.json'], policy: RETRIEVAL_POLICY, counts: fixture.protocol.counts }, null, 2));
  process.exit(0);
}
if (!evidence) throw new Error('First publish the protocol with --freeze.');
assert.equal(sources['tests/fixtures/stress-memory.json'], evidence.sourceHashesAtFreeze['tests/fixtures/stress-memory.json'], 'The frozen data changed.');
if (mode === '--run') {
  assert.equal(evidence.firstRun, null, 'First-run evidence already exists. Use --verify without retuning.');
  assert.deepEqual(sources, evidence.preScoringAmendments?.at(-1)?.sourceHashes ?? evidence.sourceHashesAtFreeze, 'Implementation changed after protocol freeze; reconcile rather than silently scoring changed code.');
} else assert.ok(evidence.firstRun, 'Verification requires a completed first run.');



function buildXml(cases) {
  const failed = cases.flatMap((item) => [0, 1].map((repeat) => {
    const detail = `${item.detail}\nat execute (/runner/${repeat ? 'second' : 'first'}/suite.js:${repeat ? '91:4' : '17:2'})\n2026-10-21T00:00:0${repeat}Z pid=${repeat ? 9103 : 2201}`;
    return `<testcase name="${xmlEscape(item.id)}__${repeat}" classname="synthetic.integration"><failure type="${xmlEscape(item.type)}" message="${xmlEscape(item.message)}">${xmlEscape(detail)}</failure></testcase>`;
  }));
  return `<?xml version="1.0"?><testsuites><testsuite name="Stress synthetic"><testcase name="passing"/><testcase name="skipped"><skipped/></testcase>${failed.join('')}</testsuite></testsuites>`;
}
const xml = buildXml(fixture.cases);
const parseBegin = performance.now();
const failures = parseJUnit(xml);
const parseMs = performance.now() - parseBegin;
const groupBegin = performance.now();
const groups = groupFailures(failures);
const groupMs = performance.now() - groupBegin;
assert.equal(failures.length, 130);
assert.equal(groups.length, 65);
const groupsByCase = new Map();
for (const group of groups) {
  assert.equal(group.count, 2);
  const ids = group.failures.map((failure) => failure.name.replace(/__\d$/, ''));
  assert.equal(new Set(ids).size, 1, 'Different test cases must not accidentally merge.');
  assert.ok(!groupsByCase.has(ids[0]));
  assert.ok(!group.signature.includes(ids[0]), 'Case ID must not leak into model input.');
  groupsByCase.set(ids[0], group);
}
const corpusInputs = fixture.incidents.map((memory) => normalizeFailure(memory.symptom));
for (const group of groups) assert.ok(!corpusInputs.includes(group.signature), 'Variant benchmark must not include exact memory replay.');

// Separate deterministic controls ensure exact replay works and distinct diagnostic values stay distinct.
const controlXml = `<testsuite>${fixture.incidents.flatMap((memory) => [0, 1].map((repeat) => `<testcase name="${memory.id}-${repeat}"><failure message="${xmlEscape(memory.symptom)}"/></testcase>`)).join('')}</testsuite>`;
const exactControlGroups = groupFailures(parseJUnit(controlXml));
assert.equal(exactControlGroups.length, 20);
assert.ok(exactControlGroups.every((group) => group.count === 2 && corpusInputs.includes(group.signature)));
const distinctDiagnostics = ['HTTP 401', 'HTTP 403', 'expected 3 got 4', 'expected 3 got 5', 'port 5432', 'port 5433', 'expected timeout 100 ms', 'expected timeout 500 ms'];
assert.equal(new Set(distinctDiagnostics.map(normalizeFailure)).size, distinctDiagnostics.length);
const normalizationRepeatMs = [];
for (let repeat = 0; repeat < 5; repeat++) {
  const start = performance.now();
  assert.equal(groupFailures(parseJUnit(xml)).length, 65);
  normalizationRepeatMs.push(performance.now() - start);
}

// Use the existing local cache only: no report text or synthetic data is transmitted.
env.allowRemoteModels = false;
env.allowLocalModels = true; // Required for cache-only mode; no model or text changes.
const tokenizer = await loadTokenizerNode();
const tokenDetails = new Map(groups.map((group) => {
  const prepared = MODEL_INFO.inputPreparationVersion === INPUT_PREPARATION_VERSION ? prepareSemanticText(group.signature) : { text: group.signature, truncated: false, selectedLines: null, originalLength: group.signature.length };
  const allIds = tokenizer(group.signature, { truncation: false, padding: false, return_tensor: false }).input_ids;
  const preparedIds = tokenizer(prepared.text, { truncation: false, padding: false, return_tensor: false }).input_ids;
  const keptIds = tokenizer(prepared.text, { truncation: true, padding: false, max_length: MODEL_INFO.maxTokens, return_tensor: false }).input_ids;
  assert.ok(Array.isArray(allIds) && Array.isArray(keptIds));
  return [group.representative.id, { originalTokens: allIds.length, preparedTokens: preparedIds.length, retainedTokens: keptIds.length, truncated: allIds.length > keptIds.length, tokenizerTruncated: preparedIds.length > keptIds.length, inputPreparationVersion: MODEL_INFO.inputPreparationVersion ?? null, inputPreparationTruncated: prepared.truncated, selectedLines: prepared.selectedLines, preparedText: prepared.text, truncatedTokenIdsSha256: sha(JSON.stringify(keptIds)) }];
}));
const startupStarted = performance.now();
const corpusVectors = await embedForRun(corpusInputs);
const startupMs = performance.now() - startupStarted;
const vectors = new Map(fixture.incidents.map((memory, index) => [memory.id, corpusVectors[index]]));
const embeddingTimes = [];
for (const item of fixture.cases) {
  const group = groupsByCase.get(item.id);
  const start = performance.now();
  const [vector] = await embedForRun([group.signature]);
  embeddingTimes.push({ id: item.id, ms: performance.now() - start });
  assert.equal(vector.length, MODEL_INFO.dimensions);
  vectors.set(group.representative.id, vector);
}
const lexicalTokens = (value) => new Set(value.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? []);
const jaccard = (left, right) => {
  const a = lexicalTokens(left), b = lexicalTokens(right);
  const common = [...a].filter((token) => b.has(token)).length;
  return a.size + b.size - common ? common / (a.size + b.size - common) : 0;
};
function evaluate(item, method) {
  const group = groupsByCase.get(item.id);
  const policy = method === 'semantic' ? RETRIEVAL_POLICY : method === 'lexical' ? fixture.protocol.lexicalPolicy : { minSimilarity: 1, minMargin: 0, topK: 3 };
  const ranked = fixture.incidents.map((memory, index) => ({ id: memory.id, score: method === 'semantic' ? cosineSimilarity(vectors.get(group.representative.id), vectors.get(memory.id)) : method === 'lexical' ? jaccard(group.signature, corpusInputs[index]) : Number(group.signature === corpusInputs[index]) })).sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1));
  let acceptedId = null, reasonCode;
  if (method === 'semantic') {
    const decision = retrieveIncidents(group.representative, fixture.incidents, vectors, RETRIEVAL_POLICY);
    acceptedId = decision.candidates[0]?.incident.id ?? null;
    reasonCode = decision.reasonCode;
    assert.ok(Math.abs(decision.bestScore - ranked[0].score) < 1e-10);
  } else if (ranked[0].score < policy.minSimilarity) reasonCode = 'BELOW_THRESHOLD';
  else if (ranked[0].score - ranked[1].score < policy.minMargin) reasonCode = 'AMBIGUOUS_NEIGHBORS';
  else { acceptedId = ranked[0].id; reasonCode = 'CANDIDATES_FOUND'; }
  const position = item.expectedIncidentId === null ? null : ranked.findIndex((candidate) => candidate.id === item.expectedIncidentId) + 1;
  return { id: item.id, split: item.split, kind: item.kind, expectedIncidentId: item.expectedIncidentId, acceptedId, correctAcceptance: acceptedId !== null && acceptedId === item.expectedIncidentId, reasonCode, expectedRank: position, topScore: ranked[0].score, margin: ranked[0].score - ranked[1].score, ranked };
}
function metrics(rows) {
  const known = rows.filter((row) => row.expectedIncidentId !== null), novel = rows.filter((row) => row.expectedIncidentId === null);
  const accepted = rows.filter((row) => row.acceptedId !== null), correct = rows.filter((row) => row.correctAcceptance);
  const novelAccepted = novel.filter((row) => row.acceptedId !== null);
  // Zero-scored ties are not evidence of a top-k exact retrieval.
  const topK = (k) => known.filter((row) => row.ranked.slice(0, k).some((candidate) => candidate.id === row.expectedIncidentId && candidate.score > 0)).length;
  return { total: rows.length, known: known.length, novel: novel.length, accepted: accepted.length, correctAccepted: correct.length, wrongAccepted: accepted.length - correct.length, acceptedPrecision: ratio(correct.length, accepted.length), allCaseAcceptedCoverage: ratio(accepted.length, rows.length), knownCorrectAcceptanceRate: ratio(correct.length, known.length), knownWrongAcceptance: known.filter((row) => row.acceptedId !== null && !row.correctAcceptance).length, novelFalseAccepts: novelAccepted.length, novelFalseAcceptRate: ratio(novelAccepted.length, novel.length), abstentionRate: ratio(rows.length - accepted.length, rows.length), knownTop1Count: topK(1), knownTop3Count: topK(3), knownTop1: ratio(topK(1), known.length), knownTop3: ratio(topK(3), known.length) };
}
const results = {};
for (const method of ['exact', 'lexical', 'semantic']) {
  const scoreStart = performance.now();
  const rows = fixture.cases.map((item) => evaluate(item, method));
  results[method] = { policy: method === 'semantic' ? RETRIEVAL_POLICY : method === 'lexical' ? fixture.protocol.lexicalPolicy : { minSimilarity: 1, minMargin: 0, topK: 3 }, main: metrics(rows.filter((row) => row.split !== 'stress')), stress: metrics(rows.filter((row) => row.split === 'stress')), all: metrics(rows), scoringTotalMs: performance.now() - scoreStart, rows };
}
const pair = fixture.cases.filter((item) => item.pair === 'tail-collision').map((item) => groupsByCase.get(item.id));
const pairTokens = pair.map((group) => tokenDetails.get(group.representative.id));
const tailProbe = { caseIds: ['stress-01', 'stress-02'], trueCausesDiffer: true, rawNormalizedInputsDiffer: pair[0].signature !== pair[1].signature, retainedTokenSequencesIdentical: pairTokens[0].truncatedTokenIdsSha256 === pairTokens[1].truncatedTokenIdsSha256, embeddingCosine: cosineSimilarity(...pair.map((group) => vectors.get(group.representative.id))), inputPreparationVersion: MODEL_INFO.inputPreparationVersion ?? null, expectedObservation: MODEL_INFO.inputPreparationVersion ? 'Seen-case functional regression: bounded preparation should expose the differing tail diagnostics. This is not new held-out evidence or proof that the selected fix works.' : 'When diagnostic differences fall after token 256, the model cannot observe them. Ranking equality is an information-loss finding, not a root-cause result.' };
if (MODEL_INFO.inputPreparationVersion) {
  assert.equal(tailProbe.retainedTokenSequencesIdentical, false, 'Prepared long-log tails should remain distinguishable.');
  assert.ok(tailProbe.embeddingCosine < .999999, 'Distinct diagnostic tails should not produce identical embeddings.');
} else {
  assert.equal(tailProbe.retainedTokenSequencesIdentical, true, 'Original long-log probe must actually lose its differing diagnostic tail.');
  assert.ok(tailProbe.embeddingCosine > .999999);
}
const scoringTimes = [];
for (const item of fixture.cases) {
  const group = groupsByCase.get(item.id), start = performance.now();
  retrieveIncidents(group.representative, fixture.incidents, vectors, RETRIEVAL_POLICY);
  scoringTimes.push(performance.now() - start);
}
const sourceHashesAtFinish = await hashes();
const result = {
  evaluatedAt: new Date().toISOString(), sourceHashes: sources, sourceHashesAtFinish, sourceStableDuringRun: JSON.stringify(sources) === JSON.stringify(sourceHashesAtFinish),
  model: { ...MODEL_INFO, evaluatedRuntime, wasmRuntimeInfo: wasmAdapter?.WASM_RUNTIME_INFO ?? null, cacheOnlyNoDownloads: true },
  environment: { node: process.version, platform: process.platform, arch: process.arch, cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length },
  junitPath: { generatedXmlSha256: sha(xml), bytes: Buffer.byteLength(xml), failedRecords: failures.length, exactGroups: groups.length, expectedGroups: 65, allDuplicatePairsCorrectlyGrouped: true, accidentalCrossCaseMerges: 0, passAndSkipOmitted: true, exactReplayControls: { excludedFromMainMetrics: true, failures: 40, groups: 20, exactRecalls: 20 }, distinctDiagnosticControls: { inputs: distinctDiagnostics, distinctNormalizedOutputs: distinctDiagnostics.length } },
  modelInputs: { corpus: fixture.incidents.map((memory, index) => ({ id: memory.id, text: corpusInputs[index] })), queries: fixture.cases.map((item) => { const group = groupsByCase.get(item.id); return { id: item.id, text: group.signature, ...tokenDetails.get(group.representative.id) }; }), note: 'IDs are bookkeeping keys only. Only text values were passed to embedTextsNode; no title, fix, evidence, expected target or case category was embedded.' },
  results, tailTruncationProbe: tailProbe,
  timings: { parseMs, groupMs, repeatedParseAndGroup: timings(normalizationRepeatMs), modelInitializationAndTwentyCorpusEmbeddingsMs: startupMs, warmSingleQueryEmbedding: timings(embeddingTimes.map((entry) => entry.ms)), warmRetrievalOnly: timings(scoringTimes), perQueryEmbedding: embeddingTimes, note: `Sequential batch-of-one inference; model already initialized. ${evaluatedRuntime}. Existing cache, uncontrolled shared-host load. No browser UI, first download, network, end-to-end human workflow or time-saved measurement.` },
  observedFalseAccepts: Object.entries(results).flatMap(([method, value]) => value.rows.filter((row) => row.acceptedId !== null && !row.correctAcceptance).map((row) => ({ method, id: row.id, expectedIncidentId: row.expectedIncidentId, acceptedId: row.acceptedId, topScore: row.topScore, margin: row.margin }))),
  limitations: ['All cases and labels were authored by one evaluator, not externally sampled, independently annotated or confirmed by execution.', 'The 20-memory notebook and 65 probes are still small. Precision and false-accept rates describe this exact construction only.', 'Shared error codes can mask distinct causes. Neither exact symptoms nor cosine similarity establishes that a historical fix is applicable.', 'The fixed policies were originally calibrated against just three memories. No claim is made that they are calibrated for larger or different notebooks.', 'The lexical baseline uses full normalized text; semantic inference has a 256-token cap, with bounded diagnostic-line selection when inputPreparationVersion is present. This reflects the actual pipelines, not matched input budgets.', 'Top-3 ranking is now over 20 candidates and is measured before abstention, not the number of suggestions actually surfaced.', 'Generated JUnit exercises parser/group/model integration but is not the UI import path, browser WASM, a production report, or a real CI remediation study.', 'Runtime numbers are measured under a shared Node host (native or CPU-WASM as explicitly labeled), not a real browser UI session or developer time saved.', 'Correctness refers to the authored historical-incident identity, not verified downstream fix effectiveness. A fix may coincidentally help a different cause; exact diagnostic code/wording fidelity has not been validated by reproducing the failure.'],
};
if (evidence.firstRun) {
  result.inputComparisonWithFirstRun = { rawQueryStringsChanged: result.modelInputs.queries.filter((item) => item.text !== evidence.firstRun.modelInputs.queries.find((old) => old.id === item.id).text).map((item) => item.id), preparedQueryStringsChanged: result.modelInputs.queries.filter((item) => item.preparedText !== evidence.firstRun.modelInputs.queries.find((old) => old.id === item.id).text).map((item) => item.id), corpusStringsChanged: result.modelInputs.corpus.filter((item) => item.text !== evidence.firstRun.modelInputs.corpus.find((old) => old.id === item.id).text).map((item) => item.id) };
  result.comparisonWithPreservedFirstRun = Object.fromEntries(Object.entries(results).map(([method, value]) => {
    const originalRows = new Map(evidence.firstRun.results[method].rows.map((row) => [row.id, row]));
    return [method, { decisionChanges: value.rows.filter((row) => row.acceptedId !== originalRows.get(row.id).acceptedId).map((row) => ({ id: row.id, before: originalRows.get(row.id).acceptedId, after: row.acceptedId })), topRankChanges: value.rows.filter((row) => row.ranked[0].id !== originalRows.get(row.id).ranked[0].id).map((row) => ({ id: row.id, before: originalRows.get(row.id).ranked[0].id, after: row.ranked[0].id })), mainMetricsIdentical: JSON.stringify(value.main) === JSON.stringify(evidence.firstRun.results[method].main) }];
  }));
}
if (wasmAdapter) {
  const nativeBaseline = [...evidence.verificationRuns].reverse().find((run) => !run.model.wasmRuntimeInfo && run.model.inputPreparationVersion === MODEL_INFO.inputPreparationVersion);
  if (nativeBaseline) {
    const original = new Map(nativeBaseline.results.semantic.rows.map((row) => [row.id, row]));
    const rows = result.results.semantic.rows;
    result.comparisonWithLatestNativeCpu = { evaluatedAt: nativeBaseline.evaluatedAt, changedAcceptances: rows.filter((row) => row.acceptedId !== original.get(row.id).acceptedId).map((row) => ({ id: row.id, native: original.get(row.id).acceptedId, wasm: row.acceptedId })), changedTopRanks: rows.filter((row) => row.ranked[0].id !== original.get(row.id).ranked[0].id).map((row) => ({ id: row.id, native: original.get(row.id).ranked[0].id, wasm: row.ranked[0].id })), maxAbsoluteCosineDifference: Math.max(...rows.flatMap((row) => row.ranked.map((candidate) => Math.abs(candidate.score - original.get(row.id).ranked.find((old) => old.id === candidate.id).score)))) };
  }
  await wasmAdapter.releaseWasmModel();
}
result.metricRegressionsComparedWithFirstRun = evidence.firstRun ? Object.entries(results).flatMap(([method, value]) => {
  const before = evidence.firstRun.results[method].main, after = value.main;
  const alerts = [];
  if (after.wrongAccepted > before.wrongAccepted) alerts.push({ metric: 'wrongAccepted', before: before.wrongAccepted, after: after.wrongAccepted });
  if (after.correctAccepted < before.correctAccepted) alerts.push({ metric: 'correctAccepted', before: before.correctAccepted, after: after.correctAccepted });
  if (after.knownTop1Count < before.knownTop1Count) alerts.push({ metric: 'knownTop1Count', before: before.knownTop1Count, after: after.knownTop1Count });
  if (after.knownTop3Count < before.knownTop3Count) alerts.push({ metric: 'knownTop3Count', before: before.knownTop3Count, after: after.knownTop3Count });
  return alerts.map((alert) => ({ method, ...alert }));
}) : [];
if (mode === '--run') evidence.firstRun = result;
else evidence.verificationRuns.push(result);
evidence.status = 'evaluated';
evidence.latestRunAt = result.evaluatedAt;
await fs.writeFile(evidencePath, JSON.stringify(evidence, null, 2) + '\n');
const lines = renderProtocol();
lines.push('## First run: 60 ordinary cases', '', `Scored: ${evidence.firstRun.evaluatedAt}. Policies were not tuned on these results.`, '');
for (const [method, value] of Object.entries(evidence.firstRun.results)) {
  const m = value.main;
  lines.push(`### ${method}`, '', `- Accepted ${m.accepted}/${m.total}: ${m.correctAccepted} correct, ${m.wrongAccepted} wrong. Accepted precision ${pct(m.acceptedPrecision)}.`, `- Known correct acceptance ${m.correctAccepted}/${m.known} (${pct(m.knownCorrectAcceptanceRate)}); novel false accepts ${m.novelFalseAccepts}/${m.novel} (${pct(m.novelFalseAcceptRate)}).`, `- Known top-1 ${m.knownTop1Count}/${m.known} (${pct(m.knownTop1)}); top-3 ${m.knownTop3Count}/${m.known} (${pct(m.knownTop3)}), before abstention over 20 candidates.`, '');
}
lines.push('## Five stress probes', '');
for (const item of fixture.cases.filter((item) => item.split === 'stress')) {
  const query = evidence.firstRun.modelInputs.queries.find((entry) => entry.id === item.id);
  const semantic = evidence.firstRun.results.semantic.rows.find((row) => row.id === item.id);
  const lexical = evidence.firstRun.results.lexical.rows.find((row) => row.id === item.id);
  lines.push(`- ${item.id}, ${item.kind}: ${query.originalTokens} tokens → ${query.retainedTokens}; expected ${item.expectedIncidentId ?? 'abstention'}; semantic ${semantic.acceptedId ?? 'abstained'} (top ${semantic.ranked[0].id}); lexical ${lexical.acceptedId ?? 'abstained'} (top ${lexical.ranked[0].id}).`);
}
lines.push('', `The two tail-cause cases have different true labels and different normalized logs, but identical retained token sequences. Their embedding cosine is ${evidence.firstRun.tailTruncationProbe.embeddingCosine}. The model cannot distinguish diagnoses it never receives.`, '', '## Exact grouping and runtime', '',
  '- All 130 generated failure records formed the expected 65 groups, with both duplicate occurrences retained and no cross-case merges. Successful/skipped tests were omitted.',
  '- All 20 separate exact-replay controls retrieved their corresponding stored signature. Eight diagnostic-value controls remained distinct.',
  `- First-run parse ${evidence.firstRun.timings.parseMs.toFixed(2)} ms; grouping ${evidence.firstRun.timings.groupMs.toFixed(2)} ms.`,
  `- Model initialization plus 20 corpus embeddings ${evidence.firstRun.timings.modelInitializationAndTwentyCorpusEmbeddingsMs.toFixed(2)} ms; warm single-query embedding median ${evidence.firstRun.timings.warmSingleQueryEmbedding.medianMs.toFixed(2)} ms, p95 ${evidence.firstRun.timings.warmSingleQueryEmbedding.p95Ms.toFixed(2)} ms.`,
  `- Warm retrieval-only median ${evidence.firstRun.timings.warmRetrievalOnly.medianMs.toFixed(2)} ms, p95 ${evidence.firstRun.timings.warmRetrievalOnly.p95Ms.toFixed(2)} ms.`, '', evidence.firstRun.timings.note, '', '## Observed false accepts', '');
for (const row of evidence.firstRun.observedFalseAccepts) lines.push(`- ${row.method}: ${row.id} accepted ${row.acceptedId}, expected ${row.expectedIncidentId ?? 'abstention'}; score ${row.topScore.toFixed(4)}, margin ${row.margin.toFixed(4)}.`);
if (!evidence.firstRun.observedFalseAccepts.length) lines.push('None in this authored construction; this does not imply zero real-world risk.');
lines.push('', '## Interpretation and independent checks', '', 'Acceptance metrics refer to the top-ranked accepted historical incident, not a probability that its fix will work. Labels describe authored cause identity. Diagnostic texts were not executed, and a suggested fix could coincidentally help a different cause.', '', ...(evidence.qualityChecks ? ['- Independent Python recomputation matched all accepted/correct/wrong counts.', '- The cached q8 model file SHA-256 matched the pinned provenance hash.', '- Existing parser, adversarial and CLI regressions: 63/63 passed before the runtime upgrade.'] : []), '', '## Product-safe next steps, not applied by this benchmark', '', '- Keep matches explicitly labeled historical candidates requiring review. Do not translate cosine scores into probabilities or promise root-cause detection.', '- Expose when a normalized log exceeds the model context and avoid implying the entire report was considered. Any head/tail or error-extraction strategy needs a new predeclared dataset, not tuning against these probes.', '- Collect consented, independently labeled realistic examples with a larger notebook before claiming a semantic advantage. Check precision/coverage and distinct-cause negatives together.', '- Preserve a lexical/exact reference path, full original failure evidence and easy dismissal of inapplicable notes. Do not automatically apply a retrieved fix.', '', '## Limits', '', ...evidence.firstRun.limitations.map((entry) => `- ${entry}`), '', `Regression verification runs retained in JSON: ${evidence.verificationRuns.length}. First-run metrics remain unchanged above.`, '', 'Detailed normalized model inputs, per-case ranks/decisions, tokenizer counts, source hashes, timing samples and later verification results are retained in stress-evaluation.json.', '');
if (evidence.verificationRuns.length) {
  const latest = evidence.verificationRuns.at(-1);
  lines.push('## Latest implementation regression on the already inspected cases', '', `Run: ${latest.evaluatedAt}; ${latest.model.evaluatedRuntime}; Transformers.js ${latest.model.libraryVersion}; input preparation ${latest.model.inputPreparationVersion ?? 'original full-text truncation'}. This is not a fresh held-out test and did not retune thresholds or labels.`, '');
  for (const [method, value] of Object.entries(latest.results)) {
    const m = value.main;
    lines.push(`- ${method}, ordinary cases: top-1 ${m.knownTop1Count}/${m.known}; top-3 ${m.knownTop3Count}/${m.known}; ${m.correctAccepted} correct and ${m.wrongAccepted} wrong accepted, precision ${pct(m.acceptedPrecision)}, known correct coverage ${pct(m.knownCorrectAcceptanceRate)}.`);
  }
  lines.push('');
  for (const item of fixture.cases.filter((entry) => entry.split === 'stress')) {
    const query = latest.modelInputs.queries.find((entry) => entry.id === item.id);
    const row = latest.results.semantic.rows.find((entry) => entry.id === item.id);
    lines.push(`- ${item.id}: ${query.originalTokens} original tokens → ${query.preparedTokens ?? query.originalTokens} prepared → ${query.retainedTokens} retained; semantic ${row.acceptedId ?? 'abstained'}, top rank ${row.ranked[0].id}; expected ${item.expectedIncidentId ?? 'abstention'}.`);
  }
  lines.push('', `Tail-probe retained token sequences identical: ${latest.tailTruncationProbe.retainedTokenSequencesIdentical}; embedding cosine ${latest.tailTruncationProbe.embeddingCosine}.`, '', 'Bounded diagnostic-line selection remains lossy: it can omit relevant context and the tokenizer still has a 256-token cap. Passing these already-inspected probes does not establish long-log accuracy on unseen reports.', '');
}
await fs.writeFile(markdownPath, lines.join('\n'));
console.log(JSON.stringify({ phase: mode === '--run' ? 'first-stress-run' : 'stress-regression-verification', evaluatedAt: result.evaluatedAt, main: Object.fromEntries(Object.entries(results).map(([method, value]) => [method, value.main])), stress: Object.fromEntries(Object.entries(results).map(([method, value]) => [method, value.stress])), grouping: result.junitPath, tailProbe, timings: { ...result.timings, perQueryEmbedding: undefined }, sourceStableDuringRun: result.sourceStableDuringRun, evaluatedRuntime, comparisonWithPreservedFirstRun: result.comparisonWithPreservedFirstRun ?? null, comparisonWithLatestNativeCpu: result.comparisonWithLatestNativeCpu ?? null, inputComparisonWithFirstRun: result.inputComparisonWithFirstRun ?? null, metricRegressionsComparedWithFirstRun: result.metricRegressionsComparedWithFirstRun }, null, 2));
if (result.metricRegressionsComparedWithFirstRun.length) console.warn('METRIC REGRESSION OBSERVED: ' + JSON.stringify(result.metricRegressionsComparedWithFirstRun) + '. Results are retained without relabeling or retuning; review the changed decisions above.');
if (!result.sourceStableDuringRun) process.exitCode = 1;
