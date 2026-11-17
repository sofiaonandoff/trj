import { tr } from './i18n'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { DESTINATIONS, type Destination } from './data/destinations'
import { defaultChecklist, planTrip, type Pace } from './lib/planner'
import { addDays, dateRange, today, uid } from './lib/util'
import { stamp } from './lib/merge'
import type { Category, DriveLink, Flight, Trip } from './types'

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

/** 항공편을 저장하고, 출발·도착일이 여행 기간 밖이면 기간을 넓힌다 */
export function putFlight(t: Trip, f: Flight) {
  const i = t.flights.findIndex((x) => x.id === f.id)
  if (i >= 0) t.flights[i] = f; else t.flights.push(f)
  t.flights.sort((a, b) => `${a.depDate}${a.depTime}`.localeCompare(`${b.depDate}${b.depTime}`))
  if (f.depDate < t.start) t.start = f.depDate
  if (f.arrDate > t.end) t.end = f.arrDate
  syncDays(t)
}

export interface NewTripInput {
  dest?: Destination
  city: string
  country?: string
  lat?: number
  lng?: number
  start: string
  end: string
  pace: Pace
  interests: Category[]
  people: string[]
  recommend: boolean
}

export function buildTrip(i: NewTripInput): Trip {
  const d = i.dest
  const nights = dateRange(i.start, i.end).length - 1
  const days = d && i.recommend
    ? planTrip({ dest: d, start: i.start, end: i.end, pace: i.pace, interests: i.interests, seed: Date.now() % 100000 })
    : dateRange(i.start, i.end).map((date) => ({ date, items: [] }))
  const names = i.people.length ? i.people : [tr('나')]
  return {
    id: uid(),
    title: `${i.city} ${nights ? tr('{0}박 {1}일', nights, nights + 1) : tr('당일치기')}`,
    city: i.city, country: d?.country ?? i.country ?? '', destId: d?.id,
    lat: d?.lat ?? i.lat ?? 37.5665, lng: d?.lng ?? i.lng ?? 126.978,
    start: i.start, end: i.end, days, flights: [],
    members: names.map((name, k) => ({ id: uid(), name, color: MEMBER_COLORS[k % MEMBER_COLORS.length] })),
    expenses: [], checklist: defaultChecklist(d, Boolean(d?.domestic)), journal: {},
    currency: d?.currency ?? 'KRW', rate: d?.rate ?? 1, budget: 0, createdAt: Date.now(),
  }
}

/** 처음 열었을 때 둘러볼 수 있는 예시 여행. 항공편 시각은 실제 운항 정보가 아니다. */
export function sampleTrip(): Trip {
  const start = addDays(today(), 12), end = addDays(start, 3)
  const t = buildTrip({ dest: DESTINATIONS[0], city: tr('도쿄'), start, end, pace: 'normal', interests: ['food', 'culture', 'cafe'], people: [tr('나'), tr('지우'), tr('민서')], recommend: true })
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
