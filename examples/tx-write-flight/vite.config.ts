import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Fully static output — no server code, no env secrets. Every baked
// constant (WETH addresses, default amounts) is public by definition.
// Deploy = copy dist/ to a web root.
export default defineConfig({
  plugins: [react()],
  base: './',
  build: { outDir: 'dist', target: 'es2020' },
})
