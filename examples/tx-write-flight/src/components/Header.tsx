import type { Hex } from 'viem'

import { shortAddr } from '../lib/format'

export interface HeaderProps {
  account: Hex | null
  chainLabel: string | null
  symbol: string
  blockNumber: bigint | null
  onConnect: () => void
  onDisconnect: () => void
}

export const Header = ({
  account,
  chainLabel,
  symbol,
  blockNumber,
  onConnect,
  onDisconnect,
}: HeaderProps): JSX.Element => (
  <header className="app-header">
    <div className="app-header__brand">tx-write-flight</div>
    <div className="app-header__chain">
      {chainLabel ? (
        <>
          <span className="chain-name">{chainLabel}</span>
          <span className="chain-symbol">{symbol}</span>
          <span className="chain-block">
            {blockNumber !== null ? `#${blockNumber.toString()}` : '—'}
          </span>
        </>
      ) : (
        <span className="chain-name">not connected</span>
      )}
    </div>
    <div className="app-header__wallet">
      {account ? (
        <>
          <span className="wallet-addr">{shortAddr(account)}</span>
          <button type="button" onClick={onDisconnect}>Disconnect</button>
        </>
      ) : (
        <button type="button" className="primary" onClick={onConnect}>Connect wallet</button>
      )}
    </div>
  </header>
)
