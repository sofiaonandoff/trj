import { applyDraft, pickDate, toBudget, undoApplied } from '../src/lib/photoImport'
import type { Trip } from '../src/types'

let fail = 0
const check = (label: string, ok: boolean, got?: unknown) => { if (!ok) fail++; console.log(ok ? 'PASS' : 'FAIL', label, ok ? '' : JSON.stringify(got)) }
const days = ['2026-12-02', '2026-12-03', '2026-12-04']

check('사진 속 날짜가 여행 안이면 그 날', pickDate(days, '2026-12-04', '2026-12-03', '2026-12-02').date === '2026-12-04')
check('사진 속 날짜가 여행 밖이면 찍은 날', pickDate(days, '2026-11-20', '2026-12-03', '2026-12-02').date === '2026-12-03')
check('둘 다 없으면 보고 있던 날', pickDate(days, undefined, undefined, '2026-12-02').from === 'current')
check('여행지 통화는 그대로', toBudget({ currency: 'THB' }, 120, 'THB', 4800)?.currency === 'THB')
check('아는 다른 통화는 그 통화 그대로', JSON.stringify(toBudget({ currency: 'THB' }, 10, 'USD', 14000)) === JSON.stringify({ amount: 10, currency: 'USD' }))
check('모르는 통화는 원화로', JSON.stringify(toBudget({ currency: 'THB' }, 10, 'XYZ', 14000)) === JSON.stringify({ amount: 14000, currency: 'KRW', extra: '10 XYZ' }))
check('금액 없으면 기록 안 함', toBudget({ currency: 'THB' }, 0, 'THB', 0) === null)

const trip = {
  days: days.map((date) => ({ date, items: [] as never[] })), flights: [], expenses: [],
  members: [{ id: 'a', name: '나', color: '' }, { id: 'b', name: '민지', color: '' }],
} as unknown as Trip
const d = { date: '2026-12-03', dateFrom: 'photo' as const, place: { id: 'p1', name: '카페', lat: 1, lng: 1, category: 'cafe' as const }, expense: { id: 'e1', title: '카페', amount: 120, currency: 'THB', category: 'food' as const, date: '2026-12-03' } }
const r = applyDraft(trip, structuredClone(d), () => {})
check('장소는 그 날에', trip.days[1].items.length === 1 && r.placeAdded === true)
check('비용은 나눔으로 예산에', trip.expenses.length === 1 && trip.expenses[0].split.length === 2 && trip.expenses[0].payer === 'a')
check('사진으로 넣은 장소에 비용이 묶인다', (trip.days[1].items[0] as { expenseId?: string }).expenseId === 'e1')
const again = applyDraft(trip, { ...structuredClone(d), place: { ...d.place, id: 'p2' }, expense: { ...d.expense, id: 'e2' } }, () => {})
check('같은 영수증을 다시 올려도 겹치지 않는다', trip.days[1].items.length === 1 && trip.expenses.length === 1 && !again.placeAdded, again)
undoApplied(trip, again)
check('겹친 것을 빼도 원래 것은 남는다', trip.days[1].items.length === 1 && trip.expenses.length === 1)
undoApplied(trip, r)
check('빼면 장소와 비용이 함께 빠진다', trip.days[1].items.length === 0 && trip.expenses.length === 0)
{
  // 장소의 전체 예약 비용: 넣으면 지출이 생기고, 고치면 같은 지출이 바뀌고, 0이면 지워지고, 장소를 지우면 함께 지워진다
  const { syncPlaceCost, removePlace } = await import('../src/store')
  const t = structuredClone(trip)
  const p = { id: 'tour', name: '카약 투어', lat: 0, lng: 0, category: 'nature' as const }
  t.days[0].items.push(p)
  syncPlaceCost(t, p, t.days[0].date, { amount: 178, currency: 'NZD' })
  const e = t.expenses.find((x) => x.id === (p as { expenseId?: string }).expenseId)
  check('예약 비용 → 관광 지출 (통화 그대로, 모두 나눔)', e?.amount === 178 && e.currency === 'NZD' && e.category === 'play' && e.split.length === 2 && e.date === t.days[0].date, e)
  syncPlaceCost(t, p, t.days[1].date, { amount: 200, currency: 'USD' })
  check('고치면 같은 지출이 바뀐다', t.expenses.filter((x) => x.title === '카약 투어').length === 1 && e?.amount === 200 && e.currency === 'USD' && e.date === t.days[1].date)
  removePlace(t, 'tour')
  check('장소를 지우면 지출도 지워진다', !t.expenses.some((x) => x.title === '카약 투어') && !t.days[0].items.length)
}
console.log(fail ? `${fail}개 실패` : '모두 통과')
process.exit(fail ? 1 : 0)
