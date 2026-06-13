# `@valve-tech/agent-skills`

Make the integration skills that ship inside `@valve-tech/*` packages
**discoverable** to AI coding agents. Every toolkit package already
bundles `skills/<pkg>-integration/SKILL.md` and `AGENTS.md` in its npm
tarball — but Claude Code does not auto-discover skills inside
`node_modules`, so in a consumer project they're invisible. This CLI
copies them into your project's `.claude/skills/` where the agent can
find them.

```bash
# In your project (with @valve-tech/* packages installed):
npx @valve-tech/agent-skills install
```

> **Node-only by design.** This is a dev tool, not library code. The
> toolkit's browser-safety invariant applies to the library packages,
> not to this CLI — it reads `node_modules` and writes files, so it
> uses Node's `fs`/`path`. Don't "fix" that. It has **zero runtime
> dependencies**.

## What it does

1. Finds the project root (nearest `package.json` above the cwd;
   override with `--root <dir>`).
2. Scans `node_modules/@valve-tech/*/skills/*/SKILL.md` — including this
   package's own `building-apps-with-evm-toolkit` skill, which is how
   the cross-package wiring guide gets distributed.
3. **Copies** (never symlinks) each skill directory into
   `.claude/skills/<skill-dir>/`. Copy is deliberate: cross-platform,
   survives `node_modules` wipes, no symlink-following surprises.
   Re-run to refresh.
4. Records provenance in `.claude/skills/.valve-tech-agent-skills.json`
   (source package + installed version + per-file hashes) so re-runs
   know what's *ours* to refresh versus *yours* to leave alone.

## Commands

### `install`

Copies installed skills into `.claude/skills/`. Idempotent and
conservative:

- A skill dir that **doesn't exist** → installed.
- A skill dir we previously installed (in the manifest) → refreshed in
  place.
- A skill dir that exists but is **not** in the manifest → reported as
  a **conflict** and never touched (you own it).
- A manifest-tracked skill whose source package is **gone** → reported
  as an **orphan**; removed only with `--prune`.

```bash
npx @valve-tech/agent-skills install            # copy / refresh
npx @valve-tech/agent-skills install --dry-run  # show what would change
npx @valve-tech/agent-skills install --prune    # also remove orphans
npx @valve-tech/agent-skills install --root .   # explicit project root
```

### `check`

Compares the manifest against installed package versions and on-disk
copies. **Exit 0** if everything is in sync; **exit 1** with a
per-skill drift report otherwise (package upgraded since install,
files modified locally, source package missing, copy deleted).
CI-friendly:

```bash
npx @valve-tech/agent-skills check
```

A typical loop: `check` fails after a dependency upgrade → run
`install` to refresh → `check` passes.

## What it deliberately does not do

- **No postinstall hook.** Security-conscious projects disable install
  scripts and npm hides their output. Discovery is via docs and the
  skills themselves, not a silent hook.
- No symlink mode, no watch mode, no other-harness output formats.
  `AGENTS.md` already serves non-skill-aware agents.

## yarn Plug'n'Play

PnP projects have no `node_modules` tree to read. The CLI detects this
(`.pnp.cjs` present, `node_modules` absent) and exits with guidance:
read the skills in place from each package's published tarball instead.

## Part of the toolkit

`@valve-tech/agent-skills` rides the
[valve-tech/evm-toolkit](https://github.com/valve-tech/evm-toolkit)
synchronized release line — every package publishes at the same `0.x`
version together.

## License

MIT
