import { handleRoute, type RouteEnv } from '../../server/route'

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

/**
 * Cloudflare Pages Function: POST /api/route — 하루 동선의 도보·차 거리와 시간.
 * 받은 구간은 KV(TRJ_VIEWS)에 넣어 둔다. ORS_API_KEY Secret이 있으면 OpenRouteService를 쓴다.
 */
export const onRequestPost = async ({ request, env }: { request: Request; env: RouteEnv }) => {
  const origin = request.headers.get('Origin')
  if (origin && new URL(origin).host !== new URL(request.url).host) return json(403, { error: 'forbidden' })
  let body: unknown
  try { body = await request.json() } catch { return json(400, { error: 'bad_request' }) }
  const r = await handleRoute(body, env)
  return json(r.status, r.json)
}
