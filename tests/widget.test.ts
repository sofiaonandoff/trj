import { widgetScript } from '../src/lib/widgetScript'
import { handleView, memoryStore } from '../server/view'

/* Scriptable API를 흉내 내 위젯 스크립트를 실제로 돌려 본다 */
let fails = 0
const check = (label: string, ok: boolean, got?: unknown) => { if (!ok) fails++; console.log(ok ? 'PASS' : 'FAIL', label, ok ? '' : JSON.stringify(got)) }

const trip = {
  title: '뉴질랜드 남섬', start: '2026-12-07', end: '2026-12-09',
  days: [{ date: '2026-12-07', items: [{ name: 'Sky Tower', time: '10:00' }] }, { date: '2026-12-08', items: [{ name: '보태닉 가든', time: '16:00' }, { name: '저녁' }] }, { date: '2026-12-09', items: [] }],
  flights: [{ flightNo: 'NZ501', from: 'AKL', to: 'CHC', depDate: '2026-12-08', depTime: '13:05', arrDate: '2026-12-08', arrTime: '14:30' }],
  stays: [{ name: 'Quest Auckland', checkIn: '2026-12-07', checkOut: '2026-12-08' }],
}
const store = memoryStore()
const made = (await handleView('POST', '', { data: trip }, null, store)).json as { id: string }

async function run(now: string, family: string, offline = false) {
  const texts: string[] = []
  let url = ''
  const stack = () => ({ centerAlignContent() {}, addSpacer() {}, addText: (s: string) => { texts.push(s); return {} }, addStack: () => stack() })
  class ListWidget { backgroundColor: unknown; url = ''; refreshAfterDate: unknown; setPadding() {} addSpacer() {} addText(s: string) { texts.push(s); return {} } addStack() { return stack() } async presentMedium() {} set _u(v: string) { url = v } }
  const files = new Map<string, string>()
  const g = globalThis as Record<string, unknown>
  g.ListWidget = ListWidget
  g.Color = class { constructor(public c: string, public a?: number) {} }
  g.Font = new Proxy({}, { get: () => () => ({}) })
  g.Request = class { constructor(public u: string) {} async loadJSON() { if (offline) throw new Error('offline'); const r = await handleView('GET', this.u.split('/').pop()!, null, null, store); return r.json } }
  g.FileManager = { local: () => ({ documentsDirectory: () => '/d', joinPath: (a: string, b: string) => a + '/' + b, writeString: (p: string, v: string) => files.set(p, v), readString: (p: string) => files.get(p), fileExists: (p: string) => files.has(p) }) }
  g.config = { widgetFamily: family, runsInWidget: true }
  let set: { url: string } | undefined
  g.Script = { setWidget: (w: { url: string }) => { set = w }, complete() {} }
  const RealDate = Date
  const fixed = new RealDate(now).getTime()
  g.Date = class extends RealDate { constructor(...a: unknown[]) { super(...((a.length ? a : [fixed]) as [number])) } static now() { return fixed } }
  const code = widgetScript(made.id, 'https://trj-onnoff.pages.dev', 'ko')
  await new Function(`return (async () => { ${code} })()`)()
  g.Date = RealDate
  void url
  return { texts, url: set?.url }
}

const before = await run('2026-12-01T09:00:00', 'medium')
check('여행 전: D-6과 첫날 일정', before.texts.includes('D-6') && before.texts.some((t) => t.includes('Sky Tower')) && before.texts.some((t) => t.includes('체크인 · Quest Auckland')), before.texts)
check('위젯을 누르면 보기 링크가 열린다', before.url === `https://trj-onnoff.pages.dev/#/v/${made.id}`, before.url)
const day2 = await run('2026-12-08T12:00:00', 'medium')
check('여행 중: 2일차, 지난 체크아웃은 빼고 항공편부터', day2.texts.includes('2일차') && day2.texts[day2.texts.indexOf('13:05') + 1]?.includes('NZ501 AKL→CHC') && !day2.texts.some((t) => t.includes('체크아웃')), day2.texts)
const small = await run('2026-12-08T15:00:00', 'small')
check('작은 위젯: 다음 일정 하나와 남은 수', small.texts.includes('16:00') && small.texts.includes('보태닉 가든') && small.texts.some((t) => t.startsWith('외 ')), small.texts)
const after = await run('2026-12-20T09:00:00', 'medium')
check('여행 뒤: 다녀온 여행', after.texts.includes('다녀온 여행'), after.texts)
const off = await run('2026-12-08T12:00:00', 'medium', true)
check('인터넷이 없으면 받지 못했다고 알린다 (처음 실행)', off.texts.some((t) => t.includes('받지 못했어요')), off.texts)

// 안드로이드(KWGT)용 위젯 주소: 계산한 값을 납작하게
{
  const { handleWidget, widgetData, nowIn } = await import('../server/widget')
  const w = widgetData(trip as never, 'ko', { date: '2026-12-08', hm: '12:00' })
  check('위젯 데이터: 2일차, 다음은 항공편, 줄마다', w.badge === '2일차' && w.next === '13:05 ✈ NZ501 AKL→CHC' && w.line1 === w.next.replace(' ', '  ') && w.count === 3 && w.text.startsWith('뉴질랜드 남섬 · 2일차\n12.8\n'), w)
  const before = widgetData(trip as never, 'en', { date: '2026-12-01', hm: '09:00' })
  check('여행 전 (영어): D-6, 첫날 일정', before.badge === 'D-6' && before.text.includes('First day · 12.7') && before.line1.includes('Sky Tower'), before)
  check('여행 뒤: 다녀온 여행, 일정 줄 없음', widgetData(trip as never, 'ko', { date: '2026-12-20', hm: '09:00' }).text === '뉴질랜드 남섬 · 다녀온 여행\n12.9')
  check('시간대: 서울 기준 날짜', nowIn('Asia/Seoul', new Date('2026-12-07T16:30:00Z')).date === '2026-12-08' && nowIn('Asia/Seoul', new Date('2026-12-07T16:30:00Z')).hm === '01:30')
  const api = await handleWidget(made.id, new URLSearchParams('lang=ko&format=txt'), store)
  check('주소로 받기 (글)', api.status === 200 && api.type.startsWith('text/plain') && api.body.startsWith('뉴질랜드 남섬 · '), api)
  check('없는 링크', (await handleWidget('NOPE12345', new URLSearchParams(''), store)).status === 404)
}
console.log(fails ? `\n${fails}개 실패` : '\n모두 통과')
process.exit(fails ? 1 : 0)
