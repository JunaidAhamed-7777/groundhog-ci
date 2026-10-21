import './style.css';
import { parseJUnit, normalizeFailure, groupFailures, retrieveIncidents, redactSecrets, validateMemory, ENGINE_LIMITS } from './engine.js';
import { embedTexts, MODEL_INFO } from './model.js';
import { SAMPLE_RUNS, SEED_INCIDENTS } from './demo-data.js';

const STORAGE_KEY = 'groundhog-memory-v1';
const MAX_FILE_SIZE = ENGINE_LIMITS.maxInputBytes;
const MAX_AI_ITEMS = 250;
const MAX_AI_TEXT = 20_000;
const app = document.querySelector('#app');
const dialog = document.querySelector('#app-dialog');
const icons = {
  inbox: '<path d="M4 4h16v16H4zM4 14h5l2 3h2l2-3h5"/>',
  memory: '<path d="M5 4h12l3 3v13H5zM9 4v6h7V4M9 20v-6h7v6"/>',
  steps: '<path d="M5 5h14M5 12h14M5 19h14"/><circle cx="5" cy="5" r="2"/><circle cx="19" cy="12" r="2"/><circle cx="10" cy="19" r="2"/>',
  upload: '<path d="M12 16V3m-5 5 5-5 5 5M4 16v5h16v-5"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  file: '<path d="M5 3h9l5 5v13H5zM14 3v5h5M8 12h8M8 16h6"/>',
  search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  repeat: '<path d="M4 9a8 8 0 0 1 14-4l2 2M20 3v4h-4M20 15a8 8 0 0 1-14 4l-2-2M4 21v-4h4"/>',
  shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6z"/><path d="m8 12 3 3 5-6"/>',
  link: '<path d="m10 13 4-4M8 15l-2 2a4 4 0 0 1-5-5l4-4a4 4 0 0 1 6 0m2 1 2-2a4 4 0 0 1 5 5l-4 4a4 4 0 0 1-6 0"/>',
  copy: '<rect x="8" y="8" width="12" height="13" rx="1"/><path d="M16 8V3H3v13h5"/>',
  download: '<path d="M12 3v13m-5-5 5 5 5-5M4 17v4h16v-4"/>',
  spark: '<path d="m12 3 2.8 6.2L21 12l-6.2 2.8L12 21l-2.8-6.2L3 12l6.2-2.8z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',
  minus: '<path d="M5 12h14"/>',
};
const icon = (name, extra='') => `<svg class="icon ${extra}" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.file}</svg>`;
const mark = `<svg class="brand-mark" width="34" height="34" viewBox="0 0 44 44" fill="none" aria-hidden="true"><path d="M7 31V22a15 15 0 0 1 30 0v9M14 31V22a8 8 0 0 1 16 0v9M4 35h36" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><circle cx="22" cy="25" r="2.2" fill="currentColor"/></svg>`;
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safe = value => redactSecrets(String(value ?? ''));
const textOf = f => [f.message, f.detail].filter(Boolean).join('\n');
const initials = name => name.replace(/^.*\./, '').slice(0, 1).toUpperCase();
let noticeTimer;
let generation = 0;
let persistenceError = '';
let customMemory = [];
try {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) {
    const data = JSON.parse(stored);
    const checked = validateMemory(data);
    if (checked.valid) customMemory = Array.isArray(checked.memory) ? checked.memory : (checked.memory?.incidents || []);
    else persistenceError = 'Saved memory could not be read. Import a backup to restore your notes.';
  }
} catch { persistenceError = 'Local storage is unavailable. You can still work, but export your notes before closing this tab.'; }
const state = {
  screen: ['memory','about'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'run',
  memory: [...SEED_INCIDENTS.map(i => ({...i, synthetic:true})), ...customMemory],
  failures: [], groups: [], selected: null, query:'', memoryQuery:'', selectedMemory:null,
  run: null, runError:'', model: 'idle', modelProgress:0, modelMessage:'', modelError:'',
  embeddingMap: {}, semanticBusy:false, replayed:false, runVersion:0, aiLimitMessage:'', patternLimit:100, memoryLimit:100, rejected:{}, removedMemory:null,
};
const exactIndex = new Map();
const recallMemo = new Map();
function rebuildExactIndex() {
  exactIndex.clear();
  for (const incident of state.memory) {
    const signature=normalizeFailure(incident.symptom);
    if(!exactIndex.has(signature)) exactIndex.set(signature,incident);
  }
}
rebuildExactIndex();
function notify(message, type='success', undoAction=null) {
  const el = document.querySelector('#notice');
  clearTimeout(noticeTimer); el.innerHTML = `<span>${esc(message)}</span>${undoAction?`<button class="toast-undo" data-action="${esc(undoAction)}">Undo</button>`:''}`; el.className = `toast visible ${type}`;
  noticeTimer = setTimeout(() => { el.className = 'toast'; }, undoAction?12000:type==='error' ? 10000 : 5000);
}
function remember() {
  customMemory = state.memory.filter(i => !i.synthetic);
  state.runVersion++;
  rebuildExactIndex();
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({version:1, incidents:customMemory})); return true; }
  catch { notify('Note kept for this session only. Local storage is unavailable. Export your memory to keep it.', 'error'); return false; }
}
function exactIncident(group) {
  return exactIndex.get(group.signature);
}
function recall(group) {
  if (!group) return null;
  if(recallMemo.has(group.id))return recallMemo.get(group.id);
  const result=computeRecall(group);recallMemo.set(group.id,result);return result;
}
function computeRecall(group) {
  if(state.rejected[group.id])return {kind:'dismissed',dismissedIncident:state.rejected[group.id]};
  const exact = exactIncident(group);
  if (exact) return {kind:'exact', incident:exact};
  if (state.model === 'ready' && !state.semanticBusy && !state.aiLimitMessage) {
    try {
      const result = retrieveIncidents(group.representative, state.memory, state.embeddingMap);
      if (result.status === 'candidate-only' && result.candidates?.length) return {kind:'semantic',incident:result.candidates[0].incident,result};
      return {kind:'none', reason:result.reason};
    } catch { return {kind:'none', reason:'No safe semantic result. Review the raw evidence.'}; }
  }
  return {kind:'none'};
}
function render() {
  recallMemo.clear();
  const focus = document.activeElement;
  const focusId = focus?.id;
  const focusGroup = focus?.dataset?.group;
  const focusAction = focus?.dataset?.action;
  const cursor = focus?.selectionStart;
  app.innerHTML = `<div class="workspace">${renderSidebar()}<div class="workspace-body"><header class="topbar"><div class="breadcrumb"><span>Workspace</span><span class="breadcrumb-slash">/</span><strong>${state.screen==='run'?'Run inbox':state.screen==='memory'?'Fix memory':'How it works'}</strong></div><div class="local-label"><span class="status-dot"></span>Local workspace</div></header><main id="main-content" tabindex="-1">${state.screen==='run'?renderInbox():state.screen==='memory'?renderMemory():renderAbout()}</main><footer class="app-footer"><span>Built for the next time it breaks.</span><span>${icon('shield')} No account. No telemetry. Your notes stay here.</span></footer></div></div>`;
  if (focusId || focusGroup || focusAction) {
    const next = focusId ? document.getElementById(focusId) : focusGroup ? app.querySelector(`[data-group="${CSS.escape(focusGroup)}"]`) : app.querySelector(`[data-action="${CSS.escape(focusAction)}"]`);
    if (next) { next.focus({preventScroll:true}); if (typeof cursor === 'number' && next.setSelectionRange) next.setSelectionRange(cursor,cursor); }
  }
}
function renderSidebar() {
  return `<aside class="sidebar"><a class="brand" href="#run" aria-label="Groundhog run inbox">${mark}<span>groundhog<small>Fix it once.</small></span></a><div class="workspace-name"><span class="workspace-letter">G</span><span>Your workspace<small>On this device</small></span>${icon('shield')}</div><nav class="main-nav" aria-label="Main navigation"><a href="#run" class="nav-item ${state.screen==='run'?'active':''}" ${state.screen==='run'?'aria-current="page"':''}>${icon('inbox')}<span>Run inbox</span>${state.groups.length?`<span class="nav-count">${state.groups.length}</span>`:''}</a><a href="#memory" class="nav-item ${state.screen==='memory'?'active':''}" ${state.screen==='memory'?'aria-current="page"':''}>${icon('memory')}<span>Fix memory</span><span class="nav-count">${state.memory.length}</span></a><a href="#about" class="nav-item ${state.screen==='about'?'active':''}" ${state.screen==='about'?'aria-current="page"':''}>${icon('steps')}<span>How it works</span></a></nav><div class="sidebar-bottom">${renderModel()}<div class="sidebar-footnote">A little memory.<br>A lot less repetition.</div><div class="version"><span>GROUNDHOG</span><span>LOCAL · v1</span></div></div></aside>`;
}
function renderModel() {
  const ready = state.model === 'ready';
  const loading = state.model === 'loading';
  return `<section class="model-panel" aria-label="Local semantic model"><div class="model-heading">${icon(ready?'check':'spark')}<strong>${ready?'Open model ready':'A small model. A long memory.'}</strong></div><p>${ready?'MiniLM is running in your browser. Similar symptoms, not just matching words.':loading?'Downloading open model files. Your failure text stays in this browser.':'Find related fixes, even when the error message changes.'}</p>${loading?`<progress value="${state.modelProgress}" max="100" aria-label="Model download progress"></progress><span class="model-state" role="status">${esc(state.modelMessage || 'Preparing local model…')}</span>`:`<button class="model-button" data-action="load-model" ${ready?'disabled':''}>${icon(ready?'shield':'download')} ${ready?'Inference stays local':state.model==='error'?'Retry open model':'Load open model (~23MB)'}</button>`}${state.model==='error'?`<p class="model-error">${esc(state.modelError)} Exact matching is still available.</p>`:''}<small>${ready?'Open weights · 384-dimensional embeddings':'23MB model + runtime assets. No API key.'}</small></section>`;
}
function renderInbox() {
  const exactCount = state.groups.filter(g => recall(g)?.kind==='exact').length;
  const relatedCount = state.groups.filter(g => recall(g)?.kind==='semantic').length;
  return `<section class="page-intro"><div><h1>Same failure.<br><em>Less déjà vu.</em></h1><p>Your CI has a memory now. Turn repeated failures<br class="desktop-break"> into fixes you can find again.</p></div><div class="intro-actions"><button class="button primary" data-action="import-run">${icon('upload')} Import JUnit report</button><button class="text-button" data-action="paste-run">or paste XML ${icon('arrow')}</button></div></section>
  <section class="demo-strip" aria-label="Synthetic demo runs"><div class="demo-label"><span class="tiny-dot"></span>SYNTHETIC DEMO</div><div class="demo-controls"><label for="run-preset">Try a run</label><select id="run-preset" aria-label="Select a synthetic demo run">${SAMPLE_RUNS.map((r,i)=>`<option value="${esc(r.id)}" ${state.run?.id===r.id?'selected':''}>${esc(r.title || `Example run ${i+1}`)}</option>`).join('')}${state.run?.custom?'<option selected value="custom">Your imported report</option>':''}</select><button class="icon-button" data-action="replay" title="Replay the selected run" aria-label="Replay the selected run">${icon('repeat')}</button></div><span class="demo-explainer">Real parsing. Real local retrieval. Example data.</span></section>
  ${state.runError?`<div class="banner error" role="alert">${icon('info')}<div><strong>That report could not be opened.</strong><p>${esc(state.runError)}</p></div><button class="text-button" data-action="import-run">Try another file</button></div>`:''}
  ${state.aiLimitMessage?`<div class="banner warning" role="status">${icon('info')}<p>${esc(state.aiLimitMessage)}</p></div>`:''}
  ${persistenceError?`<div class="banner warning" role="status">${icon('info')}<p>${esc(persistenceError)}</p></div>`:''}
  <section class="run-section" aria-labelledby="run-heading"><div class="section-heading"><div><div class="run-heading-line"><h2 id="run-heading">${esc(state.run?.title || 'Your run inbox')}</h2>${state.run?.custom?'<span class="badge neutral">IMPORTED</span>':'<span class="badge neutral">EXAMPLE RUN</span>'}</div><p>${state.run?.custom?'Parsed in this browser. The full report is not saved.':esc(state.run?.description || 'Select a sample or import your own JUnit XML.')}</p></div><div class="run-mode">${icon(state.model==='ready'?'spark':'shield')}<span>${state.model==='loading'?`Loading open model · ${Math.round(state.modelProgress)}%`:state.semanticBusy?'Comparing local embeddings…':state.model==='ready'&&!state.aiLimitMessage?'Semantic + exact recall':'Exact matching only'}</span></div></div>
  <div class="run-summary"><div class="summary-block"><span class="summary-number failure-count">${state.failures.length}</span><span>failed tests</span></div><div class="summary-connector" aria-hidden="true"><span></span>${icon('arrow')}</div><div class="summary-block"><span class="summary-number">${state.groups.length}</span><span>distinct patterns</span></div><div class="summary-divider"></div><div class="summary-block recall-summary"><span class="summary-number">${exactCount}</span><span>exact memories</span></div><div class="summary-note">${state.failures.length>state.groups.length?`${state.failures.length-state.groups.length} repeated symptoms grouped.<br>Review each pattern, not every failure.`:'Every pattern keeps its original evidence.<br>No automatic fixes. You stay in control.'}</div>${relatedCount?`<div class="semantic-count">${icon('spark')}${relatedCount} related ${relatedCount===1?'note':'notes'}</div>`:''}</div>
  ${state.groups.length?`<div class="workbench"><section class="patterns-panel" aria-label="Failure patterns"><div class="panel-toolbar"><div><strong>Failure patterns</strong><span class="count-label">${state.groups.length}</span></div><label class="search-box" for="pattern-search">${icon('search')}<input id="pattern-search" type="search" value="${esc(state.query)}" placeholder="Filter patterns" autocomplete="off" /></label></div>${renderPatterns()}<div class="panel-footer">${icon('info')}Grouped by normalized error signature, not guessed root cause.</div></section><section class="evidence-panel" aria-label="Selected failure evidence">${renderEvidence()}</section></div>`:renderEmptyRun()}</section>
  <section class="bottom-note"><span class="loop-symbol">${icon('repeat')}</span><p>Today’s investigation.<br><strong>Tomorrow’s starting point.</strong></p><button class="text-button" data-action="go-memory">Open your fix memory ${icon('arrow')}</button></section>`;
}
function renderPatterns() {
  const groups = state.groups.filter(g => `${g.representative.name} ${g.representative.suite} ${g.representative.message}`.toLowerCase().includes(state.query.toLowerCase()));
  if (!groups.length) return `<div class="empty-state compact">${icon('search')}<h3>No matching patterns</h3><p>Try a test name or part of an error message.</p><button class="text-button" data-action="clear-filter">Clear filter</button></div>`;
  return `<div class="table-scroll"><table class="patterns-table"><thead><tr><th scope="col">Pattern / first occurrence</th><th scope="col" class="count-column">Tests</th><th scope="col">Memory</th><th scope="col"><span class="sr-only">Details</span></th></tr></thead><tbody>${groups.slice(0,state.patternLimit).map(g=>{
    const r=recall(g); const isSelected=state.selected===g.id;
    return `<tr class="pattern-row ${isSelected?'selected':''}" data-group-row="${esc(g.id)}"><td><button class="pattern-select" data-group="${esc(g.id)}" aria-pressed="${isSelected}"><span class="pattern-name">${esc(firstLine(g.representative.message || g.representative.name))}</span><span class="pattern-suite">${esc(g.representative.suite || 'Test suite')}<span>·</span>${esc(g.representative.name)}</span></button></td><td class="count-column"><span class="occurrence-count">${g.count}</span></td><td><span class="memory-status ${r.kind}">${icon(r.kind==='exact'?'memory':r.kind==='semantic'?'spark':'minus')}<span>${r.kind==='exact'?'Exact match':r.kind==='semantic'?'Related note':r.kind==='dismissed'?'Set aside':'Not known'}</span></span></td><td class="row-chevron">${icon('chevron')}</td></tr>`;
  }).join('')}</tbody></table></div>${groups.length>state.patternLimit?`<div class="load-more"><span>Showing ${state.patternLimit} of ${groups.length} patterns</span><button class="text-button" data-action="more-patterns">Show next 100 ${icon('down')}</button></div>`:''}`;
}
function firstLine(value) { return safe(String(value).split('\n').filter(Boolean)[0] || 'Unnamed failure'); }
function renderEvidence() {
  const group=state.groups.find(g=>g.id===state.selected) || state.groups[0];
  if (!group) return '';
  const r=recall(group);
  const incident=r.incident;
  return `<div class="evidence-header"><span>THE EVIDENCE</span><span class="source-id">${esc(group.id)}</span></div><div class="evidence-body"><div class="evidence-title-line"><span class="failure-indicator" aria-hidden="true">${icon('close')}</span><h3>${esc(firstLine(group.representative.message || group.representative.name))}</h3></div><div class="evidence-meta">${icon('file')}<span>${esc(group.representative.suite || 'Test suite')}<br><strong>${esc(group.representative.name)}</strong></span></div><div class="source-label"><span>Observed in this run</span><span>${group.count} ${group.count===1?'occurrence':'occurrences'}</span></div><pre class="evidence-code"><code>${esc(safe(textOf(group.representative)))}</code></pre><details class="occurrences"><summary>Inspect ${group.count<=100?'all ':''}${group.count} ${group.count===1?'occurrence':'occurrences'} ${icon('down')}</summary><div>${group.failures.slice(0,100).map(f=>`<div class="occurrence"><strong>${esc(f.name)}</strong><span>${esc(f.suite)}</span><pre>${esc(safe(textOf(f)))}</pre></div>`).join('')}${group.count>100?'<p class="bounded-evidence">Showing the first 100 occurrences. Your original report contains the full evidence.</p>':''}</div></details>
  <div class="recall-divider">${icon(r.kind==='none'?'memory':'link')}<span>${r.kind==='exact'?'An exact memory surfaced':r.kind==='semantic'?'A related memory surfaced':r.kind==='dismissed'?'Your review comes first':'A place for the next fix'}</span></div>
  ${incident?`<article class="fix-note ${r.kind==='semantic'?'suggested':''}"><div class="fix-note-top"><span class="badge ${r.kind==='exact'?'moss':'amber'}">${icon(r.kind==='exact'?'check':'spark')}${r.kind==='exact'?'EXACT SYMPTOM':'RELATED · VERIFY FIRST'}</span>${incident.synthetic?'<span class="synthetic-label">DEMO NOTE</span>':'<span class="synthetic-label">YOUR NOTE</span>'}</div><h4>${esc(incident.title)}</h4><p class="fix-text">${esc(incident.fix)}</p><div class="citation"><span>${icon('link')}Stored evidence</span><p>${esc(incident.evidence)}</p><small>Memory ${esc(incident.id)} · ${dateLabel(incident.createdAt)}</small></div><p class="verification-note">${r.kind==='exact'?'Matching symptoms are not proof of the same cause. Verify this fix in your environment.':'Semantic similarity is a lead, not a diagnosis. Confirm the cause before applying this fix.'}</p><div class="fix-actions"><button class="text-button" data-action="copy-fix" data-incident="${esc(incident.id)}">${icon('copy')}Copy fix note</button><button class="icon-button" data-action="view-memory" data-incident="${esc(incident.id)}" title="Open this memory" aria-label="Open this memory">${icon('arrow')}</button></div><button class="dismiss-candidate" data-action="reject-candidate" data-group-id="${esc(group.id)}" data-incident="${esc(incident.id)}">${icon('minus')}Not the same issue</button></article>`:r.kind==='dismissed'?`<div class="no-memory dismissed-memory"><h4>That note is set aside.</h4><p>You marked it as a different issue. This failure is still open. Your feedback applies to this run only; it does not retrain the model.</p><button class="text-button" data-action="undo-reject" data-group-id="${esc(group.id)}">${icon('repeat')}Undo dismissal</button></div>`:`<div class="no-memory"><h4>No prior fix to recall.</h4><p>${state.aiLimitMessage?'Semantic lookup is paused for this report. Exact matching remains available.':state.model==='loading'?'The open model is loading. Exact matches work now; related notes will appear when local inference is ready.':state.semanticBusy?'The local model is comparing symptoms. Related notes will appear when this finishes.':state.model==='ready'?'Nothing in your memory is a clear enough lead. Groundhog leaves this one open.':'No exact symptom match. Load the open model to look for related notes, or save a fix after you verify it.'}</p>${state.model!=='ready'&&state.model!=='loading'?'<button class="text-button" data-action="load-model">Look for related fixes '+icon('arrow')+'</button>':''}</div>`}
  <button class="button record-button" data-action="record-fix">${icon('plus')}Record a verified fix</button><p class="record-caption">Your investigation becomes searchable memory.</p></div>`;
}
function renderEmptyRun() {
  return `<div class="empty-state">${icon('check')}<h3>${state.run?'No failed tests found.':'Nothing to investigate yet.'}</h3><p>${state.run?'This report contains no failure or error elements. Import another report or try a synthetic run.':'Import a JUnit report to group repeated failures and look for past fixes.'}</p><button class="button secondary" data-action="import-run">${icon('upload')}Import another report</button></div>`;
}
function dateLabel(value) {
  const d = new Date(value);
  return Number.isNaN(d.getTime())?'Undated':new Intl.DateTimeFormat('en', {month:'short',day:'numeric',year:'numeric'}).format(d);
}
function renderMemory() {
  const matching = state.memory.filter(i=>`${i.title} ${i.symptom} ${i.fix}`.toLowerCase().includes(state.memoryQuery.toLowerCase()));
  return `<section class="page-intro memory-intro"><div><h1>Good fixes<br><em>deserve a memory.</em></h1><p>A notebook of what actually worked.<br>Every note has a symptom, a fix, and its evidence.</p></div><div class="intro-actions"><button class="button primary" data-action="export-memory">${icon('download')}Export memory</button><button class="text-button" data-action="import-memory">Import memory JSON ${icon('upload')}</button></div></section>${state.removedMemory?`<div class="banner warning removal-banner" role="status"><p>Removed “${esc(state.removedMemory.incident.title)}” from this browser.</p><button class="text-button" data-action="undo-remove">Undo removal</button></div>`:''}<div class="memory-toolbar"><div><h2>Fix memory <span class="count-label">${state.memory.length}</span></h2><p>${state.memory.filter(i=>!i.synthetic).length} of your notes · ${state.memory.filter(i=>i.synthetic).length} synthetic examples</p></div><label class="search-box" for="memory-search">${icon('search')}<input id="memory-search" type="search" placeholder="Search your memory" value="${esc(state.memoryQuery)}" /></label></div><div class="memory-list">${matching.length?matching.slice(0,state.memoryLimit).map(i=>`<article class="memory-entry ${state.selectedMemory===i.id?'memory-highlight':''}" id="memory-${esc(i.id)}"><div class="memory-entry-icon">${icon('memory')}</div><div class="memory-entry-main"><div class="memory-entry-heading"><h3>${esc(i.title)}</h3><span class="badge ${i.synthetic?'neutral':'moss'}">${i.synthetic?'SYNTHETIC EXAMPLE':'SAVED NOTE'}</span></div><p class="memory-symptom">${esc(firstLine(i.symptom))}</p><details ${state.selectedMemory===i.id?'open':''}><summary>Read fix & evidence ${icon('down')}</summary><div class="memory-expanded"><div><h4>What worked</h4><p>${esc(i.fix)}</p></div><div><h4>Stored evidence</h4><p>${esc(i.evidence)}</p></div><details class="stored-symptom"><summary>Full stored symptom</summary><pre>${esc(i.symptom)}</pre></details><div class="memory-entry-actions"><button class="text-button" data-action="copy-fix" data-incident="${esc(i.id)}">${icon('copy')}Copy fix note</button><span>Memory ${esc(i.id)}</span></div>${!i.synthetic?`<button class="text-button remove-memory" data-action="confirm-remove" data-incident="${esc(i.id)}">Remove this note</button>`:''}</div></details></div><time datetime="${esc(i.createdAt)}">${dateLabel(i.createdAt)}</time></article>`).join(''):`<div class="empty-state">${icon('search')}<h3>No matching memories</h3><p>Try a different search, or record a verified fix from your run inbox.</p><button class="text-button" data-action="clear-memory-filter">Clear search</button></div>`}</div>${matching.length>state.memoryLimit?`<div class="load-more"><span>Showing ${state.memoryLimit} of ${matching.length} notes</span><button class="text-button" data-action="more-memories">Show next 100 ${icon('down')}</button></div>`:''}<div class="privacy-note">${icon('shield')}<div><strong>Your memory stays yours.</strong><p>New notes are saved in this browser’s local storage. Export a backup to move them between devices. Import merges notes and never replaces an existing ID. Review exported files before sharing.</p></div></div>`;
}
function renderAbout() {
  const modelName = MODEL_INFO?.id || MODEL_INFO?.modelId || MODEL_INFO?.name || 'Xenova/all-MiniLM-L6-v2';
  return `<section class="page-intro about-intro"><div><h1>A memory,<br><em>not a magic answer.</em></h1><p>Groundhog helps you find past investigations.<br>It doesn’t pretend to know your codebase.</p></div>${mark}</section><section class="how-flow" aria-label="How Groundhog works"><article><span class="step-number">1</span><div><h2>Bring the failure</h2><p>Import a JUnit XML report or paste it. Repeated normalized error signatures become a single pattern, with every original occurrence still attached.</p><span class="process-tag">Deterministic grouping</span></div></article><article><span class="step-number">2</span><div><h2>Find the investigation</h2><p>Exact recall works immediately. Optionally load MiniLM, a small open embedding model, to compare the meaning of new symptoms against your stored fix notes. Related notes are leads to verify, never automatic diagnoses.</p><span class="process-tag">Real local model inference</span></div></article><article><span class="step-number">3</span><div><h2>Fix it. Then remember it.</h2><p>After you verify a fix, record what worked and cite its evidence. Replay a report to see that note surface next time. Groundhog never edits your code or runs a suggested command.</p><span class="process-tag">A human-confirmed learning loop</span></div></article></section><section class="technical-details"><h2>Small by design.</h2><div class="evaluation-note"><strong>Why every suggestion needs review</strong><p>In a 24-case, hand-authored held-out test, semantic retrieval surfaced 9 suggestions: 8 correct and 1 wrong. An HTTP 503 migration failure incorrectly retrieved a startup-readiness note. This small synthetic test is not a production benchmark. Groundhog therefore shows historical evidence, never an automatic diagnosis.</p></div><dl><div><dt>Open model</dt><dd>${esc(modelName)}<br><span>Quantized MiniLM · 384-dimensional sentence embeddings</span></dd></div><div><dt>What it learns</dt><dd>Your explicit fix notes. No background training or fine-tuning.</dd></div><div><dt>What leaves this page</dt><dd>Model files download from the model host when you choose to load them. Report text, embeddings, and notes are processed locally, with no remote inference or telemetry.</dd></div><div><dt>Without the model</dt><dd>JUnit parsing, deterministic grouping, exact recall, and saving notes still work. Related-match suggestions require a successful model load.</dd></div><div><dt>What stays here</dt><dd>Only your saved fix notes are persisted in local storage. Reports stay in session memory. Common secret patterns are redacted, but you should still review notes before saving or sharing.</dd></div><div><dt>Demo vs. real data</dt><dd>All built-in reports and seeded fix notes are synthetic and labeled. Imported reports and notes are yours. There are no fabricated production metrics or model-generated fixes.</dd></div></dl></section><div class="about-cta"><p>Give your next investigation a head start.</p><button class="button primary" data-action="go-run">Open run inbox ${icon('arrow')}</button></div>`;
}
function openDialog(content) {
  dialog.innerHTML = content;
  dialog.showModal();
  dialog.querySelector('input:not([type="checkbox"]),textarea,button')?.focus();
}
function dialogHeader(title,description) {
  return `<div class="dialog-header"><div><h2 id="dialog-title">${title}</h2><p>${description}</p></div><button class="icon-button" data-action="close-dialog" aria-label="Close dialog">${icon('close')}</button></div>`;
}
function openPaste() {
  openDialog(`${dialogHeader('Bring your JUnit report','Paste XML below. Parsing happens locally; the full report is not saved.')}<form id="paste-form" novalidate><label class="field-label" for="report-name">Report name</label><input id="report-name" name="name" value="Imported JUnit report" maxlength="100"/><label class="field-label" for="report-xml">JUnit XML</label><textarea id="report-xml" name="xml" rows="12" placeholder="&lt;testsuite name=&quot;checkout&quot;&gt;…&lt;/testsuite&gt;" required spellcheck="false"></textarea><p id="paste-error" class="field-error" role="alert"></p><div class="dialog-footer"><span>${icon('shield')}Stays in this browser</span><button type="submit" class="button primary">Read report ${icon('arrow')}</button></div></form>`);
}
function openRecord() {
  const group = state.groups.find(g=>g.id===state.selected) || state.groups[0];
  if (!group) return;
  openDialog(`${dialogHeader('Give this fix a memory.','Save what you verified, not what you suspect. Groundhog will recall your note next time.')}<form id="fix-form" novalidate data-group="${esc(group.id)}"><div class="recording-symptom"><span>FOR THIS SYMPTOM</span><p>${esc(firstLine(group.representative.message || group.representative.name))}</p></div><label class="field-label" for="fix-title">A useful title <span>Required</span></label><input id="fix-title" name="title" maxlength="180" placeholder="e.g. Regenerate the lockfile with the pinned Node version" required/><label class="field-label" for="fix-body">What fixed it? <span>Required</span></label><textarea id="fix-body" name="fix" rows="4" maxlength="10000" placeholder="Describe the verified fix and any conditions that matter." required></textarea><label class="field-label" for="fix-evidence">Evidence or reference <span>Required</span></label><textarea id="fix-evidence" name="evidence" rows="2" maxlength="4000" placeholder="A commit, issue, command result, or investigation note that supports this fix." required></textarea><label class="checkbox-field"><input type="checkbox" name="verified" required/><span>I verified this fix. This note is my finding, not an AI-generated answer.</span></label><p id="fix-error" class="field-error" role="alert"></p><div class="dialog-footer"><span>${icon('shield')}Review for secrets before saving</span><button type="submit" class="button primary">${icon('memory')}Save verified fix</button></div></form>`);
}
function openRemove(incidentId) {
  const incident=state.memory.find(i=>i.id===incidentId);
  if(!incident || incident.synthetic)return;
  openDialog(`${dialogHeader('Remove this fix note?', 'The note will be removed from this browser’s memory. Your exported backups will not change.')}<div class="recording-symptom"><p>${esc(incident.title)}</p></div><p class="remove-explanation">You can undo this removal during this session. The original failure report is not affected.</p><div class="dialog-footer"><button class="button secondary" data-action="close-dialog">Keep note</button><button class="button danger" data-action="remove-memory" data-incident="${esc(incident.id)}">Remove note</button></div>`);
}
async function setRun(xml, metadata) {
  try {
    const failures = parseJUnit(xml);
    state.failures = failures; state.groups = groupFailures(failures); state.selected = state.groups[0]?.id || null;
    state.run = metadata; state.runVersion++; state.runError=''; state.query=''; state.patternLimit=100; state.rejected={}; state.screen='run';
    if (location.hash !== '#run') history.replaceState(null,'','#run');
    render();
    if (state.model==='ready') await indexMemory();
    return true;
  } catch(error) {
    state.runError = error.message || 'Check that the file contains valid JUnit XML and try again.';
    render(); return false;
  }
}
async function indexMemory() {
  const token=++generation;
  const runVersion=state.runVersion;
  state.semanticBusy=true; state.aiLimitMessage=''; render();
  const failures=state.groups.map(g=>g.representative);
  const items=[...failures.map(f=>({id:f.id,text:normalizeFailure(textOf(f) || f.name)})),...state.memory.map(i=>({id:i.id,text:normalizeFailure(i.symptom)}))];
  if(items.length > MAX_AI_ITEMS || items.some(i => i.text.length > MAX_AI_TEXT)) {
    state.semanticBusy=false;
    if(state.model==='loading')state.model='idle';
    state.aiLimitMessage='Semantic lookup is paused for this report. Use at most 250 total patterns and memory notes, with each symptom under 20,000 characters. Exact matching is still available.';
    render();notify(state.aiLimitMessage,'error');return;
  }
  try {
    const vectors=await embedTexts(items.map(i=>i.text), progress=>{
      if(state.model==='loading') updateProgress(progress);
    });
    if(token!==generation) return;
    state.embeddingMap=Object.fromEntries(items.map((item,index)=>[item.id, Array.from(vectors[index])]));
    state.model='ready'; state.modelError='';
    if(state.runVersion!==runVersion) { state.semanticBusy=false; await indexMemory(); return; }
  } catch(error) {
    if(token!==generation) return;
    state.model='error'; state.modelError=error.message || 'The model could not be loaded.';
    notify('The local model could not run. Exact matching is still available.','error');
  } finally {
    if(token===generation) { state.semanticBusy=false; render(); }
  }
}
let lastProgressRender=0;
function updateProgress(progress) {
  if(typeof progress==='number') state.modelProgress=Math.max(0,Math.min(100,progress));
  else if(progress) {
    state.modelProgress=Math.max(state.modelProgress,Math.min(100,Number(progress.progress ?? progress.percent ?? 0)));
    state.modelMessage=progress.status==='progress'?`Downloading model files · ${Math.round(state.modelProgress)}%`:progress.message || (progress.status==='ready'?'Preparing inference…':'Preparing open model…');
  }
  if(Date.now()-lastProgressRender>200) { lastProgressRender=Date.now(); render(); }
}
async function loadModel() {
  if(state.model==='loading'||state.model==='ready') return;
  state.model='loading';state.modelProgress=0;state.modelMessage='Preparing open model…';state.modelError='';render();
  await indexMemory();
  if(state.model==='ready') notify('Open model ready. Related-fix retrieval now runs locally.');
}
function exportMemory() {
  const content=JSON.stringify({version:1,incidents:state.memory.map(({synthetic,...i})=>i)},null,2);
  const blob=new Blob([content],{type:'application/json'});
  const url=URL.createObjectURL(blob);const anchor=document.createElement('a');anchor.href=url;anchor.download='groundhog-memory.json';anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  notify('Memory exported. Review the file before sharing it.');
}
async function importMemory(file) {
  if(file.size>MAX_FILE_SIZE) { notify('Memory file is too large. Choose a JSON file smaller than 2 MiB.','error'); return; }
  try {
    const parsed=JSON.parse(await file.text());const checked=validateMemory(parsed);
    if(!checked.valid) throw new Error(checked.errors?.join(' ') || 'This is not a valid Groundhog memory file.');
    const incoming=Array.isArray(checked.memory)?checked.memory:checked.memory?.incidents;
    if(!Array.isArray(incoming)) throw new Error('The file does not contain an incidents list.');
    const ids=new Set(state.memory.map(i=>i.id));const added=incoming.filter(i=>!ids.has(i.id)).map(i=>({...i,title:safe(i.title),symptom:safe(i.symptom),fix:safe(i.fix),evidence:safe(i.evidence),synthetic:false}));
    if(state.memory.length+added.length>ENGINE_LIMITS.maxIncidents)throw new Error('This import would exceed the 5,000-note memory limit.');
    const combined=validateMemory({version:1,incidents:[...state.memory,...added]});
    if(!combined.valid)throw new Error(combined.errors.join(' '));
    state.memory.push(...added);remember();render();notify(`${added.length} ${added.length===1?'note':'notes'} imported. Existing memory IDs were kept.`);
    if(state.model==='ready') await indexMemory();
  } catch(error) { notify(`Memory was not imported. ${error.message}`,'error'); }
}
async function handleAction(action,target) {
  switch(action) {
    case 'import-run': document.querySelector('#junit-file').click(); break;
    case 'paste-run': openPaste(); break;
    case 'close-dialog': dialog.close(); break;
    case 'load-model': await loadModel();break;
    case 'record-fix':openRecord();break;
    case 'reject-candidate':state.rejected[target.dataset.groupId]=target.dataset.incident;render();notify('Candidate set aside for this run. The failure remains open.');break;
    case 'undo-reject':delete state.rejected[target.dataset.groupId];render();notify('Candidate restored for review.');break;
    case 'confirm-remove':openRemove(target.dataset.incident);break;
    case 'remove-memory': {
      const index=state.memory.findIndex(i=>i.id===target.dataset.incident&&!i.synthetic);
      if(index<0)return;
      state.removedMemory={incident:state.memory[index],index};state.memory.splice(index,1);
      if(state.selectedMemory===target.dataset.incident)state.selectedMemory=null;
      remember();dialog.close();render();notify('Fix note removed from this browser.','success','undo-remove');
      if(state.model==='ready')await indexMemory();break;
    }
    case 'undo-remove': {
      if(!state.removedMemory)return;
      const {incident,index}=state.removedMemory;
      if(state.memory.some(i=>i.id===incident.id)){state.removedMemory=null;render();notify('A note with that ID already exists. The existing note was kept.','error');return;}
      const checked=validateMemory({version:1,incidents:[...state.memory,incident]});
      if(!checked.valid){notify('Cannot restore this note: '+checked.errors.join(' '),'error');return;}
      state.memory.splice(index,0,incident);state.removedMemory=null;state.selectedMemory=incident.id;remember();render();notify('Fix note restored.');
      if(state.model==='ready')await indexMemory();break;
    }
    case 'clear-filter':state.query='';state.patternLimit=100;render();break;
    case 'more-patterns':state.patternLimit+=100;render();break;
    case 'more-memories':state.memoryLimit+=100;render();break;
    case 'clear-memory-filter':state.memoryQuery='';render();break;
    case 'go-memory':location.hash='memory';break;
    case 'go-run':location.hash='run';break;
    case 'view-memory':state.selectedMemory=target.dataset.incident;location.hash='memory';if(state.screen==='memory')render();break;
    case 'export-memory':exportMemory();break;
    case 'import-memory':document.querySelector('#memory-file').click();break;
    case 'copy-fix': {
      const incident=state.memory.find(i=>i.id===target.dataset.incident);
      if(!incident) return;
      try { await navigator.clipboard.writeText(`${incident.title}\n\n${incident.fix}\n\nEvidence: ${incident.evidence}\nMemory: ${incident.id}`); notify('Fix note and evidence copied.'); }
      catch { notify('Clipboard access is unavailable. You can select and copy the note text.','error'); }
      break;
    }
    case 'replay': {
      if(!state.run) return;
      await setRun(state.run.xml, state.run);notify('Run replayed against your current fix memory.');break;
    }
  }
}
document.addEventListener('click',event=>{
  const action=event.target.closest('[data-action]');
  if(action) { handleAction(action.dataset.action,action);return; }
  const group=event.target.closest('[data-group]') || event.target.closest('[data-group-row]');
  if(group) { state.selected=group.dataset.group || group.dataset.groupRow;render(); }
});
window.addEventListener('hashchange',()=>{state.screen=['memory','about'].includes(location.hash.slice(1))?location.hash.slice(1):'run';render();document.querySelector('#main-content').focus({preventScroll:true});});
document.addEventListener('input',event=>{
  if(event.target.id==='pattern-search'){state.query=event.target.value;state.patternLimit=100;render();}
  if(event.target.id==='memory-search'){state.memoryQuery=event.target.value;state.memoryLimit=100;render();}
});
document.addEventListener('change',async event=>{
  if(event.target.id==='run-preset') {
    const run=SAMPLE_RUNS.find(r=>r.id===event.target.value);if(run)await setRun(run.xml,run);
  }
  if(event.target.id==='junit-file') {
    const file=event.target.files?.[0];event.target.value='';if(!file)return;
    if(file.size>MAX_FILE_SIZE){notify('That report is too large. Choose a JUnit XML file smaller than 2 MiB.','error');return;}
    try {const xml=await file.text();if(await setRun(xml,{id:'imported',title:safe(file.name),description:'Your imported report',custom:true,xml}))notify(`${state.failures.length} failed tests read locally.`);}catch(error){notify(`The report could not be read. ${error.message}`,'error');}
  }
  if(event.target.id==='memory-file') {const file=event.target.files?.[0];event.target.value='';if(file)await importMemory(file);}
});
document.addEventListener('submit',async event=>{
  if(event.target.id==='paste-form') {
    event.preventDefault();const data=new FormData(event.target);const xml=String(data.get('xml')||'');
    if(!xml.trim()) {document.querySelector('#paste-error').textContent='Paste your JUnit XML before reading the report.';document.querySelector('#report-xml').focus();return;}
    if(new Blob([xml]).size>MAX_FILE_SIZE){document.querySelector('#paste-error').textContent='This report is too large. Use a report smaller than 2 MiB.';return;}
    const ok=await setRun(xml,{id:'pasted',title:safe(data.get('name')||'Pasted JUnit report'),custom:true,xml});
    if(ok){dialog.close();notify(`${state.failures.length} failed tests read locally.`);}else document.querySelector('#paste-error').textContent=state.runError;
  }
  if(event.target.id==='fix-form') {
    event.preventDefault();const data=new FormData(event.target);const group=state.groups.find(g=>g.id===event.target.dataset.group);
    if(!group)return;
    const title=String(data.get('title')||'').trim(),fix=String(data.get('fix')||'').trim(),evidence=String(data.get('evidence')||'').trim();
    const error=document.querySelector('#fix-error');
    if(!title||!fix||!evidence||!data.get('verified')){
      error.textContent='Add a title, the verified fix, its evidence, and confirm that you tested it.';
      const missing=!title?'fix-title':!fix?'fix-body':!evidence?'fix-evidence':null;
      if(missing)document.getElementById(missing).focus();else event.target.querySelector('[name="verified"]').focus();return;
    }
    const incident={id:`fix-${crypto.randomUUID?.()||Date.now().toString(36)}`,title:safe(title),symptom:safe(textOf(group.representative)),fix:safe(fix),evidence:safe(evidence),createdAt:new Date().toISOString(),synthetic:false};
    const checked=validateMemory({version:1,incidents:[incident,...state.memory]});
    if(!checked.valid){error.textContent='This note could not be saved. '+checked.errors.join(' ');return;}
    state.memory.unshift(incident);const persisted=remember();state.selectedMemory=incident.id;dialog.close();render();
    if(persisted)notify('Verified fix saved. Replay this run to see it recalled.');
    if(state.model==='ready')await indexMemory();
  }
});
dialog.addEventListener('click',event=>{if(event.target===dialog){const rect=dialog.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)dialog.close();}});
if(SAMPLE_RUNS.length) {const initialScreen=state.screen;setRun(SAMPLE_RUNS[0].xml,SAMPLE_RUNS[0]);state.screen=initialScreen;if(initialScreen!=='run')history.replaceState(null,'',`#${initialScreen}`);render();} else render();
