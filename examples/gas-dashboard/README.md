# gas-dashboard

Pick an EVM chain (or paste any public RPC) and watch gas behave per block.
A single [`@valve-tech/chain-source`](../../packages/chain-source) feeds a
single [`@valve-tech/gas-oracle`](../../packages/gas-oracle); four panels
repaint on every block. **No wallet — read-only public RPC only.**

## What it demonstrates

- **Chain-source capability probe.** On startup `chain-source` probes the RPC
  for `eth_subscribe(newHeads)` (WebSocket push) and `txpool_content` (mempool
  access). The results land in the capability panel and drive three status
  badges — `HTTP`, `WS`, `mempool` — so you can see exactly what the node
  exposes without digging into network tabs.

- **Gas-oracle tiers.** `gas-oracle` observes every block and publishes four
  priority-fee tiers — **slow / standard / fast / instant** — as hero cards
  across the top. The oracle also computes a base-fee trend, a mempool snapshot,
  and a block-included ring for the fallback path.

- **One ChainSource → one gas-oracle, switch = teardown / rebuild.** Selecting
  a chain from the dropdown (or accepting a detected custom RPC) calls
  `dispose()` on the running pipeline and builds a fresh
  `createChainSource → createGasOracle` pair. Badges and the block counter
  reset to their connecting state, then repopulate within a few blocks. The
  pipeline is deliberately flat — no global singleton, no reconnect logic to
  hide — so you can read `src/lib/dashboard.ts` start to finish.

- **Capability-aware degradation (no silent downgrade).** Every disabled panel
  gets an explanation string, not a blank space:
  - On a **gated-mempool** public RPC (`txpool_content` returns an error), the
    histogram panel shows *"this RPC doesn't expose the mempool
    (txpool_content is gated)"* and the mempool badge goes dim. The block-position
    estimator automatically switches from live pending-tx tips to recent
    block-included tips and labels itself *"recent block-included tips"*.
  - On an **HTTP-only** RPC (no WebSocket), the WS badge is dim and `chain-source`
    falls back to polling on a timer — no code change, no special branch.

- **Four panels — hand-rolled SVG, no charting library.**
  - **Base-fee sparkline**: a `<polyline>` over the last N `baseFee` values,
    rescaled per-render.
  - **Mempool tip histogram**: bucketed bar chart of pending-tx priority fees,
    coloured by tier cutoff. Hidden and replaced by the degradation notice on a
    gated RPC.
  - **Block-position estimator**: type a priority-fee tip; it ranks the value
    against the live distribution (mempool or block-included) and reports the
    percentile.
  - **Capability panel**: live table of `chain-source` capability fields —
    `newHeads`, `txpoolContent`, `receiptByHash` — with their current probe
    result and the pending gas-demand figure from the mempool.

- **Custom RPC detection.** Paste any `http(s)://` URL in the header input and
  click *add RPC*. The app calls `eth_chainId`, resolves a label, adds the chain
  to the dropdown, and switches immediately. Garbage input surfaces an error
  banner — the pipeline never starts in an unknown-chain state.

## Run it

```bash
yarn            # from the repo root, installs the workspace
yarn workspace @valve-tech/example-gas-dashboard dev
```

Open the printed localhost URL. PulseChain is the default; it connects within
one or two 10-second blocks. The WS badge lights up if the public node supports
subscriptions; the mempool badge reflects whether `txpool_content` is open.

Build the static bundle:

```bash
yarn workspace @valve-tech/example-gas-dashboard build
# → examples/gas-dashboard/dist/  (deploy anywhere static)
```

## Manual verification checklist

After `yarn workspace @valve-tech/example-gas-dashboard dev`:

- [ ] PulseChain connects, block number ticks, tier cards populate within a few
  blocks.
- [ ] Base-fee sparkline draws and updates per block.
- [ ] On a gated-mempool public RPC the histogram panel shows the notice; the
  `mempool` badge is dim; the estimator labels itself *"recent block-included
  tips"*.
- [ ] Switching chains in the dropdown resets badges + block number, then
  repopulates from the new chain.
- [ ] Pasting an `http(s)://` RPC → *add RPC* detects chain id, adds it,
  switches to it.
- [ ] Pasting garbage surfaces the error banner.
- [ ] Typing a tip in the estimator updates the rank / percentile readout.

## Configuration

All config is public (a static site holds no secrets) and lives in
[`src/config.ts`](src/config.ts):

| Constant | What it is |
| --- | --- |
| `CHAINS[].rpcUrl` | JSON-RPC endpoint — `ws(s)://` builds a WS transport; `http(s)://` polls |
| `CHAINS[].chainId` | EIP-155 chain id, used by `gas-oracle` for EIP-1559 / legacy detection |
| `CHAINS[].label` | Human label shown in the dropdown |
| `CHAINS[].symbol` | Native-currency symbol (informational; fees print in gwei) |

PulseChain (369) is `CHAINS[0]` and the default. To add your own node at
build-time, append a `ChainConfig` entry; to use it at runtime paste the RPC
URL into the header input.

## Copying this out of the repo

This example is a self-contained Vite app. To lift it into its own repo:

1. Copy the `examples/gas-dashboard/` directory out.
2. In `package.json`, `"@valve-tech/chain-source": "^0.18.0"` and
   `"@valve-tech/gas-oracle": "^0.18.0"` already resolve from npm — no edit
   needed. (In-repo, yarn workspaces resolve those ranges to the local packages.)
3. `yarn && yarn dev`.

No server, no env file, no build-time secret, no wallet required.
