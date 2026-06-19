# AGENTS.md

Terse reference for AI agents integrating
`@valve-tech/wallet-key-session`. Full README is for humans.

## What this package does

Owns the **memory-only lifecycle** of a wallet-derived encryption
`CryptoKey` in a browser tab. It does NOT derive the key (that's
`@valve-tech/wallet-crypto`) and does NOT do SIWE (that's `viem/siwe`
+ `@valve-tech/siwe-store`). One factory, no storage.

## Public API

```ts
import { createKeySession } from '@valve-tech/wallet-key-session'
import type { KeySession, Eip1193Like } from '@valve-tech/wallet-key-session'

const session: KeySession = createKeySession({
  address,                 // Address the key is bound to
  derive,                  // () => Promise<CryptoKey> — wire wallet-crypto here
  provider,                // optional Eip1193Like — auto-clear on account/chain change
  clearOnPageHide,         // optional, default true — clear on pagehide
})
// session.address      readonly Address
// session.getKey()     Promise<CryptoKey>  (derive-once, concurrent-safe, retry-on-reject)
// session.clear()      void                (drop the key; next getKey re-derives)
```

## Invariants (load-bearing)

1. **Memory-only.** The CryptoKey never leaves a closure variable. No
   persistent storage of any kind.
2. **Derive-once.** `getKey()` memoizes the promise; concurrent callers
   share one derivation. A rejected derivation is NOT cached.
3. **Wipe on identity/visibility change.** `accountsChanged`,
   `chainChanged`, `pagehide`, and `clear()` all drop the key.
4. **Injectable derivation.** `derive` is a callback, so the package
   has no `@valve-tech/wallet-crypto` dependency and is testable
   without a wallet.

## Composition

- **`@valve-tech/wallet-crypto`** — provides `deriveWalletEncryptionKey`;
  wire it into `derive`. The `WalletDeclined` / `WalletUnavailable`
  throws surface through `getKey()`'s rejected promise.
- **`viem/siwe` + `@valve-tech/siwe-store`** — the auth half; orthogonal
  to this package.

## Skills

`skills/wallet-key-session-integration/SKILL.md` ships in the tarball.
