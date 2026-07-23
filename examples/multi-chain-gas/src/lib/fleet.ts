/**
 * The multi-chain observation fleet. One pipeline per configured chain:
 *
 *   PublicClient → ChainSource → GasOracle
 *
 * runs CONCURRENTLY for every entry — mirroring gas-dashboard's
 * createDashboard, fanned out. Every callback is tagged with its chainId so
 * the UI keys state per chain. dispose() tears down every pipeline.
 *
 * One-ChainSource-per-chain is the toolkit invariant this example
 * demonstrates at fleet scale: no cross-chain state is shared below the UI.
 */
import { createChainSource, type Capabilities } from '@valve-tech/chain-source'
import { createGasOracle, type GasOracleState } from '@valve-tech/gas-oracle'
import type { ChainConfig } from '../config'
import { buildClient } from './rpc'

export interface FleetHandlers {
  onState: (chainId: number, state: GasOracleState) => void
  onCapabilities: (chainId: number, caps: Capabilities) => void
  onError: (chainId: number, err: Error) => void
}

export interface Fleet {
  dispose: () => void
}

const toError = (e: unknown): Error =>
  e instanceof Error ? e : new Error(String(e))

export const createFleet = (
  chains: readonly ChainConfig[],
  handlers: FleetHandlers,
): Fleet => {
  const disposers = chains.map((chain) => {
    const client = buildClient(chain)

    const source = createChainSource({
      client,
      onError: (_method, e) => handlers.onError(chain.chainId, toError(e)),
    })

    const oracle = createGasOracle({
      source,
      chainId: chain.chainId,
      keepMempoolSnapshot: false, // compare view needs tiers only — skip the sample buffer
    })

    const unsub = oracle.subscribe((state) =>
      handlers.onState(chain.chainId, state),
    )

    source.start()
    oracle.start()

    // Report real capabilities once the eager probe lands, then force one
    // poll so the first paint isn't empty.
    void source
      .ready()
      .then(async () => {
        handlers.onCapabilities(chain.chainId, source.capabilities())
        await oracle.pollOnce()
      })
      .catch((e) => handlers.onError(chain.chainId, toError(e)))

    return () => {
      unsub()
      oracle.stop()
      source.stop()
    }
  })

  return {
    dispose: () => {
      for (const dispose of disposers) dispose()
    },
  }
}
