/**
 * 로그인 없이 보는 일정의 짧은 링크 (#/v/<id>).
 * 일정(viewOf로 이메일·예약번호를 뺀 것)을 서버 저장소에 두고, 만든 기기만 아는 토큰으로 고치거나 지운다.
 * Cloudflare Pages Function(functions/api/view/[[path]].ts)은 KV(TRJ_VIEWS)를, 로컬 개발 서버는 메모리를 쓴다.
 */
export interface ViewStore {
  get(key: string): Promise<string | null>
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>
  delete(key: string): Promise<void>
}
export interface ViewResult { status: number; json: unknown }

/** 마지막으로 고친 뒤 이만큼 지나면 지운다 (초) */
const TTL = 400 * 24 * 3600
const MAX = 512 * 1024
const ID = /^[A-Za-z0-9]{8,16}$/
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'

const random = (n: number) => { const b = crypto.getRandomValues(new Uint8Array(n)); return [...b].map((x) => ALPHA[x % ALPHA.length]).join('') }
async function hash(s: string) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
interface Rec { h: string; data: unknown; at: number }
const valid = (d: unknown) => {
  const t = d as { title?: unknown; days?: unknown } | null
  return !!t && typeof t.title === 'string' && Array.isArray(t.days)
}

/** method: GET·POST·DELETE, id: /api/view/ 뒤의 값 (POST로 새로 만들 때는 없음) */
const ALIAS = /^[A-Za-z0-9_-]{10,100}$/

export async function handleView(method: string, path: string, body: unknown, token: string | null, store?: ViewStore): Promise<ViewResult> {
  if (!store) return { status: 503, json: { error: 'no_store' } }
  let id = path
  // a/<별칭>: 예전에 보낸 Google Drive 보기 링크(#/view/<Drive 파일 id>)도 이 짧은 링크의 최신 내용을 보게 한다
  if (method === 'GET' && path.startsWith('a/')) {
    const alias = path.slice(2)
    const to = ALIAS.test(alias) ? await store.get(`a:${alias}`) : null
    if (!to) return { status: 404, json: { error: 'not_found' } }
    id = to
  }
  if (method === 'GET') {
    if (!ID.test(id)) return { status: 404, json: { error: 'not_found' } }
    const raw = await store.get(`v:${id}`)
    if (!raw) return { status: 404, json: { error: 'not_found' } }
    const r = JSON.parse(raw) as Rec
    return { status: 200, json: { data: r.data, at: r.at } }
  }
  if (method === 'POST') {
    const b = body as { data?: unknown; id?: string; token?: string; alias?: string } | null
    const alias = b?.alias && ALIAS.test(b.alias) ? b.alias : undefined
    if (!b || !valid(b.data)) return { status: 400, json: { error: 'bad_request' } }
    const text = JSON.stringify(b.data)
    if (text.length > MAX) return { status: 413, json: { error: 'too_large' } }
    // 고치기: 만든 기기의 토큰이 맞아야 한다
    if (b.id) {
      if (!ID.test(b.id) || !b.token) return { status: 400, json: { error: 'bad_request' } }
      const raw = await store.get(`v:${b.id}`)
      if (!raw) return { status: 404, json: { error: 'not_found' } }
      const r = JSON.parse(raw) as Rec
      if (r.h !== await hash(b.token)) return { status: 403, json: { error: 'forbidden' } }
      await store.put(`v:${b.id}`, JSON.stringify({ h: r.h, data: b.data, at: Date.now() }), { expirationTtl: TTL })
      if (alias) await store.put(`a:${alias}`, b.id, { expirationTtl: TTL })
      return { status: 200, json: { id: b.id } }
    }
    const newId = random(10), newToken = random(32)
    await store.put(`v:${newId}`, JSON.stringify({ h: await hash(newToken), data: b.data, at: Date.now() }), { expirationTtl: TTL })
    if (alias) await store.put(`a:${alias}`, newId, { expirationTtl: TTL })
    return { status: 200, json: { id: newId, token: newToken } }
  }
  if (method === 'DELETE') {
    if (!ID.test(id) || !token) return { status: 400, json: { error: 'bad_request' } }
    const raw = await store.get(`v:${id}`)
    if (!raw) return { status: 200, json: { ok: true } }
    if ((JSON.parse(raw) as Rec).h !== await hash(token)) return { status: 403, json: { error: 'forbidden' } }
    await store.delete(`v:${id}`)
    return { status: 200, json: { ok: true } }
  }
  return { status: 405, json: { error: 'method' } }
}

/** 로컬 개발용 저장소 */
export function memoryStore(): ViewStore {
  const m = new Map<string, string>()
  return { get: async (k) => m.get(k) ?? null, put: async (k, v) => { m.set(k, v) }, delete: async (k) => { m.delete(k) } }
}
