# `@valve-tech/agent-skills` — skills discoverability design spec

**Date:** 2026-06-12
**Status:** Approved by maintainer; ready for implementation planning
**Phase:** 2 of 3 of the examples/skills initiative
(Phase 1: `2026-06-12-unchained-tx-history-design.md`; the two specs
are independent — implement in either order or in parallel.)

## Problem

All nine published `@valve-tech/*` packages already ship
`skills/<pkg>-integration/SKILL.md` and `AGENTS.md` in their npm
tarballs. But nothing makes an AI agent working in a **consumer**
project discover them — Claude Code does not auto-discover skills
inside `node_modules`. The skills exist; they are invisible.

## Goal

1. A new published package, `@valve-tech/agent-skills` — an
   `npx`-able CLI that wires installed `@valve-tech/*` skills into a
   consumer project's `.claude/skills/`.
2. A new cross-package skill, `building-apps-with-evm-toolkit`,
   shipped inside that package and distributed by the same installer.
3. "For AI agents" discovery pointers in every package's README and
   AGENTS.md.

## 1. The package

`packages/agent-skills/` — joins the synced release line as a
published package (the count depends on whether Phase 1 has landed;
do not hardcode "11th" anywhere user-visible).

- `bin`: `{ "valve-agent-skills": "dist/cli.js" }` so both
  `npx @valve-tech/agent-skills <cmd>` and a local
  `yarn valve-agent-skills <cmd>` work.
- **Node-only by design.** This is a dev tool, not library code; the
  toolkit's browser-safety invariant applies to library packages.
  State this plainly in README + AGENTS.md + the package's own
  skill description so nobody "fixes" it.
- Zero runtime dependencies (Node 18+ `fs`/`path`/`process` only —
  no commander/chalk/glob; the CLI surface is two subcommands).
- Standard package shape: `src/` with colocated tests, `README.md`,
  `AGENTS.md`, `CHANGELOG.md`, `LICENSE`, `.npmignore`, `files`
  allowlist including `skills` and `dist`.
- Release: **manual first publish** (OIDC trusted-publisher dance) +
  `Publish @valve-tech/agent-skills` step in
  `.github/workflows/release.yml`, per
  `.claude/skills/releasing-evm-toolkit/SKILL.md`.
  `yarn verify:release-coverage` enforces.

## 2. CLI behavior

### `install`

1. Locate the consumer project root (walk up from `cwd` to the
   nearest `package.json`; `--root <dir>` overrides).
2. Scan `node_modules/@valve-tech/*/skills/*/SKILL.md` — including
   `@valve-tech/agent-skills`'s own `skills/` dir (that is how
   `building-apps-with-evm-toolkit` gets distributed). Handle
   scoped-hoisting normally; do NOT attempt yarn-PnP support
   (no `node_modules` there) — detect PnP (`.pnp.cjs` present,
   `node_modules` absent) and exit with a clear message.
3. **Copy** (not symlink) each skill directory to
   `.claude/skills/<skill-dir-name>/`. Copy is deliberate:
   cross-platform, survives `node_modules` wipes, no
   symlink-following surprises. Staleness is handled by re-running.
4. Write/update a manifest at
   `.claude/skills/.valve-tech-agent-skills.json`:
   `{ [skillDirName]: { package, version, files: [...] } }`
   recording provenance (source package + its installed version).
5. **Idempotent and conservative**:
   - Re-running refreshes manifest-tracked skills in place.
   - A `.claude/skills/<name>/` that exists but is NOT in the
     manifest is never touched — report it as a conflict and skip
     (the user owns it).
   - A manifest-tracked skill whose source package is no longer
     installed is reported; removed only with `--prune`.
6. Output: one line per skill (installed / refreshed / skipped
   conflict / orphaned), then a summary. `--dry-run` supported.

### `check`

Compares manifest entries against installed package versions and
on-disk copies; exit 0 if in sync, exit 1 with a per-skill drift
report (package upgraded since install / files modified locally /
source package missing). CI-friendly.

### Explicitly NOT doing

- **No postinstall hook.** Security-conscious consumers disable
  install scripts and npm hides their output. Discovery is via docs
  (§4) and the skills themselves.
- No symlink mode, no watch mode, no other-harness output formats
  (Cursor rules etc. — AGENTS.md already serves generic agents).
  YAGNI until requested.

## 3. The cross-package skill

`packages/agent-skills/skills/building-apps-with-evm-toolkit/SKILL.md`

Audience: an AI agent in a consumer project composing **multiple**
toolkit packages into an app (the per-package skills cover depth;
this covers wiring).

Content requirements:

- **Ownership map**: one paragraph per package on what it owns and
  what it deliberately does not (condensed from the contributing
  skill's "per-package responsibilities", rewritten for consumers).
- **Canonical recipes** (code-level, viem-era, copy-adaptable):
  - dapp write path: wallet-adapter (`sendTransactionWithHooks`)
    → tx-tracker (`watchTransaction`) → tx-flight-react strip,
    with gas-oracle feeding fee params and viem-errors classifying
    failures;
  - chain watching: one `ChainSource` shared by gas-oracle +
    tx-tracker (never two poll loops);
  - historical reads decision: trueblocks-sdk (you run a chifra
    daemon) vs unchained-reader (browser/trustless, IPFS + RPC
    only) — include this row only once Phase 1 ships; coordinate
    if implementing in parallel;
  - auth-lite + wallet-crypto where they fit.
- **Pointers, not duplication**: link each recipe to the relevant
  per-package skill by name and to `examples/` apps as living
  references. This skill must not restate per-package API detail
  that will rot.
- Description frontmatter follows the same trigger/delegation
  discipline as the existing nine (trigger on "build a dapp with
  valve packages", "which @valve-tech package do I use for X",
  multi-package wiring questions; delegate single-package depth to
  the per-package skill).

## 4. Discovery pointers (all nine existing packages + new ones)

Add a short, uniform "For AI agents" section to every package
README and a one-liner in every AGENTS.md:

> Machine-readable integration skills ship in this tarball under
> `skills/`. Run `npx @valve-tech/agent-skills install` to copy all
> installed `@valve-tech/*` skills into `.claude/skills/`, or read
> them in place at `node_modules/@valve-tech/<pkg>/skills/`.

README/AGENTS.md are in every package's `files` allowlist →
**consumer-visible → this is a synced version bump across all
packages** when it lands (normal release coupling; fold it into the
same release that first publishes `@valve-tech/agent-skills`).

## 5. Implementation shape (toolkit invariants)

- Installer logic as **pure functions over an injected filesystem
  interface** (`readDir`/`readFile`/`writeFile`/`exists`/`rm`...):
  plan-then-apply — a pure `planInstall(scan, manifest) → actions[]`
  reducer, a thin applier doing I/O, a thin `cli.ts` doing argv.
  Mirrors the primitive-layer discipline; fixture-tested without
  touching disk.
- Const-namespace pattern for action/status unions (e.g.
  `SkillAction.install / refresh / skipConflict / orphan`).
- No `any`; `.js` import extensions; JSDoc on exports; colocated
  behavior-driven tests (scan shapes, conflict cases, prune,
  drift detection, PnP detection).

## Testing

- Unit: planner pure functions over fixture filesystem states
  (fresh install, re-run no-op, upgrade refresh, local-edit
  conflict, orphaned skill, PnP detection, missing
  `.claude/` dir creation).
- Integration: run the built CLI in a temp dir simulating a consumer
  project with two fake `@valve-tech/*` packages; assert files +
  manifest + exit codes (including `check` drift exit 1).
- Self-test in this repo: running `install` inside the monorepo
  itself must skip gracefully (workspace `node_modules` layout) —
  document whatever the correct expectation is once verified.

## Acceptance

- [ ] In a scratch consumer project with 2+ `@valve-tech/*` packages
      installed, `npx @valve-tech/agent-skills install` populates
      `.claude/skills/` with their skills +
      `building-apps-with-evm-toolkit`, and a Claude Code session in
      that project lists/uses them.
- [ ] Re-run is a no-op; upgrade → `check` exits 1 → `install`
      refreshes; locally-edited skill is skipped with a conflict
      report.
- [ ] Every package README/AGENTS.md carries the "For AI agents"
      section.
- [ ] `yarn verify:clean` and `yarn verify:release-coverage` green;
      release.yml has the new Publish step.

## Out of scope

- Phase 3 quality pass over the nine existing SKILL.md files
  (separate spec).
- Plugin-marketplace packaging of the skills.
- Non-Claude harness output formats.
