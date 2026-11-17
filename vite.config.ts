import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { handlePlan, type PlanEnv } from './server/plan'

/**
 * 로컬(npm run dev / preview)에서도 /api/plan이 동작하게 한다.
 * 배포에서는 functions/api/plan.ts(Cloudflare Pages Function)가 같은 일을 한다.
 * 키는 .env.local의 GEMINI_API_KEY에서 읽고, 브라우저용 번들에는 들어가지 않는다.
 */
function localApi(env: PlanEnv): Plugin {
  type Req = { method?: string; on: (ev: string, cb: (chunk?: unknown) => void) => void }
  type Res = { statusCode: number; setHeader: (k: string, v: string) => void; end: (body: string) => void }
  const handler = (req: Req, res: Res, next: () => void) => {
    if (req.method !== 'POST') return next()
    let raw = ''
    req.on('data', (chunk) => { raw += String(chunk) })
    req.on('end', async () => {
      let body: unknown = null
      try { body = JSON.parse(raw) } catch { /* 아래에서 400으로 답한다 */ }
      const r = body ? await handlePlan(body, env) : { status: 400, json: { error: 'bad_request' } }
      res.statusCode = r.status
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify(r.json))
    })
  }
  return {
    name: 'trj-local-api',
    configureServer(server) { server.middlewares.use('/api/plan', handler as never) },
    configurePreviewServer(server) { server.middlewares.use('/api/plan', handler as never) },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '') as PlanEnv
  return {
    plugins: [
      react(),
      localApi(env),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['favicon.svg', 'icon.svg', 'apple-touch-icon.png'],
        manifest: {
          name: 'trj. — THEREALJOURNEY',
          short_name: 'trj.',
          description: 'Your world, your journey. 일정·동선·항공편·예산·기록을 한곳에 담는 여행 앱',
          lang: 'ko',
          theme_color: '#1C2C29',
          background_color: '#F8F6F1',
          display: 'standalone',
          start_url: '.',
          icons: [
            { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
            { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
            { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
            { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
          maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
          navigateFallbackDenylist: [/^\/api\//, /^\/privacy/],
          runtimeCaching: [
            {
              urlPattern: ({ url }) => url.hostname === 'tiles.openfreemap.org',
              handler: 'StaleWhileRevalidate',
              options: { cacheName: 'map-tiles', expiration: { maxEntries: 600, maxAgeSeconds: 60 * 60 * 24 * 14 } },
            },
          ],
        },
      }),
    ],
  }
})
