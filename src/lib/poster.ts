import { BRAND, LOGO } from '../brand'
import { lang, tr } from '../i18n'
import { mapSnapshot, type MapSnapshot, type MapTint } from './mapSnapshot'
import { airlineOf } from '../data/airports'
import { CATEGORY } from '../data/destinations'
import type { Flight, Place, Trip } from '../types'
import { distLabel, fmtDur, fmtRange, km, md, weekday } from './util'

/** 내보내기 이미지의 화면 비율 */
export const RATIOS = {
  story: { w: 1080, h: 1920, label: '9:16', hint: tr('스토리·릴스') },
  square: { w: 1080, h: 1080, label: '1:1', hint: tr('피드') },
  wide: { w: 1920, h: 1080, label: '16:9', hint: tr('영상·블로그') },
} as const
export type Ratio = keyof typeof RATIOS

/** 템플릿: 색만 다르고 배치는 같다 */
export const THEMES = {
  forest: { label: tr('포레스트'), bg: BRAND.forest, fg: BRAND.linen, sub: 'rgba(248,246,241,0.62)', accent: BRAND.sand, route: BRAND.sand, onRoute: BRAND.forest, card: 'rgba(248,246,241,0.06)', line: 'rgba(248,246,241,0.12)',
    map: { land: '#22342F', water: '#142019', green: '#263A31', road: 'rgba(248,246,241,0.18)', minor: 'rgba(248,246,241,0.08)' } },
  linen: { label: tr('리넨'), bg: BRAND.linen, fg: BRAND.forest, sub: '#66716D', accent: BRAND.sandInk, route: BRAND.forest, onRoute: BRAND.linen, card: BRAND.sage, line: '#DDE1D8',
    map: { land: '#E7EBE2', water: '#CCD8D3', green: '#DAE2D0', road: '#FFFFFF', minor: 'rgba(255,255,255,0.7)' } },
  sand: { label: tr('샌드'), bg: BRAND.sand, fg: BRAND.forest, sub: 'rgba(28,44,41,0.66)', accent: BRAND.forest, route: BRAND.forest, onRoute: BRAND.sand, card: 'rgba(248,246,241,0.32)', line: 'rgba(28,44,41,0.16)',
    map: { land: '#DCC6AA', water: '#C2A482', green: '#D3BE9C', road: 'rgba(248,246,241,0.72)', minor: 'rgba(248,246,241,0.38)' } },
} as const
export type ThemeId = keyof typeof THEMES
type Theme = (typeof THEMES)[ThemeId] & { map: MapTint }

/** 'summary'는 여행 전체 한 장, 숫자는 그 날(0부터) 한 장 */
export type Page = 'summary' | number
export interface PosterOptions { ratio: Ratio; theme: ThemeId; page: Page }

/** 한국어 화면에서 틀 문구에 쓰이는 글자. 캔버스에 그리기 전에 글꼴 조각을 받아 두려고 쓴다 */
const FONT_HINT = (lang === 'ko' ? '자유 일정 이 날은 입니다 그리고 더 곳 이동 박 일 명이 함께 당일치기 ' : '') + BRAND.tagline + BRAND.full

interface Rect { x: number; y: number; w: number; h: number }
type Ctx = CanvasRenderingContext2D
const KO = '"Pretendard Variable", Pretendard, system-ui, sans-serif'
const NUM = KO
const font = (weight: number, size: number, family = KO) => `${weight} ${Math.round(size)}px ${family}`

/** 폭에 맞지 않으면 끝을 …로 줄인다 */
function fit(c: Ctx, text: string, max: number) {
  if (c.measureText(text).width <= max) return text
  let s = text
  while (s.length > 1 && c.measureText(`${s}…`).width > max) s = s.slice(0, -1)
  return `${s.trimEnd()}…`
}
/** 정해진 줄 수 안에서 줄바꿈하고, 넘치면 마지막 줄을 줄인다 */
function wrap(c: Ctx, parts: string[], sep: string, max: number, lines: number): string[] {
  const out: string[] = ['']
  parts.forEach((p, i) => {
    const piece = i ? `${sep}${p}` : p
    const cur = out[out.length - 1]
    if (!cur || c.measureText(cur + piece).width <= max) out[out.length - 1] = cur + piece
    else out.push(p)
  })
  if (out.length <= lines) return out.map((l) => fit(c, l, max))
  const kept = out.slice(0, lines)
  kept[lines - 1] = fit(c, `${kept[lines - 1]}${sep}${out[lines]}`, max)
  return kept
}
/** 줄이지 않고 다 쓰려면 몇 줄이 필요한지 */
function linesNeeded(c: Ctx, parts: string[], sep: string, max: number) {
  let n = 1, cur = ''
  parts.forEach((p, i) => {
    const piece = i ? `${sep}${p}` : p
    if (!cur || c.measureText(cur + piece).width <= max) cur += piece; else { n++; cur = p }
  })
  return n
}
/** 지도 이미지 위에 동선을 그린다. 점은 지도 투영으로 얻은 실제 위치에 놓인다 */
function drawOnMap(c: Ctx, r: Rect, th: Theme, places: Place[], numbered: boolean, caption: string, snap: MapSnapshot) {
  c.save()
  c.beginPath(); c.roundRect(r.x, r.y, r.w, r.h, 40); c.clip()
  c.drawImage(snap.image, r.x, r.y, r.w, r.h)
  const xy = places.map((p) => { const [x, y] = snap.project(p.lng, p.lat); return [r.x + x, r.y + y] as [number, number] }).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y))
  if (xy.length > 1) {
    const path = () => { c.beginPath(); c.moveTo(xy[0][0], xy[0][1]); for (const [x, y] of xy.slice(1)) c.lineTo(x, y) }
    c.lineCap = 'round'; c.lineJoin = 'round'
    // 지도 위에서도 선이 묻히지 않도록 땅색 테두리를 먼저 깐다
    path(); c.strokeStyle = th.map.land; c.lineWidth = 17; c.stroke()
    path(); c.strokeStyle = th.route; c.lineWidth = 8; c.stroke()
  }
  xy.forEach(([x, y], i) => {
    const last = i === xy.length - 1
    if (numbered || xy.length === 1) {
      c.beginPath(); c.arc(x, y, 27, 0, Math.PI * 2); c.fillStyle = th.route; c.fill()
      c.lineWidth = 5; c.strokeStyle = th.map.land; c.stroke()
      c.font = font(800, 26, NUM); c.fillStyle = th.onRoute; c.textAlign = 'center'; c.textBaseline = 'middle'
      c.fillText(String(i + 1), x, y + 2)
    } else if (last) {
      c.beginPath(); c.arc(x, y, 19, 0, Math.PI * 2); c.fillStyle = th.accent; c.fill()
      c.lineWidth = 5; c.strokeStyle = th.map.land; c.stroke()
    } else {
      c.beginPath(); c.arc(x, y, 10, 0, Math.PI * 2); c.fillStyle = th.map.land; c.fill()
      c.lineWidth = 5; c.strokeStyle = th.route; c.stroke()
    }
  })
  c.textAlign = 'left'; c.textBaseline = 'alphabetic'
  // OpenStreetMap 데이터 출처 (라이선스상 표기해야 한다)
  c.font = font(500, 15); c.fillStyle = th.sub; c.textAlign = 'right'
  c.fillText('© OpenStreetMap', r.x + r.w - 22, r.y + r.h - 18)
  c.textAlign = 'left'
  if (caption) {
    c.font = font(700, 30, NUM)
    const w = Math.min(c.measureText(caption).width, r.w - 260) + 36
    box(c, { x: r.x + 26, y: r.y + r.h - CAPTION_H - 34, w, h: CAPTION_H }, 14, th.bg)
    c.fillStyle = th.fg; c.fillText(fit(c, caption, w - 36), r.x + 44, r.y + r.h - 48)
  }
  c.restore()
}

function box(c: Ctx, r: Rect, radius: number, fill: string) {
  c.beginPath(); c.roundRect(r.x, r.y, r.w, r.h, radius); c.fillStyle = fill; c.fill()
}

/** 그 날의 항공편: 일정 화면과 같은 규칙으로 위(도착·오전 출발)와 아래(오후 출발)에 놓는다 */
function dayFlights(trip: Trip, date: string) {
  const arrivals = trip.flights.filter((f) => f.arrDate === date && f.depDate !== date)
  const departures = trip.flights.filter((f) => f.depDate === date)
  return { top: [...arrivals, ...departures.filter((f) => f.depTime < '14:00')], bottom: departures.filter((f) => f.depTime >= '14:00'), arrivals }
}

function drawHead(c: Ctx, r: Rect, th: Theme, trip: Trip, page: Page) {
  const day = page === 'summary' ? undefined : trip.days[page]
  c.textBaseline = 'alphabetic'; c.textAlign = 'left'
  let y = r.y + 44
  c.font = font(700, 40, NUM); c.fillStyle = th.accent
  c.fillText(day ? `DAY ${(page as number) + 1}   ${md(day.date)} ${weekday(day.date)}` : fmtRange(trip.start, trip.end), r.x, y)

  // 도시 이름은 폭에 맞춰 크기를 줄인다
  let size = 136
  c.fillStyle = th.fg
  c.letterSpacing = '-4px'
  do { c.font = font(800, size); size -= 6 } while (c.measureText(trip.city).width > r.w && size > 60)
  y += size + 34
  c.fillText(fit(c, trip.city, r.w), r.x - 4, y)
  c.letterSpacing = '0px'

  c.font = font(500, 34); c.fillStyle = th.sub
  y += 62
  if (day) {
    const dist = day.items.slice(1).reduce((s, p, i) => s + km(day.items[i], p), 0)
    c.fillText(fit(c, day.items.length ? tr('{0}곳{1}', day.items.length, dist > 0 ? tr(', 이동 {0}', distLabel(dist)) : '') : tr('자유 일정'), r.w), r.x, y)
  } else {
    const nights = trip.days.length - 1
    const span = nights ? tr('{0}박 {1}일', nights, nights + 1) : tr('당일치기')
    c.fillText(fit(c, trip.members.length > 1 ? tr('{0}, {1}명이 함께', span, trip.members.length) : span, r.w), r.x, y)
  }
}

/** 실제 동선을 선으로 그린다. 하루 페이지는 순서 번호를, 요약은 점만 찍는다 */
const CAPTION_H = 50
/** 지도에서 동선이 카드 가장자리에 붙지 않게 두는 여백 */
const artPad = (numbered: boolean, caption: boolean) => {
  const p = numbered ? 78 : 64
  return { top: p, left: p, right: p, bottom: p + (caption ? CAPTION_H : 0) }
}

function drawArt(c: Ctx, r: Rect, th: Theme, places: Place[], numbered: boolean, caption: string, snap: MapSnapshot | null = null) {
  if (snap && places.length) return drawOnMap(c, r, th, places, numbered, caption, snap)
  box(c, r, 40, th.card)
  const pad = numbered ? 78 : 64
  const inner = { x: r.x + pad, y: r.y + pad, w: r.w - pad * 2, h: r.h - pad * 2 - (caption ? 50 : 0) }
  // 장소가 하나뿐이면 가짜 선을 긋지 않고 가운데에 점 하나만 찍는다
  if (places.length === 1) {
    const cx = r.x + r.w / 2, cy = r.y + (r.h - (caption ? 50 : 0)) / 2
    c.beginPath(); c.arc(cx, cy, 30, 0, Math.PI * 2); c.fillStyle = th.route; c.fill()
    c.font = font(800, 28, NUM); c.fillStyle = th.onRoute; c.textAlign = 'center'; c.textBaseline = 'middle'
    c.fillText('1', cx, cy + 1)
    c.textAlign = 'left'; c.textBaseline = 'alphabetic'
    if (caption) { c.font = font(700, 30, NUM); c.fillStyle = th.sub; c.fillText(fit(c, caption, r.w - 88), r.x + 44, r.y + r.h - 40) }
    return
  }
  let pts = places.map((p) => [p.lng, p.lat * 1.2] as [number, number])
  const fallback = pts.length < 2
  if (fallback) pts = [[0, 0], [1, 0.9], [2.2, 0.5], [3, 1.4]]
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1])
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
  const s = Math.min(inner.w / (x1 - x0 || 1), inner.h / (y1 - y0 || 1))
  const ox = inner.x + (inner.w - (x1 - x0) * s) / 2, oy = inner.y + (inner.h - (y1 - y0) * s) / 2
  const xy = pts.map(([x, y]) => [ox + (x - x0) * s, inner.y + inner.h - (oy - inner.y) - (y - y0) * s])

  c.beginPath(); c.moveTo(xy[0][0], xy[0][1])
  for (let i = 1; i < xy.length; i++) {
    const [px, py] = xy[i - 1], [cx, cy] = xy[i]
    // 번호를 찍는 하루 페이지는 선이 점을 정확히 지나게 곧게 잇고, 요약은 부드럽게 흘린다
    if (numbered && !fallback) c.lineTo(cx, cy); else c.quadraticCurveTo(px, py, (px + cx) / 2, (py + cy) / 2)
  }
  c.lineTo(xy[xy.length - 1][0], xy[xy.length - 1][1])
  c.strokeStyle = th.route; c.lineWidth = 9; c.lineCap = 'round'; c.lineJoin = 'round'; c.stroke()

  xy.forEach(([x, y], i) => {
    const last = i === xy.length - 1
    if (numbered && !fallback) {
      c.beginPath(); c.arc(x, y, 27, 0, Math.PI * 2); c.fillStyle = th.route; c.fill()
      c.lineWidth = 5; c.strokeStyle = th.bg; c.stroke()
      c.font = font(800, 26, NUM); c.fillStyle = th.onRoute; c.textAlign = 'center'; c.textBaseline = 'middle'
      c.fillText(String(i + 1), x, y + 2)
    } else if (last) {
      c.beginPath(); c.arc(x, y, 19, 0, Math.PI * 2); c.fillStyle = th.accent; c.fill()
    } else {
      c.beginPath(); c.arc(x, y, 10, 0, Math.PI * 2); c.fillStyle = th.bg; c.fill()
      c.lineWidth = 5; c.strokeStyle = th.fg; c.stroke()
    }
  })
  c.textAlign = 'left'; c.textBaseline = 'alphabetic'
  if (caption) { c.font = font(700, 30, NUM); c.fillStyle = th.sub; c.fillText(fit(c, caption, r.w - 88), r.x + 44, r.y + r.h - 40) }
}

/** 요약: 날마다 한 줄씩. 줄이 적으면 글자를 키워 화면을 채운다 */
function drawSummary(c: Ctx, r: Rect, th: Theme, trip: Trip) {
  const MIN = 92
  const cap = Math.max(1, Math.floor(r.h / MIN))
  const over = trip.days.length > cap
  const shown = over ? trip.days.slice(0, cap - 1) : trip.days
  const rowH = Math.min(250, r.h / (shown.length + (over ? 1 : 0)))
  const stopsOf = (date: string, items: Place[]) => [...trip.flights.filter((f) => f.depDate === date).map((f) => `${f.from} → ${f.to}`), ...items.map((p) => p.name)]
  // 글자는 클수록 좋지만, 장소 이름이 잘리지 않는 가장 큰 크기를 고른다
  let k = 1
  for (const cand of [1.45, 1.3, 1.15, 1]) {
    k = Math.max(1, Math.min(cand, rowH / 130))
    c.font = font(600, 34 * k)
    const room = Math.max(1, Math.min(3, Math.floor((rowH - 28) / (48 * k))))
    if (shown.every((d) => linesNeeded(c, stopsOf(d.date, d.items), '  ›  ', r.w - 170 * k) <= room)) break
  }
  const lh = 48 * k, labelW = 170 * k
  const lines = Math.max(1, Math.min(3, Math.floor((rowH - 28) / lh)))
  shown.forEach((d, i) => {
    const y = r.y + rowH * i
    if (i) { c.fillStyle = th.line; c.fillRect(r.x, y, r.w, 2) }
    const mid = y + rowH / 2
    c.textBaseline = 'alphabetic'
    c.font = font(800, 54 * k, NUM); c.fillStyle = th.accent; c.fillText(String(i + 1).padStart(2, '0'), r.x, mid + 6 * k)
    c.font = font(500, 26 * k); c.fillStyle = th.sub; c.fillText(`${md(d.date)} ${weekday(d.date)}`, r.x, mid + 42 * k)
    const stops = stopsOf(d.date, d.items)
    c.font = font(600, 34 * k); c.fillStyle = stops.length ? th.fg : th.sub
    const text = stops.length ? wrap(c, stops, '  ›  ', r.w - labelW, lines) : [tr('자유 일정')]
    const top = mid - ((text.length - 1) * lh) / 2 + 12 * k
    text.forEach((l, n) => c.fillText(l, r.x + labelW, top + n * lh))
  })
  if (over) {
    c.font = font(600, 32); c.fillStyle = th.sub
    c.fillText(tr('그리고 {0}일 더', trip.days.length - shown.length), r.x + labelW, r.y + rowH * shown.length + rowH / 2 + 12)
  }
}

type Row = { kind: 'place'; p: Place; n: number } | { kind: 'flight'; f: Flight; arriving: boolean }

/** 하루: 시각·번호·장소가 한 줄씩, 왼쪽 선이 동선이다. 줄이 적으면 글자를 키운다 */
function drawDay(c: Ctx, r: Rect, th: Theme, trip: Trip, index: number) {
  const day = trip.days[index]
  const { top, bottom, arrivals } = dayFlights(trip, day.date)
  const flightRow = (f: Flight): Row => ({ kind: 'flight', f, arriving: arrivals.includes(f) })
  const all: Row[] = [...top.map(flightRow), ...day.items.map((p, i): Row => ({ kind: 'place', p, n: i + 1 })), ...bottom.map(flightRow)]
  if (!all.length) {
    c.font = font(600, 40); c.fillStyle = th.sub; c.textAlign = 'left'
    c.fillText(tr('이 날은 자유 일정입니다'), r.x, r.y + 60)
    return
  }
  const MIN = 96
  const cap = Math.max(1, Math.floor(r.h / MIN))
  const over = all.length > cap
  const rows = over ? all.slice(0, cap - 1) : all
  const rowH = Math.min(210, r.h / (rows.length + (over ? 1 : 0)))
  const k = Math.max(1, Math.min(1.5, rowH / 124))
  const timeW = 132 * k, railX = r.x + timeW + 32 * k, textX = railX + 60 * k, textW = r.x + r.w - textX
  const detail = rowH >= 112

  if (rows.length > 1) { c.fillStyle = th.route; c.fillRect(railX - 3 * k, r.y + rowH / 2, 6 * k, rowH * (rows.length - 1)) }
  rows.forEach((row, i) => {
    const mid = r.y + rowH * i + rowH / 2
    const time = row.kind === 'place' ? row.p.time ?? '' : row.arriving ? row.f.arrTime : row.f.depTime
    c.textAlign = 'right'; c.textBaseline = 'middle'
    c.font = font(700, 38 * k, NUM); c.fillStyle = th.fg; c.fillText(time, r.x + timeW, mid + 2)

    c.beginPath(); c.arc(railX, mid, 26 * k, 0, Math.PI * 2)
    c.fillStyle = row.kind === 'flight' ? th.accent : th.route; c.fill()
    c.lineWidth = 6 * k; c.strokeStyle = th.bg; c.stroke()
    c.textAlign = 'center'; c.font = font(800, 24 * k, NUM)
    c.fillStyle = row.kind === 'flight' ? th.bg : th.onRoute
    c.fillText(row.kind === 'place' ? String(row.n) : '✈', railX, mid + 2)

    c.textAlign = 'left'; c.textBaseline = 'alphabetic'
    const name = row.kind === 'place' ? row.p.name : `${row.f.from} → ${row.f.to}`
    const sub = row.kind === 'place'
      ? [CATEGORY[row.p.category].label, row.p.duration ? fmtDur(row.p.duration) : ''].filter(Boolean).join(', ')
      : [airlineOf(row.f.flightNo), row.f.flightNo, `${row.f.depTime}–${row.f.arrTime}`].filter(Boolean).join(' ')
    c.font = font(700, 40 * k); c.fillStyle = th.fg
    c.fillText(fit(c, name, textW), textX, detail ? mid - 4 * k : mid + 14 * k)
    if (detail) { c.font = font(500, 28 * k); c.fillStyle = th.sub; c.fillText(fit(c, sub, textW), textX, mid + 36 * k) }
  })
  if (over) {
    c.font = font(600, 32); c.fillStyle = th.sub; c.textAlign = 'left'
    c.fillText(tr('그리고 {0}곳 더', all.length - rows.length), textX, r.y + rowH * rows.length + rowH / 2 + 12)
  }
}

/** 바닥: 왼쪽에 trj. 워드마크(글꼴이 아니라 경로로 그린다), 오른쪽에 브랜드 문구 */
function drawFoot(c: Ctx, x: number, y: number, right: number, th: Theme) {
  const [vx, vy, vw, vh] = LOGO.viewBox
  const h = 46, s = h / vh
  c.save()
  c.translate(x - vx * s, y - h - vy * s)
  c.scale(s, s)
  c.fillStyle = th.fg
  c.fill(new Path2D(LOGO.d))
  c.restore()
  c.textAlign = 'right'; c.textBaseline = 'alphabetic'
  c.font = font(600, 19); c.fillStyle = th.sub
  c.letterSpacing = '6px'
  c.fillText(BRAND.full, right + 6, y - 26)
  c.letterSpacing = '0px'
  c.font = font(500, 24); c.fillText(BRAND.tagline, right, y + 4)
}

/** 캔버스에 쓰기 전에, 그릴 글자에 필요한 글꼴 조각을 받아 둔다 */
async function loadFonts(text: string) {
  try {
    await Promise.all([
      document.fonts.load(font(500, 40), text), document.fonts.load(font(700, 40), text), document.fonts.load(font(800, 40), text),
      document.fonts.load(font(600, 40, NUM), '0123456789DAY'), document.fonts.load(font(700, 40, NUM), '0123456789TRJ'),
    ])
  } catch { /* 글꼴을 못 받아도 기본 글꼴로 그린다 */ }
}

/** withMap: 지도 윤곽을 깔지. 꺼져 있거나 지도를 못 받으면 동선만 그린다 */
export async function renderPoster(canvas: HTMLCanvasElement, trip: Trip, { ratio, theme, page }: PosterOptions, withMap = true) {
  const { w: W, h: H } = RATIOS[ratio]
  const th = THEMES[theme] as Theme
  await loadFonts(JSON.stringify([trip.city, trip.title, trip.days, Object.values(CATEGORY)]) + FONT_HINT)
  const work = document.createElement('canvas')
  work.width = W; work.height = H
  const c = work.getContext('2d')!
  c.fillStyle = th.bg; c.fillRect(0, 0, W, H)

  const P = ratio === 'story' ? 84 : 72
  const FOOT = 70
  let head: Rect, art: Rect, list: Rect
  if (ratio === 'wide') {
    head = { x: P, y: P, w: 720, h: 300 }
    art = { x: P, y: P + 320, w: 720, h: H - P * 2 - 320 - FOOT - 20 }
    list = { x: P + 720 + 72, y: P, w: W - P * 2 - 792, h: H - P * 2 }
  } else if (ratio === 'square') {
    head = { x: P, y: P, w: W - P * 2 - 400, h: 300 }
    art = { x: W - P - 370, y: P, w: 370, h: 300 }
    list = { x: P, y: P + 340, w: W - P * 2, h: H - P * 2 - 340 - FOOT }
  } else {
    head = { x: P, y: P + 16, w: W - P * 2, h: 300 }
    art = { x: P, y: P + 350, w: W - P * 2, h: 500 }
    list = { x: P, y: P + 900, w: W - P * 2, h: H - P * 2 - 900 - FOOT }
  }

  drawHead(c, head, th, trip, page)
  const first = trip.flights[0], last = trip.flights[trip.flights.length - 1]
  const caption = page === 'summary' && first ? (last && last !== first && ratio !== 'square' ? `${first.from} → ${first.to}      ${last.from} → ${last.to}` : `${first.from} → ${first.to}`) : ''
  const places = page === 'summary' ? trip.days.flatMap((d) => d.items) : trip.days[page].items
  const numbered = page !== 'summary' && ratio !== 'square'
  const snap = withMap ? await mapSnapshot(places, art.w, art.h, artPad(numbered, Boolean(caption)), th.map) : null
  drawArt(c, art, th, places, numbered, caption, snap)
  if (page === 'summary') drawSummary(c, list, th, trip)
  else drawDay(c, list, th, trip, page)
  drawFoot(c, P, H - P + 6, ratio === 'wide' ? P + 720 : W - P, th)
  // 다 그린 뒤 한 번에 옮긴다: 지도를 기다리는 동안 미리 보기가 비지 않는다
  canvas.width = W; canvas.height = H
  canvas.getContext('2d')!.drawImage(work, 0, 0)
}

export const posterName = (trip: Trip, o: PosterOptions) =>
  `${trip.title || trip.city}-${o.page === 'summary' ? 'summary' : `day${o.page + 1}`}-${RATIOS[o.ratio].label.replace(':', 'x')}.png`

export const toBlob = (canvas: HTMLCanvasElement) =>
  new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error(tr('이미지를 만들지 못했습니다')))), 'image/png'))
