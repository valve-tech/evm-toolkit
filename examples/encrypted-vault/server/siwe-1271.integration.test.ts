/**
 * Real-chain integration test for the SIWE smart-account (EIP-1271)
 * verify path.
 *
 * Boots anvil, deploys a minimal ERC-1271 verifier contract whose
 * `isValidSignature` does a real ECDSA recover against a stored owner,
 * then runs the FULL `authenticateSiwe` flow with the REAL hybrid
 * verifier (offline-EOA → viem `verifyMessage` for contracts) pointed
 * at anvil. Proves end-to-end that:
 *   - a SIWE message whose `address` is the contract, signed by the
 *     contract's owner EOA, authenticates via the 1271 on-chain check;
 *   - a signature by a non-owner is rejected;
 *   - the EOA fast-path still authenticates a plain EOA login.
 *
 * The contract bytecode below is compiled from
 * `Erc1271Owner.sol` (Solc 0.8.25) — source kept in the test's git
 * history / the skill that generated it:
 *
 *   contract Erc1271Owner {
 *     address public owner;
 *     constructor(address _owner) { owner = _owner; }
 *     function isValidSignature(bytes32 hash, bytes calldata signature)
 *       external view returns (bytes4) {
 *         // 65-byte sig → ecrecover → return 0x1626ba7e iff signer == owner
 *     }
 *   }
 *
 * Node-only (anvil is a native subprocess). Run via `yarn test:integration`.
 */
import { afterAll, beforeAll, expect, test } from 'vitest'
import {
  createPublicClient,
  createWalletClient,
  http,
  getAddress,
  type Address,
  type Hex,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { createSiweMessage } from 'viem/siwe'
import {
  createAnvilFixture,
  ANVIL_ACCOUNT_0,
  ANVIL_ACCOUNT_1,
  ANVIL_CHAIN_ID,
} from './anvil-fixture.js'
import { authenticateSiwe, type SiweConfig } from './siwe-auth.js'
import { createHybridSignatureVerifier } from './verify-signature.js'

/** Creation bytecode of Erc1271Owner (constructor takes the owner address). */
const ERC1271_BYTECODE =
  '0x608060405234801561000f575f80fd5b50604051610531380380610531833981810160405281019061003191906100d4565b805f806101000a81548173ffffffffffffffffffffffffffffffffffffffff021916908373ffffffffffffffffffffffffffffffffffffffff160217905550506100ff565b5f80fd5b5f73ffffffffffffffffffffffffffffffffffffffff82169050919050565b5f6100a38261007a565b9050919050565b6100b381610099565b81146100bd575f80fd5b50565b5f815190506100ce816100aa565b92915050565b5f602082840312156100e9576100e8610076565b5b5f6100f6848285016100c0565b91505092915050565b6104258061010c5f395ff3fe608060405234801561000f575f80fd5b5060043610610034575f3560e01c80631626ba7e146100385780638da5cb5b14610068575b5f80fd5b610052600480360381019061004d919061027a565b610086565b60405161005f9190610311565b60405180910390f35b6100706101bb565b60405161007d9190610369565b60405180910390f35b5f604183839050146100a15763ffffffff60e01b90506101b4565b5f805f853592506020860135915060408601355f1a90505f6001888386866040515f81526020016040526040516100db94939291906103ac565b6020604051602081039080840390855afa1580156100fb573d5f803e3d5ffd5b5050506020604051035190505f73ffffffffffffffffffffffffffffffffffffffff168173ffffffffffffffffffffffffffffffffffffffff161415801561018d57505f8054906101000a900473ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff168173ffffffffffffffffffffffffffffffffffffffff16145b156101a557631626ba7e60e01b9450505050506101b4565b63ffffffff60e01b9450505050505b9392505050565b5f8054906101000a900473ffffffffffffffffffffffffffffffffffffffff1681565b5f80fd5b5f80fd5b5f819050919050565b6101f8816101e6565b8114610202575f80fd5b50565b5f81359050610213816101ef565b92915050565b5f80fd5b5f80fd5b5f80fd5b5f8083601f84011261023a57610239610219565b5b8235905067ffffffffffffffff8111156102575761025661021d565b5b60208301915083600182028301111561027357610272610221565b5b9250929050565b5f805f60408486031215610291576102906101de565b5b5f61029e86828701610205565b935050602084013567ffffffffffffffff8111156102bf576102be6101e2565b5b6102cb86828701610225565b92509250509250925092565b5f7fffffffff0000000000000000000000000000000000000000000000000000000082169050919050565b61030b816102d7565b82525050565b5f6020820190506103245f830184610302565b92915050565b5f73ffffffffffffffffffffffffffffffffffffffff82169050919050565b5f6103538261032a565b9050919050565b61036381610349565b82525050565b5f60208201905061037c5f83018461035a565b92915050565b61038b816101e6565b82525050565b5f60ff82169050919050565b6103a681610391565b82525050565b5f6080820190506103bf5f830187610382565b6103cc602083018661039d565b6103d96040830185610382565b6103e66060830184610382565b9594505050505056fea2646970667358221220cb9390073f6d8acda05390a35873cd4cbc05765536c0f2782b98c020e1c3a7b264736f6c63430008190033' as Hex

const CONFIG: SiweConfig = {
  domain: 'localhost',
  uri: 'http://localhost',
  chainId: ANVIL_CHAIN_ID,
  version: '1',
}

const anvil = createAnvilFixture(8749)
let contractAddress: Address

const owner = privateKeyToAccount(ANVIL_ACCOUNT_0.privateKey)
const nonOwner = privateKeyToAccount(ANVIL_ACCOUNT_1.privateKey)

// The real hybrid verifier, pointed at anvil — exactly what server.ts wires.
let verifySignature: ReturnType<typeof createHybridSignatureVerifier>

beforeAll(async () => {
  await anvil.start()
  const publicClient = createPublicClient({ transport: http(anvil.url) })
  const wallet = createWalletClient({ account: owner, transport: http(anvil.url) })

  // Deploy Erc1271Owner(owner = account0).
  const hash = await wallet.deployContract({
    abi: [{ type: 'constructor', inputs: [{ name: '_owner', type: 'address' }], stateMutability: 'nonpayable' }],
    bytecode: ERC1271_BYTECODE,
    args: [owner.address],
    chain: null,
  })
  const receipt = await publicClient.waitForTransactionReceipt({ hash })
  if (!receipt.contractAddress) throw new Error('contract not deployed')
  contractAddress = getAddress(receipt.contractAddress)

  verifySignature = createHybridSignatureVerifier((args) => publicClient.verifyMessage(args))
}, 30_000)

afterAll(async () => {
  await anvil.stop()
})

/** Build a SIWE message for `address` with a fixed nonce + far-future expiry. */
function buildMessage(address: Address): string {
  return createSiweMessage({
    address,
    domain: CONFIG.domain,
    uri: CONFIG.uri,
    version: '1',
    chainId: CONFIG.chainId,
    nonce: 'deadbeef01',
    issuedAt: new Date('2020-01-01T00:00:00Z'),
    expirationTime: new Date('2999-01-01T00:00:00Z'),
  })
}

test('authenticates an EIP-1271 smart account when its owner signs the SIWE message', async () => {
  const message = buildMessage(contractAddress)
  const signature = await owner.signMessage({ message }) as Hex
  const result = await authenticateSiwe({
    message,
    signature,
    config: CONFIG,
    consumeNonce: () => true,
    verifySignature,
  })
  expect(result).toBe(contractAddress)
})

test('rejects an EIP-1271 login signed by a non-owner', async () => {
  const message = buildMessage(contractAddress)
  const signature = await nonOwner.signMessage({ message }) as Hex
  const result = await authenticateSiwe({
    message,
    signature,
    config: CONFIG,
    consumeNonce: () => true,
    verifySignature,
  })
  expect(result).toBeNull()
})

test('the EOA fast-path still authenticates a plain EOA login (no contract call)', async () => {
  const message = buildMessage(getAddress(owner.address))
  const signature = await owner.signMessage({ message }) as Hex
  const result = await authenticateSiwe({
    message,
    signature,
    config: CONFIG,
    consumeNonce: () => true,
    verifySignature,
  })
  expect(result).toBe(getAddress(owner.address))
})
