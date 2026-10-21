import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import * as engine from '../src/engine.js';
import { SAMPLE_RUNS, SEED_INCIDENTS } from '../src/demo-data.js';
import * as semantic from '../src/semantic-input.js';
import { MODEL_INFO } from '../src/model-info.js';

// Functional DOM-stub tests only. No browser, network, model download, or real
// user data is involved. The application source is unchanged; its imports and
// browser globals are bound to real pure modules and explicit test doubles.
const source = (await fs.readFile(new URL('../src/app.js', import.meta.url), 'utf8'))
  .replace(/^import .*;\n/gm, '');
const STORAGE_KEY = 'groundhog-memory-v1';
const makeNote = (overrides = {}) => ({
  id: 'synthetic-note', title: 'Synthetic saved fix', symptom: 'Synthetic symptom',
  fix: 'Synthetic resolution', evidence: 'Authored synthetic reproduction',
  createdAt: '2026-10-21T00:00:00.000Z', ...overrides,
});
const notebook = (incidents) => JSON.stringify({ version: 1, incidents });
const report = (message) => `<testsuite name="synthetic"><testcase name="synthetic case"><failure message="${message}"/></testcase></testsuite>`;
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

function createApp({ storage = new Map(), hash = '#run', denyRead = false, denyWrite = false, embedTexts } = {}) {
  const callbacks = new Map();
  const windowCallbacks = new Map();
  const elements = new Map();
  const downloads = [];
  const element = (id) => elements.get(id) || elements.set(id, {
    id, innerHTML: '', textContent: '', className: '', dataset: {}, open: false,
    focus() {}, querySelector() { return null; },
    showModal() { this.open = true; }, close() { this.open = false; },
    addEventListener(type, callback) { this[type] = callback; },
  }).get(id);
  const location = { hash };
  let writeBlocked = denyWrite;
  const environment = {
    ...engine, ...semantic, SAMPLE_RUNS, SEED_INCIDENTS, MODEL_INFO,
    stressReportUrl: '/assets/synthetic-stress-report.md',
    embedTexts: embedTexts || (async (texts) => texts.map((_, index) => [index + 1, 1])),
    document: {
      activeElement: null, querySelector: element, getElementById: (id) => element('#' + id),
      addEventListener: (type, callback) => callbacks.set(type, callback),
      createElement: () => ({ click() {}, style: {} }),
    },
    window: { addEventListener: (type, callback) => windowCallbacks.set(type, callback) },
    location, history: { replaceState(_state, _title, hash) { location.hash = hash; } },
    CSS: { escape: (value) => value }, crypto: webcrypto,
    localStorage: {
      getItem(key) { if (denyRead) throw new Error('Synthetic read denial'); return storage.get(key) ?? null; },
      setItem(key, value) { if (writeBlocked) throw new Error('Synthetic quota failure'); storage.set(key, value); },
    },
    FormData: class { constructor(form) { this.values = form.values; } get(key) { return this.values[key]; } },
    Blob, URL: { createObjectURL(blob) { downloads.push(blob); return 'blob:synthetic-test'; }, revokeObjectURL() {} },
    setTimeout: () => 1, clearTimeout() {}, navigator: { clipboard: { async writeText() {} } },
  };
  const bindings = Object.keys(environment).join(',');
  const app = new Function('environment', `const {${bindings}} = environment;\n${source}\nreturn {state, handleAction, setRun, loadModel, render};`)(environment);
  return {
    ...app, storage, downloads,
    html: () => element('#app').innerHTML,
    notice: () => element('#notice').innerHTML,
    dialog: element('#app-dialog'),
    blockWrites(value = true) { writeBlocked = value; },
    click: (action, dataset = {}) => app.handleAction(action, { dataset }),
    change: (target) => callbacks.get('change')({ target }),
    submit: (target) => callbacks.get('submit')({ target, preventDefault() {} }),
    navigate(screen) { location.hash = '#' + screen; windowCallbacks.get('hashchange')(); },
    async importNotes(incidents) {
      const text = notebook(incidents);
      await callbacks.get('change')({ target: { id: 'memory-file', value: '', files: [{ size: Buffer.byteLength(text), text: async () => text }] } });
    },
  };
}

async function saveNote(app, overrides = {}) {
  await app.click('record-fix');
  await app.submit({ id: 'fix-form', dataset: { group: app.state.selected }, values: {
    title: 'Synthetic verified fix', fix: 'Synthetic tested change', evidence: 'Synthetic test run', verified: 'on', ...overrides,
  }, querySelector() { return { focus() {} }; } });
  return app.state.memory.find((incident) => !incident.synthetic);
}

test('saved notes survive reload and export/import without retaining synthetic flags', async () => {
  const app = createApp();
  const saved = await saveNote(app);
  assert.match(app.html(), /An exact memory surfaced/);
  const reloaded = createApp({ storage: app.storage });
  assert.equal(reloaded.state.memory.find((note) => note.id === saved.id)?.fix, saved.fix);
  assert.match(reloaded.html(), /An exact memory surfaced/);
  await reloaded.click('export-memory');
  const exported = JSON.parse(await reloaded.downloads[0].text());
  assert.equal(engine.validateMemory(exported).valid, true);
  assert.ok(exported.incidents.every((note) => !Object.hasOwn(note, 'synthetic')));
  const imported = createApp();
  await imported.importNotes(exported.incidents);
  assert.equal(imported.state.memory.filter((note) => !note.synthetic).length, 1);
  assert.equal(imported.state.memory.find((note) => note.id === saved.id)?.fix, saved.fix);
});

test('duplicate notebook IDs reject atomically, and existing IDs are never replaced', async () => {
  const app = createApp();
  await app.importNotes([makeNote()]);
  const before = app.storage.get(STORAGE_KEY);
  await app.importNotes([makeNote({ id: 'duplicate' }), makeNote({ id: 'duplicate' })]);
  assert.match(app.notice(), /not imported.*duplicated/);
  assert.equal(app.storage.get(STORAGE_KEY), before);
  await app.importNotes([makeNote({ fix: 'Must not replace the existing fix' })]);
  assert.equal(app.state.memory.find((note) => note.id === 'synthetic-note').fix, 'Synthetic resolution');
  assert.equal(app.storage.get(STORAGE_KEY), before);
});

test('importing a removed ID clears stale removal state and makes undo a no-op', async () => {
  const app = createApp();
  await app.importNotes([makeNote()]);
  app.navigate('memory');
  await app.click('remove-memory', { incident: 'synthetic-note' });
  assert.equal(app.state.removedMemory.incident.id, 'synthetic-note');
  assert.match(app.html(), /removal-banner/);
  await app.importNotes([makeNote({ fix: 'New imported fix' })]);
  assert.equal(app.state.removedMemory, null);
  assert.doesNotMatch(app.html(), /removal-banner|Undo removal/);
  assert.match(app.notice(), /1 note imported/);
  assert.doesNotMatch(app.notice(), /removed|undo-remove/i);
  const importedState = JSON.stringify(app.state.memory);
  const persistedState = app.storage.get(STORAGE_KEY);
  const importNotice = app.notice();
  await app.click('undo-remove');
  assert.equal(JSON.stringify(app.state.memory), importedState);
  assert.equal(app.storage.get(STORAGE_KEY), persistedState);
  assert.equal(app.notice(), importNotice);
  assert.equal(app.state.memory.filter((note) => note.id === 'synthetic-note').length, 1);
  assert.equal(app.state.memory.find((note) => note.id === 'synthetic-note').fix, 'New imported fix');
  assert.equal(engine.validateMemory(JSON.parse(app.storage.get(STORAGE_KEY))).valid, true);
});

test('invalid saved notebook is not trusted or rendered as a saved fix', () => {
  const storage = new Map([[STORAGE_KEY, notebook([makeNote({ id: '__proto__' })])]]);
  const app = createApp({ storage });
  assert.match(app.html(), /Saved memory could not be read/);
  assert.equal(app.state.memory.filter((note) => !note.synthetic).length, 0);
  assert.equal(storage.get(STORAGE_KEY), notebook([makeNote({ id: '__proto__' })]));
});

test('import preserves an actionable warning when persistence fails', async () => {
  const app = createApp({ denyWrite: true });
  await app.importNotes([makeNote()]);
  assert.equal(app.state.memory.filter((note) => !note.synthetic).length, 1);
  assert.equal(app.storage.has(STORAGE_KEY), false);
  assert.match(app.notice(), /session only|not saved|not persisted|unavailable/i);
  assert.doesNotMatch(app.notice(), /^<span>1 note imported\. Existing memory IDs were kept\.<\/span>$/);
});

test('removal preserves an actionable warning when persistence fails', async () => {
  const app = createApp();
  await app.importNotes([makeNote()]);
  app.blockWrites();
  await app.click('remove-memory', { incident: 'synthetic-note' });
  assert.equal(app.state.memory.filter((note) => !note.synthetic).length, 0);
  assert.equal(JSON.parse(app.storage.get(STORAGE_KEY)).incidents.length, 1);
  assert.match(app.notice(), /session only|not saved|not persisted|unavailable/i);
});

test('undo preserves an actionable warning when persistence fails', async () => {
  const app = createApp();
  await app.importNotes([makeNote()]);
  await app.click('remove-memory', { incident: 'synthetic-note' });
  app.blockWrites();
  await app.click('undo-remove');
  assert.equal(app.state.memory.filter((note) => !note.synthetic).length, 1);
  assert.equal(JSON.parse(app.storage.get(STORAGE_KEY)).incidents.length, 0);
  assert.match(app.notice(), /session only|not saved|not persisted|unavailable/i);
});

test('storage-unavailable warning is visible when opening directly to fix memory', () => {
  const app = createApp({ hash: '#memory', denyRead: true, denyWrite: true });
  assert.ok(/Local storage is unavailable|not saved|not persisted/i.test(app.html()), 'The memory screen must disclose unavailable storage.');
});

test('session-only notes stay exportable, and a later successful write clears the warning', async () => {
  const app = createApp({ denyWrite: true });
  await app.importNotes([makeNote()]);
  for (const screen of ['memory', 'about', 'run']) {
    app.navigate(screen);
    assert.ok(/session only/i.test(app.html()), `Storage warning must remain visible on ${screen}.`);
  }
  await app.click('export-memory');
  const exported = JSON.parse(await app.downloads[0].text());
  assert.equal(exported.incidents.find((note) => note.id === 'synthetic-note').fix, 'Synthetic resolution');
  assert.equal(app.storage.has(STORAGE_KEY), false);
  app.blockWrites(false);
  await app.importNotes([makeNote({ id: 'second-synthetic-note' })]);
  assert.equal(JSON.parse(app.storage.get(STORAGE_KEY)).incidents.length, 2);
  assert.ok(!/session only/i.test(app.html()), 'A successful full write should clear the stale storage warning.');
});

test('model load rebuilds for a report switch and newly saved note before exposing results', async () => {
  const jobs = [];
  const app = createApp({ embedTexts(texts) { const job = { ...deferred(), texts }; jobs.push(job); return job.promise; } });
  const loading = app.loadModel();
  await app.setRun(report('Synthetic newer failure'), { id: 'newer', title: 'Synthetic newer report' });
  const saved = await saveNote(app);
  jobs[0].resolve(jobs[0].texts.map(() => [1, 0]));
  await flush();
  assert.equal(jobs.length, 2);
  assert.equal(app.state.semanticBusy, true);
  assert.ok(jobs[1].texts.includes('Synthetic newer failure'));
  jobs[1].resolve(jobs[1].texts.map(() => [0, 1]));
  await loading;
  assert.equal(app.state.semanticBusy, false);
  assert.equal(app.state.model, 'ready');
  assert.equal(app.state.run.id, 'newer');
  const incidentVectors = app.state.embeddingMap.incidents || app.state.embeddingMap;
  assert.ok(incidentVectors instanceof Map ? incidentVectors.has(saved.id) : Object.hasOwn(incidentVectors, saved.id));
  assert.match(app.html(), /An exact memory surfaced/);
});

test('stale semantic success never overwrites the latest report embeddings', async () => {
  const jobs = [];
  const app = createApp({ embedTexts(texts) { const job = { ...deferred(), texts }; jobs.push(job); return job.promise; } });
  const loading = app.loadModel();
  jobs[0].resolve(jobs[0].texts.map(() => [1, 0]));
  await loading;
  const older = app.setRun(report('Synthetic older failure'), { id: 'older', title: 'Synthetic older report' });
  const newer = app.setRun(report('Synthetic newer failure'), { id: 'newer', title: 'Synthetic newer report' });
  jobs[2].resolve(jobs[2].texts.map(() => [0, 1]));
  await newer;
  const latestMap = app.state.embeddingMap;
  jobs[1].resolve(jobs[1].texts.map(() => [1, 0]));
  await older;
  assert.equal(app.state.embeddingMap, latestMap);
  assert.equal(app.state.run.id, 'newer');
});

test('stale semantic failure never disables a newer successful comparison', async () => {
  const jobs = [];
  const app = createApp({ embedTexts(texts) { const job = { ...deferred(), texts }; jobs.push(job); return job.promise; } });
  const loading = app.loadModel();
  jobs[0].resolve(jobs[0].texts.map(() => [1, 0]));
  await loading;
  const older = app.setRun(report('Synthetic older failure'), { id: 'older', title: 'Synthetic older report' });
  const newer = app.setRun(report('Synthetic newer failure'), { id: 'newer', title: 'Synthetic newer report' });
  jobs[2].resolve(jobs[2].texts.map(() => [0, 1]));
  await newer;
  jobs[1].reject(new Error('Synthetic stale model failure'));
  await older;
  assert.equal(app.state.model, 'ready');
  assert.equal(app.state.semanticBusy, false);
  assert.equal(app.state.run.id, 'newer');
  assert.equal(app.state.modelError, '');
});

test('a completed report comparison does not close a newer fix dialog', async () => {
  const jobs = [];
  const app = createApp({ embedTexts(texts) { const job = { ...deferred(), texts }; jobs.push(job); return job.promise; } });
  const loading = app.loadModel();
  jobs[0].resolve(jobs[0].texts.map(() => [1, 0]));
  await loading;
  await app.click('paste-run');
  const submission = app.submit({ id: 'paste-form', values: { name: 'Synthetic pasted report', xml: report('Synthetic newer failure') } });
  await app.click('close-dialog');
  await app.click('record-fix');
  assert.match(app.dialog.innerHTML, /fix-form/);
  assert.equal(app.dialog.open, true);
  jobs[1].resolve(jobs[1].texts.map(() => [0, 1]));
  await submission;
  assert.equal(app.dialog.open, true, 'An old paste submission must not dismiss a newer fix form and its unsaved input.');
});

test('imported incident IDs cannot overwrite a failure query embedding', async () => {
  const xml = report('Synthetic red query');
  const [failure] = engine.parseJUnit(xml);
  const app = createApp({ embedTexts: async (texts) => texts.map((text) => text === 'Synthetic red query' ? [1, 0] : text === 'Synthetic blue unrelated note' ? [0, 1] : [1, 0]) });
  await app.setRun(xml, { id: 'collision', title: 'Synthetic ID collision report' });
  await app.importNotes([makeNote({ id: failure.id, title: 'Unrelated blue fix', symptom: 'Synthetic blue unrelated note' })]);
  await app.loadModel();
  assert.ok(!app.html().includes('<h4>Unrelated blue fix</h4>'), 'Orthogonal symptom embeddings must not become a perfect match just because their IDs collide.');
});
