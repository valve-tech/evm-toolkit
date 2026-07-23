/**
 * Single-chain gas pipeline for UserOp pricing:
 *
 *   PublicClient → ChainSource → GasOracle
 *
 * Same shape as gas-dashboard's createDashboard, trimmed to tiers-only
 * (no mempool snapshot) — the UserOp needs one EIP-1559 fee pair.
 */
import { createChainSource } from '@valve-tech/chain-source'
import { createGasOracle, type GasOracleState } from '@valve-tech/gas-oracle'
import type { PublicClient } from 'viem'

export interface GasFeed {
  dispose: () => void
}

export const createGasFeed = (
  client: PublicClient,
  chainId: number,
  onState: (state: GasOracleState) => void,
  onError: (err: Error) => void,
): GasFeed => {
  const source = createChainSource({
    client,
    onError: (_method, e) =>
      onError(e instanceof Error ? e : new Error(String(e))),
  })
  const oracle = createGasOracle({ source, chainId, keepMempoolSnapshot: false })
  const unsub = oracle.subscribe(onState)

  source.start()
  oracle.start()
  void source
    .ready()
    .then(() => oracle.pollOnce())
    .catch((e) => onError(e instanceof Error ? e : new Error(String(e))))

  return {
    dispose: () => {
      unsub()
      oracle.stop()
      source.stop()
    },
  }
}
