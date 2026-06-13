# ZK proofs over the Unchained Index — research track

**Date:** 2026-06-13
**Status:** Research track (exploratory) — not yet scheduled for implementation
**Relates to:** `2026-06-12-unchained-tx-history-design.md` (Phase 1),
`@valve-tech/unchained-reader`, `@valve-tech/example-unchained-index-server`

## The problem this solves

To find an address's appearances trustlessly, a client must learn **which
chunks** the address is in. Today that means downloading **every** chunk's
bloom filter and testing it locally. On a busy chain the blooms are not
small — measured live (2026-06-13):

| chain | chunks | bloom avg | bloom max | all blooms |
| --- | --- | --- | --- | --- |
| PulseChain (369) | 5,665 | ~0.9 MB | 5 MB | **~5 GB** |
| PulseChain-v4 (943) | 3,447 | ~1.0 MB | 5 MB | ~3.6 GB |
| Ethereum (1) | 5,948 | ~1.0 MB | 5 MB | ~6 GB |

(The chunk blooms are *adaptive* — one ~128 KB sub-bloom per ~50k
addresses — not the 256-byte Ethereum `logsBloom`.) Full-history search
over IPFS is therefore multiple GB of bloom downloads per query. `chifra`
avoids this only because the blooms sit on local disk.

Three tiers address this, in increasing order of ambition:

1. **Direct / trustless (today).** Browser downloads + parses blooms and
   matching chunks itself. Correct, but multi-GB for full history.
2. **Backend accelerator (shipped, short-term).**
   `@valve-tech/example-unchained-index-server` holds a chain's blooms in
   memory and streams matching appearances over SSE. Fast, but reintroduces
   a trusted server.
3. **ZK proofs (this track).** Replace the bloom download with a *succinct
   proof*, verifiable against the published index commitment — bandwidth of
   tier 2, trust model of tier 1.

## The ZK idea

A prover that holds the full index produces a **succinct proof** that a
claimed answer is correct *with respect to the published commitment*, and
the client verifies that proof in milliseconds. The commitment already
exists: the manifest (resolved on-chain from the permissionless
UnchainedIndex contract) lists every chunk's content-addressed CIDs. A
proof binds its claim to those CIDs / a root over them, so the client
trusts **the proof + the on-chain manifest hash**, never the prover.

### Tier A — "which chunks" proof (first milestone)

Prove the membership decision for a target address across the chunk set:

> "Against manifest `M` (hash `h_M`, read on-chain), address `X` is
>  **possibly-present** in chunks `{c_i}` and **definitely-absent** in all
>  others."

The frontend fetches the small proof + the short hit-list, verifies it
against `h_M`, then downloads **only** the matching index chunks (a
handful, not 5,665 blooms) and parses appearances client-side — so the
final read stays trustless. This is the **80% bandwidth win** and the
recommended starting point: it proves the bloom scan, nothing more.

### Tier B — "direct to appearances" proof (the ideal)

Skip the index-chunk download entirely: prove the appearances directly,
along **each dimension of relevance** the user cares about — **blocks** and
**transactions** — as separate, composable proofs ("2 proofs"):

> Proof 1 (blocks): "X appears in blocks `{b_j}`" — bound to the index
>   chunks' commitments.
> Proof 2 (transactions): "within those, X is the tx at
>   `(block, txIndex)` → hash `H_k`" — bound likewise.

The client then has verified `(block, txIndex, txHash)` tuples with **zero
chunk downloads**, and can render immediately (hydrating tx detail over its
own RPC, or trusting the proven hash). Tier B is strictly harder (the
circuit must open the index address+appearance tables, not just the bloom),
but it's the end state: the frontend "instantly checks" a proof and gets
every dimension of relevance.

## Circuit sketch (what must be proven)

For each claimed chunk, the prover demonstrates, in zero knowledge of the
rest of the chunk:

1. **Commitment binding:** the chunk bytes hash (CIDv1 / the index's
   content hash) to the CID listed in manifest `M` — and `M` hashes to the
   on-chain `h_M`. (A hash-preimage / Merkle-path circuit.)
2. **Bloom decision (Tier A):** the adaptive-bloom membership test for `X`
   over those bytes evaluates to the claimed possibly-present / absent bit.
3. **Table inclusion (Tier B):** `X` is at offset `o` in the chunk's
   *sorted* address table (a Merkle/vector-commitment inclusion or a
   sortedness + binary-search argument), and the appearance-table slice
   `[o, o+count)` decodes to the claimed `(block, txIndex)` records.

The honest-but-curious prover runs the existing `unchained-reader` logic;
the circuit re-expresses that logic as constraints. The parsers in this
repo (`bloom.ts`, `chunk.ts`) are the executable spec for the circuit.

## Trust model & trade-offs

- **Verifiable, not trusted:** the client checks the proof against the
  on-chain manifest hash. A lying prover cannot forge a valid proof.
- **Reintroduces a prover service** (softening the strict "no backend"
  headline of Phase 1) — but it is a *verifiable* service, a different and
  defensible posture. The direct path remains available for the purist.
- **Proving cost** moves server-side and is non-trivial (hashing MBs of
  chunk bytes in-circuit is the expensive part — recursion / a commitment
  scheme that avoids re-hashing whole chunks is the key research question).

## Prior art — Space and Time (Proof of SQL)

[spaceandtime.io](https://spaceandtime.io) has built **Proof of SQL**: a ZK
proof that a SQL query result is correct over a *cryptographically committed*
table, verifiable in milliseconds by a smart contract or a light client.
This maps almost directly onto **Tier B** and sidesteps the hardest part of
this track (hand-rolling a circuit over the chunk binary format):

- Load the Unchained Index appearances into an SXT-committed table
  (`address, blockNumber, transactionIndex, txHash`).
- A query `SELECT blockNumber, transactionIndex, txHash WHERE address = X`
  returns rows **plus a Proof of SQL** the frontend verifies against the
  table commitment — the "frontend just gets the zkproof and instantly
  checks" outcome, with both dimensions of relevance (blocks + transactions)
  in one verified result set.

Open questions this raises: how the table commitment is anchored to (or
reconciled with) the on-chain UnchainedIndex manifest hash so the trust root
stays the index itself; ingestion/freshness as chunks append; and whether
SXT's commitment scheme is cheaper than a bespoke Merkle-over-chunks
approach. **Action:** evaluate Proof of SQL as the Tier B implementation
path before committing to a custom circuit — it may collapse milestones 2–4.

## Open research questions

- Which proof system (Groth16 / PLONK / STARK / folding) best fits "hash a
  few MB + table inclusion," and can proofs be **precomputed per chunk**
  and composed per query rather than proved per request?
- Can we commit the index in a ZK-friendlier form at **publish time**
  (Verkle/Merkle over address tables, a Poseidon-hashed mirror) so the
  circuit opens a commitment instead of re-hashing raw chunk bytes? This is
  the highest-leverage change and may belong upstream in chifra publishing.
- Is the adaptive bloom worth proving at all (Tier A), or do we skip
  straight to table-inclusion proofs (Tier B) and drop blooms from the
  served artifacts entirely — "zkproofs we serve instead of 1 MB blooms"?
- Incremental updates: new chunks append continuously — proofs/commitments
  must be cheap to extend.

## Milestones

1. Pin the index commitment story: does a chunk CID + on-chain manifest
   hash suffice, or do we need a publish-time ZK-friendly commitment?
2. Prototype Tier A for one small chunk against a fixture (reuse
   `src/__fixtures__/`), proving the bloom decision + CID binding.
3. Benchmark prover cost; decide precompute-per-chunk vs prove-per-query.
4. Extend to Tier B (table inclusion → `(block, txIndex, hash)`).
5. Wire a verifying client into `unchained-reader` as an alternative source
   alongside direct + backend (same `StreamQuery` contract the example
   already uses).

## Out of scope (for now)

Implementation. This document starts the track and records the design
intent; scheduling is a separate decision.
