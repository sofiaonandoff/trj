import { mergeTrips, sameContent, shared, stamp } from '../src/lib/merge'
import type { Trip, Place } from '../src/types'

let clock = 1000
const edit = (t: Trip, fn: (d: Trip) => void): Trip => { const c = structuredClone(t); fn(c); stamp(t, c, ++clock); return c }
const P = (id: string, name = id): Place => ({ id, name, lat: 0, lng: 0, category: 'sight' })
const base: Trip = {
  id: 't', title: '도쿄', city: '도쿄', country: '일본', lat: 0, lng: 0, start: '2026-12-01', end: '2026-12-03',
  days: [{ date: '2026-12-01', items: [P('a'), P('b'), P('c')] }, { date: '2026-12-02', items: [P('d')] }, { date: '2026-12-03', items: [] }],
  flights: [], members: [{ id: 'm1', name: '나', color: '#000' }],
  expenses: [{ id: 'e1', title: '밥', amount: 10, currency: 'KRW', category: 'food', payer: 'm1', split: ['m1'], date: '2026-12-01' }],
  checklist: [{ id: 'c1', text: '여권', group: '서류', done: false }, { id: 'c2', text: '충전기', group: '짐', done: false }],
  journal: {}, currency: 'JPY', rate: 9, budget: 0, createdAt: 1,
}
const names = (t: Trip, i: number) => t.days[i].items.map((p) => p.name).join(',')
let fails = 0
const check = (label: string, ok: boolean, got?: unknown) => { if (!ok) fails++; console.log(ok ? 'PASS' : 'FAIL', label, ok ? '' : JSON.stringify(got)) }
const both = (A: Trip, B: Trip) => {
  const ab = mergeTrips(A, B), ba = mergeTrips(B, A)
  check('  양방향 병합 결과가 같다', sameContent(ab, ba), [names(ab, 0), names(ba, 0)])
  check('  다시 합쳐도 변하지 않는다', sameContent(mergeTrips(B, shared(ab)), ab) && sameContent(mergeTrips(ab, shared(ab)), ab))
  return ab
}

// 1. 서로 다른 항목을 고치면 둘 다 남는다
{
  const A = edit(base, (t) => { t.days[0].items.push(P('x', '스카이트리')) })
  let B = edit(base, (t) => { t.expenses[0].amount = 99 })
  B = edit(B, (t) => { t.checklist = t.checklist.filter((c) => c.id !== 'c2') })
  B = edit(B, (t) => { t.members.push({ id: 'm2', name: '지우', color: '#111' }) })
  const m = both(A, B)
  check('1 A가 넣은 장소가 남는다', names(m, 0) === 'a,b,c,스카이트리', names(m, 0))
  check('1 B가 고친 지출이 남는다', m.expenses[0].amount === 99)
  check('1 B가 지운 준비물은 지워진다', m.checklist.length === 1 && m.checklist[0].id === 'c1', m.checklist)
  check('1 B가 추가한 동행이 남는다', m.members.length === 2)
}
// 2. 같은 항목을 둘 다 고치면 나중 것이 남는다
{
  const A = edit(base, (t) => { t.days[0].items[0].note = 'A 메모' })
  const B = edit(base, (t) => { t.days[0].items[0].note = 'B 메모' })
  check('2 나중에 고친 B의 메모', both(A, B).days[0].items[0].note === 'B 메모')
}
// 3. 삭제: 그 뒤에 다른 쪽이 고치지 않았으면 지워지고, 고쳤으면 살아남는다
{
  const B0 = edit(base, (t) => { t.days[0].items[1].note = '예전 수정' })
  const A = edit(base, (t) => { t.days[0].items = t.days[0].items.filter((p) => p.id !== 'b') })
  check('3 A가 지운 장소는 지워진다', names(both(A, B0), 0) === 'a,c', names(mergeTrips(A, B0), 0))
  const B1 = edit(base, (t) => { t.days[0].items[1].note = '삭제 뒤 수정' })
  check('3 삭제 뒤에 B가 고친 장소는 살아남는다', both(A, B1).days[0].items.some((p) => p.id === 'b'))
}
// 4. 한쪽은 순서를 바꾸고 다른 쪽은 장소를 넣는다
{
  const B = edit(base, (t) => { t.days[0].items.push(P('y', '새 장소')) })
  const A = edit(base, (t) => { t.days[0].items.reverse() })
  check('4 A의 순서 + B의 새 장소', names(both(A, B), 0) === 'c,b,a,새 장소', names(mergeTrips(A, B), 0))
}
// 5. 다른 날로 옮기기 + 다른 쪽의 무관한 수정
{
  const A = edit(base, (t) => { const [p] = t.days[0].items.splice(0, 1); t.days[1].items.push(p) })
  const B = edit(base, (t) => { t.title = '도쿄 겨울' })
  const m = both(A, B)
  check('5 옮긴 장소가 한 곳에만 있다', names(m, 0) === 'b,c' && names(m, 1) === 'd,a', [names(m, 0), names(m, 1)])
  check('5 제목 변경이 남는다', m.title === '도쿄 겨울')
}
// 6. 기간 줄이기: 사라진 날의 장소는 마지막 날로
{
  const A = edit(base, (t) => { t.end = '2026-12-01'; t.days = [{ date: '2026-12-01', items: [...t.days[0].items, ...t.days[1].items] }] })
  const B = edit(base, (t) => { t.days[1].items.push(P('z', '둘째 날 추가')) })
  const m = both(A, B)
  check('6 하루짜리가 되고 장소는 모두 남는다', m.days.length === 1 && m.days[0].items.length === 5, m.days.map((d) => d.items.map((p) => p.name)))
}
// 7. 기록: 글은 나중 것, 사진은 이 기기 것
{
  const A = edit(base, (t) => { t.journal['2026-12-01'] = { text: 'A 글', photos: ['photo-local'] } })
  const B = edit(base, (t) => { t.journal['2026-12-01'] = { text: 'B 글', photos: [] } })
  const m = mergeTrips(A, shared(B))
  check('7 B의 글 + A 기기의 사진', m.journal['2026-12-01'].text === 'B 글' && m.journal['2026-12-01'].photos[0] === 'photo-local', m.journal)
  check('7 파일에는 사진 키와 동기화 상태가 없다', shared({ ...A, drive: { fileId: 'f' } }).journal['2026-12-01'].photos.length === 0 && !('drive' in shared({ ...A, drive: { fileId: 'f' } })))
}
// 8. 바뀐 것이 없으면 변경 시각을 찍지 않는다
{
  const same = edit(base, () => {})
  check('8 내용이 그대로면 updatedAt이 생기지 않는다', same.updatedAt === undefined)
}
console.log(fails ? `\n${fails}개 실패` : '\n모두 통과')
process.exit(fails ? 1 : 0)
