import { airport, CORE_AIRPORTS, type Airport } from '../data/airports'
import { destination } from '../data/destinations'
import type { Leg, Trip } from '../types'
import { addDays, dateRange, km } from './util'

export interface Place0 { city: string; country?: string; lat: number; lng: number; destId?: string }

/** 그 날짜에 머무는 도시. 구간이 없는 여행이면 여행 자체의 도시 */
export function legOf(trip: Trip, date: string): Place0 {
  const legs = trip.legs
  if (!legs?.length) return trip
  return legs.find((l) => date >= l.start && date <= l.end) ?? (date < legs[0].start ? legs[0] : legs[legs.length - 1])
}

/** 화면에 쓰는 도시 이름: 방콕 · 콘깬 (돌아오는 같은 도시는 한 번만) */
export function cityLabel(cities: string[]) {
  return [...new Set(cities)].join(' · ')
}

/**
 * 시작일과 구간별 숙박 수로 날짜를 나눈다.
 * 구간 i는 숙박 수만큼의 날을 갖고, 마지막 구간은 돌아오는 날을 하루 더 갖는다.
 * 예: 방콕 2박, 콘깬 2박, 방콕 1박 → 1–2일 방콕, 3–4일 콘깬, 5–6일 방콕
 */
export function splitDates(start: string, nights: number[]) {
  const out: { start: string; end: string }[] = []
  let cursor = start
  nights.forEach((n, i) => {
    const last = i === nights.length - 1
    const days = Math.max(last ? n + 1 : n, 1)
    out.push({ start: cursor, end: addDays(cursor, days - 1) })
    cursor = addDays(cursor, days)
  })
  return out
}

/** 여행 기간이 바뀐 뒤 구간 날짜를 맞춘다: 시작이 옮겨진 만큼 모두 옮기고, 마지막 구간을 여행 끝에 맞춘다 */
export function fitLegs(t: Trip, prevStart: string) {
  if (!t.legs?.length) return
  const shift = dateRange(prevStart, t.start).length - 1 || -(dateRange(t.start, prevStart).length - 1)
  let legs = t.legs.map((l) => ({ ...l, start: addDays(l.start, shift), end: addDays(l.end, shift) }))
  // 새 기간 안에 들어오는 구간만 남긴다. 하나도 안 남으면 첫 구간이 기간 전체를 맡는다
  legs = legs.filter((l) => l.start <= t.end)
  if (!legs.length) legs = [{ ...t.legs[0] }]
  legs[0].start = t.start
  legs[legs.length - 1].end = t.end
  // 구간끼리 이어지게: 앞 구간이 끝나는 날 다음 구간이 시작한다 (기간 밖으로 나가지 않게)
  for (let i = 1; i < legs.length; i++) {
    if (legs[i].start < t.start) legs[i].start = t.start
    if (legs[i - 1].end > legs[i].start) legs[i - 1].end = legs[i].start
  }
  t.legs = legs.length > 1 ? legs : undefined
  if (legs.length === 1) Object.assign(t, { city: legs[0].city, lat: legs[0].lat, lng: legs[0].lng, destId: legs[0].destId })
}

/** 도시에서 가장 가까운 공항 (120km 안에 있을 때만) */
export function nearestAirport(p: { lat: number; lng: number; destId?: string }): Airport | undefined {
  const own = destination(p.destId)?.airport
  if (own) return airport(own)
  const best = CORE_AIRPORTS.reduce((a, b) => (km(p, a) < km(p, b) ? a : b))
  return km(p, best) <= 120 ? best : undefined
}

export const newLegId = () => Math.random().toString(36).slice(2, 9)
export type { Leg }

type LL = { lat: number; lng: number }
/**
 * 구간의 들어오고 나가는 지점.
 * 첫 구간은 도시 근처 공항으로 도착하고, 마지막 구간은 그 공항으로 떠난다.
 * 가운데 구간은 앞 도시에서 육로·국내선으로 넘어오므로 도시 중심을 도착 지점으로 본다.
 */
export function legEnds(legs: Place0[], i: number): { arrive?: LL; depart?: LL; arriveText?: string; departText?: string } {
  const leg = legs[i]
  const first = i === 0, last = i === legs.length - 1
  const inAir = first ? nearestAirport(leg) : undefined
  const outAir = last ? nearestAirport(leg) : undefined
  return {
    arrive: inAir ? { lat: inAir.lat, lng: inAir.lng } : first ? undefined : { lat: leg.lat, lng: leg.lng },
    depart: outAir ? { lat: outAir.lat, lng: outAir.lng } : undefined,
    arriveText: inAir ? `${inAir.name} (${inAir.code})` : first ? undefined : `from ${legs[i - 1].city}`,
    departText: outAir ? `${outAir.name} (${outAir.code})` : undefined,
  }
}
