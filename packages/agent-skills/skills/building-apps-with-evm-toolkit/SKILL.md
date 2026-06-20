---
name: building-apps-with-evm-toolkit
description: Use when composing MULTIPLE @valve-tech/* packages into one EVM app and you need the wiring between them — "build a dapp with the valve packages", "which @valve-tech package do I use for X", "how do wallet-adapter, tx-tracker and tx-flight-react fit together", "share one ChainSource across gas-oracle and tx-tracker", "wire gas pricing into my write path", "add SIWE login plus a transaction strip". Owns the SEAMS (the write path, the shared chain stream, the auth+crypto pairing) and routes you to the right package. Delegates single-package depth to that package's own integration skill (gas-oracle-integration, tx-tracker-integration, wallet-adapter-integration, chain-source-integration, viem-errors-integration, tx-flight-react-integration, wallet-key-session-integration, siwe-store-integration, wallet-crypto-integration, trueblocks-sdk-integration). Skip when the task lives entirely inside one package — go straight to that package's skill.
---

# Building apps with the valve-tech EVM toolkit

This skill is the map. It tells you **which package owns what** and
**how they wire together**. For the depth of any one package — full
API, options, edge cases — delegate to that package's own integration
skill (named in each section below). This skill deliberately holds no
per-package API detail that would rot; it holds the seams.

All packages move on one **synchronized release line** — every
published version bumps every package to the same `0.x`. Install the
same version across the board; never pin a specific minor in code or
docs (the line guarantees a concrete `^0.x.y` will rot).

## Ownership map — what each package owns, and what it refuses to

- **`@valve-tech/chain-source`** — the upstream poll cycle, capability
  probe, and multi-subscriber fan-out for blocks + mempool
  (`subscribeBlocks`, `subscribeMempool`, `getBlock`, `getReceipt`,
  `getTransaction`, `getMempoolSnapshot`, `getFeeHistory`,
  `capabilities`). One `ChainSource` feeds many consumers off one RPC
  poll. Knows nothing about gas tiers or per-tx state. → `chain-source-integration`
- **`@valve-tech/gas-oracle`** — the gas-tier reducer
  (`slow`/`standard`/`fast`/`instant`), EIP-1559 priority + EIP-4844
  blob math, replacement-bump helpers (`recommendBumpTier`,
  `bumpForReplacement`), `chainPresets`, and viem-actions/transport
  extension surfaces. Consumes `ChainSource`. No per-tx state. → `gas-oracle-integration`
- **`@valve-tech/tx-tracker`** — the per-tx state machine, the
  `TxEvent` discriminated union, `TxTrackerStore` (persistence seam),
  reorg detection, and the verbs `watchTransaction` /
  `replaceTransaction` plus the promise companions
  `waitForTransaction` / `waitForPending` (`createTxTracker`).
  Consumes `ChainSource`. Emits neutral observations, never editorial
  verbs. No gas math, no retry policy. → `tx-tracker-integration`
- **`@valve-tech/viem-errors`** — pure cause-chain utilities for viem
  errors: `isUserRejectionError`, `extractContractErrorName`,
  `getUserFriendlyErrorMessage`. No I/O, no state. → `viem-errors-integration`
- **`@valve-tech/wallet-adapter`** — framework-agnostic dapp wallet
  vocabulary + helpers: the `WalletAdapter` interface, the
  `WriteHookParams` lifecycle, `sendTransactionWithHooks` /
  `awaitReceiptWithHooks`, typed `WalletRejectedError` /
  `ContractRevertedError`, and `TX_STATUS` / `TX_FLOW` / `TrackedTx`
  for tx-state UI. Uses `viem-errors` for classification. No
  subscriptions, no per-tx state machine, no React. → `wallet-adapter-integration`
- **`@valve-tech/tx-flight-react`** — React UI primitives for an
  in-flight transaction strip: `<TxFlightProvider>` + `useTxFlight()`
  with three add shapes (`addWithWalletAdapter`, `addByHash`,
  `addManual`) and pluggable storage at the `/storage` subpath. Pulls
  `tx-tracker` + `chain-source` only via dynamic import (so
  wallet-adapter-only consumers don't pay for them). → `tx-flight-react-integration`
- **`@valve-tech/siwe-store`** — the *server* state for full EIP-4361
  SIWE that `viem/siwe` leaves to the app: a single-use/TTL nonce store
  (`createMemoryNonceStore`) and an opaque address-bound session store
  (`createMemorySessionStore`). The SIWE crypto/message/validation
  itself is `viem/siwe` (`createSiweMessage`, `parseSiweMessage`,
  `validateSiweMessage`, `generateSiweNonce`). → `siwe-store-integration`
- **`@valve-tech/wallet-key-session`** — the *client* memory-only
  lifecycle of a wallet-derived encryption key: `createKeySession`
  (derive-once, wipe on account-change / tab-close). Pairs
  `wallet-crypto`. → `wallet-key-session-integration`
- **`@valve-tech/wallet-crypto`** — wallet-derived encryption keys +
  AES-GCM envelopes: `deriveWalletEncryptionKey`, `encryptEnvelope` /
  `decryptEnvelope`. Pairs with wallet-key-session (key lifecycle) and viem/siwe + siwe-store (auth). → `wallet-crypto-integration`
- **`@valve-tech/trueblocks-sdk`** — typed client over a TrueBlocks
  `chifra` daemon for historical reads (you run the daemon). Server-side;
  not a browser/trustless reader. → `trueblocks-sdk-integration`

## Recipe 1 — the dapp write path

The spine of almost every dapp. Each package owns one link; wire them
in order. Depth for any link is in its own skill.

1. **Price the tx** — `gas-oracle` gives you a tier's
   `maxPriorityFeePerGas` / `maxFeePerGas`. Feed those fee fields into
   the request you hand the wallet.
2. **Send with lifecycle hooks** — `wallet-adapter`'s
   `sendTransactionWithHooks` drives the `WriteHookParams` lifecycle
   (awaiting-signature → hash → confirmed/failed/dropped/replaced).
   It throws typed `WalletRejectedError` / `ContractRevertedError`.
3. **Track to terminal** — hand the returned hash to `tx-tracker`'s
   `watchTransaction` (or `waitForTransaction` for a promise) so the
   per-tx state machine — not ad-hoc polling — drives confirmations,
   replacement, and reorg detection.
4. **Render** — in React, skip wiring 2–3 by hand: `tx-flight-react`'s
   `useTxFlight().addWithWalletAdapter` runs the same send+track flow
   and shows the in-flight strip. Use `addByHash` for a tx you only
   have the hash for.
5. **Classify failures** — route every catch through `viem-errors`:
   `isUserRejectionError` to stay quiet on user-cancels,
   `getUserFriendlyErrorMessage` / `extractContractErrorName` for the
   rest. `wallet-adapter` already uses these internally; use them
   directly anywhere you handle a raw error.

If a tx gets stuck, `gas-oracle`'s `recommendBumpTier` /
`bumpForReplacement` size the replacement and `tx-tracker`'s
`replaceTransaction` tracks the swap.

## Recipe 2 — one ChainSource, many consumers

`gas-oracle` and `tx-tracker` are **siblings** over `ChainSource`, not
layered on each other. Create **one** `ChainSource` (`createChainSource`)
and pass it to both. Never stand up two poll loops against the same
RPC — the fan-out exists precisely so one poll cycle feeds every
consumer. When you add your own derived view of chain state, consume
`ChainSource` the same way; don't piggyback on the oracle or tracker.

## Recipe 3 — login + wallet-encrypted data

Full EIP-4361 SIWE login + wallet-derived encryption. `viem/siwe` owns
the SIWE crypto; the two valve packages own the state `viem/siwe`
leaves to you.

- **Login (server)**: `nonce = nonceStore.issue()` →
  `createSiweMessage({ domain, uri, address, chainId, nonce, statement,
  issuedAt, expirationTime })`. Binding fields come from server config,
  never the request.
- **Login (client)**: `walletClient.signMessage({ message })` → POST
  `{ message, signature }`.
- **Verify (server)**: `const fields = parseSiweMessage(message)` →
  `nonceStore.consume(fields.nonce)` (single-use/replay) → re-assert the
  binding fields `validateSiweMessage` does NOT check
  (`fields.version`/`fields.uri`/`fields.chainId` === server config) →
  `validateSiweMessage({ message: fields, domain })` (domain + time;
  pass the PARSED `fields`, not the raw string — viem requires a parsed
  message) →
  verify the signature against `fields.address` (crypto:
  `recoverMessageAddress` for EOAs, or a `PublicClient.verifyMessage`
  for EIP-1271/6492 smart accounts) → `sessionStore.issue(fields.address)`.
  Any failure → 401.
- **Encrypt user data to their wallet**: wire
  `deriveWalletEncryptionKey` (wallet-crypto) into
  `createKeySession({ address, derive, provider })`
  (wallet-key-session), then `encryptEnvelope` / `decryptEnvelope`.

The `nonceStore` / `sessionStore` are `@valve-tech/siwe-store`; the key
lifecycle is `@valve-tech/wallet-key-session`. The two are independent
of the chain-watching half. A runnable end-to-end wiring is the
`encrypted-vault` example.

## Historical reads

For server-side historical/index reads you run a TrueBlocks `chifra`
daemon and talk to it via `trueblocks-sdk`. A trustless,
browser/IPFS-only reader is a separate concern and not part of this
recipe set yet — check the ownership map for the current package list
before assuming a browser path exists.

## Where to look next

- **Per-package depth**: the integration skill named in each ownership
  bullet — `npx @valve-tech/agent-skills install` copies them all into
  `.claude/skills/`, or read them in place under
  `node_modules/@valve-tech/<pkg>/skills/`.
- **Runnable references**: several packages ship numbered `examples/`
  in their tarball-adjacent source (`gas-oracle`, `wallet-adapter`,
  `wallet-crypto`, `wallet-key-session`, `siwe-store`) — the closest thing to copy-paste
  starting points.
- **AGENTS.md** in each package is the consumer-facing API reference if
  you are not running a skill-aware harness.
