# Security Policy

## Reporting a vulnerability

Please report security issues privately. **Do not open a public GitHub issue for a
suspected vulnerability.**

- Email: **security@usesynth.ai**
- Or use GitHub's [private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)
  ("Report a vulnerability" under the repository's **Security** tab).

Include what you found, how to reproduce it, and the impact you expect. We aim to
acknowledge reports within 3 business days.

## Scope

Stack runs locally and talks to the Codex CLI and (optionally) hosted Synth services.
Reports we especially care about:

- Leakage of credentials or tokens (including anything read from `~/.codex` or written
  under `~/.stack` / a workspace `.stack`).
- Stack reading or modifying files outside its own data directories.
- Command/argument injection into spawned subprocesses (Codex, shells).
- Telemetry that sends data not on the documented allowlist.

## Handling of secrets

Stack treats the user's `~/.codex` (Codex's own home, including `auth.json`) as
read-only and never copies credentials into Stack artifacts. If you find a path that
violates this, treat it as a security issue and report it privately.
