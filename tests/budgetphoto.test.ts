// 예산 탭에서 넣은 사진: 일정은 그대로, 금액만 지출로
import { applyExpenseOnly } from '../src/lib/photoImport'
import type { Trip } from '../src/types'

let fail = 0
const check = (label: string, ok: boolean, got?: unknown) => { if (!ok) fail++; console.log(ok ? 'PASS' : 'FAIL', label, ok ? '' : JSON.stringify(got)) }
const trip = (): Trip => ({ id: 't', title: 'T', start: '2027-02-12', end: '2027-02-13', currency: 'THB', budget: 0, members: [{ id: 'A', name: 'A', color: '#000' }, { id: 'B', name: 'B', color: '#000' }],
  groups: [{ id: 'g', name: '방콕팀', color: '#000', members: ['B'] }],
  days: [{ date: '2027-02-12', items: [] }, { date: '2027-02-13', items: [] }], flights: [], stays: [], expenses: [], checklist: [], journal: {} } as unknown as Trip)
const stayDraft = { date: '2027-02-12', dateFrom: 'image' as const, stay: { id: 's', name: '아사이 방콕 차이나타운', lat: 13.7, lng: 100.5, checkIn: '2027-02-12', checkOut: '2027-02-13' }, expense: { id: 'e', title: 'Biggy King Bunk', amount: 370422, currency: 'KRW', category: 'stay' as const, date: '2027-02-12' } }
const t = trip()
const r = applyExpenseOnly(t, stayDraft as never)
check('숙소 화면: 지출만 기록하고 숙소는 넣지 않는다', t.expenses.length === 1 && (t.stays ?? []).length === 0 && t.days.every((d) => !d.items.length), t)
check('지출 이름은 숙소 이름, 나누기는 모두', t.expenses[0].title === '아사이 방콕 차이나타운' && t.expenses[0].split.length === 2 && r.expenseId === 'e', t.expenses[0])
check('같은 사진을 다시 넣으면 겹쳐 넣지 않는다', applyExpenseOnly(t, { ...stayDraft, expense: { ...stayDraft.expense, id: 'e2' } } as never).duplicate === true && t.expenses.length === 1)
const t2 = trip()
applyExpenseOnly(t2, stayDraft as never, 'g')
check('그룹 화면이면 그룹 사람끼리 나눈다', t2.expenses[0].group === 'g' && t2.expenses[0].split.join() === 'B' && t2.expenses[0].payer === 'B', t2.expenses[0])
const none = applyExpenseOnly(t2, { date: '2027-02-12', dateFrom: 'image', flight: { id: 'f', flightNo: 'FD3249', from: 'KKC', to: 'DMK', depDate: '2027-02-12', depTime: '12:15', arrDate: '2027-02-12', arrTime: '13:15' } } as never)
check('금액이 없으면 기록하지 않는다 (항공편도 넣지 않는다)', none.noAmount === true && t2.flights.length === 0 && t2.expenses.length === 1)
process.exit(fail ? 1 : 0)
