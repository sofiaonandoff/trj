// 그룹: 그룹별 일정 보기, 동선 색, 지출 나누기 기본값, 그룹 지우기, 합치기
import { dayLine, groupRoutes } from '../src/lib/dayline'
import { removeGroup, visibleIn } from '../src/lib/groups'
import { mergeTrips } from '../src/lib/merge'
import { payerFor, splitFor } from '../src/store'
import type { Trip } from '../src/types'

let fail = 0
const check = (label: string, ok: boolean, got?: unknown) => { if (!ok) fail++; console.log(ok ? 'PASS' : 'FAIL', label, ok ? '' : JSON.stringify(got)) }
const P = (id: string, time: string, lat: number, lng: number, group?: string) => ({ id, name: id, lat, lng, category: 'sight' as const, time, ...(group ? { group } : {}) })
const mk = (): Trip => ({
  id: 't', title: 'Thai', start: '2027-02-09', end: '2027-02-12', currency: 'THB', budget: 0,
  members: [{ id: 'A', name: 'A', color: '#000' }, { id: 'B', name: 'B', color: '#000' }, { id: 'C', name: 'C', color: '#000' }, { id: 'D', name: 'D', color: '#000' }],
  groups: [{ id: 'k', name: '끄라비팀', color: '#C2410C', members: ['A', 'B'] }, { id: 'b', name: '방콕팀', color: '#0F766E', members: ['C', 'D'] }],
  days: [
    { date: '2027-02-09', items: [] },
    { date: '2027-02-10', items: [P('shared', '09:00', 13.75, 100.5), P('krabi1', '10:00', 8.05, 98.9, 'k'), P('bkk1', '11:00', 13.74, 100.52, 'b'), P('krabi2', '15:00', 8.06, 98.91, 'k'), P('bkk2', '16:00', 13.73, 100.53, 'b')] },
    { date: '2027-02-11', items: [] }, { date: '2027-02-12', items: [] },
  ],
  flights: [{ id: 'f', flightNo: 'FD3011', from: 'DMK', to: 'KBV', depDate: '2027-02-10', depTime: '07:00', arrDate: '2027-02-10', arrTime: '08:20', group: 'k' }],
  stays: [
    { id: 'sk', name: 'Krabi Resort', lat: 8.04, lng: 98.9, checkIn: '2027-02-09', checkOut: '2027-02-12', group: 'k' },
    { id: 'sb', name: 'Bangkok Hotel', lat: 13.74, lng: 100.53, checkIn: '2027-02-09', checkOut: '2027-02-12', group: 'b' },
  ],
  expenses: [{ id: 'e1', title: 'resort', amount: 100, currency: 'THB', category: 'stay', payer: 'A', split: ['A', 'B'], date: '2027-02-09', group: 'k' }],
  checklist: [], journal: {},
} as unknown as Trip)
const t = mk()
const ids = (v?: string) => dayLine(t, '2027-02-10', v).map((e) => e.kind === 'place' ? `${e.place.id}#${e.no + 1}` : e.kind === 'flight' ? `✈${e.flight.flightNo}` : e.kind === 'stay-start' ? `↑${e.stay.id}` : e.kind === 'stay-end' ? `↓${e.stay.id}` : '?').join(' ')
check('끄라비 탭: 끄라비 숙소·항공편·장소와 모두의 장소만, 번호는 보이는 것만', ids('k') === '↑sk ✈FD3011 shared#1 krabi1#2 krabi2#3 ↓sk', ids('k'))
check('방콕 탭: 방콕 것만', ids('b') === '↑sb shared#1 bkk1#2 bkk2#3 ↓sb', ids('b'))
const all = ids('all')
check('전체 탭: 모든 장소와 두 숙소', ['shared#1', 'krabi1#2', 'bkk1#3', 'krabi2#4', 'bkk2#5', '↑sk', '↑sb', '↓sk', '↓sb', '✈FD3011'].every((x) => all.includes(x)), all)
check('그룹을 쓰지 않으면 예전처럼 (view 없음)', dayLine(t, '2027-02-10').filter((e) => e.kind === 'place').length === 5)
const r = groupRoutes(t, '2027-02-10', 'all', dayLine(t, '2027-02-10', 'all'))
check('전체 탭 동선: 그룹마다 색', r?.length === 2 && r[0].color === '#C2410C' && r[1].color === '#0F766E', r?.map((x) => x.color))
check('그룹 탭 동선: 그 그룹 색', groupRoutes(t, '2027-02-10', 'b', [])?.[0].color === '#0F766E')
check('모두 함께인 날은 기본 동선', groupRoutes({ ...t, stays: [], flights: [] } as Trip, '2027-02-11', 'all', []) === undefined)
check('visibleIn: 모두의 일정은 어느 그룹에서나', visibleIn('k', {}) && !visibleIn('k', { group: 'b' }) && visibleIn('all', { group: 'b' }))
check('지출 나눌 사람 기본값: 그룹 사람들', JSON.stringify(splitFor(t, 'b')) === '["C","D"]' && payerFor(t, 'b') === 'C')
check('그룹 없으면 모두', splitFor(t).length === 4)

const t2 = mk(); removeGroup(t2, 'k')
check('그룹 지우기: 그 그룹 일정은 모두의 일정으로', !t2.days[1].items.some((p) => p.group === 'k') && !t2.flights[0].group && !t2.stays![0].group && !t2.expenses[0].group && t2.groups!.length === 1)

const local = mk(), remote = mk()
remote.groups!.push({ id: 'n', name: '새그룹', color: '#7C3AED', members: ['A'] })
const m = mergeTrips(local, remote)
check('합치기: 다른 기기에서 만든 그룹도 들어온다', Boolean(m.groups?.some((g) => g.id === 'n')), m.groups?.map((g) => g.id))
process.exit(fail ? 1 : 0)
