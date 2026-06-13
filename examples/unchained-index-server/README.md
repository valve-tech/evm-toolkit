# `@valve-tech/example-unchained-index-server`

Short-term backend for the [`unchained-tx-history`](../unchained-tx-history)
demo. The trustless browser path must download **every** chunk's bloom
filter to search full history — ~5 GB on a busy chain. This server pays
that cost **once**: on the first query for a chain it loads all of that
chain's bloom filters into memory, then every later query is an **in-RAM
bloom scan** that fetches only the matching index chunks and **streams
appearances back over SSE** as they're found.

It runs the *same* parser the browser uses (`@valve-tech/unchained-reader`),
just server-side with the blooms pre-warmed in a content cache. Deploy it
where the blooms are local (valve infra / the IPFS pin) and the one-time
warm is seconds, not minutes.

> This is a pragmatic accelerator, **not** a replacement for the trustless
> path. The browser can still read the index directly; the backend just
> makes full-history search usable today. The eventual fix is a ZK proof
> of which chunks match (see the research-track spec).

## Run

```bash
yarn build
PORT=8788 WARM=pulsechain yarn workspace @valve-tech/example-unchained-index-server start
```

- `WARM=pulsechain,pulsechain-v4` pre-warms those chains on startup
  (otherwise a chain warms lazily on its first request).
- `IPFS_GATEWAY` (default `https://ipfs.valve.city`) and `MANIFEST_RPC`
  (default the `vk_demo` mainnet endpoint) are overridable.

## API

`GET /appearances?chain=<chainKey>&address=0x…` → `text/event-stream`:

| event | data |
| --- | --- |
| `status` | `{ phase: "loading", chain }` |
| `loading` | `{ done, total }` — bloom warm progress (first query only) |
| `meta` | `{ chunks, first, last }` — the scanned block window |
| `progress` | `{ chunksTotal, bloomsFetched, hits, chunksFetched, appearancesFound }` |
| `appearances` | `[{ blockNumber, transactionIndex }, …]` — streamed per matching chunk |
| `done` | `{ total, failures: [{ first, last, cid, reason }] }` |
| `error` | `{ message }` |

Block numbers / indices are decimal strings (JSON has no bigint).

`GET /health` → `{ ok, bloomsInMemory }`.

The frontend points at this with `VITE_BACKEND_URL` (see the demo README).

## Memory

One chain's blooms is the resident set — ~5 GB for PulseChain (5,665
chunks × ~0.9 MB avg). Index chunks are fetched on a bloom hit and **not**
cached, so memory stays bounded to the warmed bloom set. Size the host
accordingly, or warm only the chains you serve.
