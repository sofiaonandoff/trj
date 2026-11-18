import { dayLine, nextStops, routeSegments } from '../src/lib/dayline'
import { mergeTrips, stamp } from '../src/lib/merge'
import type { Trip } from '../src/types'

let fail = 0
const check = (label: string, ok: boolean, got?: unknown) => { if (!ok) fail++; console.log(ok ? 'PASS' : 'FAIL', label, ok ? '' : JSON.stringify(got)) }
const P = (id: string, time?: string, lat = 13.75) => ({ id, name: id, lat, lng: 100.5, category: 'sight' as const, time })
const trip = {
  start: '2026-12-02', end: '2026-12-05',
  days: [
    { date: '2026-12-02', items: [] },
    { date: '2026-12-03', items: [P('a', '10:00'), P('b')] },
    { date: '2026-12-04', items: [P('c', '11:00')] },
    { date: '2026-12-05', items: [P('d', '10:00'), P('e', '16:00')] },
  ],
  flights: [
    { id: 'f1', flightNo: 'KE651', from: 'ICN', to: 'BKK', depDate: '2026-12-02', depTime: '18:25', arrDate: '2026-12-02', arrTime: '22:10' },
    { id: 'f2', flightNo: 'TG656', from: 'BKK', to: 'ICN', depDate: '2026-12-05', depTime: '14:00', arrDate: '2026-12-05', arrTime: '21:30' },
  ],
  stays: [
    { id: 'A', name: 'Hotel A', lat: 13.74, lng: 100.53, checkIn: '2026-12-02', checkOut: '2026-12-04' },
    { id: 'B', name: 'Hotel B', lat: 13.73, lng: 100.52, checkIn: '2026-12-04', checkOut: '2026-12-05' },
  ],
} as unknown as Trip
const kinds = (date: string) => dayLine(trip, date).map((e) => e.kind === 'place' ? e.place.id : e.kind === 'flight' ? `✈${e.flight.flightNo}` : e.kind === 'stay-start' ? `↑${e.stay.id}${e.checkout ? '-out' : ''}` : e.kind === 'stay-end' ? `↓${e.stay.id}${e.checkin ? '-in' : ''}` : '?숙소').join(' ')
check('도착 날: 항공편 → 체크인', kinds('2026-12-02') === '✈KE651 ↓A-in', kinds('2026-12-02'))
check('가운데 날: 숙소에서 출발 → 장소 → 숙소로', kinds('2026-12-03') === '↑A a b ↓A', kinds('2026-12-03'))
check('숙소 바꾸는 날: 체크아웃 → 장소 → 새 숙소 체크인', kinds('2026-12-04') === '↑A-out c ↓B-in', kinds('2026-12-04'))
check('떠나는 날: 체크아웃, 항공편은 시각에 맞춰 장소 사이', kinds('2026-12-05') === '↑B-out d ✈TG656 e', kinds('2026-12-05'))
const noStay = { ...trip, stays: [] } as Trip
check('숙소가 없는 밤에는 정하기 칸', dayLine(noStay, '2026-12-03').at(-1)?.kind === 'stay-missing')
check('마지막 날에는 정하기 칸이 없다', dayLine(noStay, '2026-12-05').every((e) => e.kind !== 'stay-missing'))
const l3 = dayLine(trip, '2026-12-03')
const n3 = nextStops(l3)
check('숙소에서 첫 장소로, 마지막 장소에서 숙소로 거리', n3[0] === trip.days[1].items[0] && (n3[2] as { id?: string })?.id === 'A', n3)
const segs = routeSegments(dayLine(trip, '2026-12-02'))
check('도착 날 경로: 방콕 공항 → 숙소 (인천 쪽은 비행 구간으로 끊김)', segs.length === 1 && segs[0].length === 2 && Math.abs(segs[0][1][0] - 100.53) < 0.01, segs)
// 다른 나라 공항으로 가는 길은 땅 위 이동으로 치지 않는다 (방콕 장소 → 인천 출발)
const far = { ...trip, days: [{ date: '2026-12-02', items: [P('x', '15:00')] }, ...trip.days.slice(1)] } as Trip
const fl = dayLine(far, '2026-12-02')
check('먼 공항까지는 거리·선 없음', nextStops(fl)[0] === undefined && routeSegments(fl).every((sg) => sg.length < 3), [nextStops(fl)[0], routeSegments(fl)])
// 함께 편집: 한쪽에서 넣은 숙소와 다른 쪽에서 지운 숙소가 합쳐진다
const base = structuredClone({ ...trip, id: 't', members: [], expenses: [], checklist: [], journal: {}, deleted: {} }) as Trip
const a = structuredClone(base), b = structuredClone(base)
a.stays = [...a.stays!, { id: 'C', name: 'Hotel C', lat: 1, lng: 1, checkIn: '2026-12-05', checkOut: '2026-12-06' }]; stamp(base, a, 100)
b.stays = b.stays!.filter((s) => s.id !== 'B'); stamp(base, b, 200)
const m = mergeTrips(a, b)
check('숙소 병합: 넣은 것은 남고 지운 것은 지워진다', m.stays?.map((s) => s.id).join() === 'A,C', m.stays?.map((s) => s.id))
console.log(fail ? `${fail}개 실패` : '모두 통과')
process.exit(fail ? 1 : 0)
