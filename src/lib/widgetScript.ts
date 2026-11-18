/**
 * 아이폰 홈 화면 위젯 (Scriptable 앱용 스크립트).
 * 보기 링크 서버(/api/view/<id>)에서 여행을 받아 오늘 일정·다음 일정·D-day를 보여 준다.
 * 스크립트는 문자열로 만들어 사용자가 복사해 Scriptable에 붙여 넣는다 (앱 설치나 로그인 없이 동작).
 */
export function widgetScript(viewId: string, base: string, lang: 'ko' | 'en'): string {
  return `// trj. 여행 위젯 — Scriptable에 붙여 넣고 홈 화면 위젯에서 이 스크립트를 고르세요.
// trj. trip widget — paste into Scriptable, then pick this script in a home screen widget.
const VIEW = ${JSON.stringify(viewId)}
const BASE = ${JSON.stringify(base)}
const LANG = ${JSON.stringify(lang)}
${BODY}`
}

/* 아래는 Scriptable(아이폰)에서 그대로 실행되는 자바스크립트다. 브라우저·노드 API가 아니라 Scriptable API를 쓴다. */
const BODY = String.raw`
const T = {
  ko: { left: (n) => 'D-' + n, day: (n) => n + '일차', done: '다녀온 여행', none: '오늘은 정해진 일정이 없어요', next: '다음', now: '지금', fail: '일정을 받지 못했어요', stale: '저장된 일정', out: '체크아웃', in: '체크인', arr: '도착', more: (n) => '외 ' + n + '개', start: '첫날 일정' },
  en: { left: (n) => 'D-' + n, day: (n) => 'Day ' + n, done: 'Trip finished', none: 'Nothing planned today', next: 'Next', now: 'Now', fail: "Couldn't load the plan", stale: 'Saved plan', out: 'Check-out', in: 'Check-in', arr: 'Arrive', more: (n) => '+' + n + ' more', start: 'First day' },
}[LANG]
const C = { bg: new Color('#1C2C29'), ink: new Color('#F8F6F1'), mute: new Color('#F8F6F1', 0.62), sand: new Color('#D2B698'), line: new Color('#F8F6F1', 0.14) }

const pad = (n) => String(n).padStart(2, '0')
const ymd = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
const days = (a, b) => Math.round((Date.parse(b + 'T00:00:00') - Date.parse(a + 'T00:00:00')) / 86400000)
const md = (s) => Number(s.slice(5, 7)) + '.' + Number(s.slice(8, 10))

async function load() {
  const fm = FileManager.local()
  const cache = fm.joinPath(fm.documentsDirectory(), 'trj-' + VIEW + '.json')
  try {
    const r = await new Request(BASE + '/api/view/' + VIEW).loadJSON()
    if (r && r.data && r.data.days) { fm.writeString(cache, JSON.stringify(r.data)); return { trip: r.data } }
  } catch (e) { /* 아래에서 저장된 것을 쓴다 */ }
  if (fm.fileExists(cache)) return { trip: JSON.parse(fm.readString(cache)), stale: true }
  return {}
}

/** 그 날의 일정: 숙소 체크아웃·장소·항공편·체크인을 시각 순서로 */
function agenda(t, date) {
  const out = []
  for (const s of t.stays || []) if (s.checkOut === date) out.push({ time: s.outTime || '11:00', icon: '🛏', name: T.out + ' · ' + s.name })
  let eff = '00:00'
  const day = (t.days || []).find((d) => d.date === date)
  for (const p of day ? day.items : []) { eff = p.time || eff; out.push({ time: p.time, sort: eff, icon: '•', name: p.name }) }
  for (const f of t.flights || []) {
    if (f.depDate === date) out.push({ time: f.depTime, icon: '✈', name: f.flightNo + ' ' + f.from + '→' + f.to })
    else if (f.arrDate === date) out.push({ time: f.arrTime, icon: '✈', name: T.arr + ' ' + f.to + ' (' + f.flightNo + ')' })
  }
  for (const s of t.stays || []) if (s.checkIn === date) out.push({ time: s.inTime || '15:00', icon: '🛏', name: T.in + ' · ' + s.name })
  return out.map((e, i) => ({ ...e, i })).sort((a, b) => (a.sort || a.time || '99').localeCompare(b.sort || b.time || '99') || a.i - b.i)
}

function row(w, e, big) {
  const s = w.addStack()
  s.centerAlignContent()
  const tm = s.addText(e.time || '  ·  ')
  tm.font = Font.semiboldMonospacedSystemFont(big ? 13 : 12)
  tm.textColor = C.sand
  s.addSpacer(8)
  const nm = s.addText((e.icon === '•' ? '' : e.icon + ' ') + e.name)
  nm.font = Font.mediumSystemFont(big ? 14 : 13)
  nm.textColor = C.ink
  nm.lineLimit = 1
}

async function build() {
  const fam = config.widgetFamily || 'medium'
  const w = new ListWidget()
  w.backgroundColor = C.bg
  w.setPadding(14, 16, 14, 16)
  w.url = BASE + '/#/v/' + VIEW
  w.refreshAfterDate = new Date(Date.now() + 30 * 60 * 1000)
  const { trip: t, stale } = await load()
  if (!t) { const x = w.addText(T.fail); x.textColor = C.ink; x.font = Font.mediumSystemFont(14); return w }

  const now = new Date()
  const today = ymd(now)
  const hm = pad(now.getHours()) + ':' + pad(now.getMinutes())
  const before = today < t.start, after = today > t.end
  const date = before ? t.start : after ? t.end : today
  const badge = before ? T.left(days(today, t.start)) : after ? T.done : T.day(days(t.start, today) + 1)

  // 머리: 여행 이름 + D-day/몇일차
  const head = w.addStack()
  head.centerAlignContent()
  const ttl = head.addText(t.title)
  ttl.font = Font.boldSystemFont(fam === 'small' ? 13 : 15)
  ttl.textColor = C.ink
  ttl.lineLimit = 1
  head.addSpacer()
  const bd = head.addText(badge)
  bd.font = Font.heavySystemFont(fam === 'small' ? 13 : 15)
  bd.textColor = C.sand
  const sub = w.addText((before ? T.start + ' · ' : '') + md(date) + (stale ? ' · ' + T.stale : ''))
  sub.font = Font.systemFont(11)
  sub.textColor = C.mute
  w.addSpacer(fam === 'small' ? 8 : 10)

  if (after) { w.addSpacer(); return w }
  const list = agenda(t, date)
  if (!list.length) { const x = w.addText(T.none); x.font = Font.systemFont(13); x.textColor = C.mute; w.addSpacer(); return w }

  // 오늘이면 지난 일정은 건너뛰고 다음 것부터 (다 지났으면 하루 전체)
  const upcoming = date === today ? list.filter((e) => (e.time || e.sort || '99') >= hm) : list
  const shown = upcoming.length ? upcoming : list

  if (fam === 'small') {
    const e = shown[0]
    const lb = w.addText(date === today ? T.next : md(date))
    lb.font = Font.semiboldSystemFont(11); lb.textColor = C.sand
    const tm = w.addText(e.time || '')
    tm.font = Font.boldMonospacedSystemFont(22); tm.textColor = C.ink
    const nm = w.addText((e.icon === '•' ? '' : e.icon + ' ') + e.name)
    nm.font = Font.mediumSystemFont(13); nm.textColor = C.ink; nm.lineLimit = 2
    if (shown.length > 1) { w.addSpacer(4); const m = w.addText(T.more(shown.length - 1)); m.font = Font.systemFont(11); m.textColor = C.mute }
    w.addSpacer()
    return w
  }
  const max = fam === 'large' || fam === 'extraLarge' ? 9 : 4
  shown.slice(0, max).forEach((e, i) => { if (i) w.addSpacer(6); row(w, e, max > 4) })
  if (shown.length > max) { w.addSpacer(6); const m = w.addText(T.more(shown.length - max)); m.font = Font.systemFont(11); m.textColor = C.mute }
  w.addSpacer()
  return w
}

const widget = await build()
if (config.runsInWidget) Script.setWidget(widget)
else await widget.presentMedium()
Script.complete()
`
