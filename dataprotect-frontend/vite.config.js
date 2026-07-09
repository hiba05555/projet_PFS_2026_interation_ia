import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.VITE_API_TARGET || 'http://localhost:3000',
        changeOrigin: true,
        // > timeout gateway → chatbot-service (660s) pour ne pas couper la réponse en premier
        timeout: 720000,
        proxyTimeout: 720000,
      }
    }
  }
})