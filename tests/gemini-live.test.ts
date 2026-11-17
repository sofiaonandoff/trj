// 실제 Gemini API로 일정 초안을 한 번 받아 본다 (네트워크와 .env.local의 GEMINI_API_KEY 필요)
//   npx tsx tests/gemini-live.test.ts
import fs from 'node:fs'
import path from 'node:path'
import { handlePlan } from '../server/plan'

const env = fs.readFileSync(path.resolve(import.meta.dirname, '../.env.local'), 'utf8')
const key = env.match(/^GEMINI_API_KEY=(.+)$/m)?.[1].trim()
if (!key) { console.log('.env.local에 GEMINI_API_KEY가 없습니다'); process.exit(1) }

const r = await handlePlan({ mode: 'trip', city: '리스본', country: '포르투갈', start: '2026-12-01', end: '2026-12-02', pace: 'normal', interests: ['food'], lang: 'ko' }, { GEMINI_API_KEY: key })
const data = r.json as { error?: string; detail?: string; model?: string; days?: { items: { name: string; start: string }[] }[] }
if (r.status !== 200) { console.log(`실패 (${r.status}) ${data.error}: ${data.detail ?? ''}`); process.exit(1) }
console.log(`성공, 모델 ${data.model}`)
data.days?.forEach((d, i) => console.log(`${i + 1}일차: ${d.items.map((p) => `${p.start} ${p.name}`).join(' → ')}`))
