/**
 * @fileoverview Plaintext template for the key-derivation signing prompt.
 *
 * The exact bytes the wallet shows the user when deriving an encryption
 * key. This must be a fixed, versioned format so:
 *
 * 1. The same `purpose` + `version` always produces the same plaintext
 *    → same signature → same derived key, across devices.
 * 2. A different `purpose` or `version` produces different plaintext
 *    → different signature → different key (cross-purpose isolation).
 * 3. The wallet's signing UI clearly tells the user this is a
 *    KEY-DERIVATION signature, not a transaction or transfer
 *    authorization.
 *
 * The trailing "does NOT authorize" line is non-negotiable per the
 * consumer contract — wallets display the raw text on signing and
 * users must see that assurance before clicking confirm.
 */

/**
 * Format the plaintext message a wallet will sign for key derivation.
 *
 * Returns the EXACT bytes that will become input to the wallet's
 * `personal_sign`. Same `purpose` + `version` → same plaintext, byte-
 * for-byte, forever. This determinism is the load-bearing property:
 * the derived encryption key is reproducible only because this
 * function is pure.
 *
 * Header is "Wallet key derivation" (library-fixed, not app-specific —
 * consumers put their app identifier in the `purpose` field, which is
 * what the wallet UI will display under "Purpose").
 *
 * @param opts.purpose - App-specific purpose identifier. Becomes part
 *   of the cryptographic domain — different purpose → different key.
 *   Convention: kebab-case, app-namespaced (e.g. `explore-workspaces`).
 * @param opts.version - Schema version. Bump to rotate the key without
 *   touching `purpose`. Different version → different key.
 */
export function formatKeyDerivationMessage(opts: {
  purpose: string
  version: number
}): string {
  return [
    'Wallet key derivation',
    `Purpose: ${opts.purpose}`,
    `Version: ${opts.version}`,
    '',
    'This signature derives an encryption key. It does NOT authorize any transaction or transfer.',
  ].join('\n')
}
