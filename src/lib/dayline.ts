import { airport, type Airport } from '../data/airports'
import type { Flight, Place, Stay, Trip } from '../types'
import { km } from './util'

/**
 * 하루 일정을 시간 순서의 한 줄로 만든다.
 *
 *   [숙소에서 출발 / 체크아웃]   ← 전날 밤 묵은 숙소 (위에 고정)
 *   장소들 (사용자가 정한 순서)
 *   항공편 + 공항                 ← 출발·도착 시각에 맞춰 장소 사이에 끼운다
 *   [숙소로 돌아오기 / 체크인]   ← 오늘 밤 묵을 숙소 (아래에 고정)
 *   [오늘 밤 숙소 정하기]         ← 묵을 곳이 없는 밤
 *
 * 지도 경로도 이 순서를 따른다: 숙소 → 장소 → 공항 ✈ 공항 → 장소 → 숙소.
 */

export type Entry =
  | { kind: 'stay-start'; stay: Stay; checkout: boolean }
  | { kind: 'place'; place: Place; index: number }
  | { kind: 'flight'; flight: Flight; arriving: boolean; time: string; from?: Airport; to?: Airport }
  | { kind: 'stay-end'; stay: Stay; checkin: boolean }
  | { kind: 'stay-missing' }

export interface LL { lat: number; lng: number }

/** 이보다 멀면 땅 위 이동으로 보지 않는다 (거리·이동 시간·지도 선을 그리지 않는다) */
export const GROUND_KM = 300

export const DEFAULT_IN = '15:00'
export const DEFAULT_OUT = '11:00'

/** 그 날 아침에 일어나는 숙소 (전날 밤 묵은 곳) */
export const morningStay = (trip: Trip, date: string) => (trip.stays ?? []).find((s) => s.checkIn < date && date <= s.checkOut)
/** 그 날 밤 묵는 숙소 */
export const nightStay = (trip: Trip, date: string) => (trip.stays ?? []).find((s) => s.checkIn <= date && date < s.checkOut)

/** 밤을 비행기에서 보내거나 여행이 끝나는 날이면 숙소가 필요 없다 */
function needsNight(trip: Trip, date: string) {
  if (date >= trip.end) return false
  return !trip.flights.some((f) => f.depDate === date && f.arrDate > date)
}

export function dayLine(trip: Trip, date: string): Entry[] {
  const day = trip.days.find((d) => d.date === date)
  const items = day?.items ?? []
  const out: Entry[] = []

  const morning = morningStay(trip, date)
  // 밤새 날아와 아침에 내리는 날은 숙소에서 시작하지 않는다.
  // 단, 그 비행기가 이 숙소가 있는 도시에서 숙박 기간 중에 떠난 경우만이다. 그렇지 않으면(다른 곳에서 떠난 편,
  // 도착일이 잘못 들어간 편) 사용자가 직접 넣은 숙소를 믿고 체크아웃을 보여 준다
  const leftOvernight = morning && trip.flights.some((f) => {
    if (f.arrDate !== date || f.depDate >= date || f.depDate < morning.checkIn) return false
    const a = airport(f.from)
    return !a || km(a, morning) <= GROUND_KM
  })
  if (morning && !leftOvernight) out.push({ kind: 'stay-start', stay: morning, checkout: morning.checkOut === date })

  // 항공편: 그 날 출발하는 편은 출발 시각에, 전날 떠나 그 날 도착하는 편은 도착 시각에
  const flights: Extract<Entry, { kind: 'flight' }>[] = []
  for (const f of trip.flights) {
    if (f.depDate === date) flights.push({ kind: 'flight', flight: f, arriving: false, time: f.depTime, from: airport(f.from), to: airport(f.to) })
    else if (f.arrDate === date) flights.push({ kind: 'flight', flight: f, arriving: true, time: f.arrTime, from: airport(f.from), to: airport(f.to) })
  }
  flights.sort((a, b) => a.time.localeCompare(b.time))

  // 장소의 시각: 정해진 시각이 없으면 앞 장소의 시각을 이어받는다
  let eff = '00:00'
  const placed = items.map((place, index) => { eff = place.time ?? eff; return { place, index, eff } })
  let fi = 0
  for (const p of placed) {
    // 이 장소보다 먼저인 항공편을 앞에 넣는다
    while (fi < flights.length && flights[fi].time < p.eff) out.push(flights[fi++])
    out.push({ kind: 'place', place: p.place, index: p.index })
  }
  while (fi < flights.length) out.push(flights[fi++])

  const night = nightStay(trip, date)
  if (night) out.push({ kind: 'stay-end', stay: night, checkin: night.checkIn === date })
  else if (needsNight(trip, date)) out.push({ kind: 'stay-missing' })
  return out
}

/** 줄의 각 칸이 지도에서 차지하는 자리 (도착 지점) */
export function locOf(e: Entry): LL | undefined {
  switch (e.kind) {
    case 'stay-start': case 'stay-end': return e.stay
    case 'place': return e.place
    // 출발하는 편은 출발 공항이 그 날 동선의 끝, 도착하는 편은 도착 공항이 시작
    case 'flight': return e.arriving ? e.to : e.from
    default: return undefined
  }
}

/** 그 칸에서 다음 곳으로 떠나는 자리. 같은 날 내리는 항공편은 도착 공항에서 떠난다 */
export function hopFrom(e: Entry): LL | undefined {
  if (e.kind === 'flight') return e.arriving || e.flight.arrDate === e.flight.depDate ? e.to : undefined
  if (e.kind === 'stay-end') return undefined
  return locOf(e)
}

/** 각 칸에서 다음 칸까지 이동할 곳 (거리·이동 시간 표시용). 밤새 날아가는 편 뒤로는 잇지 않는다 */
export function nextStops(line: Entry[]): (LL | undefined)[] {
  return line.map((e, i) => {
    if (!hopFrom(e)) return undefined
    for (let j = i + 1; j < line.length; j++) {
      const n = line[j]
      if (n.kind === 'stay-missing') return undefined
      const l = n.kind === 'flight' ? (n.arriving ? undefined : n.from) : locOf(n)
      if (n.kind === 'flight' || l) {
        const from = hopFrom(e)!
        return l && km(from, l) <= GROUND_KM ? l : undefined
      }
    }
    return undefined
  })
}

/** 지도에 그릴 땅 위 경로 구간들. 비행 구간에서 끊고, 같은 날 도착하면 도착 공항에서 다시 시작한다 */
export function routeSegments(line: Entry[]): [number, number][][] {
  const segs: [number, number][][] = []
  let cur: [number, number][] = []
  const add = (l?: LL) => {
    if (!l) return
    // 땅으로 갈 수 없을 만큼 먼 곳(다른 도시의 공항 등)은 잇지 않고 새로 시작한다
    const last = cur[cur.length - 1]
    if (last && km({ lat: last[1], lng: last[0] }, l) > GROUND_KM) { if (cur.length > 1) segs.push(cur); cur = [] }
    cur.push([l.lng, l.lat])
  }
  for (const e of line) {
    if (e.kind === 'flight') {
      if (e.arriving) { if (cur.length > 1) segs.push(cur); cur = []; add(e.to); continue }
      add(e.from)
      if (cur.length > 1) segs.push(cur)
      cur = []
      // 그 날 안에 내리면 도착 공항부터 이어진다
      if (e.flight.arrDate === e.flight.depDate) add(e.to)
      continue
    }
    add(locOf(e))
  }
  if (cur.length > 1) segs.push(cur)
  return segs
}
