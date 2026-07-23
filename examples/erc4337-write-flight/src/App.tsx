/**
 * Top-level app for the ERC-4337 write flight:
 *
 *   demo owner key → Coinbase Smart Account (counterfactual address)
 *   gas-oracle tier → UserOp fee pair
 *   bundler RPC (+ optional paymaster) → sendUserOperation
 *   inclusion tx hash → tx-flight-react strip via addByHash
 *
 * The account deploys itself on its first bundled op (initCode) — the
 * "deployed" flag in the account panel flips after the first send.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Hex } from 'viem'
import type { SmartAccount } from 'viem/account-abstraction'
import type { GasOracleState, TierName } from '@valve-tech/gas-oracle'
import { TIER_LADDER } from '@valve-tech/gas-oracle'
import { TxFlightProvider, TxFlightList, useTxFlight } from '@valve-tech/tx-flight-react'
import { localStorageAdapter } from '@valve-tech/tx-flight-react/storage'

import { CHAINS, type AaChainConfig } from './config'
import {
  buildClient,
  buildSmartAccount,
  clientFactory,
  readAccountStatus,
  registerClient,
  sendDemoOp,
  type SmartAccountStatus,
} from './lib/aa'
import { createGasFeed } from './lib/source'
import {
  createOwnerKey,
  forgetOwnerKey,
  importOwnerKey,
  loadOwnerKey,
  toOwnerAccount,
} from './lib/owner'
import { UserOpPhase, feesFromTier } from './lib/userop'
import { formatGwei, formatWei } from './lib/format'
import { Banner } from './components/Banner'
import { KeyPanel } from './components/KeyPanel'
import { PhaseTimeline } from './components/PhaseTimeline'

interface OpResultView {
  userOpHash: Hex
  transactionHash: Hex
  blockNumber: bigint
  success: boolean
}

const Flight = (): JSX.Element => {
  const flight = useTxFlight()

  const [chain, setChain] = useState<AaChainConfig>(CHAINS[0])
  const [bundlerUrl, setBundlerUrl] = useState(CHAINS[0].bundlerUrl)
  const [paymasterUrl, setPaymasterUrl] = useState('')
  const [ownerKey, setOwnerKey] = useState<Hex | null>(() => loadOwnerKey())
  const [account, setAccount] = useState<SmartAccount | null>(null)
  const [status, setStatus] = useState<SmartAccountStatus | null>(null)
  const [oracle, setOracle] = useState<GasOracleState | null>(null)
  const [tier, setTier] = useState<TierName>('standard')
  const [phase, setPhase] = useState<UserOpPhase>(UserOpPhase.idle)
  const [result, setResult] = useState<OpResultView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)

  const client = useMemo(() => {
    const c = buildClient(chain)
    registerClient(chain.chainId, c)
    return c
  }, [chain])

  const ownerAddress = useMemo(
    () => (ownerKey ? toOwnerAccount(ownerKey).address : null),
    [ownerKey],
  )

  // Gas feed for the selected chain — prices the UserOp per tier.
  useEffect(() => {
    setOracle(null)
    const feed = createGasFeed(client, chain.chainId, setOracle, (e) =>
      setError(e.message),
    )
    return () => feed.dispose()
  }, [client, chain.chainId])

  // Derive the smart account whenever the key or chain changes.
  const statusEpoch = useRef(0)
  const refreshStatus = useCallback(
    async (acct: SmartAccount): Promise<void> => {
      const epoch = ++statusEpoch.current
      const s = await readAccountStatus(client, acct)
      if (statusEpoch.current === epoch) setStatus(s)
    },
    [client],
  )

  useEffect(() => {
    setAccount(null)
    setStatus(null)
    setResult(null)
    setPhase(UserOpPhase.idle)
    if (!ownerKey) return
    let cancelled = false
    void buildSmartAccount(client, toOwnerAccount(ownerKey))
      .then(async (acct) => {
        if (cancelled) return
        setAccount(acct)
        await refreshStatus(acct)
      })
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : String(e)),
      )
    return () => {
      cancelled = true
    }
  }, [client, ownerKey, refreshStatus])

  const send = async (): Promise<void> => {
    if (!account || !bundlerUrl.trim()) return
    setSending(true)
    setError(null)
    setResult(null)
    try {
      const outcome = await sendDemoOp({
        client,
        account,
        bundlerUrl: bundlerUrl.trim(),
        paymasterUrl: paymasterUrl.trim() || undefined,
        fees: feesFromTier(oracle, tier),
        onPhase: setPhase,
      })
      setResult(outcome)
      // Hand the inclusion tx to the flight strip — read-only: the
      // bundler holds the nonce slot for the envelope tx, not us.
      await flight.addByHash({
        hash: outcome.transactionHash,
        chainId: chain.chainId,
        client,
        readOnly: true,
        withReceipts: true,
      })
      await refreshStatus(account)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSending(false)
    }
  }

  const fees = feesFromTier(oracle, tier)

  return (
    <>
      <header>
        <strong>⚙ erc-4337 write flight</strong>
        <select
          value={chain.chainId}
          onChange={(e) => {
            const next = CHAINS.find(
              (c) => c.chainId === Number(e.target.value),
            )
            if (next) {
              setChain(next)
              setBundlerUrl(next.bundlerUrl)
            }
          }}
        >
          {CHAINS.map((c) => (
            <option key={c.chainId} value={c.chainId}>
              {c.label} ({c.chainId})
            </option>
          ))}
        </select>
        <span className="muted">
          {oracle ? `block ${oracle.blockNumber.toString()}` : 'connecting…'}
        </span>
      </header>

      {error && <Banner message={error} />}

      <section className="cards-grid">
        <KeyPanel
          ownerKey={ownerKey}
          ownerAddress={ownerAddress}
          onGenerate={() => setOwnerKey(createOwnerKey())}
          onImport={(raw) => {
            const imported = importOwnerKey(raw)
            if (imported) setOwnerKey(imported)
            return imported !== null
          }}
          onForget={() => {
            forgetOwnerKey()
            setOwnerKey(null)
          }}
        />

        <div className="panel">
          <h3>Smart account</h3>
          {!ownerKey ? (
            <p className="muted">generate or import a demo key first.</p>
          ) : !status ? (
            <p className="muted">deriving counterfactual address…</p>
          ) : (
            <>
              <p>
                address: <code>{status.address}</code>
              </p>
              <p>
                {status.deployed ? (
                  <span className="ok">deployed</span>
                ) : (
                  <span className="muted">
                    counterfactual — deploys with the first op
                  </span>
                )}{' '}
                · balance {formatWei(status.balanceWei)} wei
              </p>
              {status.balanceWei === 0n && !paymasterUrl && (
                <p className="warn">
                  fund this address (or set a paymaster) before sending —
                  someone must pay the op's gas.
                </p>
              )}
            </>
          )}
        </div>

        <div className="panel">
          <h3>Bundler & paymaster</h3>
          <div className="stack">
            <label>
              bundler RPC
              <input
                value={bundlerUrl}
                onChange={(e) => setBundlerUrl(e.target.value)}
                placeholder="https://… (required)"
              />
            </label>
            <label>
              paymaster RPC{' '}
              <span className="muted">(optional, ERC-7677)</span>
              <input
                value={paymasterUrl}
                onChange={(e) => setPaymasterUrl(e.target.value)}
                placeholder="leave empty to pay from the account"
              />
            </label>
          </div>
        </div>

        <div className="panel">
          <h3>Send a demo op</h3>
          <div className="rule-editor">
            <select
              value={tier}
              onChange={(e) => setTier(e.target.value as TierName)}
            >
              {TIER_LADDER.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <span className="muted">
              {fees
                ? `${formatGwei(fees.maxPriorityFeePerGas)} gwei tip / ${formatGwei(fees.maxFeePerGas)} max`
                : 'no oracle state — bundler will estimate'}
            </span>
            <button
              onClick={() => void send()}
              disabled={sending || !account || !bundlerUrl.trim()}
            >
              {sending ? 'sending…' : 'send self-call UserOp'}
            </button>
          </div>

          <PhaseTimeline phase={phase} />

          {result && (
            <div className="result">
              <p>
                userOp <code>{result.userOpHash.slice(0, 18)}…</code>{' '}
                {result.success ? (
                  <span className="ok">succeeded</span>
                ) : (
                  <span className="warn">reverted</span>
                )}
              </p>
              <p>
                bundled in tx <code>{result.transactionHash.slice(0, 18)}…</code>{' '}
                at block {result.blockNumber.toString()}
                {chain.explorerUrl && (
                  <>
                    {' '}
                    <a
                      href={`${chain.explorerUrl}/tx/${result.transactionHash}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      explorer ↗
                    </a>
                  </>
                )}
              </p>
            </div>
          )}
        </div>
      </section>

      <section className="strip">
        <h3 className="muted">inclusion transactions (tx-flight strip)</h3>
        <TxFlightList
          empty={<p className="muted">no bundled ops yet</p>}
        />
      </section>
    </>
  )
}

export const App = (): JSX.Element => (
  <TxFlightProvider
    id="erc4337-write-flight"
    storage={localStorageAdapter()}
    clientFactory={clientFactory}
  >
    <Flight />
  </TxFlightProvider>
)
