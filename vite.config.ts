import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { execSync } from 'node:child_process'

/** 화면 아래에 보여 줄 빌드 버전: Cloudflare가 주는 커밋, 없으면 로컬 git */
const version = (process.env.CF_PAGES_COMMIT_SHA ?? (() => { try { return execSync('git rev-parse HEAD').toString() } catch { return 'dev' } })()).trim().slice(0, 7)
import { handlePlan, type PlanEnv } from './server/plan'
import { handleView, memoryStore } from './server/view'
import { handleTranslate } from './server/translate'
import { handleWidget } from './server/widget'
import { handleRoute } from './server/route'

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
  // 보기 링크: 로컬에서는 메모리에 둔다 (서버를 다시 켜면 사라진다)
  const views = memoryStore()
  type VReq = Req & { url?: string; headers: Record<string, string | undefined> }
  const viewHandler = (req: VReq, res: Res) => {
    let raw = ''
    req.on('data', (chunk) => { raw += String(chunk) })
    req.on('end', async () => {
      let body: unknown = null
      try { body = raw ? JSON.parse(raw) : null } catch { /* 400 */ }
      const id = (req.url ?? '').replace(/^\/+/, '').split('?')[0]
      const r = await handleView(req.method ?? 'GET', id, body, req.headers['x-view-token'] ?? null, views)
      res.statusCode = r.status
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify(r.json))
    })
  }
  // 번역: 로컬에는 Workers AI가 없으므로 Gemini로
  const translateHandler = (req: Req, res: Res, next: () => void) => {
    if (req.method !== 'POST') return next()
    let raw = ''
    req.on('data', (chunk) => { raw += String(chunk) })
    req.on('end', async () => {
      let body: unknown = null
      try { body = JSON.parse(raw) } catch { /* 400 */ }
      const r = body ? await handleTranslate(body, env) : { status: 400, json: { error: 'bad_request' } }
      res.statusCode = r.status
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify(r.json))
    })
  }
  // 길찾기: 로컬에서도 같은 서버(OSRM)에 묻고, 받은 구간은 메모리에 둔다
  const routeHandler = (req: Req, res: Res, next: () => void) => {
    if (req.method !== 'POST') return next()
    let raw = ''
    req.on('data', (chunk) => { raw += String(chunk) })
    req.on('end', async () => {
      let body: unknown = null
      try { body = JSON.parse(raw) } catch { /* 400 */ }
      const r = body ? await handleRoute(body, { TRJ_VIEWS: views, ORS_API_KEY: (env as { ORS_API_KEY?: string }).ORS_API_KEY }) : { status: 400, json: { error: 'bad_request' } }
      res.statusCode = r.status
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify(r.json))
    })
  }
  const widgetHandler = async (req: { url?: string }, res: Res) => {
    const u = new URL(req.url ?? '/', 'http://x')
    const r = await handleWidget(u.pathname.replace(/^\/+/, ''), u.searchParams, views)
    res.statusCode = r.status
    res.setHeader('Content-Type', r.type)
    res.end(r.body)
  }
  const use = (server: { middlewares: { use: (p: string, h: never) => void } }) => {
    server.middlewares.use('/api/plan', handler as never); server.middlewares.use('/api/view', viewHandler as never); server.middlewares.use('/api/translate', translateHandler as never)
    server.middlewares.use('/api/widget', widgetHandler as never); server.middlewares.use('/api/route', routeHandler as never)
  }
  return {
    name: 'trj-local-api',
    configureServer(server) { use(server) },
    configurePreviewServer(server) { use(server) },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '') as PlanEnv
  return {
    define: { __APP_VERSION__: JSON.stringify(version) },
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
