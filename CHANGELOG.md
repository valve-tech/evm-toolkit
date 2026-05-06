# Changelog

All notable changes to the `valve-tech/evm-toolkit` monorepo are documented in
this file. Per-package details live in each `packages/*/CHANGELOG.md`.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.8.0] — 2026-05-06

Synced bump across all five `@valve-tech/*` packages.

- **chain-source**: WS subscribe paths wired in `subscribeBlocks` and `subscribeMempool` (live-probed at capability time; lazy-opened on first use; falls back to existing poll cycle on subscribe failure).
- **tx-tracker**: closes the three deferred items from `tx-tracker-spec.md` (receipt-poll-fallback runtime, withReceipts eager enrichment, tracker.group cross-tx correlation), adds two Provex upstream verbs (`watchTransaction`, `replaceTransaction`), and ships two Promise-based companions (`waitForTransaction`, `waitForPending` with arrival-timeout). Project-local contributor skill at `.claude/skills/extending-tx-tracker/SKILL.md`.
- **gas-oracle / viem-errors / wallet-adapter**: synced no-op.

Spec: `docs/superpowers/specs/2026-05-06-v0.8.0-tx-tracker-completion-design.md`
