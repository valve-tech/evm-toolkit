import type { Capabilities } from '@valve-tech/chain-source'
import type { GasOracleState } from '@valve-tech/gas-oracle'
import type { PanelState } from '../lib/capabilities'
import { trendArrow } from '../lib/format'

interface Props {
  caps: Capabilities | null
  panel: PanelState
  state: GasOracleState
}

export const CapabilityPanel = ({ caps, panel, state }: Props): JSX.Element => (
  <div className="panel">
    <h3>Capabilities &amp; reducer inputs</h3>
    <h4 className="muted">chain-source probe</h4>
    {caps ? (
      <ul>
        <li>newHeads: {caps.newHeads}</li>
        <li>newPendingTransactions: {caps.newPendingTransactions}</li>
        <li>txpoolContent: {caps.txpoolContent}</li>
        <li>receiptByHash: {caps.receiptByHash}</li>
        <li>transport: {panel.transport}</li>
      </ul>
    ) : (
      <p className="muted">probing…</p>
    )}
    <h4 className="muted">tiers = f(inputs)</h4>
    <ul>
      <li>base-fee trend: {trendArrow(state.baseFeeTrend)} {state.baseFeeTrend}</li>
      <li>block-included tips: {state.ring.reduce((n, b) => n + b.tips.length, 0)} samples in ring</li>
      <li>pending tips: {state.mempoolSamples.length} mempool samples</li>
      <li>pending gas demand: {state.mempool.pendingGasDemand.toString()}</li>
    </ul>
  </div>
)
