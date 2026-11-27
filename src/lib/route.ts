import { create } from 'zustand'
import { lang } from '../i18n'
import { fmtDur, km, travelMin } from './util'

/**
 * 장소 사이 이동: 도로 길찾기(/api/route)로 받은 실제 거리와 시간.
 * - 걸어서 15분 이내면 도보, 그보다 멀면 택시로 본다.
 * - 택시 시간 = 길찾기의 차 시간 × 1.3 (도심 신호·막힘) + 5분 (잡고 타고 내리기).
 * - 아직 받지 못했거나 오프라인이면 직선거리로 어림한 값을 쓴다 (exact: false).
 * 받은 구간은 이 기기(localStorage)와 서버(KV)에 오래 둔다. 같은 장소 사이는 다시 묻지 않는다.
 */
type LL = { lat: number; lng: number }
/** [미터, 초]: 도보 w, 차 c */
interface LegPair { w: [number, number]; c: [number, number] }
export interface Hop { mode: 'walk' | 'taxi'; min: number; km: number; exact: boolean }

const KEY = 'trj-route-v1'
const MAX = 4000
export const WALK_MAX_MIN = 15
const TAXI_FACTOR = 1.3
const TAXI_WAIT = 5

const r5 = (n: number) => n.toFixed(5)
const legKey = (a: LL, b: LL) => `${r5(a.lat)},${r5(a.lng)}>${r5(b.lat)},${r5(b.lng)}`

const load = (): Record<string, LegPair> => { try { return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, LegPair> } catch { return {} } }
const cache: Record<string, LegPair> = typeof localStorage === 'undefined' ? {} : load()
const save = () => {
  try {
    const keys = Object.keys(cache)
    if (keys.length > MAX) keys.slice(0, keys.length - MAX).forEach((k) => delete cache[k])
    localStorage.setItem(KEY, JSON.stringify(cache))
  } catch { /* 저장 공간이 없으면 이번에만 쓴다 */ }
}

/** 새 구간을 받으면 화면을 다시 그리게 하는 신호 */
const useRouteTick = create<{ n: number; bump: () => void }>((set) => ({ n: 0, bump: () => set((s) => ({ n: s.n + 1 })) }))
export const useRoutes = () => useRouteTick((s) => s.n)

/** 두 곳 사이 이동 (받아 둔 길찾기가 있으면 그것, 없으면 어림) */
export function hop(a: LL, b: LL): Hop {
  const leg = cache[legKey(a, b)]
  if (leg) {
    const walk = leg.w[1] / 60
    if (walk <= WALK_MAX_MIN) return { mode: 'walk', min: Math.max(1, Math.round(walk)), km: leg.w[0] / 1000, exact: true }
    return { mode: 'taxi', min: Math.round((leg.c[1] / 60) * TAXI_FACTOR + TAXI_WAIT), km: leg.c[0] / 1000, exact: true }
  }
  const d = km(a, b)
  return { mode: d < 1.2 ? 'walk' : 'taxi', min: travelMin(d), km: d, exact: false }
}
export const hopMin = (a: LL, b: LL) => hop(a, b).min
const EN = lang === 'en'
export const hopLabel = (h: Hop) => (EN ? `${h.mode === 'walk' ? 'Walk' : 'Taxi'} ~${fmtDur(h.min)}` : `${h.mode === 'walk' ? '도보' : '택시'} 약 ${fmtDur(h.min)}`)

/* ── 받아 오기: 한 번에 한 동선씩, 1초 넘게 띄워서 (길찾기 서버 이용 조건) ── */
const tried = new Set<string>()
const queue: LL[][] = []
let running = false

async function pump() {
  if (running) return
  running = true
  while (queue.length) {
    const pts = queue.shift()!
    if (pts.slice(1).every((b, i) => cache[legKey(pts[i], b)])) continue
    try {
      const res = await fetch('/api/route', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pts: pts.map((p) => [p.lng, p.lat]) }) })
      const j = (await res.json().catch(() => ({}))) as { legs?: (LegPair | null)[]; source?: string }
      let added = 0
      j.legs?.forEach((l, i) => { if (l && Array.isArray(l.w) && Array.isArray(l.c)) { cache[legKey(pts[i], pts[i + 1])] = l; added++ } })
      if (added) { save(); useRouteTick.getState().bump() }
      // 서버 캐시에서 나온 답은 길찾기 서버를 쓰지 않았으니 바로 다음으로
      if (j.source === 'cache') continue
    } catch { /* 오프라인 등: 어림값을 그대로 쓴다 */ }
    await new Promise((r) => setTimeout(r, 1100))
  }
  running = false
}

/** 이 동선(지점 순서)의 길찾기를 받아 둔다. 이미 있거나 이번 실행에서 물어본 동선이면 건너뛴다 */
export function ensureRoute(points: LL[]) {
  if (typeof fetch === 'undefined' || (typeof navigator !== 'undefined' && navigator.onLine === false)) return
  const pts = points.filter((p, i) => i === 0 || km(points[i - 1], p) > 0.005)
  for (let s = 0; s < pts.length - 1; s += 24) {
    const part = pts.slice(s, s + 25)
    if (part.length < 2 || part.slice(1).every((b, i) => cache[legKey(part[i], b)])) continue
    const id = part.map((p) => `${r5(p.lat)},${r5(p.lng)}`).join(';')
    if (tried.has(id)) continue
    tried.add(id)
    queue.push(part)
  }
  void pump()
}
/** routeSegments([lng, lat][][]) 그대로 받기 */
export const ensureSegments = (segs: [number, number][][]) => segs.forEach((s) => ensureRoute(s.map(([lng, lat]) => ({ lat, lng }))))

/**
 * 두 곳 사이 차로 가는 길을 지금 바로 받는다 (사진으로 넣은 버스 일정의 걸리는 시간 등).
 * 받아 둔 구간이 있으면 그것, 없으면 /api/route에 묻고 받아 둔다. 오프라인·실패면 undefined
 */
export async function roadLeg(a: LL, b: LL): Promise<{ km: number; min: number } | undefined> {
  const k = legKey(a, b)
  if (!cache[k] && typeof fetch !== 'undefined' && !(typeof navigator !== 'undefined' && navigator.onLine === false)) {
    try {
      const res = await fetch('/api/route', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pts: [[a.lng, a.lat], [b.lng, b.lat]] }) })
      const l = ((await res.json().catch(() => ({}))) as { legs?: (LegPair | null)[] }).legs?.[0]
      if (l && Array.isArray(l.c)) { cache[k] = l; save(); useRouteTick.getState().bump() }
    } catch { /* 어림값을 쓴다 */ }
  }
  const leg = cache[k]
  return leg ? { km: leg.c[0] / 1000, min: leg.c[1] / 60 } : undefined
}

/** 테스트용: 구간을 직접 넣는다 */
export const _putLeg = (a: LL, b: LL, l: LegPair) => { cache[legKey(a, b)] = l }
