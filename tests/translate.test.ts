import { handleTranslate } from '../server/translate'
import { mergeTrips } from '../src/lib/merge'
import type { Trip } from '../src/types'

let fails = 0
const check = (label: string, ok: boolean, got?: unknown) => { if (!ok) fails++; console.log(ok ? 'PASS' : 'FAIL', label, ok ? '' : JSON.stringify(got)) }

// 서버: Workers AI(Gemma 3)에 한 번에 묻고, 이미 그 언어인 글은 묻지 않는다
const calls: string[][] = []
const AI = { run: async (_m: string, i: { messages: { content: string }[] }) => {
  const arr = JSON.parse(i.messages[0].content.split('\n').pop()!) as string[]
  calls.push(arr)
  return { response: '```json\n' + JSON.stringify(arr.map((t) => (t === '고장' ? '' : `[en] ${t}`))) + '\n```' }
} }
const r = await handleTranslate({ texts: ['카약 투어', 'Sky Tower', '고장'], target: 'en' }, { AI })
const out = (r.json as { texts: string[] }).texts
check('Workers AI로 한국어 → 영어 (한 번에), 이미 영어인 글은 묻지 않는다', out[0] === '[en] 카약 투어' && out[1] === 'Sky Tower' && calls.length === 1 && calls[0].join() === '카약 투어,고장', { out, calls })
check('Workers AI가 못 옮기고 Gemini도 없으면 원래 글', out[2] === '고장', out)
const bad = await handleTranslate({ texts: ['카약'], target: 'en' }, { AI: { run: async () => ({ response: 'sorry' }) } })
check('모델이 엉뚱하게 답하면 원래 글', (bad.json as { texts: string[] }).texts[0] === '카약', bad)
check('잘못된 요청은 400', (await handleTranslate({ texts: [], target: 'en' }, { AI })).status === 400)
check('Workers AI도 Gemini도 없으면 설정 안 됨', (await handleTranslate({ texts: ['안녕'], target: 'en' }, {})).status === 503)

// 병합: 두 기기가 만든 번역을 합친다
const base = { id: 't', title: '여행', days: [], flights: [], members: [], expenses: [], checklist: [], journal: {}, start: '2026-12-01', end: '2026-12-01', createdAt: 1 } as unknown as Trip
const a = { ...base, txv: 2, tx: { '카약 투어': { en: 'Kayak tour' } } }
const b = { ...base, txv: 2, tx: { '카약 투어': { ko: undefined }, 'Sky Tower': { ko: '스카이 타워' } } }
const m = mergeTrips(a, b)
check('번역 병합', m.tx?.['카약 투어']?.en === 'Kayak tour' && m.tx?.['Sky Tower']?.ko === '스카이 타워', m.tx)

const old = mergeTrips({ ...base, txv: 2, tx: { 'a': { en: 'good' } } } as Trip, { ...base, tx: { 'a': { en: 'Toughened Glass' }, 'b': { en: 'bad' } } } as Trip)
check('예전 판의 번역은 버린다', old.tx?.a?.en === 'good' && !old.tx?.b && old.txv === 2, old.tx)
console.log(fails ? `\n${fails}개 실패` : '\n모두 통과')
process.exit(fails ? 1 : 0)
