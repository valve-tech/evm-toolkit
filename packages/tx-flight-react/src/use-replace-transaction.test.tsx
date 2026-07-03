import { test, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import type { WalletClient } from 'viem'
import type { TrackedTx } from '@valve-tech/wallet-adapter'

import { TxFlightProvider, _resetRegistry } from './provider.js'
import { useTxFlight } from './use-tx-flight.js'
import { useReplaceTransaction } from './use-replace-transaction.js'

const ACCOUNT = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as const
const RECIPIENT = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as const
const NEW_HASH = '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc' as const

const NEW_GAS = { maxFeePerGas: 200n, maxPriorityFeePerGas: 20n }

const makeTx = (o: Partial<TrackedTx> = {}): TrackedTx => ({
  id: 'tx-1',
  chainId: 1,
  flow: 'send',
  submittedAt: 1_000_000,
  submittedTier: 'standard',
  status: 'pending',
  ...o,
})

// A minimal viem-WalletClient shape: replaceTransaction only touches
// `.account`, `.chain`, and `.sendTransaction`.
const makeWalletClient = (
  sendTransaction: (req: unknown) => Promise<unknown>,
  { withAccount = true }: { withAccount?: boolean } = {},
): WalletClient =>
  ({
    account: withAccount ? { address: ACCOUNT } : undefined,
    chain: { id: 1 },
    sendTransaction,
  }) as unknown as WalletClient

beforeEach(() => {
  _resetRegistry()
})

afterEach(() => {
  _resetRegistry()
  if (typeof globalThis.window !== 'undefined') {
    globalThis.window.localStorage.clear()
  }
})

const wrapper = (id?: string) => ({ children }: { children: React.ReactNode }) => (
  <TxFlightProvider id={id} storage={null}>
    {children}
  </TxFlightProvider>
)

const renderBoth = () =>
  renderHook(() => ({ flight: useTxFlight(), replace: useReplaceTransaction() }), {
    wrapper: wrapper(),
  })

test('throws if called outside any provider', () => {
  const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  expect(() => renderHook(() => useReplaceTransaction())).toThrow(
    /No <TxFlightProvider id="default"> found in tree/,
  )
  spy.mockRestore()
})

test('speedUp re-sends the original at bumped fees and flips the entry to replaced', async () => {
  const sendTransaction = vi.fn(async () => NEW_HASH)
  const walletClient = makeWalletClient(sendTransaction)
  const { result } = renderBoth()

  act(() => {
    result.current.flight.addManual({ tx: makeTx() })
  })

  let returned: string | undefined
  await act(async () => {
    returned = await result.current.replace.speedUp({
      tx: makeTx(),
      walletClient,
      original: { to: RECIPIENT, nonce: 42, data: '0xdead', value: 5n },
      newGas: NEW_GAS,
    })
  })

  expect(returned).toBe(NEW_HASH)
  // Same nonce + original call, bumped fees.
  expect(sendTransaction).toHaveBeenCalledWith(
    expect.objectContaining({
      to: RECIPIENT,
      nonce: 42,
      data: '0xdead',
      value: 5n,
      maxFeePerGas: 200n,
      maxPriorityFeePerGas: 20n,
    }),
  )
  const updated = result.current.flight.get('tx-1')
  expect(updated?.status).toBe('replaced')
  expect(updated?.replacedBy).toBe(NEW_HASH)
  expect(result.current.replace.isReplacing).toBe(false)
  expect(result.current.replace.error).toBeNull()
})

test('cancel replaces with a 0-value self-send at the same nonce', async () => {
  const sendTransaction = vi.fn(async () => NEW_HASH)
  const walletClient = makeWalletClient(sendTransaction)
  const { result } = renderBoth()

  act(() => {
    result.current.flight.addManual({ tx: makeTx() })
  })

  await act(async () => {
    await result.current.replace.cancel({
      tx: makeTx(),
      walletClient,
      nonce: 42,
      newGas: NEW_GAS,
    })
  })

  expect(sendTransaction).toHaveBeenCalledWith(
    expect.objectContaining({
      to: ACCOUNT,
      value: 0n,
      data: '0x',
      nonce: 42,
      maxFeePerGas: 200n,
      maxPriorityFeePerGas: 20n,
    }),
  )
  expect(result.current.flight.get('tx-1')?.status).toBe('replaced')
})

test('cancel can target an explicit recipient', async () => {
  const sendTransaction = vi.fn(async () => NEW_HASH)
  const walletClient = makeWalletClient(sendTransaction)
  const { result } = renderBoth()

  act(() => {
    result.current.flight.addManual({ tx: makeTx() })
  })

  await act(async () => {
    await result.current.replace.cancel({
      tx: makeTx(),
      walletClient,
      nonce: 7,
      newGas: NEW_GAS,
      to: RECIPIENT,
    })
  })

  expect(sendTransaction).toHaveBeenCalledWith(expect.objectContaining({ to: RECIPIENT, value: 0n }))
})

test('cancel rejects when the wallet has no account and no `to` is given', async () => {
  const sendTransaction = vi.fn(async () => NEW_HASH)
  const walletClient = makeWalletClient(sendTransaction, { withAccount: false })
  const { result } = renderBoth()

  act(() => {
    result.current.flight.addManual({ tx: makeTx() })
  })

  await act(async () => {
    await expect(
      result.current.replace.cancel({ tx: makeTx(), walletClient, nonce: 1, newGas: NEW_GAS }),
    ).rejects.toThrow(/must have an account/)
  })
  expect(sendTransaction).not.toHaveBeenCalled()
  // The strip entry is untouched.
  expect(result.current.flight.get('tx-1')?.status).toBe('pending')
})

test('a failed send surfaces error, stops replacing, and leaves the entry unchanged', async () => {
  const boom = new Error('wallet said no')
  const sendTransaction = vi.fn(async () => {
    throw boom
  })
  const walletClient = makeWalletClient(sendTransaction)
  const { result } = renderBoth()

  act(() => {
    result.current.flight.addManual({ tx: makeTx() })
  })

  await act(async () => {
    await expect(
      result.current.replace.speedUp({
        tx: makeTx(),
        walletClient,
        original: { to: RECIPIENT, nonce: 42 },
        newGas: NEW_GAS,
      }),
    ).rejects.toBe(boom)
  })

  expect(result.current.replace.error).toBe(boom)
  expect(result.current.replace.isReplacing).toBe(false)
  // Not marked replaced — the original is still pending.
  expect(result.current.flight.get('tx-1')?.status).toBe('pending')
})
