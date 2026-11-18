import { tr } from './i18n'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { DESTINATIONS, destination, type Destination } from './data/destinations'
import { cityLabel, legEnds, newLegId } from './lib/legs'
import { defaultChecklist, planTrip, type Pace } from './lib/planner'
import { addDays, dateRange, today, uid } from './lib/util'
import { stamp } from './lib/merge'
import type { Category, Day, DriveLink, Flight, Leg, Stay, Trip } from './types'

export const MEMBER_COLORS = ['#2F5D57', '#B0603A', '#5C7F4E', '#96506A', '#5E5A86', '#8A6A48']

interface State {
  trips: Trip[]
  add: (t: Trip) => void
  remove: (id: string) => void
  /** 여행을 복사한 뒤 fn에서 고친 결과로 바꾼다 */
  mutate: (id: string, fn: (t: Trip) => void) => void
  /** 동기화가 합친 결과를 그대로 넣는다 (변경 시각을 새로 찍지 않는다) */
  put: (t: Trip) => void
  /** Drive 동기화 상태만 고친다. 여행 내용이 바뀐 것으로 치지 않는다 */
  patchDrive: (id: string, patch: Partial<DriveLink> | null) => void
}

export const useStore = create<State>()(
  persist(
    (set) => ({
      trips: [],
      add: (t) => set((s) => ({ trips: [t, ...s.trips.filter((x) => x.id !== t.id)] })),
      remove: (id) => set((s) => ({ trips: s.trips.filter((t) => t.id !== id) })),
      mutate: (id, fn) => set((s) => ({
        trips: s.trips.map((t) => { if (t.id !== id) return t; const c = structuredClone(t); fn(c); stamp(t, c); return c }),
      })),
      put: (t) => set((s) => ({ trips: s.trips.some((x) => x.id === t.id) ? s.trips.map((x) => (x.id === t.id ? t : x)) : [t, ...s.trips] })),
      patchDrive: (id, patch) => set((s) => ({
        trips: s.trips.map((t) => (t.id === id ? { ...t, drive: patch ? { ...t.drive, ...patch } : undefined } : t)),
      })),
    }),
    { name: 'trj-trips-v1' },
  ),
)

/** 여행 기간이 바뀌면 날짜 목록을 맞춘다. 기간 밖으로 밀려난 일정은 마지막 날로 옮긴다. */
export function syncDays(t: Trip) {
  const dates = dateRange(t.start, t.end)
  const orphan = t.days.filter((d) => !dates.includes(d.date)).flatMap((d) => d.items)
  t.days = dates.map((date) => t.days.find((d) => d.date === date) ?? { date, items: [] })
  if (orphan.length) t.days[t.days.length - 1].items.push(...orphan)
}

/**
 * 숙소를 저장한다. 숙박비가 있으면 체크인 날의 숙박 지출로 예산에 남기고, 지출은 숙소와 함께 고쳐지고 지워진다.
 * 기간이 여행 밖이면 여행 기간을 넓힌다.
 */
export function putStay(t: Trip, stay: Stay, cost?: { amount: number; currency: string }) {
  const stays = (t.stays ??= [])
  const i = stays.findIndex((x) => x.id === stay.id)
  const s = { ...stay }
  const linked = s.expenseId ? t.expenses.find((e) => e.id === s.expenseId) : undefined
  if (cost && cost.amount > 0) {
    if (linked) Object.assign(linked, { title: s.name, amount: cost.amount, currency: cost.currency, date: s.checkIn })
    else {
      const id = uid()
      t.expenses.push({ id, title: s.name, amount: cost.amount, currency: cost.currency, category: 'stay', payer: t.members[0]?.id ?? '', split: t.members.map((m) => m.id), date: s.checkIn })
      s.expenseId = id
    }
  } else if (cost && linked) {
    t.expenses = t.expenses.filter((e) => e.id !== linked.id)
    s.expenseId = undefined
  }
  if (i >= 0) stays[i] = s; else stays.push(s)
  stays.sort((a, b) => a.checkIn.localeCompare(b.checkIn))
  if (s.checkIn < t.start) t.start = s.checkIn
  if (s.checkOut > t.end) t.end = s.checkOut
  syncDays(t)
}

export function removeStay(t: Trip, id: string) {
  const s = t.stays?.find((x) => x.id === id)
  if (!s) return
  t.stays = t.stays!.filter((x) => x.id !== id)
  if (s.expenseId) t.expenses = t.expenses.filter((e) => e.id !== s.expenseId)
}

/** 항공편을 저장하고, 출발·도착일이 여행 기간 밖이면 기간을 넓힌다 */
export function putFlight(t: Trip, f: Flight) {
  const i = t.flights.findIndex((x) => x.id === f.id)
  if (i >= 0) t.flights[i] = f; else t.flights.push(f)
  t.flights.sort((a, b) => `${a.depDate}${a.depTime}`.localeCompare(`${b.depDate}${b.depTime}`))
  if (f.depDate < t.start) t.start = f.depDate
  if (f.arrDate > t.end) t.end = f.arrDate
  syncDays(t)
}

export interface LegInput { dest?: Destination; city: string; country?: string; lat?: number; lng?: number; start: string; end: string }
export interface Person { name: string; email?: string }
export interface NewTripInput {
  legs: LegInput[]
  pace: Pace
  interests: Category[]
  people: Person[]
  recommend: boolean
}

export function buildTrip(i: NewTripInput): Trip {
  const legs: Leg[] = i.legs.map((l) => ({
    id: newLegId(), city: l.city, country: l.dest?.country ?? l.country ?? '', destId: l.dest?.id,
    lat: l.dest?.lat ?? l.lat ?? 37.5665, lng: l.dest?.lng ?? l.lng ?? 126.978, start: l.start, end: l.end,
  }))
  const first = legs[0], start = legs[0].start, end = legs[legs.length - 1].end
  const nights = dateRange(start, end).length - 1
  const days: Day[] = dateRange(start, end).map((date) => ({ date, items: [] }))
  if (i.recommend) planBuiltIn(days, legs, i.pace, i.interests)
  const d = i.legs[0].dest
  const people = i.people.length ? i.people : [{ name: tr('나') }]
  const city = cityLabel(legs.map((l) => l.city))
  return {
    id: uid(),
    title: `${city} ${nights ? tr('{0}박 {1}일', nights, nights + 1) : tr('당일치기')}`,
    city, country: first.country ?? '', destId: first.destId, lat: first.lat, lng: first.lng,
    legs: legs.length > 1 ? legs : undefined,
    start, end, days, flights: [],
    members: people.map((p, k) => ({ id: uid(), name: p.name, color: MEMBER_COLORS[k % MEMBER_COLORS.length], ...(p.email ? { email: p.email } : {}) })),
    expenses: [], checklist: defaultChecklist(d, Boolean(d?.domestic)), journal: {},
    currency: d?.currency ?? 'KRW', rate: d?.rate ?? 1, budget: 0, createdAt: Date.now(),
  }
}

/** 기기 안의 기본 추천으로 구간마다 일정을 채운다 (추천 데이터가 있는 도시만). 같은 도시를 다시 오면 겹치지 않게 한다 */
export function planBuiltIn(days: Day[], legs: Leg[], pace: Pace, interests: Category[], only?: Set<number>) {
  const used = new Set<string>(days.flatMap((d) => d.items.map((p) => p.name)))
  legs.forEach((leg, k) => {
    const dest = destination(leg.destId)
    if (!dest || (only && !only.has(k))) return
    const { arrive, depart } = legEnds(legs, k)
    const planned = planTrip({ dest, start: leg.start, end: leg.end, pace, interests, seed: (Date.now() + k) % 100000, arrive, depart, exclude: used })
    for (const pd of planned) {
      const day = days.find((x) => x.date === pd.date)
      if (day) { day.items.push(...pd.items); pd.items.forEach((p) => used.add(p.name)) }
    }
  })
}

/** 처음 열었을 때 둘러볼 수 있는 예시 여행. 항공편 시각은 실제 운항 정보가 아니다. */
export function sampleTrip(): Trip {
  const start = addDays(today(), 12), end = addDays(start, 3)
  const t = buildTrip({ legs: [{ dest: DESTINATIONS[0], city: tr('도쿄'), start, end }], pace: 'normal', interests: ['food', 'culture', 'cafe'], people: [{ name: tr('나') }, { name: tr('지우') }, { name: tr('민서') }], recommend: true })
  t.title = tr('도쿄 3박 4일 (예시)')
  t.budget = 2400000
  putFlight(t, { id: uid(), flightNo: 'KE703', from: 'ICN', to: 'NRT', depDate: start, depTime: '10:10', arrDate: start, arrTime: '12:35', seat: '34A', pnr: 'TRJ7K2' })
  putFlight(t, { id: uid(), flightNo: 'KE704', from: 'NRT', to: 'ICN', depDate: end, depTime: '17:20', arrDate: end, arrTime: '19:55', pnr: 'TRJ7K2' })
  const [a, b, c] = t.members.map((m) => m.id)
  const all = [a, b, c]
  t.expenses = [
    { id: uid(), title: tr('숙소 3박'), amount: 54000, currency: 'JPY', category: 'stay', payer: a, split: all, date: start },
    { id: uid(), title: tr('스이카 충전'), amount: 9000, currency: 'JPY', category: 'move', payer: b, split: all, date: start },
    { id: uid(), title: tr('츠키지 초밥'), amount: 12600, currency: 'JPY', category: 'food', payer: c, split: all, date: addDays(start, 1) },
    { id: uid(), title: tr('시부야 스카이 입장권'), amount: 66000, currency: 'KRW', category: 'play', payer: a, split: all, date: addDays(start, 1) },
  ]
  t.checklist.slice(0, 3).forEach((c) => (c.done = true))
  return t
}
