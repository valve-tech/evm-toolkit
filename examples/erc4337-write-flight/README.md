# erc4337-write-flight

The **full ERC-4337 account-abstraction write path**, end to end, with
the evm-toolkit woven through it:

```
demo owner key ──▶ Coinbase Smart Account (counterfactual address)
gas-oracle tier ──▶ UserOperation fee pair (maxFee / maxPriorityFee)
bundler RPC (+ optional ERC-7677 paymaster) ──▶ sendUserOperation
inclusion tx hash ──▶ tx-flight-react strip (addByHash, read-only)
```

- The smart account **deploys itself on its first bundled op** — you
  watch the "counterfactual" flag flip to "deployed".
- UserOps are **priced from live `@valve-tech/gas-oracle` tiers** (the
  same EIP-1559 pair an EOA tx carries); with no oracle state yet the
  bundler's own estimate is used — stated, not silently guessed.
- The bundler's **inclusion transaction lands in the
  `@valve-tech/tx-flight-react` strip** via `addByHash` with
  `readOnly: true` — we didn't submit that envelope tx and don't own
  its nonce slot, and the strip renders it accordingly.

## ⚠ Demo keys only

The smart account's owner is a throwaway key generated in the browser
and kept in localStorage. **Never** fund one of these accounts with
real value. Testnet and local-anvil use only.

## Run it — local anvil fixture (fully self-contained)

Requires [foundry](https://getfoundry.sh) (`anvil` + `cast`).

```bash
# 1. anvil with the AA contracts cloned from mainnet
cd examples/erc4337-write-flight
START_ANVIL=1 ./scripts/anvil-aa-fixture.sh

# 2. a bundler against it (separate terminal; alto shown)
npx @pimlico/alto --entrypoints 0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789 \
  --rpc-url http://127.0.0.1:8545 --port 4337 \
  --executor-private-keys 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
  --utility-private-key 0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d \
  --safe-mode false

# 3. the app (repo root)
yarn workspace @valve-tech/example-erc4337-write-flight dev
```

In the UI: **generate a demo key** → copy the smart-account address →
fund it (step 2 of the fixture script's output prints the `cast send`)
→ **send self-call UserOp**. First op deploys the account.

## Run it — public testnet

Pick **Sepolia**, paste a bundler RPC for it (e.g. a Pimlico/Alchemy/
Etherspot endpoint — most need an API key), fund the smart-account
address with Sepolia ETH from a faucet, and send. Optionally paste an
ERC-7677 paymaster RPC to have gas sponsored instead of funding the
account.

## What it demonstrates

- **Counterfactual deployment** — address before contract; initCode on
  the first op.
- **Fee unification** — gas-oracle tiers price UserOps exactly as they
  price EOA txs; one oracle serves both write paths.
- **The bundler trust shape** — you never hold the envelope tx's nonce;
  `readOnly: true` on the strip entry is the honest rendering of that.
- **Phase vocabulary honesty** — UserOps get their tx hash at *bundle*
  time, not signature time, so this example defines its own ladder
  (`preparing → signing → submitted → bundled`) instead of borrowing
  `wallet-adapter`'s EOA hook vocabulary where it wouldn't fit.

## Configuration

`src/config.ts` ships two chains: the local anvil fixture (31337, with
the default local bundler URL) and Sepolia (paste a bundler). Add
entries freely — any chain with EntryPoint 0.6 + the Coinbase Smart
Wallet v1 factory deployed works.
