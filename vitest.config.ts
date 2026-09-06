import path from 'node:path'
import { defineConfig } from 'vitest/config'

// Standalone rather than merged with vite.config.ts: the PWA plugin has no
// business running under the unit tests, and these are pure-TS tests.
export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
})
