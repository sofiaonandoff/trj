import { handleView, type ViewStore } from './view'

/**
 * 홈 화면 위젯용 데이터 (/api/widget/<보기 링크 id>?lang=ko&tz=Asia/Seoul[&format=txt]).
 * 보기 링크의 여행에서 오늘(그 시간대 기준) 보여 줄 것만 계산해 납작한 JSON으로 준다.
 * 안드로이드 KWGT는 $wg("주소", json, ".badge")$처럼 값 하나씩 꺼내 쓰고, format=txt면 위젯 전체를 글 한 덩어리로 준다.
 */
type Lang = 'ko' | 'en'
interface TripLike {
  title: string; start: string; end: string
  days?: { date: string; items: { name: string; time?: string }[] }[]
  flights?: { flightNo: string; from: string; to: string; depDate: string; depTime: string; arrDate: string; arrTime: string }[]
  stays?: { name: string; checkIn: string; checkOut: string; inTime?: string; outTime?: string }[]
  tx?: Record<string, { en?: string; ko?: string }>
  txv?: number
}

const T = {
  ko: { left: (n: number) => `D-${n}`, day: (n: number) => `${n}일차`, done: '다녀온 여행', none: '오늘은 정해진 일정이 없어요', out: '체크아웃', in: '체크인', arr: '도착', first: '첫날 일정', next: '다음' },
  en: { left: (n: number) => `D-${n}`, day: (n: number) => `Day ${n}`, done: 'Trip finished', none: 'Nothing planned today', out: 'Check-out', in: 'Check-in', arr: 'Arrive', first: 'First day', next: 'Next' },
}
const pad = (n: number) => String(n).padStart(2, '0')
const days = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000)
const md = (s: string) => `${Number(s.slice(5, 7))}.${Number(s.slice(8, 10))}`

/** 그 시간대의 지금 날짜·시각 */
export function nowIn(tz: string, at = new Date()): { date: string; hm: string } {
  try {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(at).map((x) => [x.type, x.value]))
    return { date: `${p.year}-${p.month}-${p.day}`, hm: `${p.hour}:${p.minute}` }
  } catch { return nowIn('Asia/Seoul', at) }
}

export interface WidgetData {
  title: string; badge: string; date: string; next: string; nextTime: string; nextName: string
  count: number; lines: string[]; text: string
  [k: `line${number}`]: string
}

/** 오늘 위젯에 보여 줄 것 */
export function widgetData(t: TripLike, lang: Lang, now: { date: string; hm: string }): WidgetData {
  const L = T[lang]
  const tx = (s: string) => (t.txv === 2 && t.tx?.[s]?.[lang]) || s
  const today = now.date
  const before = today < t.start, after = today > t.end
  const date = before ? t.start : after ? t.end : today
  const badge = before ? L.left(days(today, t.start)) : after ? L.done : L.day(days(t.start, today) + 1)

  const list: { time?: string; sort: string; text: string; i: number }[] = []
  let i = 0
  for (const s of t.stays ?? []) if (s.checkOut === date) list.push({ time: s.outTime || '11:00', sort: s.outTime || '11:00', text: `🛏 ${L.out} · ${tx(s.name)}`, i: i++ })
  let eff = '00:00'
  for (const p of (t.days ?? []).find((d) => d.date === date)?.items ?? []) { eff = p.time || eff; list.push({ time: p.time, sort: eff, text: tx(p.name), i: i++ }) }
  for (const f of t.flights ?? []) {
    if (f.depDate === date) list.push({ time: f.depTime, sort: f.depTime, text: `✈ ${f.flightNo} ${f.from}→${f.to}`, i: i++ })
    else if (f.arrDate === date) list.push({ time: f.arrTime, sort: f.arrTime, text: `✈ ${L.arr} ${f.to} (${f.flightNo})`, i: i++ })
  }
  for (const s of t.stays ?? []) if (s.checkIn === date) list.push({ time: s.inTime || '15:00', sort: s.inTime || '15:00', text: `🛏 ${L.in} · ${tx(s.name)}`, i: i++ })
  list.sort((a, b) => a.sort.localeCompare(b.sort) || a.i - b.i)

  // 오늘이면 지난 일정은 건너뛴다 (다 지났으면 하루 전체)
  const upcoming = date === today && !after ? list.filter((e) => (e.time ?? e.sort) >= now.hm) : list
  const shown = after ? [] : upcoming.length ? upcoming : list
  const lines = shown.map((e) => `${e.time ?? '  ·  '}  ${e.text}`)
  const n = shown[0]
  const head = `${tx(t.title)} · ${badge}`
  const sub = `${before ? `${L.first} · ` : ''}${md(date)}`
  const body = after ? '' : lines.length ? lines.slice(0, 9).join('\n') : L.none
  const out: WidgetData = {
    title: tx(t.title), badge, date: md(date),
    next: n ? `${n.time ?? ''} ${n.text}`.trim() : after ? '' : L.none,
    nextTime: n?.time ?? '', nextName: n?.text ?? '',
    count: shown.length, lines: lines.slice(0, 9),
    text: [head, sub, body].filter(Boolean).join('\n'),
  }
  for (let k = 1; k <= 9; k++) out[`line${k}`] = lines[k - 1] ?? ''
  return out
}

/** /api/widget/<id> 처리 */
export async function handleWidget(id: string, query: URLSearchParams, store?: ViewStore): Promise<{ status: number; body: string; type: string }> {
  const r = await handleView('GET', id, null, null, store)
  const lang: Lang = query.get('lang') === 'en' ? 'en' : 'ko'
  const txt = query.get('format') === 'txt'
  if (r.status !== 200) {
    const msg = lang === 'en' ? 'This view link is off or wrong' : '보기 링크가 꺼졌거나 잘못되었습니다'
    return txt ? { status: r.status, body: msg, type: 'text/plain; charset=utf-8' } : { status: r.status, body: JSON.stringify({ error: (r.json as { error?: string }).error, text: msg }), type: 'application/json; charset=utf-8' }
  }
  const trip = (r.json as { data: TripLike }).data
  const d = widgetData(trip, lang, nowIn(query.get('tz') || 'Asia/Seoul'))
  return txt ? { status: 200, body: d.text, type: 'text/plain; charset=utf-8' } : { status: 200, body: JSON.stringify(d), type: 'application/json; charset=utf-8' }
}
