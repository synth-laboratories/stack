# Stack Growth Ingestion

Nightly 1 uses the existing Synth backend growth funnel endpoint for public
docs, download, and installer lifecycle events:

```text
POST /api/v1/growth/funnel-events
```

The backend route stores bounded metadata and request-level HMAC attribution. It
must not receive prompts, transcripts, source code, artifact bodies, raw paths,
secrets, environment values, command bodies, raw IPs, or unsalted IP hashes.

## Event Mapping

Stack's public telemetry allowlist keeps product-specific event names. The
backend funnel table currently uses generic growth event names, so Nightly 1
maps Stack events like this:

| Stack event | Backend `event_name` | Owner |
| --- | --- | --- |
| `stack_docs_cta_clicked` | `docs_cta_clicked` | docs frontend |
| `stack_download_clicked` | `skill_download_clicked` | docs frontend |
| `stack_release_asset_downloaded` | `skill_download_clicked` | release edge |
| `stack_installer_started` | `skill_download_clicked` | release edge |
| `stack_installer_succeeded` | `cta_destination_reached` | release edge |
| `stack_installer_failed` | `skill_download_clicked` | release edge |

Every payload includes:

```json
{
  "product": "stack",
  "campaign_id": "stack-nightly-1",
  "utm_campaign": "stack-nightly-1",
  "growth_action_id": "2026-06-30-stack-nightly-1",
  "metadata": {
    "stack_event_name": "stack_download_clicked"
  }
}
```

Installer and release-edge events may include `channel`, `version`, `target`,
`asset_kind`, `installer_version`, `duration_bucket`, or `error_code` when those
fields are present in the Stack allowlist. These fields stay in metadata because
they are coarse operational descriptors, not user content.

Validate the contract:

```bash
make smoke-growth-ingestion
```

This smoke is local and non-networked by default.

Live staging/prod proof uses the same payloads and records only HTTP status,
backend event ids, or sanitized network error classes:

```bash
bun run smoke:growth-ingestion -- --live-url https://api-dev.usesynth.ai
bun run smoke:growth-ingestion -- --live-url https://api.usesynth.ai --allow-prod-post
```

Do not include tokens in the URL. Prod live proof is guarded: do not pass
`--allow-prod-post` until the candidate and public copy are approved.
