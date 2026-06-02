/**
 * @fileoverview Plaintext template for the auth-challenge signing prompt.
 *
 * The exact bytes the wallet shows the user when authenticating. Must
 * be byte-identical on client (signing) and server (verifying) — both
 * sides call `formatAuthMessage` so there's a single source of truth.
 *
 * Schema:
 *
 *   Sign in to {app}
 *   Nonce: {nonce}
 *
 *   This signature authenticates your session. It does NOT authorize
 *   any transaction or transfer.
 *
 * The trailing "does NOT authorize" line is non-negotiable per the
 * consumer contract — wallets display the raw text on signing and
 * users must see that assurance before clicking confirm.
 */

/**
 * The constant message template (without app/nonce substitution).
 * Exported so consumers can grep the template text from their
 * codebase or render a preview in their UI.
 */
export const AUTH_MESSAGE_TEMPLATE = [
  'Sign in to {app}',
  'Nonce: {nonce}',
  '',
  'This signature authenticates your session. It does NOT authorize any transaction or transfer.',
].join('\n')

/**
 * Format the plaintext message a wallet will sign for authentication.
 *
 * Same `app` + same `nonce` → byte-identical output, forever.
 * Different `app` or `nonce` → different output, which is why
 * cross-app and cross-session signature replay is prevented.
 *
 * @param opts.app - Human-readable app identifier shown in the
 *   wallet prompt's first line. Convention: capitalize for display
 *   (e.g. `"Explore"`, not `"explore"`).
 * @param opts.nonce - The server-issued nonce from
 *   {@link generateAuthNonce}. Opaque to this function (any string
 *   substitutes verbatim).
 */
export function formatAuthMessage(opts: {
  app: string
  nonce: string
}): string {
  return [
    `Sign in to ${opts.app}`,
    `Nonce: ${opts.nonce}`,
    '',
    'This signature authenticates your session. It does NOT authorize any transaction or transfer.',
  ].join('\n')
}
