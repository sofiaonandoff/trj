import { dayLine, nextStops, routeSegments } from '../src/lib/dayline'
import { mergeTrips, stamp } from '../src/lib/merge'
import { fitAfterArrival } from '../src/lib/planner'
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
// 항공편 도착 전 시각에 잡힌 도착 도시 장소는 도착 뒤로 (도착 14:00 → 입국 90분 + 공항에서 이동)
const BKK = { lat: 13.69, lng: 100.75 }
const fit = structuredClone({ ...trip, days: [{ date: '2026-12-02', items: [P('s1', '10:00'), P('s2', '12:00'), P('s3', '18:00')] }, ...trip.days.slice(1)] }) as Trip
const r1 = fitAfterArrival(fit, { to: 'BKK', arrDate: '2026-12-02', arrTime: '14:00' }, BKK)
const t1 = fit.days[0].items.map((p) => `${p.id}@${p.time}`)
check('도착 전 장소 2곳을 도착 뒤로, 원래 저녁 일정은 겹치지 않게 그 뒤로', r1.moved === 2 && t1.map((x) => x.split('@')[0]).join() === 's1,s2,s3' && t1[0] >= 's1@15:30' && fit.days[0].items.every((p, i, a) => !i || p.time! > a[i - 1].time!), [r1, t1])
// 밤늦게 도착하면 다음 날로
const late = structuredClone({ ...trip, days: [{ date: '2026-12-02', items: [P('l1', '15:00'), P('l2', '17:20')] }, { date: '2026-12-03', items: [P('m1', '09:30')] }, ...trip.days.slice(2)] }) as Trip
const r2 = fitAfterArrival(late, { to: 'BKK', arrDate: '2026-12-02', arrTime: '22:10' }, BKK)
check('밤 도착이면 다음 날 앞으로', r2.nextDay === 2 && late.days[0].items.length === 0 && late.days[1].items.map((p) => p.id).join() === 'l1,l2,m1' && late.days[1].items[0].time === '09:30', [r2, late.days[1].items])
// 다른 도시(출발지)의 장소는 그대로
const home = structuredClone({ ...trip, days: [{ date: '2026-12-02', items: [{ ...P('seoul', '09:00'), lat: 37.5, lng: 127 }] }, ...trip.days.slice(1)] }) as Trip
check('출발 도시 장소는 옮기지 않는다', fitAfterArrival(home, { to: 'BKK', arrDate: '2026-12-02', arrTime: '14:00' }, BKK).moved === 0)
// 함께 편집: 한쪽에서 넣은 숙소와 다른 쪽에서 지운 숙소가 합쳐진다
const base = structuredClone({ ...trip, id: 't', members: [], expenses: [], checklist: [], journal: {}, deleted: {} }) as Trip
const a = structuredClone(base), b = structuredClone(base)
a.stays = [...a.stays!, { id: 'C', name: 'Hotel C', lat: 1, lng: 1, checkIn: '2026-12-05', checkOut: '2026-12-06' }]; stamp(base, a, 100)
b.stays = b.stays!.filter((s) => s.id !== 'B'); stamp(base, b, 200)
const m = mergeTrips(a, b)
check('숙소 병합: 넣은 것은 남고 지운 것은 지워진다', m.stays?.map((s) => s.id).join() === 'A,C', m.stays?.map((s) => s.id))
// 직접 넣은 1박 숙소: 다음 날 아침 체크아웃이 보인다
const one = { ...trip, flights: [], stays: [{ id: 'O', name: '1박', lat: 13.74, lng: 100.53, checkIn: '2026-12-03', checkOut: '2026-12-04' }] } as unknown as Trip
const ko = (d: string) => dayLine(one, d).map((e) => e.kind === 'stay-start' ? `↑${e.stay.id}${e.checkout ? '-out' : ''}` : e.kind === 'stay-end' ? `↓${e.stay.id}${e.checkin ? '-in' : ''}` : e.kind).join(' ')
check('1박: 첫날 체크인, 다음 날 맨 위 체크아웃', ko('2026-12-03').endsWith('↓O-in') && ko('2026-12-04').startsWith('↑O-out'), [ko('2026-12-03'), ko('2026-12-04')])
// 다른 곳에서 밤새 날아온 편(또는 도착일이 잘못 들어간 편)이 있어도 직접 넣은 숙소의 체크아웃은 보인다
const red = { ...one, flights: [{ id: 'r', flightNo: 'KE129', from: 'ICN', to: 'AKL', depDate: '2026-12-03', depTime: '19:00', arrDate: '2026-12-04', arrTime: '10:00' }] } as unknown as Trip
check('다른 도시에서 떠난 밤 비행기는 체크아웃을 가리지 않는다', dayLine(red, '2026-12-04')[0]?.kind === 'stay-start', dayLine(red, '2026-12-04').map((e) => e.kind))
// 숙소가 있는 도시에서 밤 비행기로 떠났으면 그 아침은 숙소에서 시작하지 않는다
const left = { ...one, flights: [{ id: 'l', flightNo: 'TG656', from: 'BKK', to: 'ICN', depDate: '2026-12-03', depTime: '23:30', arrDate: '2026-12-04', arrTime: '07:00' }] } as unknown as Trip
check('숙소 도시에서 밤 비행기로 떠났으면 체크아웃 없음', dayLine(left, '2026-12-04').every((e) => e.kind !== 'stay-start'), dayLine(left, '2026-12-04').map((e) => e.kind))
console.log(fail ? `${fail}개 실패` : '모두 통과')
process.exit(fail ? 1 : 0)
