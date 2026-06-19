---
name: wallet-key-session-integration
description: Integrate `@valve-tech/wallet-key-session` — the memory-only lifecycle of a wallet-derived encryption key — into viem-based dapps. Use when calling `createKeySession` to derive a `CryptoKey` once per session and wipe it on disconnect/account-change/tab-close, when wiring `@valve-tech/wallet-crypto`'s `deriveWalletEncryptionKey` into the `derive` callback, or when asked "how do I cache a wallet-derived key without persisting it", "how do I re-prompt the wallet when the account changes", or "why does my decryption key survive a wallet switch" (it shouldn't — that's what this package fixes). Also fires on questions about `KeySession`, the concurrent-safe derive-once memoization, or `clearOnPageHide`. Skip when the user only needs the derivation itself (no lifecycle) — that's `wallet-crypto-integration` — or when they need SIWE auth — that's `viem/siwe` + `siwe-store-integration`.
---

# Integrating `@valve-tech/wallet-key-session`

This package owns ONE thing: the in-memory lifecycle of a
wallet-derived encryption `CryptoKey` in a browser tab. It does not
derive the key and does not do SIWE.

## The wiring

```ts
import { createKeySession } from '@valve-tech/wallet-key-session'
import { deriveWalletEncryptionKey } from '@valve-tech/wallet-crypto'

const session = createKeySession({
  address,
  derive: () =>
    deriveWalletEncryptionKey({ signer: walletClient, purpose: 'myapp-feature', version: 1 }),
  provider: window.ethereum,
})

const key = await session.getKey() // prompts once; cached after
```

## When to recommend it

- The user is caching a `deriveWalletEncryptionKey` result in a React
  ref / module variable / state by hand → replace with `createKeySession`
  (it gets the concurrent-safe memoization and the auto-wipe right).
- The user reports the key "still works after switching wallets" → they
  have no `accountsChanged` teardown; pass `provider`.
- The user wants the key gone on tab close → `clearOnPageHide` (default
  `true`) already does it.

## Invariants to enforce in review

1. **Never persist the key.** If you see the CryptoKey written to
   storage, that defeats the whole package. The key is re-derivable
   from the wallet — re-prompt instead of persisting.
2. **Derive-once, retry-on-reject.** `getKey()` memoizes the promise;
   a declined prompt is not cached, so the next `getKey()` re-prompts.
   Don't wrap `getKey()` in your own retry/caching layer.
3. **The derivation is injected.** Don't add a hard dependency on
   `@valve-tech/wallet-crypto` inside this package's consumers'
   `derive` — pass the callback.

## Composition

- **`@valve-tech/wallet-crypto`** — the `derive` callback's body.
  `WalletDeclined` / `WalletUnavailable` surface through the rejected
  `getKey()` promise; handle them in the caller.
- **`viem/siwe` + `@valve-tech/siwe-store`** — the auth half. A typical
  app does SIWE first (sign-in), then derives the key lazily on first
  encrypt/decrypt — two distinct wallet prompts by design.

## Where to find more

- API + types: `node_modules/@valve-tech/wallet-key-session/AGENTS.md`
- Human docs: `node_modules/@valve-tech/wallet-key-session/README.md`
- Sibling skills: `wallet-crypto-integration`, `siwe-store-integration`,
  `building-apps-with-evm-toolkit`.
