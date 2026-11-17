import { handlePlan, type PlanEnv } from '../../server/plan'

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

/**
 * Cloudflare Pages Function: POST /api/plan
 * Pages 설정의 환경 변수(비밀)에 GEMINI_API_KEY를 넣어야 동작한다.
 */
export const onRequestPost = async ({ request, env }: { request: Request; env: PlanEnv }) => {
  // 다른 사이트가 이 주소를 빌려 쓰지 못하게, 같은 주소에서 온 요청만 받는다
  const origin = request.headers.get('Origin')
  if (origin && new URL(origin).host !== new URL(request.url).host) return json(403, { error: 'forbidden' })
  let body: unknown
  try { body = await request.json() } catch { return json(400, { error: 'bad_request' }) }
  const r = await handlePlan(body, env)
  return json(r.status, r.json)
}
