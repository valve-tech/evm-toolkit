/**
 * Anvil-backed integration tests for the encrypted-vault server.
 *
 * Picks up only `*.integration.test.ts`. These spawn anvil via the
 * fixture, deploy a real ERC-1271 verifier contract, and exercise the
 * full SIWE verify path (including the smart-account branch) against a
 * real chain. Kept out of the default `yarn test` (vitest.config.ts
 * excludes them) because of the anvil startup cost + the foundry dep.
 *
 * Requires foundry (`anvil`) on PATH. Run via `yarn test:integration`.
 */
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['server/**/*.integration.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
})
