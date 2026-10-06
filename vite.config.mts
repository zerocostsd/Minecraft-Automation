import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiPort = Number(env.API_PORT || 3002)
  const viewerPort = Number(env.VIEWER_PORT || 3001)

  return {
    plugins: [react()],
    server: {
      host: env.DASHBOARD_HOST || '0.0.0.0',
      port: Number(env.DASHBOARD_PORT || 3000),
      strictPort: true,
      proxy: {
        '/api': `http://127.0.0.1:${apiPort}`,
        '/viewer': {
          target: `http://127.0.0.1:${viewerPort}`,
          changeOrigin: true,
          ws: true
        }
      }
    }
  }
})