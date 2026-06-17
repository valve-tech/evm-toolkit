/** Signed-out state: centered card prompting wallet sign-in. */
interface Props {
  busy: boolean
  error: string | null
  onSignIn: () => void
}

export function SignInCard({ busy, error, onSignIn }: Props) {
  return (
    <div className="card signin">
      <h1 className="vault-title">🔒 Encrypted Vault</h1>
      <p className="lede">Sign in with your wallet to unlock your notes.</p>
      <button className="primary" disabled={busy} onClick={onSignIn}>
        {busy ? 'Check your wallet…' : 'Connect & sign in'}
      </button>
      {error && <p className="error">{error}</p>}
    </div>
  )
}
