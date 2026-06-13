# AGENTS.md

Terse reference for AI agents (Claude Code, Cursor, Aider) using
`@valve-tech/agent-skills`. Full README is for humans; this file is the
fast surface.

## What this package does

A **Node-only dev-tool CLI** (not library code — zero runtime deps)
that copies the integration skills bundled in installed `@valve-tech/*`
packages into a consumer project's `.claude/skills/`, so a skill-aware
harness can discover them. Claude Code does not auto-discover skills
inside `node_modules`; this closes that gap. Also ships and distributes
the cross-package `building-apps-with-evm-toolkit` skill.

## Bin

`valve-agent-skills` → `dist/cli.js`. Run via `npx @valve-tech/agent-skills <cmd>`
or, in this workspace, `yarn valve-agent-skills <cmd>`.

## Commands

```
valve-agent-skills install [--root <dir>] [--dry-run] [--prune]
valve-agent-skills check   [--root <dir>]
```

- `install` — copy/refresh installed `@valve-tech/*` skills into
  `.claude/skills/`. Writes provenance to
  `.claude/skills/.valve-tech-agent-skills.json`. Idempotent.
- `check` — drift report; exit 0 in sync, exit 1 on drift. CI-friendly.

## Behavior contract

- **Copy, not symlink.** Cross-platform, survives `node_modules` wipes.
- **Manifest-gated.** A `.claude/skills/<dir>` not in the manifest is
  the user's — reported as a conflict, never overwritten. A
  manifest-tracked dir whose source package is gone is an orphan —
  removed only with `--prune`.
- **No postinstall hook.** Discovery is explicit, never silent.
- **PnP** (`.pnp.cjs`, no `node_modules`) → detected, exits with
  guidance to read skills in place.

## Exit codes

- `0` — success / in sync.
- `1` — `check` found drift.
- `2` — bad args, no project root, or PnP project.

## Invariant

Node-only is intentional. Do not add browser-safety shims, runtime
dependencies, symlink modes, or a postinstall hook — each was
considered and rejected (see README + the design spec).
