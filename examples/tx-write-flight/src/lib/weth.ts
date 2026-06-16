/** Pure WETH-registry lookups. The disable decision for Wrap / Unwrap. */
import type { Hex } from 'viem'

import { WETH_BY_CHAIN } from '../config'

/** Canonical WETH address for a chain id, or null when unregistered. */
export const wethAddressFor = (chainId: number): Hex | null =>
  WETH_BY_CHAIN[chainId] ?? null

/** True iff this chain has a registered WETH — i.e. Wrap / Unwrap are enabled. */
export const wethSupported = (chainId: number): boolean =>
  wethAddressFor(chainId) !== null
