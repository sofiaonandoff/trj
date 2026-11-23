import { tr } from '../i18n'
import type { Destination, Poi } from '../data/destinations'
import type { Category, CheckItem, Day, Place, Trip } from '../types'
import { dateRange, fromMin, km, uid } from './util'
import { hopMin } from './route'

export type Pace = 'slow' | 'normal' | 'full'
export const PACE: Record<Pace, { label: string; hint: string; minutes: number }> = {
  slow: { label: tr('느긋하게'), hint: tr('하루 2–3곳'), minutes: 330 },
  normal: { label: tr('적당히'), hint: tr('하루 4곳 안팎'), minutes: 470 },
  full: { label: tr('알차게'), hint: tr('하루 5곳 이상'), minutes: 620 },
}

type LL = { lat: number; lng: number }
export interface PlanInput {
  dest: Destination; start: string; end: string; pace: Pace; interests: Category[]; seed?: number
  /** 첫날 도착하는 곳(공항이나 앞 도시에서 오는 길목). 있으면 첫날은 오후에 이 근처부터 돈다 */
  arrive?: LL
  /** 마지막 날 떠나는 곳(공항). 있으면 마지막 날은 이 근처에서 이른 오후에 끝낸다 */
  depart?: LL
  /** 앞 구간에서 이미 넣은 장소 이름 (같은 도시를 다시 올 때 겹치지 않게) */
  exclude?: Set<string>
}

// 결정적 난수: 같은 seed면 같은 일정, '다시 추천'은 seed만 바꾼다
function rng(seed: number) { let s = seed || 1; return () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296) }

const toPlace = (p: Poi): Place => ({ id: uid(), name: p.name, lat: p.lat, lng: p.lng, category: p.category, duration: p.duration, cost: p.cost || undefined, note: p.tip })
const slotRank = { m: 0, x: 1, a: 1, e: 2 } as const

/** 하루 안에서 시간대(오전→저녁) 순서를 지키면서 가까운 곳끼리 잇는다. from이 있으면 그곳에서 가장 가까운 곳부터 */
function orderDay(pois: Poi[], from?: LL): Poi[] {
  const out: Poi[] = []
  for (const rank of [0, 1, 2]) {
    const pool = pois.filter((p) => slotRank[p.slot] === rank)
    while (pool.length) {
      const last: LL | undefined = out[out.length - 1] ?? from
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
    if (!lunched && cursor >= 12 * 60 && cursor < 15 * 60 && p.category !== 'food') { cursor += 60; lunched = true }
    if (p.category === 'food') lunched = true
    const place = { ...toPlace(p), time: fromMin(Math.round(cursor / 10) * 10) }
    cursor += p.duration + (pois[i + 1] ? hopMin(p, pois[i + 1]) : 0)
    return place
  })
}

const centroid = (ps: LL[]): LL => ({ lat: ps.reduce((s, p) => s + p.lat, 0) / ps.length, lng: ps.reduce((s, p) => s + p.lng, 0) / ps.length })
const ARRIVE_AT = 14 * 60, DAY_AT = 9 * 60 + 30

/**
 * 취향·속도에 맞춰 장소를 고르고 날짜별로 나눈다. 기기 안에서 계산하며 외부로 아무것도 보내지 않는다.
 * 1) 도착하는 날: 공항(또는 도착 지점)에서 가까운 곳부터, 오후 반나절만
 * 2) 떠나는 날: 공항 근처나 가는 길에 있는 곳, 이른 오후까지
 * 3) 나머지 날: 서로 가까운 곳끼리 묶고, 전날 끝난 곳에서 가까운 묶음부터 이어 붙인다
 */
export function planTrip({ dest, start, end, pace, interests, seed = 1, arrive, depart, exclude }: PlanInput): Day[] {
  const dates = dateRange(start, end)
  const n = dates.length
  const rand = rng(seed)
  const cap = PACE[pace].minutes
  const arriving = Boolean(arrive) && n > 1
  const leaving = Boolean(depart) && n > 1
  const caps = dates.map((_, i) => (i === 0 && arriving ? cap * 0.55 : i === n - 1 && leaving ? cap * 0.5 : cap))
  const halfDay = (i: number) => (i === 0 && arriving) || (i === n - 1 && leaving)

  const scored = dest.pois
    .filter((p) => !exclude?.has(p.name))
    .map((p) => ({ p, s: (interests.includes(p.category) ? 3 : 1) + rand() * 1.5 - (p.duration >= 300 && n < 3 ? 2 : 0) }))
    .sort((a, b) => b.s - a.s)

  // 전체 일정 시간에 맞을 만큼만 고른다
  const budget = caps.reduce((a, b) => a + b, 0) + 60
  const remaining: Poi[] = []
  let total = 0
  for (const { p } of scored) { if (total + p.duration <= budget) { remaining.push(p); total += p.duration } }

  const days: Poi[][] = dates.map(() => [])
  const load = dates.map(() => 0)
  const take = (p: Poi) => remaining.splice(remaining.indexOf(p), 1)[0]

  /** 기준점에서 가까운 곳부터 그 날의 여유만큼 채운다. 반나절에는 하루를 다 쓰는 곳은 넣지 않는다 */
  const fillNear = (i: number, at: LL, avoidSlot?: 'm' | 'e') => {
    for (;;) {
      const fits = remaining.filter((p) => load[i] + p.duration <= caps[i] + 30 && p.duration < 300 && p.slot !== avoidSlot)
      if (!fits.length) return
      const p = take(fits.reduce((a, b) => (km(at, b) < km(at, a) ? b : a)))
      days[i].push(p); load[i] += p.duration
    }
  }
  if (arriving) fillNear(0, arrive!, 'm') // 오전 일정은 도착 날에 맞지 않는다
  if (leaving) fillNear(n - 1, depart!, 'e') // 떠나는 날 저녁 일정은 넣지 않는다

  // 가운데 날들: 서로 가장 먼 곳을 기준점으로 삼아 묶는다
  const middle = dates.map((_, i) => i).filter((i) => !(i === 0 && arriving) && !(i === n - 1 && leaving))
  const k = Math.min(middle.length, remaining.length)
  const seeds: Poi[] = remaining.length ? [remaining.reduce((a, b) => (b.duration > a.duration ? b : a))] : []
  while (seeds.length < k) {
    const rest = remaining.filter((p) => !seeds.includes(p))
    seeds.push(rest.reduce((a, b) => (Math.min(...seeds.map((s) => km(s, b))) > Math.min(...seeds.map((s) => km(s, a))) ? b : a)))
  }
  const groups = seeds.map((sd) => [sd])
  const gload = seeds.map((sd) => sd.duration)
  for (const p of remaining.filter((x) => !seeds.includes(x)).sort((a, b) => b.duration - a.duration)) {
    const order = seeds.map((sd, i) => ({ i, d: km(sd, p) })).sort((a, b) => a.d - b.d)
    const fit = order.find((o) => gload[o.i] + p.duration <= cap + 45)
    if (fit) { groups[fit.i].push(p); gload[fit.i] += p.duration }
  }

  // 묶음의 순서: 도착한 곳(또는 첫날 마지막 장소)에서 가까운 묶음부터 차례로 잇는다
  let at: LL | undefined = days[0][days[0].length - 1] ?? arrive
  const left = groups.map((g, i) => i)
  for (const i of middle) {
    if (!left.length) break
    const pick = at ? left.reduce((a, b) => (km(at!, centroid(groups[b])) < km(at!, centroid(groups[a])) ? b : a)) : left[0]
    left.splice(left.indexOf(pick), 1)
    days[i] = groups[pick]
    const ordered = orderDay(groups[pick], at)
    at = ordered[ordered.length - 1]
  }

  return dates.map((date, i) => {
    const from = i === 0 ? arrive : undefined
    const startAt = halfDay(i) && i === 0 ? ARRIVE_AT : DAY_AT
    return { date, items: schedule(orderDay(days[i], from ?? (i > 0 ? centroid(days[i - 1].length ? days[i - 1] : [dest]) : undefined)), startAt) }
  })
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
    cursor += (p.duration ?? 60) + (items[i + 1] ? hopMin(p, items[i + 1]) : 0)
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

/** 내려서 입국 심사·짐 찾기까지 (분) */
export const ARRIVAL_BUFFER = 90
/** 이보다 늦게 시작하는 일정은 다음 날로 넘긴다 */
const LATEST = 23 * 60

/**
 * 항공편이 도착하기 전 시각에 잡혀 있는, 도착 도시(도착 공항 300km 안)의 장소를 도착 뒤로 옮긴다.
 * 도착 시각 + 입국 90분 + 공항에서 첫 장소까지 이동 시간부터 순서대로 다시 시각을 매기고,
 * 뒤에 있던 장소도 겹치면 함께 밀린다. 밤 11시를 넘기는 장소는 다음 날 앞으로 옮긴다.
 * 옮긴 장소 수와 다음 날로 넘긴 수를 돌려준다.
 */
export function fitAfterArrival(t: Trip, f: { to: string; arrDate: string; arrTime: string }, at: { lat: number; lng: number } | undefined): { moved: number; nextDay: number } {
  const res = { moved: 0, nextDay: 0 }
  const di = t.days.findIndex((d) => d.date === f.arrDate)
  if (di < 0 || !at) return res
  const day = t.days[di]
  const ready = toMinute(f.arrTime) + ARRIVAL_BUFFER
  const near = (p: Place) => km(at, p) <= 300
  const early = day.items.filter((p) => p.time && near(p) && toMinute(p.time) < ready)
  if (!early.length) return res
  res.moved = early.length

  // 도착 전에 할 수 있는 일(다른 도시에서 떠나기 전 일정)은 그대로 두고, 그 뒤에 옮긴 장소, 그다음에 원래 뒤에 있던 장소
  const set = new Set(early)
  const before = day.items.filter((p) => !set.has(p) && p.time && toMinute(p.time) < ready)
  const after = day.items.filter((p) => !set.has(p) && !before.includes(p))
  const chain = [...early, ...after]
  let cursor = ready + hopMin(at, chain[0])
  const keep: Place[] = [], overflow: Place[] = []
  chain.forEach((p, i) => {
    const own = p.time && after.includes(p) ? toMinute(p.time) : 0
    cursor = Math.max(cursor, own)
    if (cursor > LATEST || overflow.length) { overflow.push(p); return }
    p.time = fromMin(Math.ceil(cursor / 10) * 10)
    keep.push(p)
    cursor += (p.duration ?? 60) + (chain[i + 1] ? hopMin(p, chain[i + 1]) : 0)
  })
  day.items = [...before, ...keep]

  // 너무 늦은 장소는 다음 날 맨 앞으로 (그 날 시각을 다시 맞춘다)
  const next = t.days[di + 1]
  if (overflow.length && next) {
    for (const p of overflow) p.time = undefined
    const startAt = next.items.find((p) => p.time)?.time
    next.items = [...overflow, ...next.items]
    if (startAt) next.items[0].time = startAt
    retime(next.items)
    res.nextDay = overflow.length
  } else if (overflow.length) {
    // 다음 날이 없으면 늦게라도 그 날에 남긴다
    for (const p of overflow) { p.time = fromMin(Math.min(23 * 60 + 50, Math.ceil(cursor / 10) * 10)); cursor += p.duration ?? 60 }
    day.items.push(...overflow)
  }
  return res
}

const toMinute = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5))
