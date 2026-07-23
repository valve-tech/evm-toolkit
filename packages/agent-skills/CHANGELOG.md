# Changelog

All notable changes to `@valve-tech/agent-skills` are documented in
this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.22.0] — 2026-07-23

### Notes

- Synchronized release — no changes to this package. Bumped in
  lockstep with the rest of the toolkit.

## [0.21.0] — 2026-07-15

### Changed

- Declared `engines.node` as `>=20`. The packages are CI-tested on Node
  20, 22, and 24; this makes the supported range explicit for consumers.

## [0.20.0] — 2026-06-26

### Notes

- Synchronized release — no changes to this package. Bumped in
  lockstep with the rest of the toolkit.

## [0.19.0] — 2026-06-21

### Added

- Initial release. A Node-only dev-tool CLI (`valve-agent-skills`, zero
  runtime dependencies) that makes the integration skills bundled in
  `@valve-tech/*` packages discoverable to AI coding agents by copying
  them into a consumer project's `.claude/skills/`.
  - `install` — scans `node_modules/@valve-tech/*/skills/*/SKILL.md`
    and copies (never symlinks) each skill into `.claude/skills/`,
    recording provenance (source package + version + per-file hashes)
    in `.claude/skills/.valve-tech-agent-skills.json`. Idempotent and
    conservative: refreshes only manifest-tracked skills, reports
    untracked dirs as conflicts and never touches them, reports
    orphans (source package gone) and removes them only with
    `--prune`. Supports `--dry-run` and `--root`.
  - `check` — drift report comparing the manifest against installed
    package versions and on-disk copies; exit 0 in sync, exit 1 on
    drift (package upgraded, locally modified, source/copy missing).
    CI-friendly.
  - Detects yarn Plug'n'Play (`.pnp.cjs`, no `node_modules`) and exits
    with guidance rather than failing obscurely.
  - Ships the cross-package `building-apps-with-evm-toolkit` skill —
    the wiring guide for composing multiple toolkit packages — and
    distributes it through the same installer.
- This package joins the toolkit's synchronized release line; its first
  publish is a manual OIDC trusted-publisher bootstrap (see
  `.claude/skills/releasing-evm-toolkit/SKILL.md`).
