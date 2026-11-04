import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [react()],
    server: {
      // Forward API calls to the FastAPI dev server (backend/), or to a deployed API such as the
      // Hugging Face Space. changeOrigin sends the target's Host header, which Spaces route on.
      proxy: { '/api': { target: env.API_PROXY_TARGET || 'http://localhost:8000', changeOrigin: true } },
    },
  }
})
