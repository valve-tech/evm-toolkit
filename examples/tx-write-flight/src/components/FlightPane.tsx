/**
 * Flight pane: the in-flight strip. TxFlightList renders one row per tx;
 * Speed up / Cancel are shown only while pending. The provider lives in
 * App.tsx (so the strip and the orchestration share one store).
 *
 * The installed @valve-tech/tx-flight-react atoms differ from the plan's
 * first-draft JSX: `<TxFlightItem render>` hands back the four pre-built
 * primitives `{ icon, hash, age, actions }`, `<TxFlightHashLink>` takes a
 * `tx` + an `explorer: (tx) => string` URL builder (not a raw string), and
 * `<TxFlightAge>` takes `submittedAt` (not `tx`). We compose the atoms by
 * hand here so the explorer link, the per-row flow/status labels, and the
 * pending-gated Speed up / Cancel wiring land the way this demo wants.
 */
import {
  TxFlightList,
  TxFlightItem,
  TxFlightStatusIcon,
  TxFlightHashLink,
  TxFlightAge,
  TxFlightActions,
  type TrackedTx,
} from '@valve-tech/tx-flight-react'

export interface FlightPaneProps {
  explorerUrl: string | null
  onSpeedUp: (tx: TrackedTx) => void
  onCancel: (tx: TrackedTx) => void
  onDismiss: (tx: TrackedTx) => void
}

export const FlightPane = ({
  explorerUrl,
  onSpeedUp,
  onCancel,
  onDismiss,
}: FlightPaneProps): JSX.Element => (
  <section className="pane pane--flight">
    <h2>In flight</h2>
    <TxFlightList
      className="flight-list"
      empty={<p className="flight-empty">No transactions yet. Compose one on the left.</p>}
      render={(tx) => {
        const pending = tx.status === 'pending' || tx.status === 'awaiting-signature'
        return (
          <TxFlightItem
            key={tx.id}
            tx={tx}
            className={`flight-row flight-row--${tx.status}`}
            render={() => (
              <>
                <TxFlightStatusIcon status={tx.status} />
                <span className="flight-row__flow">{tx.flow ?? 'tx'}</span>
                <span className="flight-row__status">{tx.status}</span>
                {tx.hash && explorerUrl ? (
                  <TxFlightHashLink
                    tx={tx}
                    explorer={(t) => `${explorerUrl}/tx/${t.hash ?? ''}`}
                    truncate="middle"
                  />
                ) : null}
                <TxFlightAge submittedAt={tx.submittedAt} />
                <TxFlightActions
                  tx={tx}
                  onSpeedUp={pending ? onSpeedUp : undefined}
                  onCancel={pending ? onCancel : undefined}
                  onDismiss={onDismiss}
                />
              </>
            )}
          />
        )
      }}
    />
  </section>
)
