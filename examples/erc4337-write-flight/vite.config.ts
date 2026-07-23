import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Fully static output — no server code, no env secrets. Deploy = copy dist/.
export default defineConfig({
  plugins: [react()],
  base: './',
  build: { outDir: 'dist', target: 'es2020' },
})
