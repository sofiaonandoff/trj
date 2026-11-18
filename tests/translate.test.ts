import { handleTranslate } from '../server/translate'
import { mergeTrips } from '../src/lib/merge'
import type { Trip } from '../src/types'

let fails = 0
const check = (label: string, ok: boolean, got?: unknown) => { if (!ok) fails++; console.log(ok ? 'PASS' : 'FAIL', label, ok ? '' : JSON.stringify(got)) }

// 서버: Workers AI가 있으면 그것으로, 실패한 글만 Gemini로
const calls: string[] = []
const AI = { run: async (_m: string, i: { text: string; source_lang: string; target_lang: string }) => { calls.push(`${i.source_lang}>${i.target_lang}`); return { translated_text: i.text === '고장' ? 'ERROR: bad' : `[${i.target_lang}] ${i.text}` } } }
const r = await handleTranslate({ texts: ['카약 투어', 'Sky Tower', '고장'], target: 'en' }, { AI })
const out = (r.json as { texts: string[] }).texts
check('Workers AI로 한국어 → 영어, 이미 영어인 글은 그대로', out[0] === '[en] 카약 투어' && out[1] === 'Sky Tower' && calls.join() === 'ko>en,ko>en', { out, calls })
check('Workers AI가 못 옮기고 Gemini도 없으면 원래 글', out[2] === '고장', out)
check('잘못된 요청은 400', (await handleTranslate({ texts: [], target: 'en' }, { AI })).status === 400)
check('Workers AI도 Gemini도 없으면 설정 안 됨', (await handleTranslate({ texts: ['안녕'], target: 'en' }, {})).status === 503)

// 병합: 두 기기가 만든 번역을 합친다
const base = { id: 't', title: '여행', days: [], flights: [], members: [], expenses: [], checklist: [], journal: {}, start: '2026-12-01', end: '2026-12-01', createdAt: 1 } as unknown as Trip
const a = { ...base, tx: { '카약 투어': { en: 'Kayak tour' } } }
const b = { ...base, tx: { '카약 투어': { ko: undefined }, 'Sky Tower': { ko: '스카이 타워' } } }
const m = mergeTrips(a, b)
check('번역 병합', m.tx?.['카약 투어']?.en === 'Kayak tour' && m.tx?.['Sky Tower']?.ko === '스카이 타워', m.tx)

console.log(fails ? `\n${fails}개 실패` : '\n모두 통과')
process.exit(fails ? 1 : 0)
