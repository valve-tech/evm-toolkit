/**
 * Default test config for the encrypted-vault example.
 *
 * The unit suite (`yarn test`) deliberately EXCLUDES
 * `*.integration.test.ts` — those need anvil + foundry and run only via
 * `yarn test:integration` (see vitest.integration.config.ts). Without
 * this exclusion the zero-config glob would pick them up and try to
 * spawn anvil during the normal/CI test run.
 */
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    exclude: ['**/node_modules/**', '**/dist/**', '**/dist-server/**', '**/*.integration.test.ts'],
  },
})
