import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        timeout: 120000,       // 2 min — analysis can be slow on large files
        proxyTimeout: 120000,
      }
    }
  }
})
