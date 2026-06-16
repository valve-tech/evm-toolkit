import { describe, it, expect } from 'vitest'
import type { Hex } from 'viem'

import { buildTransactionRequest, buildCancelRequest } from './actions'

const FROM = '0x1111111111111111111111111111111111111111' as Hex
const TO = '0x2222222222222222222222222222222222222222' as Hex
const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' as Hex
const GAS = { maxFeePerGas: 30_000_000_000n, maxPriorityFeePerGas: 2_000_000_000n }

describe('buildTransactionRequest', () => {
  it('native send → value transfer to the recipient, empty calldata', () => {
    const req = buildTransactionRequest(
      { kind: 'send', to: TO, amountWei: 5n },
      { chainId: 1, from: FROM, weth: WETH, gas: GAS },
    )
    expect(req).toEqual({
      to: TO,
      data: '0x',
      value: 5n,
      chainId: 1,
      maxFeePerGas: 30_000_000_000n,
      maxPriorityFeePerGas: 2_000_000_000n,
    })
  })

  it('wrap → payable deposit() on WETH, value = amount, to = WETH', () => {
    const req = buildTransactionRequest(
      { kind: 'wrap', amountWei: 1_000n },
      { chainId: 1, from: FROM, weth: WETH, gas: GAS },
    )
    expect(req.to).toBe(WETH)
    expect(req.value).toBe(1_000n)
    // deposit() selector
    expect(req.data).toBe('0xd0e30db0')
  })

  it('unwrap → withdraw(amount) on WETH, zero value, encoded arg', () => {
    const req = buildTransactionRequest(
      { kind: 'unwrap', amountWei: 1_000n },
      { chainId: 1, from: FROM, weth: WETH, gas: GAS },
    )
    expect(req.to).toBe(WETH)
    expect(req.value).toBe(0n)
    // withdraw(uint256) selector + 32-byte arg = 0x3e8
    expect(req.data).toBe(
      '0x2e1a7d4d00000000000000000000000000000000000000000000000000000000000003e8',
    )
  })
})

describe('buildCancelRequest', () => {
  it('is a 0-value self-send on the same nonce', () => {
    const cancel = buildCancelRequest({ from: FROM, chainId: 1, nonce: 42 })
    expect(cancel).toEqual({ to: FROM, value: 0n, nonce: 42, chainId: 1, data: '0x' })
  })
})
