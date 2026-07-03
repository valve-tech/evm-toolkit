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
  useReplaceTransaction,
  type TrackedTx,
} from '@valve-tech/tx-flight-react'
import { localStorageAdapter } from '@valve-tech/tx-flight-react/storage'
import {
  sendTransactionWithHooks,
  awaitReceiptWithHooks,
  WalletRejectedError,
} from '@valve-tech/wallet-adapter'
import {
  bumpForReplacement,
  recommendBumpTier,
  type TierName,
  type TierRecommendation,
} from '@valve-tech/gas-oracle'
import {
  isUserRejectionError,
  extractContractErrorName,
  getUserFriendlyErrorMessage,
} from '@valve-tech/viem-errors'

import { Header } from './components/Header'
import { ComposePane } from './components/ComposePane'
import { FlightPane } from './components/FlightPane'
import {
  buildTransactionRequest,
  type Action,
  type ResolvedGas,
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
  const { speedUp, cancel } = useReplaceTransaction()
  const [conn, setConn] = useState<Connection | null>(null)
  const [tiers, setTiers] = useState<Record<TierName, TierRecommendation> | null>(null)
  const [blockNumber, setBlockNumber] = useState<bigint | null>(null)
  const [selectedTier, setSelectedTier] = useState<TierName>('standard')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [kind, setKind] = useState<Action['kind']>('send')
  // Remember each sent request by tx id, for replacement (speed-up / cancel).
  const sentRef = useRef<
    Map<string, { action: Action; nonce: number | null; sentGas: ResolvedGas }>
  >(new Map())
  // Active tx-tracker watches keyed by tx id, so we can tear each down on
  // dismiss / unmount (the shared tracker outlives any single row).
  const watchRef = useRef<Map<string, () => void>>(new Map())

  // Build a fresh Connection for the wallet's CURRENT chain + account. Used by
  // the initial connect AND by the chainChanged / accountsChanged listeners, so
  // a mid-session network switch in the wallet rebuilds the stack rather than
  // leaving `conn` stale (which would throw chain-mismatch on the next send).
  const buildConnection = useCallback(
    async (provider: Eip1193Provider, account: Hex): Promise<Connection> => {
      const chainId = await getChainId(provider)
      const display = await resolveChain(chainId, '')
      const stack = getChainStack(provider, display.chain)
      registerClient(chainId, stack.client)
      return { provider, account, display, stack }
    },
    [],
  )

  const connect = useCallback(async () => {
    const provider = getInjectedProvider()
    if (!provider) {
      setNotice('No injected EIP-1193 wallet found (install MetaMask / Rabby).')
      return
    }
    const account = await connectWallet(provider)
    setConn(await buildConnection(provider, account))
  }, [buildConnection])

  const disconnect = useCallback(() => {
    conn?.stack.stop()
    setConn(null)
    setTiers(null)
    setBlockNumber(null)
  }, [conn])

  // Priority 3: follow the wallet's chain + account. Registered while connected;
  // a network switch re-resolves the chain and rebuilds `conn` (stopping the old
  // stack), and an empty `accountsChanged` array means the wallet disconnected.
  useEffect(() => {
    if (!conn) return
    const { provider } = conn
    if (!provider.on || !provider.removeListener) return

    const onChainChanged = (): void => {
      void (async () => {
        try {
          const next = await buildConnection(provider, conn.account)
          // Only stop the prior stack if the switch actually moved chains; a
          // same-chain re-emit reuses the cached stack (don't tear it down).
          if (next.stack !== conn.stack) conn.stack.stop()
          setConn(next)
          setTiers(null)
          setBlockNumber(null)
        } catch (error) {
          setNotice(getUserFriendlyErrorMessage(error))
        }
      })()
    }
    const onAccountsChanged = (...args: unknown[]): void => {
      const accounts = (args[0] as string[] | undefined) ?? []
      if (accounts.length === 0) {
        disconnect()
        return
      }
      setConn((prev) => (prev ? { ...prev, account: accounts[0] as Hex } : prev))
    }

    provider.on('chainChanged', onChainChanged)
    provider.on('accountsChanged', onAccountsChanged)
    return () => {
      provider.removeListener?.('chainChanged', onChainChanged)
      provider.removeListener?.('accountsChanged', onAccountsChanged)
    }
  }, [conn, buildConnection, disconnect])

  // Tear down any open tracker watches on unmount (the shared tracker in the
  // per-chain stack outlives this component).
  useEffect(() => {
    const watches = watchRef.current
    return () => {
      for (const unwatch of watches.values()) unwatch()
      watches.clear()
    }
  }, [])

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
      const sentGas = { maxFeePerGas: rec.maxFeePerGas, maxPriorityFeePerGas: rec.maxPriorityFeePerGas }
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
                sentRef.current.set(id, { action, nonce: Number(tx.nonce), sentGas }),
              )
              .catch(() => undefined)

            // Priority 2: bridge the SHARED tx-tracker into the strip. The
            // tracker emits neutral observations across blocks; we translate
            // the two it owns that awaitReceiptWithHooks can't — `replaced-by`
            // (speed-up / cancel surfaced a same-nonce tx) and the
            // drop heuristic `unseen-for-N-blocks` — into the wrapped
            // onReplaced / onDropped hooks so the row transitions.
            watchRef.current.get(id)?.()
            const unwatch = stack.tracker.subscribe(hash, (event) => {
              if (event.kind === 'replaced-by') {
                hooks.onReplaced?.({
                  chainId,
                  request,
                  original: hash,
                  replacement: event.replacementHash as Hex,
                })
              } else if (event.kind === 'unseen-for-N-blocks') {
                hooks.onDropped?.({ chainId, request, hash })
              }
            })
            watchRef.current.set(id, unwatch)
          },
          onFailed: ({ error }) => {
            if (isUserRejectionError(error) || error instanceof WalletRejectedError) {
              // Quiet cancel — no scary banner; let the row self-dismiss.
              setNotice(null)
              return
            }
            const decoded = extractContractErrorName(error)
            setNotice(
              `${decoded ? `failed · ${decoded} — ` : ''}${getUserFriendlyErrorMessage(error)}`,
            )
          },
        },
      })
      sentRef.current.set(id, { action, nonce: null, sentGas })

      setBusy(true)
      setNotice(null)
      try {
        const hash = await sendTransactionWithHooks({ wallet, request, hooks })
        // Broadcast done — clear busy and let the strip show progress.
        setBusy(false)
        // Priority 1: drive the row to a terminal state. sendTransactionWithHooks
        // only fires up to onTransactionHash; awaitReceiptWithHooks fires the
        // wrapped onConfirmed (success) / revert-onFailed (the viem-errors decode)
        // so the row reaches confirmed / failed · <ErrorName> in-session.
        await awaitReceiptWithHooks({ publicClient: stack.client, hash, request, hooks })
      } catch (error) {
        // send / receipt-await re-throw after firing onFailed; classify quietly.
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
      // What the tx is actually paying right now — the resolved tier captured in
      // sentRef at submit time (TrackedTx itself carries no request/gas).
      const current = sent.sentGas
      const bumpTier =
        recommendBumpTier(state, { priorityTip: current.maxPriorityFeePerGas }) ?? 'instant'
      const target = state.tiers[bumpTier]
      const newGas = bumpForReplacement(current, target)

      // The replacement runs through tx-flight-react's useReplaceTransaction
      // hook: it calls tx-tracker's replaceTransaction under the hood AND
      // flips this strip entry to `replaced` on success (addWithWalletAdapter
      // alone never fires onReplaced). `cancel` builds the 0-value self-send;
      // `speedUp` rebuilds the original call — the strip's TrackedTx doesn't
      // carry the raw request.
      try {
        if (mode === 'cancel') {
          await cancel({ tx, walletClient, nonce: sent.nonce, newGas })
          setNotice('Cancel submitted (same nonce).')
        } else {
          const req = buildTransactionRequest(sent.action, {
            chainId: display.chain.id,
            from: account,
            weth: wethAddressFor(display.chain.id),
            gas: current,
          })
          await speedUp({
            tx,
            walletClient,
            original: {
              to: req.to,
              data: req.data,
              value: req.value,
              nonce: sent.nonce,
              chainId: display.chain.id,
            },
            newGas,
          })
          setNotice('Speed-up submitted.')
        }
      } catch (error) {
        if (isUserRejectionError(error) || error instanceof WalletRejectedError) {
          setNotice(null)
          return
        }
        setNotice(getUserFriendlyErrorMessage(error))
      }
    },
    [conn, speedUp, cancel],
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
          onDismiss={(tx) => {
            watchRef.current.get(tx.id)?.()
            watchRef.current.delete(tx.id)
            flight.remove(tx.id)
          }}
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
