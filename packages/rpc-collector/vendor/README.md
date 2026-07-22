# Vendored chainlist data

The files in `constants/` are copied verbatim from
[DefiLlama/chainlist](https://github.com/DefiLlama/chainlist) (MIT), the
dataset that powers chainlist.org. They are self-contained plain-ESM data
modules with no imports of their own.

(Upstream once split llama-node RPCs into a separate `llamaNodesRpcs.js`
merged in via `mergeDeep`; that file was removed upstream in 2026 and
`extraRpcs.js` now carries everything inline.)

## These are build-time inputs only

Nothing here is published or imported at runtime. `scripts/generate-data.mjs`
evaluates these modules and emits `src/data.generated.ts`, which is the only
data the runtime touches. That keeps `@valve-tech/rpc-collector` at **zero
runtime dependencies** and avoids shipping a module graph Node's ESM loader
would have to resolve.

## Refreshing

```bash
# from the repo root
node packages/rpc-collector/scripts/refresh-vendor.mjs
node packages/rpc-collector/scripts/generate-data.mjs
yarn vitest run packages/rpc-collector
```

Commit the updated `constants/` files together with the regenerated
`src/data.generated.ts`.
