# Security and privacy boundaries

Groundhog is a read-only retrieval aid. It never runs a remembered shell command, modifies a repository, or suppresses a failed test. A similar symptom is not proof that a historical fix applies.

## Inputs

- JUnit and memory imports are limited to 2 MiB. XML declarations that would introduce DTDs or custom/external entities are rejected. Nesting, node counts, fields, and collection sizes are bounded.
- Imported evidence and notes are displayed as escaped text. They are not treated as HTML, JavaScript, or instructions for the app.
- Credential redaction is best-effort. Unknown secret formats, personal information, and business-sensitive data may remain. Review inputs and exported notebooks before sharing them.
- Normalization preserves assertion values rather than treating different diagnostics as exact repeats.

## Storage and network

- The browser notebook uses local storage. Export a backup for portability. Local storage is not encrypted by the application, and anyone with access to the same browser profile may be able to read it.
- Application inference runs locally. Model and runtime assets must be downloaded on first use; asset hosts and the website host can see ordinary request metadata.
- The application does not send imported reports or notes to a hosted inference API and contains no analytics integration. That is an application-code statement, not a guarantee about the browser, extensions, operating system, or hosting provider.
- Never rely on an unverified offline/cache claim. The pinned model and tokenizer identity are recorded in the code and evaluation evidence.

## Model limits

The embedding model can retrieve a plausible but wrong incident. It is English-oriented and not a specialist root-cause model. Long text is reduced to a documented diagnostic excerpt, and a 256-token inference limit still applies. Original evidence is retained for review.

## Reporting a problem

Please do not paste credentials or private logs into a public GitHub issue. Use a minimal synthetic reproduction without secrets. Include the commit and reproduction steps; avoid claims about a vulnerability until the behavior is demonstrated.
