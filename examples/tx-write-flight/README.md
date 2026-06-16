# tx-write-flight — the write half of the evm-toolkit

A fully static Vite + React + TS app that prices a transaction, sends it with
lifecycle hooks, tracks it to a terminal state, renders its progress, and
classifies failures — plus the stuck-tx replacement flow. Companion to
`unchained-tx-history` (the read half).

## What it demonstrates

- **`@valve-tech/chain-source`** — ONE poll loop, fanned out (Recipe 2).
- **`@valve-tech/gas-oracle`** — four fee tiers + replacement-bump helpers.
- **`@valve-tech/tx-tracker`** — per-tx state machine + same-nonce replacement.
- **`@valve-tech/wallet-adapter`** — a thin injected EIP-1193 `WalletAdapter`
  over `window.ethereum` + `sendTransactionWithHooks`.
- **`@valve-tech/tx-flight-react`** — the in-flight transaction strip
  (localStorage-persisted).
- **`@valve-tech/viem-errors`** — cause-chain error classification.

## How the packages wire together (Recipe 1 + Recipe 2)

```
createChainSource(publicClient)         # once per chain
  ├── createGasOracle({ source })       # fee tiers (cost preview)
  └── createTxTracker({ source })       # per-tx observations

gas-oracle tier → buildTransactionRequest → useTxFlight().addWithWalletAdapter
                → sendTransactionWithHooks (injected wallet)
                → tx-tracker observations advance the strip row
                → every catch → viem-errors
```

## The three actions

| Action | Path | Notes |
|---|---|---|
| Native send | value transfer | works on any chain |
| Wrap ETH → WETH | `deposit()` (payable) | contract-call happy path; needs WETH |
| Unwrap WETH → ETH | `withdraw(amount)` | overdraw reverts → `ContractRevertedError` demo; needs WETH |

**Which actions need WETH:** Wrap / Unwrap are gated by a chain → WETH
registry (`src/config.ts`). On chains with no registered WETH, those two
actions are disabled; native send still works.

## Run

```bash
yarn install
yarn workspace @valve-tech/example-tx-write-flight dev      # http://localhost:5173
yarn workspace @valve-tech/example-tx-write-flight build    # static dist/
```

## ⚠️ Caution — real funds

This app follows whatever chain your wallet is on, **mainnets included**.
Default amounts are tiny (0.001) and a Review & send step always shows the
resolved fee + total before signing, but transactions are real. Use a testnet
(e.g. Sepolia) if you're just exploring.

## Manual end-to-end (no wallet in CI)

1. Connect an injected wallet (MetaMask / Rabby). The header shows your
   address, chain name + native symbol, and the live block number.
2. **Native send:** pick a recipient (defaults to self), keep the tiny amount,
   pick a tier, Review & send, confirm in the wallet. Watch the row go
   `awaiting-signature → pending → confirmed`.
3. **Speed up / Cancel:** while a row is pending, click Speed up (bumped fee,
   same nonce) or Cancel (0-value self-send, same nonce). Watch for the
   `replaced` transition.
4. **Wrap:** on a chain with registered WETH, wrap a tiny amount — the
   contract-call happy path.
5. **Unwrap overdraw:** unwrap more WETH than you hold → the row shows
   `failed · <ErrorName>` from `extractContractErrorName`.
6. **User rejection:** reject in the wallet → quiet cancel, no scary banner.
