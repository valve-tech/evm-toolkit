# evm-toolkit — working agreements

`@valve-tech/evm-toolkit` is a **published npm dependency** — twelve
packages on one synchronized release line, consumed by downstream valve
systems. Treat consumer-facing actions with that in mind.

## Releases — confirm first, never autonomous

Do **not** cut or publish a release on your own initiative. A release
publishes twelve public packages that downstream systems depend on, so
the gate stays where it is: CI/CD + automation + an explicit maintainer
go-ahead. When release-ready work has landed, *say so and let the
maintainer trigger the release* — don't push the tag yourself without
being asked.

Correctness gating belongs in automation, not in a judgment call:
`verify:clean` and `verify:release-coverage` (the pre-push hook and
`ci.yml`) are the gates. Keep them green and improve the automation
rather than working around it.

## Where the detail lives

- `contributing-to-evm-toolkit` skill — repo layout, architectural
  invariants, code style, the pre-commit checks every change must pass.
- `releasing-evm-toolkit` skill — the synced-release mechanics, for when
  a release is explicitly requested.
- Project memory (`~/.claude/projects/.../memory/`) — non-obvious
  "why it's shaped this way" decisions across past sessions.
