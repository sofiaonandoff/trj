import type { ViewStore } from '../../../server/view'
import { handleWidget } from '../../../server/widget'

/** Cloudflare Pages Function: GET /api/widget/<보기 링크 id>?lang=ko&tz=Asia/Seoul[&format=txt] (안드로이드 KWGT 등 위젯 앱용) */
export const onRequestGet = async ({ request, env, params }: { request: Request; env: { TRJ_VIEWS?: ViewStore }; params: { id?: string } }) => {
  const r = await handleWidget(String(params.id ?? ''), new URL(request.url).searchParams, env.TRJ_VIEWS)
  return new Response(r.body, { status: r.status, headers: { 'Content-Type': r.type, 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' } })
}
