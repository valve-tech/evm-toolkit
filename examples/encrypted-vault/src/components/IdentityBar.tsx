import type { Address } from 'viem'

interface Props {
  address: Address
  onSignOut: () => void
}

const short = (a: Address): string => `${a.slice(0, 6)}…${a.slice(-4)}`

export function IdentityBar({ address, onSignOut }: Props) {
  return (
    <div className="identity-bar">
      <span className="addr" title={address}>{short(address)}</span>
      <span className="session-badge">session active</span>
      <button className="ghost" onClick={onSignOut}>Sign out</button>
    </div>
  )
}
