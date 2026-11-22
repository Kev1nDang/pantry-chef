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
      // Fixed ports outside Vite's default 5173+ range, so this app never trades ports with another
      // local Vite project. strictPort fails loudly instead of drifting, because Supabase only
      // sends magic links back to the exact addresses in its redirect list.
      port: phone ? 5291 : 5290,
      strictPort: true,
      // Forward API calls to the FastAPI dev server (backend/, run with --port 8290), or to a
      // deployed API. changeOrigin sends the target's Host header, which some hosts route on.
      proxy: { '/api': { target: env.API_PROXY_TARGET || 'http://localhost:8290', changeOrigin: true } },
    },
    preview: { port: 5290, strictPort: true },
    // The Live camera's detector worker imports onnxruntime-web, which needs an ES module worker.
    // Pre-bundling it up front saves the dev server a full page reload the first time the
    // worker is opened (only the worker imports it, so Vite would discover it late).
    worker: { format: 'es' },
    optimizeDeps: { include: ['onnxruntime-web/webgpu'] },
  }
})
