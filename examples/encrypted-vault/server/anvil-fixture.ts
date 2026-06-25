/**
 * Minimal anvil fixture for the encrypted-vault integration test.
 *
 * Spawns a local anvil via child_process, polls its RPC until ready,
 * and tears it down on exit. Node-only (anvil is a native binary).
 * Requires foundry (`anvil`) on PATH — CI installs it via the
 * foundry-toolchain action; locally: `curl -L https://foundry.paradigm.xyz | bash && foundryup`.
 *
 * Anvil's deterministic account 0 (10_000 ETH, known key) is the only
 * account this test needs.
 */
import { spawn, type ChildProcess } from 'node:child_process'

/** Anvil's default deterministic account 0. */
export const ANVIL_ACCOUNT_0 = {
  address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
  privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
} as const

/** Anvil's default deterministic account 1 (a non-owner signer). */
export const ANVIL_ACCOUNT_1 = {
  address: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
  privateKey: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
} as const

/** Anvil's default chain id. */
export const ANVIL_CHAIN_ID = 31337

export interface AnvilFixture {
  url: string
  start: () => Promise<void>
  stop: () => Promise<void>
}

export const createAnvilFixture = (port = 8749): AnvilFixture => {
  const url = `http://127.0.0.1:${port}`
  let proc: ChildProcess | null = null

  const waitForReady = async (deadlineMs: number): Promise<void> => {
    const start = Date.now()
    while (Date.now() - start < deadlineMs) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
        })
        if (res.ok) {
          const json = (await res.json()) as { result?: string }
          if (typeof json.result === 'string') return
        }
      } catch {
        // not listening yet — keep polling
      }
      await new Promise((r) => setTimeout(r, 100))
    }
    throw new Error(`anvil did not respond on ${url} within ${deadlineMs}ms`)
  }

  return {
    url,
    start: async () => {
      if (proc !== null) return
      proc = spawn('anvil', ['--port', String(port), '--silent'], { stdio: 'ignore' })
      proc.on('error', (err) => console.error(`anvil spawn failed: ${err.message}`))
      await waitForReady(10_000)
    },
    stop: async () => {
      if (proc === null) return
      const exited = new Promise<void>((resolve) => proc?.once('exit', () => resolve()))
      proc.kill('SIGTERM')
      await Promise.race([exited, new Promise((r) => setTimeout(r, 2_000))])
      proc = null
    },
  }
}
