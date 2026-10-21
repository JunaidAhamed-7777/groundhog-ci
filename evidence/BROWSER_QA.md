# Live browser verification

Initial functional pass: 2026-10-21, approximately 09:18–09:30 UTC.
Final deployed-build regression: 2026-10-21, approximately 09:35–09:40 UTC.

Outcome: the observed functional flows passed. The initial stale-removal-banner issue was corrected and retested. Read the limits below; this is not a claim of exhaustive browser coverage.

Target: https://groundhog-ci-junaid.bonnycoot21.chatgpt.site/#run

Environment: a fresh tab in the cloud Chromium browser, operated through supported browser/native UI tools. No private CI report or real user incident was used. This is an interactive browser pass, separate from the Node, CPU-WASM-under-Node, and DOM-stub tests. A fresh tab is not proof of an empty asset cache.

## Observed passes

- Public URL opened directly without an owner-login gate. Desktop workbench, navigation, evidence, and controls rendered.
- Before opting into model loading, Monday showed 12 failed tests, 5 distinct patterns, 0 exact memories, and exact-only mode. Group counts were 4, 3, 3, 1, and 1. Every group was expanded: all 12 original records appeared with their suite names and failure text.
- Explicit **Load model + runtime** completed in the real browser. The app changed to **Open model ready**, then produced 3 related notes for Monday. Authentication and disk-space patterns remained unknown. No model failure or app-origin console error was observed.
- Thursday's changed-wording replay produced 6 failures / 6 patterns / 0 exact memories and 4 related notes. The authentication hard negative and permission failure stayed unknown. These six synthetic examples are not an accuracy benchmark.
- A related note displayed original symptom evidence, stored resolution, provenance, and the warning that semantic similarity is not a diagnosis.
- **Not the same issue** changed a candidate to **Set aside**, kept the unresolved failure, and reduced the related-note count. **Undo dismissal** restored the candidate and count.
- A clearly labeled **SYNTHETIC QA ONLY — persistence probe** note was saved through the form. It explicitly claimed only a storage-workflow check, not a real CI fix. Reload retained it; Monday and replay recalled it as an exact symptom match with the original note/evidence.
- Export produced version-1 notebook JSON with 4 expected notes. Reimporting the same file added 0 duplicates. After removing the QA note through the confirmation dialog, importing the exported file restored exactly 1 note. Existing seed IDs were retained.
- Removal cancellation preserved the QA note. Confirmed removal removed it. **Undo removal** restored it. Final cleanup removed that note again; a real reload confirmed **0 of your notes · 3 synthetic examples**.
- Escape closed the record and paste dialogs without saving. Removal's **Keep note** action cancelled. Browser back/forward navigated memory/about correctly. Navigation remained functional while the model was loading, and inference subsequently reached ready.
- Malformed XML stayed in the paste dialog with the inline error **XML is incomplete.** The active run was not replaced.
- A 2,097,153-character pasted report was rejected with **This report is too large. Use a report smaller than 2 MiB.** Cancelling retained the active Monday run.
- A 12,617-character synthetic log exposed an **AI excerpt** of 353 characters. It retained the late ECONNREFUSED line, showed normalized source lines 1, 2, 122, 123, 124, omission markers, selector version, and the independent 256-token limitation. Full original evidence remained available above it.
- The same log contained literal script and image/onerror-looking strings. Those strings appeared as text in evidence and the excerpt; no injected UI or alert executed during the test. The browser remained usable.
- Ordinary native window resizing produced a 490-CSS-pixel narrow viewport. Read-only DOM measurements showed clientWidth=490 and scrollWidth=490, with no main buttons/inputs/selects overflowing the right edge. Overview, stacked workbench, notebook, and paste modal rendered and were usable. This was a narrow desktop window, not a mobile device test.
- A synthetic JSON file unavailable to the browser produced a visible **Memory was not imported** file-read error and preserved the existing three-note notebook.

- Double-clicking replay settled back to the same 12 failures, 5 patterns, and 3 semantic candidates without duplicate records.

Initial deployed asset identifiers: `index-C7juFgJ8.js` and `index-B654uk7d.css`.

## Issue found during initial pass

After restoring a deleted note by importing its exported ID, the previous **Removed … / Undo removal** banner remained visible even though the note had returned. Notebook contents were correct and duplicate IDs were not inserted. This was reported for a small state-cleanup fix and final regression check.

Desktop evidence/action text was visually too small in the first screenshots. A bounded readability/contrast polish was requested before final screenshots. The initial screenshots are not presented as the final polished UI.

## Limits and untested claims

- Chromium's organization policy explicitly blocked DevTools. No attempt was made to enable it or bypass that restriction. Device emulation, mobile Safari/Firefox, and widths below the ordinary window minimum were not tested.
- Network payload capture was not available in this pass. This report does not independently prove absence of report-text transmission; local-only design must also be evaluated from source and asset behavior. Console diagnostics are not a network audit.
- Cold-cache timing, offline operation, low-memory devices, WebGPU, browser-storage denial/quota failures, and cross-browser compatibility were not established.
- Schema-invalid JSON import was not established in-browser: synthetic scratch-file paths were unavailable to the browser. The observed error was a file-read failure, not successful exercise of the schema validator. JSON export/restore used the browser's own downloaded file and passed.
- No prize outcome, production accuracy, real incident resolution, or human time-saving measurement is implied by these checks.

## Actual screenshots

PNG captures are browser screenshots, not generated mockups. They have not been edited to change the UI. The pointer was moved to the far-left margin outside the main content before the final captures.

Initial before-polish captures were used for the readability review. The published evidence set below contains the final captures.


## Final deployed-build regression

The live document exposed `index-DJsxFc5F.js` and `index-DgSfsElH.css`, matching the final readability/state-fix deployment.

- Desktop evidence, provenance, controls, model status, and supporting text were visibly larger and clearer while preserving the existing layout. The measured desktop document had matching client/scroll widths (1171px before resizing; approximately 1170px after restoring the window), with no horizontal document overflow.
- At 490 CSS pixels, the newly added near-top model panel was visible before any model-load click. It showed the optional 23MB model/runtime download and an explicit button. Clicking changed the panel to progress and then **Open model ready**. The app did not initialize inference merely because the page was reloaded. This is a UI observation, not a captured network trace.
- The loaded browser again produced Monday's 3 expected related notes and left its two unfamiliar patterns unknown. The narrow page stayed at clientWidth=scrollWidth=490, and the stacked layout remained usable.
- The removal/import issue was reproduced on the final build: import the temporary synthetic note, remove it with confirmation, then restore it from the original export. Exactly 1 note returned. Both the obsolete removal banner and **Undo removal** control disappeared; the latter's DOM count was 0.
- The temporary note was removed again using the app confirmation. Reload confirmed **0 of your notes · 3 synthetic examples**. Final screenshot captures show only built-in synthetic demonstration content, not QA notes.
- No application-origin warning/error appeared in the inspected final console diagnostics. The captured log stream contained browser-extension metadata errors, which are distinguished from app failures.

### Final screenshot set

Use these rather than the before-polish images:

- [`screenshots/desktop-overview.png`](screenshots/desktop-overview.png): clean hero, loaded model status, Monday summary, and first workbench row.
- [`screenshots/desktop-evidence-final.png`](screenshots/desktop-evidence-final.png): readable related-fix note, stored evidence, provenance, review warning, and rejection control.
- [`screenshots/narrow-opt-in.png`](screenshots/narrow-opt-in.png): the same narrow layout before explicit model loading, with the opt-in panel.

The narrow captures are not evidence of a physical mobile device or mobile browser test. DevTools remained blocked; the restriction was respected.
