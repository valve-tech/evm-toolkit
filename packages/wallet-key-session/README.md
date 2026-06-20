# @valve-tech/wallet-key-session

Memory-only lifecycle for a **wallet-derived encryption key**. Derive
the key once per session, never persist it, and wipe it on
disconnect / account-change / tab-close.

`viem/siwe` owns SIWE; [`@valve-tech/wallet-crypto`](../wallet-crypto)
owns the key *derivation*. This package owns the one thing neither
does: the **stateful lifecycle** of the derived `CryptoKey` in a
browser tab.

## Install

```bash
npm install @valve-tech/wallet-key-session @valve-tech/wallet-crypto viem
```

## Use

```ts
import { createKeySession } from '@valve-tech/wallet-key-session'
import { deriveWalletEncryptionKey } from '@valve-tech/wallet-crypto'

const session = createKeySession({
  address,
  derive: () =>
    deriveWalletEncryptionKey({ signer: walletClient, purpose: 'notes-vault', version: 1 }),
  provider: window.ethereum, // auto-clear on accountsChanged / chainChanged
})

const key = await session.getKey() // first call prompts the wallet; later calls reuse it
// ...later, on sign-out:
session.clear()
```

## Invariants

- The `CryptoKey` lives **only** in a closure variable — never
  `localStorage` / `sessionStorage` / `IndexedDB` / cookies.
- `getKey()` memoizes the in-flight promise: `derive` runs once even
  under concurrent callers. A **rejected** derivation is not cached, so
  a declined wallet prompt can be retried.
- `clear()` and any `accountsChanged` / `chainChanged` / `pagehide`
  event drop the reference; the next `getKey()` re-derives (re-prompts).
- Browser-safe: no `node:*` imports; `window` access is guarded.

## Part of the toolkit

`@valve-tech/wallet-key-session` ships on the
[valve-tech/evm-toolkit](https://github.com/valve-tech/evm-toolkit)
synchronized release line. Pairs with `@valve-tech/wallet-crypto`
(derivation) and `viem/siwe` + `@valve-tech/siwe-store` (auth).
