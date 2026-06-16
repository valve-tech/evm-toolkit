/**
 * Top-level app. Owns: wallet connection, the per-chain shared stack
 * (ChainSource → gas-oracle + tx-tracker), the live block number, and the
 * send (Recipe 1) + replacement (speed-up / cancel) orchestration. Every
 * send/replace catch is routed through @valve-tech/viem-errors.
 *
 *   gas-oracle tier → buildTransactionRequest → addWithWalletAdapter (strip)
 *                   → sendTransactionWithHooks (injected wallet)
 *                   → tx-tracker observations advance the row
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Hex } from 'viem'
import {
  TxFlightProvider,
  useTxFlight,
  type TrackedTx,
} from '@valve-tech/tx-flight-react'
import { localStorageAdapter } from '@valve-tech/tx-flight-react/storage'
import {
  sendTransactionWithHooks,
  WalletRejectedError,
  ContractRevertedError,
} from '@valve-tech/wallet-adapter'
import {
  bumpForReplacement,
  recommendBumpTier,
  type TierName,
  type TierRecommendation,
} from '@valve-tech/gas-oracle'
import { replaceTransaction } from '@valve-tech/tx-tracker'
import {
  isUserRejectionError,
  extractContractErrorName,
  getUserFriendlyErrorMessage,
} from '@valve-tech/viem-errors'

import { Header } from './components/Header'
import { ComposePane } from './components/ComposePane'
import { FlightPane } from './components/FlightPane'
import {
  buildCancelRequest,
  buildTransactionRequest,
  type Action,
} from './lib/actions'
import { wethAddressFor, wethSupported } from './lib/weth'
import { resolveChain, type ChainDisplay } from './lib/chains'
import {
  connect as connectWallet,
  getChainId,
  getInjectedProvider,
  injectedWalletAdapter,
  injectedWalletClient,
  type Eip1193Provider,
} from './lib/wallet'
import {
  clientFactory,
  getChainStack,
  registerClient,
  type ChainStack,
} from './lib/source'

// Conservative static gas limits for the cost preview only (the wallet
// re-estimates at sign time).
const GAS_LIMIT_BY_KIND: Record<Action['kind'], bigint> = {
  send: 21_000n,
  wrap: 50_000n,
  unwrap: 50_000n,
}

interface Connection {
  provider: Eip1193Provider
  account: Hex
  display: ChainDisplay
  stack: ChainStack
}

/** Inner component — has access to useTxFlight (must be inside the Provider). */
const Flight = (): JSX.Element => {
  const flight = useTxFlight()
  const [conn, setConn] = useState<Connection | null>(null)
  const [tiers, setTiers] = useState<Record<TierName, TierRecommendation> | null>(null)
  const [blockNumber, setBlockNumber] = useState<bigint | null>(null)
  const [selectedTier, setSelectedTier] = useState<TierName>('standard')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [kind, setKind] = useState<Action['kind']>('send')
  // Remember each sent request by tx id, for replacement (speed-up / cancel).
  const sentRef = useRef<Map<string, { action: Action; nonce: number | null }>>(new Map())

  const connect = useCallback(async () => {
    const provider = getInjectedProvider()
    if (!provider) {
      setNotice('No injected EIP-1193 wallet found (install MetaMask / Rabby).')
      return
    }
    const account = await connectWallet(provider)
    const chainId = await getChainId(provider)
    const display = await resolveChain(chainId, '')
    const stack = getChainStack(provider, display.chain)
    registerClient(chainId, stack.client)
    setConn({ provider, account, display, stack })
  }, [])

  const disconnect = useCallback(() => {
    conn?.stack.stop()
    setConn(null)
    setTiers(null)
    setBlockNumber(null)
  }, [conn])

  // Poll oracle tiers + live block number while connected.
  useEffect(() => {
    if (!conn) return
    let alive = true
    const tick = (): void => {
      const state = conn.stack.oracle.getState()
      if (alive && state) setTiers(state.tiers)
    }
    const unsub = conn.stack.source.subscribeBlocks((block) => {
      if (alive) setBlockNumber(BigInt(block.number))
    })
    tick()
    const interval = setInterval(tick, 4_000)
    return () => {
      alive = false
      clearInterval(interval)
      unsub()
    }
  }, [conn])

  const send = useCallback(
    async (action: Action) => {
      if (!conn) return
      const { provider, account, display, stack } = conn
      const chainId = display.chain.id
      const rec = stack.oracle.getState()?.tiers[selectedTier]
      if (!rec) {
        setNotice('Gas tiers are still warming up — try again in a moment.')
        return
      }
      const request = buildTransactionRequest(action, {
        chainId,
        from: account,
        weth: wethAddressFor(chainId),
        gas: { maxFeePerGas: rec.maxFeePerGas, maxPriorityFeePerGas: rec.maxPriorityFeePerGas },
      })
      const wallet = injectedWalletAdapter(provider, account)
      const flow =
        action.kind === 'send' ? 'native-send' : action.kind === 'wrap' ? 'wrap' : 'unwrap'

      // The strip wraps the hooks: every phase fires BOTH a store update AND ours.
      const { id, hooks } = flight.addWithWalletAdapter({
        flow,
        chainId,
        request,
        hooks: {
          onTransactionHash: ({ hash }) => {
            // Record the nonce for replacement once we have a hash.
            void stack.client
              .getTransaction({ hash })
              .then((tx) =>
                sentRef.current.set(id, { action, nonce: Number(tx.nonce) }),
              )
              .catch(() => undefined)
          },
          onFailed: ({ error }) => {
            if (isUserRejectionError(error) || error instanceof WalletRejectedError) {
              // Quiet cancel — no scary banner; let the row self-dismiss.
              setNotice(null)
              return
            }
            const decoded =
              error instanceof ContractRevertedError
                ? extractContractErrorName(error)
                : extractContractErrorName(error)
            setNotice(
              `${decoded ? `failed · ${decoded} — ` : ''}${getUserFriendlyErrorMessage(error)}`,
            )
          },
        },
      })
      sentRef.current.set(id, { action, nonce: null })

      setBusy(true)
      setNotice(null)
      try {
        await sendTransactionWithHooks({ wallet, request, hooks })
      } catch (error) {
        // sendTransactionWithHooks re-throws after firing onFailed; classify quietly.
        if (!(isUserRejectionError(error) || error instanceof WalletRejectedError)) {
          setNotice(getUserFriendlyErrorMessage(error))
        }
      } finally {
        setBusy(false)
      }
    },
    [conn, flight, selectedTier],
  )

  const replace = useCallback(
    async (tx: TrackedTx, mode: 'speed-up' | 'cancel') => {
      if (!conn) return
      const { provider, account, display, stack } = conn
      const sent = sentRef.current.get(tx.id)
      const state = stack.oracle.getState()
      if (!sent || sent.nonce === null || !state) {
        setNotice('Cannot replace yet — waiting for the nonce / gas tiers.')
        return
      }
      const walletClient = injectedWalletClient(provider, account, display.chain)
      // What the tx is actually paying right now — captured at submit time on
      // the TrackedTx; fall back to the standard tier if the wallet didn't echo
      // its gas back.
      const current = {
        maxFeePerGas: tx.submittedGas?.maxFeePerGas ?? state.tiers.standard.maxFeePerGas,
        maxPriorityFeePerGas:
          tx.submittedGas?.maxPriorityFeePerGas ?? state.tiers.standard.maxPriorityFeePerGas,
      }
      const bumpTier =
        recommendBumpTier(state, { priorityTip: current.maxPriorityFeePerGas }) ?? 'instant'
      const target = state.tiers[bumpTier]
      const newGas = bumpForReplacement(current, target)

      // Rebuild the original call from the remembered action (the strip's
      // TrackedTx doesn't carry the raw request); a cancel is a 0-value
      // self-send on the same nonce.
      const original =
        mode === 'cancel'
          ? buildCancelRequest({ from: account, chainId: display.chain.id, nonce: sent.nonce })
          : (() => {
              const req = buildTransactionRequest(sent.action, {
                chainId: display.chain.id,
                from: account,
                weth: wethAddressFor(display.chain.id),
                gas: current,
              })
              return {
                to: req.to,
                data: req.data,
                value: req.value,
                nonce: sent.nonce,
                chainId: display.chain.id,
              }
            })()

      try {
        await replaceTransaction({ original, walletClient, newGas })
        setNotice(mode === 'cancel' ? 'Cancel submitted (same nonce).' : 'Speed-up submitted.')
      } catch (error) {
        if (isUserRejectionError(error) || error instanceof WalletRejectedError) {
          setNotice(null)
          return
        }
        setNotice(getUserFriendlyErrorMessage(error))
      }
    },
    [conn],
  )

  const tierProps = useMemo(() => tiers, [tiers])

  return (
    <>
      <Header
        account={conn?.account ?? null}
        chainLabel={conn?.display.label ?? null}
        symbol={conn?.display.symbol ?? ''}
        blockNumber={blockNumber}
        onConnect={() => void connect()}
        onDisconnect={disconnect}
      />
      {notice && <div className="notice" role="status">{notice}</div>}
      <main className="two-pane">
        <ComposePane
          connected={conn !== null}
          account={conn?.account ?? null}
          symbol={conn?.display.symbol ?? 'ETH'}
          wethSupported={conn ? wethSupported(conn.display.chain.id) : false}
          tiers={tierProps}
          selectedTier={selectedTier}
          gasLimit={GAS_LIMIT_BY_KIND[kind]}
          onSelectTier={setSelectedTier}
          onSend={(action) => {
            setKind(action.kind)
            void send(action)
          }}
          busy={busy}
        />
        <FlightPane
          explorerUrl={conn?.display.explorerUrl ?? null}
          onSpeedUp={(tx) => void replace(tx, 'speed-up')}
          onCancel={(tx) => void replace(tx, 'cancel')}
          onDismiss={(tx) => flight.remove(tx.id)}
        />
      </main>
    </>
  )
}

export const App = (): JSX.Element => (
  <TxFlightProvider
    id="tx-write-flight"
    storage={localStorageAdapter()}
    clientFactory={clientFactory}
  >
    <Flight />
  </TxFlightProvider>
)
