import { handleView, type ViewStore } from '../../../server/view'

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

/**
 * Cloudflare Pages Function: /api/view, /api/view/<id>
 * Pages 프로젝트 설정 → Bindings에 KV 네임스페이스를 TRJ_VIEWS 이름으로 연결해야 동작한다.
 */
export const onRequest = async ({ request, env, params }: { request: Request; env: { TRJ_VIEWS?: ViewStore }; params: { path?: string[] } }) => {
  const id = (params.path ?? [])[0] ?? ''
  if (request.method !== 'GET') {
    // 고치기·지우기는 이 앱에서 온 요청만 받는다
    const origin = request.headers.get('Origin')
    if (origin && new URL(origin).host !== new URL(request.url).host) return json(403, { error: 'forbidden' })
  }
  let body: unknown = null
  if (request.method === 'POST') { try { body = await request.json() } catch { return json(400, { error: 'bad_request' }) } }
  const r = await handleView(request.method, id, body, request.headers.get('X-View-Token'), env.TRJ_VIEWS)
  return json(r.status, r.json)
}
