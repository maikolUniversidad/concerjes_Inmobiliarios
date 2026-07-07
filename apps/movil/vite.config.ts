import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

// base './' para que los assets carguen desde file:// en la webview de Capacitor.
export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@conserjes/offline': path.resolve(__dirname, '../../packages/offline/src/index.ts'),
    },
  },
})
