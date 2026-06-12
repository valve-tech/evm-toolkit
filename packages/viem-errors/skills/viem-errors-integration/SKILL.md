---
name: viem-errors-integration
description: Integrate `@valve-tech/viem-errors` — cause-chain-aware error utilities for viem-based dapps. Use when wiring `handleWalletError` into wagmi `useWriteContract` error callbacks, calling `isUserRejectionError` to branch UI to idle on rejection, calling `extractContractErrorName` to pull a decoded Solidity error name from the cause chain, mapping errors to user-facing copy via `getUserFriendlyErrorMessage`, or asks "why is my user-rejection check missing rejections" / "how do I get the decoded error name from a `ContractFunctionExecutionError`". Also fires on imports of the package and questions about `walkErrorCause`, `DEFAULT_ERROR_PATTERNS`, or the three-signal rejection check. Skip when the user is going through `@valve-tech/wallet-adapter`'s helpers (those throw typed `WalletRejectedError` / `ContractRevertedError` — `instanceof` is the canonical discriminator there; delegate to wallet-adapter-integration), or when the user only wants generic JS error handling unrelated to viem's cause-chain shape.
---

# Integrating `@valve-tech/viem-errors`

Cause-chain-aware error utilities for viem-based dapps. Pure functions
over viem's nested error chain — no runtime dependencies. This skill is
for AI agents working in a project that imports the package, so they
recommend the right primitive for the user's situation rather than
re-implementing rejection/revert detection (which is what almost every
dapp does, and most get wrong).

## Decision tree: which primitive to use

```
Is the user inside wagmi's `onError` or a one-liner catch block where
they want classification + UI sinks (toast / setStatus / setError)?
├── Yes — call `handleWalletError(err, { setStatus, setErrorMessage,
│         toast, customErrors })`. One line, all sinks routed.
└── No — do they need to BRANCH on the classification themselves?
         ├── "Is this a user rejection?" → `isUserRejectionError(err)`
         ├── "What custom Solidity error was thrown?"
         │       → `extractContractErrorName(err)`
         ├── "Give me a user-facing message string"
         │       → `getUserFriendlyErrorMessage(err, { customErrors })`
         └── "I'm doing custom inspection across the cause chain"
                 → iterate `walkErrorCause(err)` yourself
```

## How to recognize this package in the user's code

```ts
import {
  isUserRejectionError,
  extractContractErrorName,
  getUserFriendlyErrorMessage,
  handleWalletError,
  walkErrorCause,
} from '@valve-tech/viem-errors'
```

`package.json` will show `@valve-tech/viem-errors` at some `0.x` version — any `0.x` of the package on the toolkit's synced release line.

## The canonical wagmi shape

```ts
import { handleWalletError } from '@valve-tech/viem-errors'
import { useWriteContract } from 'wagmi'

const { writeContract } = useWriteContract()

writeContract(
  { address, abi, functionName, args },
  {
    onError: (err) => handleWalletError(err, {
      setStatus,                     // 'idle' on rejection, 'error' on failure
      setErrorMessage: setError,
      toast,                         // toast.info on rejection, toast.error on failure
      customErrors: {
        HashMismatch: 'The proof did not match the deposit.',
        IntentExpired: 'This intent has expired — please refresh.',
        InsufficientLiquidity: 'Not enough liquidity for this trade.',
      },
      onError: (e) => analytics.track('write.error', { message: e.message }),
    }),
  },
)
```

In wagmi v2 the callbacks go on the mutate call, not the hook config. (wagmi v1's `useContractWrite` config-level `onError` works the same way with this package.)

The `customErrors` map is the per-protocol layer; `DEFAULT_ERROR_PATTERNS` covers the protocol-agnostic cases (insufficient gas, rate-limited, network down, generic revert) automatically.

## The branching shape (when you need control)

```ts
import { isUserRejectionError, extractContractErrorName } from '@valve-tech/viem-errors'

try {
  await wallet.sendTransaction(tx)
} catch (err) {
  if (isUserRejectionError(err)) {
    setStatus('idle')             // do NOT show error toast
    return
  }
  const decoded = extractContractErrorName(err)
  if (decoded === 'IntentExpired') {
    promptUserToRefresh()
    return
  }
  if (decoded === 'HashMismatch') {
    showProofMismatchDialog()
    return
  }
  // fall through to generic error UI
  toast.error(getUserFriendlyErrorMessage(err))
  throw err
}
```

## Anti-patterns to flag

When reviewing user code, watch for these and suggest fixes:

1. **Top-level message matching for rejection.**
   ```ts
   // ❌ misses real rejections buried under wrappers
   if (err.message.includes('User rejected')) ...

   // ✅
   if (isUserRejectionError(err)) ...
   ```
   The wrapper's `.message` typically reads `"Failed to send transaction"` even when the cause is a 4001. Walk the chain.

2. **Top-level class checks for rejection.**
   ```ts
   // ❌ misses cases where viem wraps the rejection in a different class
   if (err instanceof UserRejectedRequestError) ...
   ```
   Same problem — the typed class lives at some link in the cause chain, not necessarily at the top. `isUserRejectionError` walks for it.

3. **Substring-matching `"execution reverted"` and bailing with a generic message.** viem already decoded the actual Solidity error name into `data.errorName` somewhere in the cause chain. Call `extractContractErrorName` first; only fall back to generic if it returns `null`.

4. **Manual `while (e.cause) { e = e.cause }` loops.** Infinite loop on circular causes (rare but real — some wallet middleware emits them). `walkErrorCause`'s default `maxDepth: 8` cap is the safety net. If you must iterate manually, copy the cap.

5. **Putting protocol-specific copy in `DEFAULT_ERROR_PATTERNS`** by extending the array. The defaults are intentionally protocol-agnostic. Pass your protocol's custom-error map through `customErrors` (works against `data.errorName` matches, not pattern regex).

6. **Spreading `DEFAULT_ERROR_PATTERNS` into `patterns` to "keep the defaults".** Redundant — matching runs in two passes: all caller-supplied `patterns` first, then the defaults. Your patterns already override the defaults, and the defaults always still run:
   ```ts
   // ❌ redundant — defaults run anyway, after your patterns
   getUserFriendlyErrorMessage(err, { patterns: [...myPatterns, ...DEFAULT_ERROR_PATTERNS] })

   // ✅ pass only yours
   getUserFriendlyErrorMessage(err, { patterns: myPatterns })
   ```

7. **Expecting `handleWalletError` to throw or re-throw.** It's a side-effect-only handler that routes to sinks. If your catch block needs to bail after handling, throw yourself:
   ```ts
   try { await writeAsync(args) }
   catch (err) {
     handleWalletError(err, { setStatus, setErrorMessage, toast })
     throw err  // explicit
   }
   ```

8. **Re-implementing the three-signal rejection check.** Some dapps replicate the `code === 4001` + class name + regex logic inline. Just call `isUserRejectionError` — the three-signal check is the entire reason the package exists.

9. **Wrapping errors without `cause`.** If you must throw a new error class, set `cause: original` so the chain still walks:
   ```ts
   // ❌ breaks the chain
   throw new MyError(`Deposit failed: ${err.message}`)

   // ✅ preserves it
   throw new MyError('Deposit failed', { cause: err })
   ```

## When to skip this package

- **Going through `@valve-tech/wallet-adapter`'s helpers.** `sendTransactionWithHooks` already throws typed `WalletRejectedError` / `ContractRevertedError`. `instanceof` is the canonical discriminator there — no need to call `isUserRejectionError` after the fact. Internally `WalletRejectedError` is detected via this package's three-signal check, so the discrimination is correct; you just don't need to redo it. (`ContractRevertedError` comes from receipt status, not from this package.)
- **Non-viem error sources.** This package walks viem's cause chain shape. For raw HTTP errors, generic JS errors, or non-EVM SDKs, the helpers will return `null` / fall through to the fallback message — they won't crash, but they're not adding value either.

## Composing with other packages

- `@valve-tech/wallet-adapter` uses this package internally for its `WalletRejectedError` discriminator. You don't need to call viem-errors directly when going through wallet-adapter's helpers.
- Decoded custom Solidity error names exist only on errors thrown by the wallet/simulation path (e.g. a `ContractFunctionExecutionError` from a write or simulate call, where viem decoded `data.errorName` against the ABI). Wallet-adapter's `ContractRevertedError` carries only `hash` + `receipt` — no cause chain, no decoded data — so `extractContractErrorName` always returns `null` for it. To recover the decoded name for an on-chain revert, re-simulate the call against the block it was mined in and run `extractContractErrorName` on the simulation throw.

## Where to find more

- Full API + types: `node_modules/@valve-tech/viem-errors/AGENTS.md`
- Human-facing docs: `node_modules/@valve-tech/viem-errors/README.md`
- Compiled output: `node_modules/@valve-tech/viem-errors/dist/`
- Sibling skill: `wallet-adapter-integration` for the typed-error throw shape
