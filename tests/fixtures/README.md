# Fixture provenance

Groundhog has three separate kinds of evidence. Do not conflate them.

## Interactive demonstration

`src/demo-data.js` contains hand-authored synthetic JUnit reports and a synthetic
incident notebook. Monday has 12 failures with repeated identical symptoms;
Thursday has 6 failures with changed wording and deliberately unrelated errors.
The dates and resolution notes are scenario material, not a history of real
incidents. These examples establish the UI workflow, not production accuracy.

## Retrieval stress cases

`retrieval.json` is a hand-authored synthetic language test with 13 calibration
queries and 24 held-out queries. It references the three notebook entries in
`SEED_INCIDENTS`. A matching label means the author intended the query to describe
the same symptom family. It does not establish a verified root cause.

Use only `calibration` to choose thresholds and hard-negative rules, then freeze
them before running `heldOut`. If any held-out result is used to change the
algorithm, disclose that it is now development data. Neither set is a substitute
for evaluation on independently collected real CI failures.

Cases include password rejection versus a refused TCP connection, package
integrity/network/engine failures versus stale lockfiles, and query or UI-selector
timeouts versus application startup readiness. `expectedIncidentId: null` means
the tool should not claim a known incident match. Similarity scores are not
calibrated probabilities.

## Actual captured exceptions

Run from the repository root:

```sh
python tools/generate-fixtures.py
```

The generator deliberately performs failing local operations and captures their
real exceptions: missing files, invalid JSON, duplicate SQLite unique keys,
refused loopback connections, socket-read timeouts, and invalid UTF-8. The default
is three variations of each family, for 18 captured failures. It fails rather
than inventing an exception if an operation unexpectedly succeeds.

`generated/captured.xml` is actual runtime output from those controlled fixtures.
`generated/manifest.json` stores the separate family labels, generation time,
generator hash, report hash, and measured operation durations. Temporary paths,
traceback line numbers, timestamps, and timing values can change between runs.
No production logs, private user data, external network service, or paid API is
involved. These files support parser, grouping, and provenance checks, not a claim
that the three demonstration fixes resolve their six distinct fault families.
