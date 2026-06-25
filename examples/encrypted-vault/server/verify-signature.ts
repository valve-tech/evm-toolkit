/**
 * SIWE signature verification — the EOA + smart-account hybrid, factored
 * out of the HTTP server so it is unit/integration-testable against a
 * real chain without standing up the whole server.
 *
 * The decision: try an offline ECDSA recover first (EOAs — no RPC), and
 * only if that doesn't match the claimed address fall through to a
 * contract-account check (EIP-1271 / EIP-6492). The contract check is
 * injected so this module has no hard RPC dependency; the server wires
 * a viem `PublicClient.verifyMessage` in, and tests can point that at
 * anvil (or stub it).
 */
import { recoverMessageAddress, isAddressEqual, type Address, type Hex } from 'viem'

/** Returns true iff `signature` is a valid signature of `message` by `address`. */
export type SignatureVerifier = (args: {
  address: Address
  message: string
  signature: Hex
}) => Promise<boolean>

/**
 * Build a verifier that accepts both EOA and smart-account signatures.
 *
 * @param verifyContractSignature - The EIP-1271/6492 fallback, invoked
 *   only when the offline ECDSA recover does not match `address`. In
 *   production this is `(args) => publicClient.verifyMessage(args)`;
 *   viem's `verifyMessage` handles deployed (1271) and counterfactual
 *   (6492) accounts. Injected so this module needs no RPC of its own.
 */
export function createHybridSignatureVerifier(
  verifyContractSignature: SignatureVerifier,
): SignatureVerifier {
  return async ({ address, message, signature }) => {
    try {
      const recovered = await recoverMessageAddress({ message, signature })
      if (isAddressEqual(recovered, address)) return true
    } catch {
      // Not a plain EOA signature (e.g. an ERC-6492-wrapped blob) —
      // fall through to the contract-account check.
    }
    return verifyContractSignature({ address, message, signature })
  }
}
