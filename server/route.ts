import type { ViewStore } from './view'

/**
 * 도로 길찾기 (/api/route). 하루 동선의 지점들을 순서대로 받아, 구간마다 걸어서 / 차로 가는 실제 거리와 시간을 돌려준다.
 *
 * - 기본: FOSSGIS가 운영하는 OSRM 서버 (routing.openstreetmap.de, 키가 필요 없다).
 *   이용 조건이 '초당 1건 이하, 트래픽이 많은 서비스는 쓰지 말 것'이라서
 *   한 번 받은 구간은 KV(TRJ_VIEWS)에 오래 넣어 두고 다시 묻지 않는다.
 * - ORS_API_KEY(OpenRouteService 무료 키)를 Secret으로 넣으면 그쪽을 쓴다 (하루 2,000건).
 * - 하루 동선 전체를 한 번에 묻는다 (도보 1번 + 차 1번). 구간 하나씩 묻지 않는다.
 */
export interface RouteEnv {
  TRJ_VIEWS?: ViewStore
  ORS_API_KEY?: string
}
export interface RouteResult { status: number; json: unknown }

/** [미터, 초] */
export type Leg = [number, number]
export interface LegPair { w: Leg; c: Leg }

const MAX_POINTS = 25
const TTL = 60 * 60 * 24 * 180
const UA = 'trj travel planner (https://trj-onnoff.pages.dev)'

const r5 = (n: number) => n.toFixed(5)
export const legKey = (a: [number, number], b: [number, number]) => `${r5(a[1])},${r5(a[0])}>${r5(b[1])},${r5(b[0])}`

async function osrm(profile: 'foot' | 'car', pts: [number, number][]): Promise<Leg[] | null> {
  const coords = pts.map(([lng, lat]) => `${r5(lng)},${r5(lat)}`).join(';')
  const res = await fetch(`https://routing.openstreetmap.de/routed-${profile}/route/v1/driving/${coords}?overview=false&steps=false`, { headers: { 'User-Agent': UA } })
  if (!res.ok) return null
  const j = (await res.json()) as { code?: string; routes?: { legs?: { distance: number; duration: number }[] }[] }
  const legs = j.code === 'Ok' ? j.routes?.[0]?.legs : undefined
  return legs && legs.length === pts.length - 1 ? legs.map((l) => [Math.round(l.distance), Math.round(l.duration)]) : null
}

async function ors(key: string, profile: 'foot-walking' | 'driving-car', pts: [number, number][]): Promise<Leg[] | null> {
  const res = await fetch(`https://api.openrouteservice.org/v2/directions/${profile}/json`, {
    method: 'POST',
    headers: { Authorization: key, 'Content-Type': 'application/json', 'User-Agent': UA },
    body: JSON.stringify({ coordinates: pts, instructions: false, geometry: false }),
  })
  if (!res.ok) return null
  const j = (await res.json()) as { routes?: { segments?: { distance: number; duration: number }[] }[] }
  const seg = j.routes?.[0]?.segments
  return seg && seg.length === pts.length - 1 ? seg.map((s) => [Math.round(s.distance), Math.round(s.duration)]) : null
}

const valid = (p: unknown): p is [number, number] =>
  Array.isArray(p) && p.length === 2 && p.every((n) => typeof n === 'number' && Number.isFinite(n)) && Math.abs(p[0] as number) <= 180 && Math.abs(p[1] as number) <= 90

export async function handleRoute(body: unknown, env: RouteEnv): Promise<RouteResult> {
  const pts = (body as { pts?: unknown })?.pts
  if (!Array.isArray(pts) || pts.length < 2 || pts.length > MAX_POINTS || !pts.every(valid)) return { status: 400, json: { error: 'bad_request' } }
  const keys = pts.slice(1).map((b, i) => legKey(pts[i], b))

  // 이미 받아 둔 구간은 KV에서
  const kv = env.TRJ_VIEWS
  const cached = kv ? await Promise.all(keys.map((k) => kv.get(`r1:${k}`).catch(() => null))) : keys.map(() => null)
  const out: (LegPair | null)[] = cached.map((c) => { try { return c ? (JSON.parse(c) as LegPair) : null } catch { return null } })
  if (out.every(Boolean)) return { status: 200, json: { legs: out, source: 'cache' } }

  // 빠진 구간이 있으면 동선 전체를 한 번에 묻는다 (도보, 차)
  try {
    const [w, c] = env.ORS_API_KEY
      ? await Promise.all([ors(env.ORS_API_KEY, 'foot-walking', pts), ors(env.ORS_API_KEY, 'driving-car', pts)])
      : [await osrm('foot', pts), await osrm('car', pts)]
    if (!w || !c) return { status: 502, json: { error: 'route_failed', legs: out } }
    const legs = w.map((wl, i) => ({ w: wl, c: c[i] }))
    if (kv) await Promise.all(legs.map((l, i) => (out[i] ? null : kv.put(`r1:${keys[i]}`, JSON.stringify(l), { expirationTtl: TTL }).catch(() => null))))
    return { status: 200, json: { legs, source: env.ORS_API_KEY ? 'ors' : 'osrm' } }
  } catch {
    return { status: 502, json: { error: 'route_failed', legs: out } }
  }
}
