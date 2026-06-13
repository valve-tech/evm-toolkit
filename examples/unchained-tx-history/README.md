# unchained-tx-history

A fully static web app that proves the TrueBlocks **Unchained Index** is
trustlessly consumable from a browser with nothing but an RPC URL and an
IPFS gateway — **no chifra daemon, no backend, no API key.**

Type an address → the page resolves the index manifest live from chain,
streams bloom filters and index chunks from IPFS, parses the binary
formats **in the browser** with
[`@valve-tech/unchained-reader`](../../packages/unchained-reader), and
hydrates each appearance into a full transaction over plain JSON-RPC.

Live at **<https://mention.valve.city>**.

## What it demonstrates

- **`@valve-tech/unchained-reader` end to end**: manifest → blooms →
  chunks → appearances, all client-side. The bloom filter gates which
  chunks are even worth fetching; only matching chunks are downloaded and
  parsed.
- **Trustless by construction**: the manifest CID is read live from the
  permissionless UnchainedIndex contract (so it is never a stale baked-in
  value), chunks come from any IPFS gateway, and transactions are
  hydrated with vanilla `eth_getTransactionByBlockNumberAndIndex`. Swap
  the RPC and gateway for your own and **nothing depends on valve**.
- **Honest progress + partial-answer surfacing**: a live counter shows
  blooms read / hits / chunks parsed / appearances found, and any chunk
  that fails to fetch or parse is shown explicitly — a partial result is
  never presented as complete.
- **Bounded by default**: full mainnet history is hundreds of MB of bloom
  fetches, so the app scans only the most recent chunks unless you tick
  "search all history".

## Run it

```bash
yarn            # from the repo root, installs the workspace
yarn workspace @valve-tech/example-unchained-tx-history dev
```

Open the printed localhost URL, pick a chain (PulseChain Testnet v4 is the
fastest — smallest index), and click **try a sample address** → **Trace**.

Build the static bundle:

```bash
yarn workspace @valve-tech/example-unchained-tx-history build
# → examples/unchained-tx-history/dist/  (deploy this anywhere static)
```

## Configuration

All config is public (a static site holds no secrets) and lives in
[`src/config.ts`](src/config.ts):

| Constant | What it is |
| --- | --- |
| `IPFS_GATEWAY` | gateway serving the chunks/blooms (`ipfs.valve.city`) |
| `CHAINS[].rpcUrl` | JSON-RPC for tx hydration — uses valve's public, rate-limited, read-only `vk_demo` key |
| `MANIFEST_LOOKUP_RPC` | Ethereum RPC for the one manifest-resolution `eth_call` |
| `UNCHAINED_CONTRACT` / `VALVE_PUBLISHER` | where manifest CIDs are published on-chain |
| `DEFAULT_RECENT_CHUNKS` | how many recent chunks the default (bounded) scope scans |

To point at your own infra, replace `IPFS_GATEWAY` and the per-chain
`rpcUrl`s with any gateway / EVM node. The `vk_demo` endpoints are
deliberately public but rate-limited; for heavy use bring your own key or
node.

## Copying this out of the repo

This example is a self-contained Vite app. To lift it into its own repo:

1. Copy the `examples/unchained-tx-history/` directory out.
2. In `package.json`, the dependency
   `"@valve-tech/unchained-reader": "^0.18.0"` already resolves from npm —
   no edit needed. (In-repo, yarn workspaces resolve that same semver
   range to the local workspace.)
3. `yarn && yarn dev`.

No other changes are required — there is no server, no env file, and no
build-time secret.
