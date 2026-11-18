import { handleTranslate, type TranslateEnv } from '../../server/translate'

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

/**
 * Cloudflare Pages Function: POST /api/translate
 * Pages 설정 → Bindings에 Workers AI를 변수 이름 AI로 연결하면 빠른 번역 모델을 쓴다 (없으면 GEMINI_API_KEY로).
 */
export const onRequestPost = async ({ request, env }: { request: Request; env: TranslateEnv }) => {
  const origin = request.headers.get('Origin')
  if (origin && new URL(origin).host !== new URL(request.url).host) return json(403, { error: 'forbidden' })
  let body: unknown
  try { body = await request.json() } catch { return json(400, { error: 'bad_request' }) }
  const r = await handleTranslate(body, env)
  return json(r.status, r.json)
}
