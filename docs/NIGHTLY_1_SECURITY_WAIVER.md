# Nightly 1 Artifact Security Waiver

Status: active for Nightly 1 only.

This waiver permits the first public-facing Nightly 1 candidate to publish
checksummed artifacts before signature and provenance automation is complete.
It does not apply to stable releases.

## Scope

Allowed:

- channel: `nightly`
- artifact must be immutable after publish
- artifact must include SHA256 in the manifest
- installer must verify SHA256 before activation
- public copy must say Nightly may change and is not stable

Not allowed:

- stable release without signature and provenance
- mutable artifact content behind the same version URL
- package-manager promotion
- collecting prompts, transcripts, source code, raw paths, secrets, or raw IPs

## Exit Criteria

Remove this waiver before stable promotion, or replace it with real artifact
signature and provenance fields in the published manifest.

Required stable fields:

```text
signature_url
attestation_url
```

Owner: Stack launch operator.
Review before: 2026-07-07.
