# unchained-tx-history

Type any EVM address → see every transaction it appears in. By default a
TrueBlocks **chifra** daemon serves the appearance index (`chifra list`)
straight from its on-disk copy of the **Unchained Index**, and each
appearance is hydrated into a full transaction client-side over **batched**
JSON-RPC (`eth_getTransactionByBlockNumberAndIndex`, ~16 to a request).

Or run it **fully trustless**: point it at your own RPC and IPFS gateway
and the same Unchained Index is bloom-scanned **in the browser** with
[`@valve-tech/unchained-reader`](../../packages/unchained-reader) — manifest
resolved live from chain, blooms and chunks pulled from IPFS, no daemon, no
backend, no API key.

Live at **<https://mention.valve.city>**.

## What it demonstrates

- **Three interchangeable sources behind one streaming UI**: a chifra
  daemon's `/list` (the default, via
  [`@valve-tech/trueblocks-sdk`](../../packages/trueblocks-sdk)); an
  in-memory bloom backend; or the fully client-side bloom scan with
  [`@valve-tech/unchained-reader`](../../packages/unchained-reader). The
  same render path handles all three, and a **source menu** in the controls
  swaps between them at runtime — valve's daemon, any other chifra daemon you
  paste, or the trustless browser scan.
- **Batched hydration**: appearances are hydrated in JSON-RPC batches of
  ~16 `eth_getTransactionByBlockNumberAndIndex` calls, paced by one global
  adaptive rate gate with 429 backpressure — far fewer round trips than a
  request-per-tx flood, and the public nodes tolerate it far better.
- **Trustless by construction (the fallback path)**: the manifest CID is
  read live from the permissionless UnchainedIndex contract (so it is
  never a stale baked-in value), chunks come from any IPFS gateway, and
  transactions are hydrated with vanilla JSON-RPC. Swap the RPC and gateway
  for your own and **nothing depends on valve**.
- **Honest progress + partial-answer surfacing**: a live counter shows
  hydrated / total and bytes over the wire; the trustless path additionally
  shows blooms read / hits / chunks parsed, and any chunk that fails to
  fetch or parse is shown explicitly — a partial result is never presented
  as complete.
- **Lazy, counted pagination**: the chifra source reads the exact appearance
  **count** up front, then fetches coordinates a page at a time — only the
  newest (or oldest; toggle it on the Search button) 50 are loaded, with a
  **Load more** button for the rest. A whale costs the count plus the pages
  you actually view, not its entire coordinate list. (The trustless scan
  still bounds to recent chunks unless you tick "search all history".)
- **Light & dark**: a "wet concrete" light theme toggles in the footer
  (initially follows your OS preference, then remembers your choice); the
  controls reflow responsively from desktop down to mobile.

## Run it

```bash
yarn            # from the repo root, installs the workspace
yarn workspace @valve-tech/example-unchained-tx-history dev
```

Open the printed localhost URL, pick a chain (PulseChain Testnet v4 is the
fastest — smallest index), and click **try a sample address** → **Search**.

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
| `CHIFRA_URL` | chifra daemon base for the default `/list` source (`chifra.valve.city`); set `VITE_CHIFRA_URL=''` to fall back to the backend / trustless paths |
| `IPFS_GATEWAY` | gateway serving the chunks/blooms for the trustless path (`ipfs.valve.city`) |
| `CHAINS[].rpcUrl` | JSON-RPC for tx hydration — public nodes (`rpc.pulsechain.com`, `rpc-ethereum.g4mm4.io`) |
| `MANIFEST_LOOKUP_RPC` | Ethereum RPC for the one manifest-resolution `eth_call` (trustless path) |
| `UNCHAINED_CONTRACT` / `VALVE_PUBLISHER` | where manifest CIDs are published on-chain |
| `DEFAULT_RECENT_CHUNKS` | how many recent chunks the default (bounded) trustless scan covers |

To point at your own infra, replace `CHIFRA_URL`, `IPFS_GATEWAY` and the
per-chain `rpcUrl`s with any daemon / gateway / EVM node. The defaults are
deliberately public but rate-limited; for heavy use bring your own node.

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
