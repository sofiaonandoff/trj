import { tr } from '../i18n'
import type { Destination, Poi } from '../data/destinations'
import type { Category, CheckItem, Day, Place, Trip } from '../types'
import { dateRange, fromMin, km, travelMin, uid } from './util'

export type Pace = 'slow' | 'normal' | 'full'
export const PACE: Record<Pace, { label: string; hint: string; minutes: number }> = {
  slow: { label: tr('느긋하게'), hint: tr('하루 2–3곳'), minutes: 330 },
  normal: { label: tr('적당히'), hint: tr('하루 4곳 안팎'), minutes: 470 },
  full: { label: tr('알차게'), hint: tr('하루 5곳 이상'), minutes: 620 },
}

export interface PlanInput { dest: Destination; start: string; end: string; pace: Pace; interests: Category[]; seed?: number }

// 결정적 난수: 같은 seed면 같은 일정, '다시 추천'은 seed만 바꾼다
function rng(seed: number) { let s = seed || 1; return () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296) }

const toPlace = (p: Poi): Place => ({ id: uid(), name: p.name, lat: p.lat, lng: p.lng, category: p.category, duration: p.duration, cost: p.cost || undefined, note: p.tip })
const slotRank = { m: 0, x: 1, a: 1, e: 2 } as const

/** 하루 안에서 시간대(오전→저녁) 순서를 지키면서 가까운 곳끼리 잇는다 */
function orderDay(pois: Poi[]): Poi[] {
  const out: Poi[] = []
  for (const rank of [0, 1, 2]) {
    const pool = pois.filter((p) => slotRank[p.slot] === rank)
    while (pool.length) {
      const last = out[out.length - 1]
      let best = 0
      if (last) pool.forEach((p, i) => { if (km(last, p) < km(last, pool[best])) best = i })
      out.push(pool.splice(best, 1)[0])
    }
  }
  return out
}

/** 시작 시각을 채운다. 점심 무렵에는 식사 시간을 비워 둔다. */
export function schedule(pois: Poi[], startAt = 9 * 60 + 30): Place[] {
  let cursor = startAt, lunched = false
  return pois.map((p, i) => {
    if (p.slot === 'e') cursor = Math.max(cursor, 17 * 60)
    if (!lunched && cursor >= 12 * 60 && p.category !== 'food') { cursor += 60; lunched = true }
    if (p.category === 'food') lunched = true
    const place = { ...toPlace(p), time: fromMin(Math.round(cursor / 10) * 10) }
    cursor += p.duration + (pois[i + 1] ? travelMin(km(p, pois[i + 1])) : 0)
    return place
  })
}

/**
 * 취향·속도에 맞춰 장소를 고르고, 가까운 곳끼리 같은 날로 묶은 뒤, 시간대에 맞게 순서를 잡는다.
 * 기기 안에서 계산하며 외부 서버로 아무것도 보내지 않는다.
 */
export function planTrip({ dest, start, end, pace, interests, seed = 1 }: PlanInput): Day[] {
  const dates = dateRange(start, end)
  const rand = rng(seed)
  const cap = PACE[pace].minutes
  const scored = dest.pois
    .map((p) => ({ p, s: (interests.includes(p.category) ? 3 : 1) + rand() * 1.5 - (p.duration >= 300 && dates.length < 3 ? 2 : 0) }))
    .sort((a, b) => b.s - a.s)

  // 1) 전체 일정 시간에 맞을 만큼만 고른다
  const picked: Poi[] = []
  let total = 0
  for (const { p } of scored) {
    if (total + p.duration > cap * dates.length + 60) continue
    picked.push(p); total += p.duration
  }

  // 2) 서로 가장 먼 장소들을 각 날의 기준점으로 삼는다
  const n = Math.min(dates.length, picked.length)
  const seeds: Poi[] = picked.length ? [picked.reduce((a, b) => (b.duration > a.duration ? b : a))] : []
  while (seeds.length < n) {
    const rest = picked.filter((p) => !seeds.includes(p))
    seeds.push(rest.reduce((a, b) => (Math.min(...seeds.map((s) => km(s, b))) > Math.min(...seeds.map((s) => km(s, a))) ? b : a)))
  }
  const groups = seeds.map((s) => [s])
  const load = seeds.map((s) => s.duration)

  // 3) 나머지는 가까우면서 여유가 있는 날에 넣는다
  for (const p of picked.filter((x) => !seeds.includes(x)).sort((a, b) => b.duration - a.duration)) {
    const order = seeds.map((s, i) => ({ i, d: km(s, p) })).sort((a, b) => a.d - b.d)
    const fit = order.find((o) => load[o.i] + p.duration <= cap + 45) ?? { i: load.indexOf(Math.min(...load)) }
    groups[fit.i].push(p); load[fit.i] += p.duration
  }

  // 4) 가벼운 날을 첫날·마지막 날에 둔다 (도착·출발일은 시간이 모자라기 쉽다)
  const idx = groups.map((_, i) => i).sort((a, b) => load[a] - load[b])
  const arranged: Poi[][] = new Array(dates.length).fill(null).map(() => [])
  const slots = dates.length > 1 ? [0, dates.length - 1, ...dates.map((_, i) => i).slice(1, -1)] : [0]
  idx.forEach((g, k) => { arranged[slots[k]] = groups[g] })

  return dates.map((date, i) => ({ date, items: schedule(orderDay(arranged[i]), i === 0 && dates.length > 1 ? 15 * 60 : 9 * 60 + 30) }))
}

/** 그날 동선에서 가까운, 아직 일정에 없는 장소 */
export function suggestions(dest: Destination, trip: Trip, dayIndex: number): (Poi & { dist: number | null })[] {
  // 이름은 언어에 따라 달라지므로 좌표로 이미 넣은 장소를 가린다
  const at = (p: { lat: number; lng: number }) => `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`
  const used = new Set(trip.days.flatMap((d) => d.items.map(at)))
  const items = trip.days[dayIndex]?.items ?? []
  const c = items.length ? { lat: items.reduce((s, i) => s + i.lat, 0) / items.length, lng: items.reduce((s, i) => s + i.lng, 0) / items.length } : null
  return dest.pois.filter((p) => !used.has(at(p))).map((p) => ({ ...p, dist: c ? km(c, p) : null })).sort((a, b) => (a.dist ?? 0) - (b.dist ?? 0))
}

export const poiToPlace = toPlace

export function defaultChecklist(dest: Destination | undefined, domestic: boolean): CheckItem[] {
  const rows: [string, string][] = [
    ...(domestic ? ([[tr('서류'), tr('신분증')]] as [string, string][]) : ([
      [tr('서류'), tr('여권 (유효기간 6개월 이상)')], [tr('서류'), tr('항공권 e티켓 저장')], [tr('서류'), tr('여행자 보험 가입')],
      [tr('돈'), tr('{0} 환전 또는 트래블 카드 충전', dest?.currency ?? tr('현지 통화'))], [tr('통신'), tr('eSIM·로밍 준비')],
    ] as [string, string][])),
    [tr('서류'), tr('숙소 예약 확인서')],
    [tr('전자기기'), tr('충전기와 보조배터리')],
    ...(dest && dest.plug.includes('110V') ? ([[tr('전자기기'), tr('110V 변환 플러그(돼지코)')]] as [string, string][]) : []),
    [tr('짐'), tr('상비약')], [tr('짐'), tr('세면도구')], [tr('짐'), tr('날씨에 맞는 겉옷')],
  ]
  return rows.map(([group, text]) => ({ id: uid(), group, text, done: false }))
}

/** 순서는 그대로 두고 시작 시각만 다시 채운다 */
export function retime(items: Place[]) {
  let cursor = items[0]?.time ? Number(items[0].time.slice(0, 2)) * 60 + Number(items[0].time.slice(3)) : 9 * 60 + 30
  items.forEach((p, i) => {
    p.time = fromMin(Math.round(cursor / 10) * 10)
    cursor += (p.duration ?? 60) + (items[i + 1] ? travelMin(km(p, items[i + 1])) : 0)
  })
}

/** 첫 장소에서 출발해 가까운 곳부터 차례로 잇는다 */
export function shortest(items: Place[]): Place[] {
  if (items.length < 3) return items
  const pool = items.slice(1), out = [items[0]]
  while (pool.length) {
    const last = out[out.length - 1]
    let best = 0
    pool.forEach((p, i) => { if (km(last, p) < km(last, pool[best])) best = i })
    out.push(pool.splice(best, 1)[0])
  }
  return out
}
