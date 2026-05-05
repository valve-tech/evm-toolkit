import { describe, it, expect, vi } from 'vitest'
import type { Hex, TransactionReceipt } from 'viem'
import { awaitReceiptWithHooks, ContractRevertedError, type ReceiptAwaiter } from './receipt.js'

const HASH = '0xfeedface' as Hex

const buildReceipt = (status: 'success' | 'reverted'): TransactionReceipt =>
  ({
    transactionHash: HASH,
    status,
    blockNumber: 1n,
    blockHash: '0xabc' as Hex,
    transactionIndex: 0,
    from: '0x' as Hex,
    to: '0x' as Hex,
    contractAddress: null,
    cumulativeGasUsed: 21000n,
    gasUsed: 21000n,
    effectiveGasPrice: 100n,
    logs: [],
    logsBloom: '0x',
    type: 'eip1559',
  }) as unknown as TransactionReceipt

const okClient = (status: 'success' | 'reverted'): ReceiptAwaiter => ({
  waitForTransactionReceipt: vi.fn(async () => buildReceipt(status)),
})

describe('awaitReceiptWithHooks', () => {
  describe('on receipt success', () => {
    it('resolves with the receipt', async () => {
      const receipt = await awaitReceiptWithHooks({
        publicClient: okClient('success'),
        hash: HASH,
      })
      expect(receipt.status).toBe('success')
      expect(receipt.transactionHash).toBe(HASH)
    })

    it('fires onConfirmed exactly once with the receipt', async () => {
      const onConfirmed = vi.fn()
      await awaitReceiptWithHooks({
        publicClient: okClient('success'),
        hash: HASH,
        hooks: { onConfirmed },
      })
      expect(onConfirmed).toHaveBeenCalledOnce()
      const [arg] = onConfirmed.mock.calls[0]!
      expect((arg as TransactionReceipt).status).toBe('success')
    })

    it("fires onPhase with phase='confirmed' on success, including hash + receipt", async () => {
      const onPhase = vi.fn()
      await awaitReceiptWithHooks({
        publicClient: okClient('success'),
        hash: HASH,
        hooks: { onPhase },
      })
      expect(onPhase).toHaveBeenCalledOnce()
      const [event] = onPhase.mock.calls[0]!
      expect(event).toMatchObject({ phase: 'confirmed', hash: HASH })
      expect((event as { receipt: TransactionReceipt }).receipt.status).toBe('success')
    })

    it('does NOT fire onFailed on success', async () => {
      const onFailed = vi.fn()
      await awaitReceiptWithHooks({
        publicClient: okClient('success'),
        hash: HASH,
        hooks: { onFailed },
      })
      expect(onFailed).not.toHaveBeenCalled()
    })
  })

  describe('on receipt revert', () => {
    it('throws ContractRevertedError', async () => {
      await expect(
        awaitReceiptWithHooks({ publicClient: okClient('reverted'), hash: HASH }),
      ).rejects.toBeInstanceOf(ContractRevertedError)
    })

    it('attaches hash and full receipt to ContractRevertedError', async () => {
      try {
        await awaitReceiptWithHooks({ publicClient: okClient('reverted'), hash: HASH })
        expect.fail('expected throw')
      } catch (err) {
        expect(err).toBeInstanceOf(ContractRevertedError)
        const e = err as ContractRevertedError
        expect(e.hash).toBe(HASH)
        expect(e.receipt.status).toBe('reverted')
      }
    })

    it('fires onFailed with the ContractRevertedError', async () => {
      const onFailed = vi.fn()
      await expect(
        awaitReceiptWithHooks({
          publicClient: okClient('reverted'),
          hash: HASH,
          hooks: { onFailed },
        }),
      ).rejects.toThrow()
      expect(onFailed).toHaveBeenCalledOnce()
      const [arg] = onFailed.mock.calls[0]!
      expect(arg).toBeInstanceOf(ContractRevertedError)
    })

    it("fires onPhase with phase='failed' on revert, including hash + receipt + error", async () => {
      const onPhase = vi.fn()
      await expect(
        awaitReceiptWithHooks({
          publicClient: okClient('reverted'),
          hash: HASH,
          hooks: { onPhase },
        }),
      ).rejects.toThrow()
      expect(onPhase).toHaveBeenCalledOnce()
      const [event] = onPhase.mock.calls[0]!
      expect(event).toMatchObject({ phase: 'failed', hash: HASH })
      const failedEvent = event as { phase: 'failed'; error: Error; receipt: TransactionReceipt }
      expect(failedEvent.error).toBeInstanceOf(ContractRevertedError)
      expect(failedEvent.receipt.status).toBe('reverted')
    })

    it('does NOT fire onConfirmed on revert', async () => {
      const onConfirmed = vi.fn()
      await expect(
        awaitReceiptWithHooks({
          publicClient: okClient('reverted'),
          hash: HASH,
          hooks: { onConfirmed },
        }),
      ).rejects.toThrow()
      expect(onConfirmed).not.toHaveBeenCalled()
    })
  })

  describe('on receipt-await error (network / timeout)', () => {
    it('fires onFailed with the original error and rethrows it unchanged', async () => {
      const original = new Error('RPC timeout')
      const onFailed = vi.fn()
      const publicClient: ReceiptAwaiter = {
        waitForTransactionReceipt: vi.fn(async () => { throw original }),
      }
      await expect(
        awaitReceiptWithHooks({ publicClient, hash: HASH, hooks: { onFailed } }),
      ).rejects.toBe(original)
      expect(onFailed).toHaveBeenCalledExactlyOnceWith(original)
    })

    it('coerces a thrown non-Error into an Error before firing onFailed', async () => {
      const onFailed = vi.fn()
      const publicClient: ReceiptAwaiter = {
        waitForTransactionReceipt: vi.fn(async () => { throw 'something broke' }),
      }
      try {
        await awaitReceiptWithHooks({ publicClient, hash: HASH, hooks: { onFailed } })
        expect.fail('expected throw')
      } catch (err) {
        expect(err).toBeInstanceOf(Error)
        expect((err as Error).message).toBe('something broke')
      }
      expect(onFailed).toHaveBeenCalledOnce()
      const [arg] = onFailed.mock.calls[0]!
      expect(arg).toBeInstanceOf(Error)
    })
  })

  describe('with no hooks', () => {
    it('resolves on success without throwing', async () => {
      const receipt = await awaitReceiptWithHooks({
        publicClient: okClient('success'),
        hash: HASH,
      })
      expect(receipt.status).toBe('success')
    })

    it('still throws ContractRevertedError on revert', async () => {
      await expect(
        awaitReceiptWithHooks({ publicClient: okClient('reverted'), hash: HASH }),
      ).rejects.toBeInstanceOf(ContractRevertedError)
    })
  })
})

describe('ContractRevertedError', () => {
  it('is an Error subclass with stable name', () => {
    const e = new ContractRevertedError(HASH, buildReceipt('reverted'))
    expect(e).toBeInstanceOf(Error)
    expect(e).toBeInstanceOf(ContractRevertedError)
    expect(e.name).toBe('ContractRevertedError')
  })

  it('exposes hash and receipt as readonly fields', () => {
    const receipt = buildReceipt('reverted')
    const e = new ContractRevertedError(HASH, receipt)
    expect(e.hash).toBe(HASH)
    expect(e.receipt).toBe(receipt)
  })

  it('has a sensible default message', () => {
    expect(new ContractRevertedError(HASH, buildReceipt('reverted')).message.length)
      .toBeGreaterThan(0)
  })
})
