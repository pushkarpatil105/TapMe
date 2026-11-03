import process from 'node:process'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import { validatePublicRedirectBaseUrl } from './src/utils/public-url.js'

// https://vite.dev/config/
export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const publicBaseUrl = env.VITE_PUBLIC_REDIRECT_BASE_URL || process.env.VITE_PUBLIC_REDIRECT_BASE_URL

  // In production builds, strictly enforce that VITE_PUBLIC_REDIRECT_BASE_URL is configured
  // and does not point to localhost, 127.0.0.1, or a LAN IP.
  if (command === 'build' && mode === 'production') {
    validatePublicRedirectBaseUrl(publicBaseUrl, true)
  }

  return {
    plugins: [react()],
    server: {
      proxy: {
        '/api': {
          target: 'http://127.0.0.1:8787',
          changeOrigin: true,
        },
        '/r': {
          target: 'http://127.0.0.1:8787',
          changeOrigin: true,
        },
      },
    },
  }
})
