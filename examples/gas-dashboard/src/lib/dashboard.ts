/**
 * The single-chain observation pipeline. createDashboard builds:
 *
 *   PublicClient → ChainSource → gasOracle
 *
 * one of each, wired so the oracle's per-block `subscribe` callback delivers a
 * fresh GasOracleState to the UI. Capabilities are probed (source.ready) and
 * reported once up front. Switching chains in App.tsx calls dispose() and
 * builds a new Dashboard — demonstrating one-ChainSource-per-chain cleanly.
 *
 * keepMempoolSnapshot is ON so state.mempoolSamples is populated for the
 * histogram and estimator; on a gated RPC the samples are simply empty and
 * the capability layer routes the UI to the block-included fallback.
 */
import { createChainSource, type Capabilities } from '@valve-tech/chain-source'
import { createGasOracle, type GasOracleState } from '@valve-tech/gas-oracle'
import type { ChainConfig } from '../config'
import { buildClient } from './rpc'

export interface DashboardHandlers {
  onState: (state: GasOracleState) => void
  onCapabilities: (caps: Capabilities) => void
  onError: (err: Error) => void
}

export interface Dashboard {
  dispose: () => void
}

export const createDashboard = (
  chain: ChainConfig,
  handlers: DashboardHandlers,
): Dashboard => {
  const client = buildClient(chain)

  const source = createChainSource({
    client,
    // chain-source's onError is (method, err); forward the cause as an Error.
    onError: (_method, e) =>
      handlers.onError(e instanceof Error ? e : new Error(String(e))),
  })

  const oracle = createGasOracle({
    source,
    chainId: chain.chainId,
    keepMempoolSnapshot: true,
  })

  // Repaint on every published state.
  const unsub = oracle.subscribe((state) => handlers.onState(state))

  source.start()
  oracle.start()

  // Report real capabilities once the eager probe lands, then force one poll
  // so the first paint isn't empty (getState is null until the first cycle).
  void source
    .ready()
    .then(async () => {
      handlers.onCapabilities(source.capabilities())
      await oracle.pollOnce()
    })
    .catch((e) =>
      handlers.onError(e instanceof Error ? e : new Error(String(e))),
    )

  return {
    dispose: () => {
      unsub()
      oracle.stop()
      source.stop()
    },
  }
}
