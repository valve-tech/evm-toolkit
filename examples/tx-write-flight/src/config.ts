/**
 * Build-time configuration — everything here is PUBLIC. A static site holds
 * no secrets. The WETH registry maps a chain id to that chain's canonical
 * wrapped-native (WETH9-style) contract; chains absent from the map disable
 * the Wrap / Unwrap actions (native send still works everywhere).
 */
import type { Hex } from 'viem'

/** Canonical WETH9-style wrapped-native address per chain id. */
export const WETH_BY_CHAIN: Readonly<Record<number, Hex>> = {
  1: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // Ethereum mainnet WETH9
  10: '0x4200000000000000000000000000000000000006', // OP Mainnet WETH
  8453: '0x4200000000000000000000000000000000000006', // Base WETH
  42161: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', // Arbitrum One WETH
  11155111: '0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9', // Sepolia WETH
}

/** Minimal WETH9 ABI — only deposit()/withdraw() are exercised. */
export const WETH_ABI = [
  { type: 'function', name: 'deposit', stateMutability: 'payable', inputs: [], outputs: [] },
  {
    type: 'function',
    name: 'withdraw',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'wad', type: 'uint256' }],
    outputs: [],
  },
] as const

/** Tiny defaults so accidental mainnet sends stay cheap. In wei (1e15 = 0.001). */
export const DEFAULT_NATIVE_WEI = 1_000_000_000_000_000n // 0.001
export const DEFAULT_WRAP_WEI = 1_000_000_000_000_000n // 0.001
export const DEFAULT_UNWRAP_WEI = 1_000_000_000_000_000n // 0.001
