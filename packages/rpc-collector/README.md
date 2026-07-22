# @valve-tech/rpc-collector

Zero-dependency EVM RPC endpoint collector. Resolve a chainId to a
privacy-ranked list of public RPC endpoints, then hand that list straight to
viem or ethers.

## Why this exists

Picking a public RPC usually means hardcoding a URL and hoping it stays up.
This package turns that into data: every endpoint the chainlist dataset knows
about, ordered so the providers that track you least come first, ready to be
wired into a transport with failover.

The dataset is **compiled into the package** at build time from
[DefiLlama/chainlist](https://github.com/DefiLlama/chainlist), so there are no
runtime dependencies and no network calls during collection.

## Install

```bash
yarn add @valve-tech/rpc-collector
# plus whichever client you use
yarn add viem   # or: yarn add ethers
```

## Quick start

```ts
import { collectRpcs } from '@valve-tech/rpc-collector'

// Every mainnet HTTP endpoint, least-tracking first.
const endpoints = collectRpcs({ chainId: 1 })

console.log(endpoints[0])
// { url: 'https://ethereum-rpc.publicnode.com', protocol: 'http',
//   tracking: 'none', chainId: 1 }
// (exact first endpoint tracks the upstream dataset)
```

### With viem

```ts
import { createPublicClient } from 'viem'
import { mainnet } from 'viem/chains'
import { collectRpcs } from '@valve-tech/rpc-collector'
import { toViemTransport } from '@valve-tech/rpc-collector/viem'

const endpoints = collectRpcs({ chainId: 1, allowedTracking: ['none'], limit: 5 })

const client = createPublicClient({
  chain: mainnet,
  transport: toViemTransport(endpoints, { mode: 'loadBalance' }),
})
```

### With ethers

```ts
import { collectRpcs } from '@valve-tech/rpc-collector'
import { toEthersProvider } from '@valve-tech/rpc-collector/ethers'

const provider = toEthersProvider(
  collectRpcs({ chainId: 1, limit: 5 }),
  { mode: 'fallback' },
)
```

## Privacy ordering

Endpoints are returned **in full** and ordered by the provider's self-reported
tracking rating — nothing is silently dropped:

`none` → `limited` → `unspecified` → `unknown` → `yes`

Opt into hard filtering when you want it:

```ts
collectRpcs({ chainId: 1, allowedTracking: ['none', 'limited'] })
```

## API

```ts
collectRpcs(options: CollectRpcsOptions): RpcEndpoint[]
```

| Option | Default | Meaning |
|---|---|---|
| `chainId` | — | Chain to look up by id (number or string) |
| `chainName` | — | Chain to look up by name, e.g. `'ethereum'` (case-insensitive) |
| `allowedTracking` | all | Restrict to these tracking ratings |
| `protocol` | `'http'` | `'http'`, `'ws'`, or `'any'` |
| `limit` | — | Cap the result, applied after ordering |

Throws `UnknownChainError` if the chain is not in the dataset, and `TypeError`
if neither `chainId` nor `chainName` is supplied.

```ts
probeEndpoints(endpoints, { timeoutMs?, keepDead? }): Promise<ProbedRpcEndpoint[]>
```

Opt-in liveness check. Pings each HTTP endpoint with `eth_chainId`, drops any
that fail or answer for the wrong chain, and reorders survivors by latency.
Websocket endpoints pass through unmeasured.

```ts
toViemTransport(endpoints, { mode?: 'fallback' | 'loadBalance' }): FallbackTransport
toEthersProvider(endpoints, { mode?: 'fallback' | 'loadBalance' }): FallbackProvider
```

`'fallback'` tries endpoints in order and rotates on failure. `'loadBalance'`
spreads traffic — viem re-ranks by latency, ethers gives every endpoint equal
priority. Both throw `EmptyEndpointSetError` rather than return a transport
that would fail every call.

## Refreshing the dataset

```bash
node packages/rpc-collector/scripts/refresh-vendor.mjs
node packages/rpc-collector/scripts/generate-data.mjs
```

See [`vendor/README.md`](./vendor/README.md).

## License

MIT
