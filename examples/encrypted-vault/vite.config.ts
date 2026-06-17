import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Client builds to dist/ (served by the Node server in prod). In dev,
// Vite serves the client and proxies the API to the local Node server.
const SERVER = 'http://localhost:8790'

export default defineConfig({
  plugins: [react()],
  base: './',
  build: { outDir: 'dist', target: 'es2020' },
  server: {
    proxy: {
      '/auth': SERVER,
      '/notes': SERVER,
    },
  },
})
