# @valve-tech/rpc-collector — notes for agents

## Invariants

1. **Zero runtime dependencies.** `dependencies` stays empty. The chainlist
   dataset is vendored under `vendor/` as a build-time input and compiled to
   `src/data.generated.ts`. Never add a runtime import of `vendor/`.
2. **`src/data.generated.ts` is generated.** Do not hand-edit it. Regenerate
   with `scripts/refresh-vendor.mjs` then `scripts/generate-data.mjs`, and
   commit both the vendored constants and the regenerated file together.
3. **The root export must not import viem or ethers.** They are optional peers
   reachable only through the `./viem` and `./ethers` subpath exports. A root
   import would break consumers who installed neither.
4. **Never silently drop endpoints.** `collectRpcs` returns everything for the
   chain, ordered privacy-first. Removal happens only when the caller passes
   `allowedTracking` / `protocol` / `limit`.
5. **Adapters refuse empty input.** Throw `EmptyEndpointSetError` rather than
   build a transport with no endpoints.

## Why the data is vendored rather than depended on

The obvious dependency, `chainlist-rpcs`, is `type: module` but uses
extensionless relative imports (`from './modules/rpcs'`). Node's native ESM
loader rejects those, so it resolves only inside a bundler. Depending on it
would pass CI (vitest bundles through Vite) and then crash real Node consumers
with `ERR_MODULE_NOT_FOUND`. Vendoring DefiLlama's constants — which are
self-contained plain-ESM data modules — and compiling them to a plain data
module avoids the whole class of problem and drops the runtime dependency
entirely.

## Upstream drift history (2026-07)

Two things the original design assumed no longer exist upstream:

- **`llamaNodesRpcs.js` was removed** (DefiLlama/chainlist#2749), and
  `extraRpcs.js` stopped importing `mergeDeep`, so the local
  `vendor/utils/fetch.js` shim the design called for was never needed and is
  not present. The vendored constants are import-free.
- **The `isOpenSource` flag disappeared from the dataset.** The planned
  `openSourceOnly` collect option was therefore dropped — it could only ever
  return an empty set, which is precisely the silent-downgrade trap invariant
  4 exists to prevent. `RawRpcRecord.isOpenSource` / `RpcEndpoint.isOpenSource`
  remain as optional passthroughs (and an ordering tiebreak) so the data
  round-trips correctly if upstream reinstates the flag; reintroduce
  `openSourceOnly` only once real data carries it again.
