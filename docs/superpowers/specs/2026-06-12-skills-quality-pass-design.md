# Skills quality pass — audit findings + remediation spec

**Date:** 2026-06-12
**Status:** Approved direction; findings from a 3-agent audit of all
nine shipped SKILL.md files, verified against v0.18.0 source.
**Phase:** 3 of 3 of the examples/skills initiative
(Phase 1: `2026-06-12-unchained-tx-history-design.md`;
Phase 2: `2026-06-12-agent-skills-design.md`).

## What this is

Every published package ships
`skills/<pkg>-integration/SKILL.md`. An audit (each claim checked
against current `src/`) found that several skills teach APIs that
don't exist or describe pre-v0.15/v0.16/v0.17 behavior. This spec
is the remediation worklist. **Skills ship in tarballs → every fix
below is consumer-visible → land as one synced version bump.**

Severity meaning: **HIGH** = an agent following the skill writes
code that is wrong/doesn't compile; **MED** = missing/stale guidance
likely to cause mistakes; **LOW** = polish.

Re-verify each finding against current source before fixing — the
audit was performed at v0.18.0 and line numbers may drift.

---

## Per-skill findings

### trueblocks-sdk-integration — needs-touch-up

- **HIGH** SKILL.md:93-94 — canonical example checks
  `status.is_responding`, which does not exist on the `status`
  schema (`isApi`/`isScraping`/`isArchive`...). Fix: liveness =
  successful `client.status()` call inside the existing
  `TrueblocksError` try/catch.
- **HIGH** SKILL.md:147-151 — appearance fields mapped as
  `a.bn` / `a.tx_id`; the schema uses `blockNumber` /
  `transactionIndex`. Both would be `undefined` at runtime.
- **HIGH** SKILL.md:54 — `client.when({ timestamps: [...] })` is
  invalid: `timestamps` is a boolean flag; timestamp/date lookups
  go in `blocks: string[]`.
- MED SKILL.md:78 — `^0.10.x` version pin rotted (see systemic
  rule 1).
- MED SKILL.md:180-182 — claims verb wrappers "convert at the
  boundary"; `makeVerb` is a pure `response.json()` passthrough.
  Keep the don't-blindly-`BigInt()` advice, fix the mechanism claim.
- LOW — blocks variant list omits `.hashes`; decision tree omits
  `logs` / `traces` / `slurp` verbs that the frontmatter advertises.

### tx-tracker-integration — needs-touch-up + one section rewrite

- **HIGH** SKILL.md:169-184 — entire "Speed-up workflow" example is
  fictional: `tracker.on('stuck', ...)` (no `.on()` method, no
  'stuck' event — the skill's own header says the tracker never
  emits "stuck"). Rewrite around real APIs:
  `tracker.subscribe(hash, e => e.kind === 'unseen-for-N-blocks')`
  + the package's own `replaceTransaction({ original, walletClient,
  newGas })` helper, which exists for exactly this and is never
  mentioned. The gas-oracle half of the example is correct — keep.
- **HIGH** SKILL.md:98-101 — "deliberately does not emit a
  `confirmed` event" is rotted: v0.15 added `confirmed-terminal`
  via `confirmationsForTerminal` (default null). Fix per the
  terminal-paths lesson: opt-in event + retention is REQUIRED for
  long-lived stores (the v0.14 leak).
- MED — event-kind list omits `left-mempool` and
  `confirmed-terminal`.
- MED — high-level helpers (`waitForTransaction`,
  `watchTransaction`, `waitForPending`, `replaceTransaction`,
  `createTxGroup`, `createLocalStorageTrackerStore`) absent from
  body and decision tree; "know when my tx confirms" should route
  to `waitForTransaction`.
- MED SKILL.md:194 — points to
  `node_modules/@valve-tech/gas-oracle/examples/07-tx-tracker.ts`,
  which is not in gas-oracle's tarball (`files` has no `examples`).
  Point to the GitHub URL.
- MED SKILL.md:86-87 — `lostSignalPolicy` table omits the
  `{ strategy: 'receipt-poll-fallback', pollEveryBlocks }` variant
  (the right answer for gated-txpool chains like PulseChain) and
  `statusPollEveryBlocks`.
- LOW — `docs/tx-tracker-spec.md` cited as repo-relative; give the
  GitHub URL. `unseenThresholdBlocks` tuning advice reads inverted —
  reword in wall-clock terms.

### chain-source-integration — needs-touch-up

- **HIGH** SKILL.md:55, 143 — describes the pre-v0.16 fixed 10s
  poll; the default is now the adaptive scheduler (ticks at
  estimated block time, 2s→30s backoff), with `pollIntervalMs` only
  the fallback. Rewrite both spots; mention
  `adaptivePolling: { enabled: false }` for fixed-interval.
- MED — `adaptivePolling` + `logger` options (v0.16) absent from
  the options overview.
- MED SKILL.md:44 — `^0.10.x` version pin rotted.
- MED SKILL.md:243 — `'receipt-poll'` glossed narrowly as the
  tx-tracker fallback; it is a CATEGORY (any per-hash status probe:
  fallback, probeMined, status polls). Widen — this protects the
  no-new-EventSource-values rule.
- LOW — capabilities table omits the `ready` field;
  public-aggregator row needs the "varies — verify per node" hedge;
  mention `caps.ready === false` alongside `await source.ready()`.

### gas-oracle-integration — needs-touch-up

- **HIGH** SKILL.md:76 — names `findTxInMempool`; the export is
  `findInMempool` (siblings `findByHash`, `findByAddressNonce`).
- MED SKILL.md:188 — points to
  `node_modules/@valve-tech/gas-oracle/examples/`, not shipped in
  the tarball. Either add `"examples"` to `files` or fix the
  pointer (decide once, apply to both this and the tx-tracker
  instance above).
- MED SKILL.md:93 — `^0.2.x` version pin rotted.
- MED SKILL.md:59-62 — anti-pattern 3 attributes post-start null
  `getState()` to "first poll pending"; the dominant cause is
  `pauseWhenIdle: true` (default) with no subscriber — loop never
  fires. Give the two real fixes (no-op subscribe or
  `await oracle.pollOnce()`).
- MED SKILL.md:40, 171-183 — table says chain 943 needs
  `PriorityModel.flat`, but `chainPresets` has no 943 entry, so the
  skill's own `presetForChainId(chainId)` recipe silently lands on
  eip1559 there. Add the explicit-flat caveat (or add the preset to
  the package — implementer's call, document either way).
- LOW — `baseFeeLivenessBlocks: 6` shown without noting the package
  default is 1; anti-pattern numbering restarts confusingly.

### wallet-adapter-integration — needs-touch-up

- **HIGH** SKILL.md:181-193 — composition example calls
  `tracker.track(hash, { onDropped, onReplaced })`; `track()` takes
  no callbacks (returns AsyncIterable; TrackOptions has none) and
  `watchTransaction` has no `onReplaced`. Rewrite with
  `tracker.subscribe(hash, e => ...)` mapping neutral kinds
  (`replaced-by`, `unseen-for-N-blocks`) to the consumer's hooks —
  and state that the consumer owns that mapping.
- MED — `TrackedTx.readOnly` (v0.17) absent from the in-flight UI
  section: relayer-submitted txs → no speed-up/cancel; read-site
  rule is `tx.readOnly === true` (never truthiness — pre-0.17
  records rehydrate `undefined`).
- MED SKILL.md:51 — `^0.10.x` version pin rotted.
- LOW — description advertises `WritePhaseSteps` declaration
  merging but the body never covers it; add a sentence or drop the
  trigger.

### tx-flight-react-integration — needs-touch-up

- **HIGH** SKILL.md:112 — instructs importing `serialize` /
  `deserialize` from `'@valve-tech/tx-flight-react/storage'`; they
  exist in src but are NOT re-exported from `storage/index.ts`.
  Preferred fix: add the re-export to the package (consumer-visible
  feature, CHANGELOG entry) — the advice itself is good. Otherwise
  rewrite the anti-pattern inline.
- MED — v0.17 `readOnly` / `submittedAt` on `addByHash` absent:
  decision tree still routes "observed elsewhere" only to
  `addManual`. Add the readOnly branch + an anti-pattern for wiring
  speed-up/cancel on read-only entries.
- MED SKILL.md:108 — `explorer="https://etherscan.io"` is a type
  error; the prop is `(tx: TrackedTx) => string`.
- MED SKILL.md:45 — `^0.10.x` version pin rotted.
- LOW — RSC anti-pattern overstated (components carry
  `'use client'`; importing from an RSC is legal — the constraint
  is Provider context + browser runtime); `addByHash` tuning knobs
  (`confirmations`, `staleAfterBlocks`, `withReceipts`) and the
  ~250ms save debounce unmentioned.

### viem-errors-integration — needs-touch-up

- **HIGH** SKILL.md:156 — claims `extractContractErrorName` works
  on `ContractRevertedError.cause`; that error has no `cause` and
  carries only `hash` + `receipt` — the branch can never fire.
  Replace with: decoded names exist only on wallet/simulation
  throws; receipt-status reverts need re-simulation.
- MED SKILL.md:44 — `^0.10.x` version pin rotted.
- MED SKILL.md:123-126 — anti-pattern 6's fix spreads
  `DEFAULT_ERROR_PATTERNS` into `patterns`; redundant — consumer
  patterns already run before defaults in two passes. Keep the
  anti-pattern, fix the mental model.
- LOW — canonical example uses wagmi v1 surface
  (`useContractWrite`); show v2 (`useWriteContract`) or both.
  Scope the "three-signal check" internals claim to
  `WalletRejectedError` only.

### auth-lite-integration — ship-as-is (optional polish)

Zero rot. LOW items: shared-error-class wording (see systemic
rule 4), missing sibling-skill path for wallet-crypto, missing
"Where to find more" block, nonce bounds (`bytes` 16-64,
`ttlSeconds` 30-3600, RangeError outside) unstated.

### wallet-crypto-integration — needs-touch-up (light)

- MED SKILL.md:130-132 — "shared `WalletDeclined` /
  `WalletUnavailable` class names so consumers can `catch (e)`
  once" — the classes are DISTINCT per package; only `.name`
  matches. A single `instanceof` arm silently misses the sibling's
  throws. Fix here and in auth-lite: discriminate on
  `err.name === 'WalletDeclined'` across packages.
- MED — `WalletUnavailable` promised in the description, never
  covered in the body (thrown when `WalletClient` lacks `account`;
  remedy: connect first).
- LOW — `usages?: KeyUsage[]` option unmentioned; no "Where to find
  more" block; determinism invariant deserves a one-line caveat
  that `personal_sign` determinism is signer-dependent (smart
  accounts / MPC may break cross-device key reproduction).

---

## Systemic rules (apply during the fix pass, then keep)

1. **No version pins in skills.** Five skills say `^0.10.x` /
   `^0.2.x`; the line ships 0.18.0 and `^0.10` doesn't even match
   0.18 on 0.x semver. Replace with "any `0.x` on the toolkit's
   synced release line". Add this rule to the contributing skill.
2. **Verify every `node_modules/...` pointer against the package's
   `files` allowlist.** Two pointers reference `examples/` dirs
   that don't ship.
3. **Release-checklist addition** (edit
   `.claude/skills/releasing-evm-toolkit/SKILL.md`): when a
   CHANGELOG gains a feature entry, diff the package's SKILL.md
   against it, AND grep sibling `skills/*/SKILL.md` for the
   package's API names — both fabricated-example highs were
   cross-package claims (`confirmed-terminal` v0.15,
   `statusPollEveryBlocks` v0.14, `readOnly`/`submittedAt` v0.17
   all shipped without skill updates).
4. **Cross-package error classes**: auth-lite and wallet-crypto
   intentionally share error NAMES, not classes. Both skills must
   teach `err.name` discrimination, not single-import `instanceof`.
5. **Description length**: several frontmatter descriptions exceed
   ~1,200 chars. Trim to the strongest triggers (keep every
   skip/delegate clause — they are the best part). Verify the
   harness's actual frontmatter limits rather than trusting the
   audit's 1,024 figure.

## Incidental source bugs found (fix in the same pass)

- `packages/gas-oracle/src/oracle.ts:98` — `priorityModel`
  docstring still says "`'flat'` (default)"; actual default is
  `PriorityModel.eip1559` (math.ts:338). The shipped .d.ts hover
  contradicts the skill.
- `packages/chain-source/src/types.ts:161` — says capabilities are
  "Probed once on `source.start()`"; the probe runs at
  construction.
- Decision needed in-pass: export `serialize`/`deserialize` from
  tx-flight-react `/storage` (preferred; makes the skill's good
  advice true) — that is a small consumer-visible API addition with
  its own CHANGELOG entry.

## Process

- One branch, commits grouped per package; every SKILL.md edit
  re-verified against source at fix time (line numbers above will
  drift).
- Per-package CHANGELOG entries under "Documentation" (or "Added"
  where APIs are added, e.g. the storage re-export).
- Lands as a synced version bump (skills + README/AGENTS.md are in
  `files`). Can ride the same release as Phase 2's "For AI agents"
  sections to avoid two bumps.

## Acceptance

- [ ] All HIGH findings fixed; every code example in all nine
      skills typechecks against the current package surface
      (spot-verify by compiling extracted snippets or careful
      manual check against `src/index.ts`).
- [ ] No version pins remain in any SKILL.md.
- [ ] All `node_modules/...` pointers resolve in a real tarball
      install.
- [ ] Releasing skill updated with the SKILL.md-diff checklist
      item; contributing skill updated with the no-version-pins
      rule.
- [ ] `yarn verify:clean` green; synced release per the releasing
      skill.
