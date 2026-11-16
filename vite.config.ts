import basicSsl from '@vitejs/plugin-basic-ssl'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  // `npm run dev:phone`: serve on the local network over HTTPS (self-signed), because phones only
  // give the camera to secure pages, so Live scan can be tried on a real phone.
  const phone = mode === 'phone'
  return {
    plugins: [react(), ...(phone ? [basicSsl()] : [])],
    server: {
      host: phone || undefined,
      // Forward API calls to the FastAPI dev server (backend/), or to a deployed API such as the
      // Hugging Face Space. changeOrigin sends the target's Host header, which Spaces route on.
      proxy: { '/api': { target: env.API_PROXY_TARGET || 'http://localhost:8000', changeOrigin: true } },
    },
  }
})
