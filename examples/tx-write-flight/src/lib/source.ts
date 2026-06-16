/**
 * Recipe 2: ONE ChainSource per chain, fanned out to gas-oracle AND tx-tracker.
 * Never two poll loops against one RPC. The oracle and tracker are siblings
 * over one source — neither is layered on the other. Cached per chain id so a
 * reconnect to the same chain reuses the running poll loop.
 */
import { createPublicClient, custom, type Chain, type PublicClient } from 'viem'
import { createChainSource, type ChainSource } from '@valve-tech/chain-source'
import { createGasOracle, type GasOracle } from '@valve-tech/gas-oracle'
import { createTxTracker, type TxTracker } from '@valve-tech/tx-tracker'

import type { Eip1193Provider } from './wallet'

export interface ChainStack {
  client: PublicClient
  source: ChainSource
  oracle: GasOracle
  tracker: TxTracker
  stop: () => void
}

const stacks = new Map<number, ChainStack>()

/** A viem PublicClient over the injected provider for a chain. */
export const publicClientFor = (
  provider: Eip1193Provider,
  chain: Chain,
): PublicClient =>
  createPublicClient({ chain, transport: custom(provider) })

/**
 * Get (or build) the running stack for a chain. The oracle needs at least one
 * subscriber to poll (pauseWhenIdle default), so we keep `pauseWhenIdle: false`
 * to guarantee `getState()` populates for the cost preview without forcing the
 * UI to subscribe.
 */
export const getChainStack = (
  provider: Eip1193Provider,
  chain: Chain,
): ChainStack => {
  const existing = stacks.get(chain.id)
  if (existing) return existing

  const client = publicClientFor(provider, chain)
  const source = createChainSource({ client })
  const oracle = createGasOracle({
    source,
    chainId: chain.id,
    priorityModel: 'eip1559',
    pauseWhenIdle: false,
  })
  const tracker = createTxTracker({ source, chainId: chain.id })

  source.start()
  oracle.start()
  tracker.start()

  const stack: ChainStack = {
    client,
    source,
    oracle,
    tracker,
    stop: () => {
      oracle.stop()
      tracker.stop()
      source.stop()
      stacks.delete(chain.id)
    },
  }
  stacks.set(chain.id, stack)
  return stack
}

/**
 * Module-level PublicClient registry keyed by chain id — used as the
 * `clientFactory` for tx-flight-react rehydrate. Must not capture rendered
 * state (called at Provider mount per pending entry).
 */
const clients = new Map<number, PublicClient>()
export const registerClient = (chainId: number, client: PublicClient): void => {
  clients.set(chainId, client)
}
export const clientFactory = (chainId: number): PublicClient | undefined =>
  clients.get(chainId)
