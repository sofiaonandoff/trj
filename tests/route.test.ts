// 도로 길찾기: 서버(OSRM 응답 해석, KV 캐시)와 화면의 도보/택시 판단
import { handleRoute } from '../server/route'
import { memoryStore } from '../server/view'
import { _putLeg, hop } from '../src/lib/route'

let fail = 0
const check = (label: string, ok: boolean, got?: unknown) => { if (!ok) fail++; console.log(ok ? 'PASS' : 'FAIL', label, ok ? '' : JSON.stringify(got)) }

// FOSSGIS OSRM 응답 모양 (방콕 민주기념탑 → 왕궁 → 왓포, 실제 응답에서 줄임)
const calls: string[] = []
globalThis.fetch = (async (url: string) => {
  calls.push(url)
  const foot = url.includes('routed-foot')
  const legs = foot ? [{ duration: 1489.2, distance: 1861.4 }, { duration: 1209.1, distance: 1508.7 }] : [{ duration: 300, distance: 2500 }, { duration: 240, distance: 1900 }]
  return new Response(JSON.stringify({ code: 'Ok', routes: [{ legs }] }))
}) as typeof fetch

const kv = memoryStore()
const pts = [[100.5018, 13.7563], [100.4913, 13.75], [100.493, 13.744]]
const r1 = await handleRoute({ pts }, { TRJ_VIEWS: kv })
const j1 = r1.json as { legs: { w: number[]; c: number[] }[]; source: string }
check('도보·차 두 번만 묻는다 (동선 전체를 한 번에)', calls.length === 2 && calls[0].includes('routed-foot') && calls[1].includes('routed-car'), calls)
check('구간마다 [미터, 초]', JSON.stringify(j1.legs[0]) === '{"w":[1861,1489],"c":[2500,300]}' && j1.source === 'osrm', j1)
const r2 = await handleRoute({ pts }, { TRJ_VIEWS: kv })
check('두 번째는 KV에서 (길찾기 서버를 다시 부르지 않는다)', calls.length === 2 && (r2.json as { source: string }).source === 'cache', r2.json)
check('잘못된 입력은 400', (await handleRoute({ pts: [[1, 2]] }, {})).status === 400 && (await handleRoute({ pts: [[999, 2], [1, 2]] }, {})).status === 400)

const A = { lat: 13.7563, lng: 100.5018 }, B = { lat: 13.75, lng: 100.4913 }, C = { lat: 13.744, lng: 100.493 }, D = { lat: 13.745, lng: 100.4935 }
check('받기 전에는 직선거리 어림 (exact: false)', hop(A, B).exact === false)
_putLeg(A, B, { w: [1861, 1489], c: [2500, 300] })
const h = hop(A, B)
check('걸어서 15분 넘으면 택시: 차 5분 × 1.3 + 5분 ≈ 12분, 도로 거리 2.5km', h.exact && h.mode === 'taxi' && h.min === 12 && h.km === 2.5, h)
_putLeg(C, D, { w: [450, 340], c: [900, 120] })
const w = hop(C, D)
check('15분 이내는 도보: 6분, 도보 거리 450m', w.mode === 'walk' && w.min === 6 && w.km === 0.45, w)
process.exit(fail ? 1 : 0)
