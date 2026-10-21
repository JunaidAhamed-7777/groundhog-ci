# Diagnostic excerpt preparation

Version: `diagnostic-lines-v1`, exported as `INPUT_PREPARATION_VERSION` by `src/semantic-input.js`.

## Reason for the change

The original `firstRun.modelInputs.queries` records for `stress-01` and `stress-02` in `stress-evaluation.json` contain different late failures after a shared header and repetitive DEBUG setup lines. The original records report 1,098 and 1,101 tokens, respectively, truncated to 256 tokens. Both retained-token hashes are `7602dc7ac54a43edeac1062809681a898351b0a0c3f826e9924a229ce813c720`. Thus their differing ENOSPC and ENOTFOUND diagnostics were absent from the original retained model inputs. These original records and benchmark outcomes have not been changed.

This is an input-retention defect, not evidence that a particular fix or root cause is correct. The stress evaluator retains and replays those exact original strings. Unit tests use self-contained synthetic shared-prefix inputs so a fresh checkout can test preprocessing without requiring a generated benchmark report. Neither unit test construction nor excerpt selection uses expected retrieval labels.

## Exported contract

`prepareSemanticText(text)` accepts a string and returns `{ text, selectedLines, truncated, originalLength }`.

- Inputs of at most 1,000 JavaScript UTF-16 code units remain byte-for-byte unchanged as strings, including whitespace and line endings. Empty text returns an empty list of selected lines.
- Longer inputs produce at most 1,000 UTF-16 code units. Selection is deterministic, tokenizer-independent, and requires no model or network call.
- `selectedLines` contains unique 1-based line numbers in the supplied input string, in input order. In the application that input is the normalized symptom, so these are not raw JUnit file line numbers. A selected line can be partially retained. `[…]` explicitly marks omitted lines or parts of long lines. It is a display cue, not a reversible serialization format.
- `truncated` reports whether this preparation step cropped the supplied string. It does not report the tokenizer's later decision. `originalLength` is the original string length in UTF-16 code units, not a byte or token count.
- Non-string input throws `TypeError`; strings are never evaluated, parsed as HTML, or mutated. The function does not redact secrets or normalize source text. Perform the existing redaction/normalization step separately as appropriate.
- The caller must preserve and display the original evidence independently of the excerpt, and surface cropping to the user. The excerpt must not replace the stored failure, grouping signature, or original benchmark input. Include this version in embedding-cache identity and new evaluation provenance.

## Selection policy

Keep a compact first nonblank line, then allocate the budget to syntax-level diagnostic cues: conventional uppercase E-prefixed error codes, FATAL, caused-by, error-code labels, failures, errors, exceptions, and expected/actual/received/assertion lines. Higher-priority cues are selected first; ties prefer later lines. Repeated exact lines are not repeatedly added. Generic DEBUG/TRACE keyword mentions do not count as failure evidence, but explicit error codes or labelled errors within such lines remain eligible. Selected lines are emitted in their original order. Adjacent non-debug context and a small non-debug tail are retained when space permits. Very long single lines preserve a head, a tail, and, when recognized, a window around a diagnostic cue.

The selector has no incident IDs, expected retrieval results, labels, root-cause mappings, or proposed fixes. ENOSPC/ENOTFOUND occur only in evidence-based regression assertions, not in selection logic. Empty or unrecognized logs do not receive invented diagnostics.

## Limits and validation scope

The model still has its own 256-token limit. A 1,000-character excerpt, or even a shorter unchanged input, can exceed it, especially with code, punctuation, Unicode, or unusual tokenization. No character-only selector guarantees that every selected diagnostic reaches the embedding model. Generic keywords can produce false positives; a finite budget can omit meaningful earlier diagnostics, long assertions, or intervening context. The selector does not prove root cause, validate a retrieved resolution, or solve difficult semantic distinctions.

The focused unit tests verify retention of both late failure types in self-contained synthetic regressions, distinct excerpts, bounded repetitive boilerplate, deterministic source-line metadata, literal markup handling, unchanged short text, invalid-input rejection, and empty/single-huge-line behavior. These are preprocessing checks, not a new retrieval accuracy claim. New model/evaluation runs must be reported separately with their preparation version; historical benchmark results remain intact.
