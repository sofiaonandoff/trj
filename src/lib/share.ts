import { tr } from '../i18n'
import LZString from 'lz-string'
import { airlineOf, airport } from '../data/airports'
import { CATEGORY } from '../data/destinations'
import type { Trip } from '../types'
import { flightMinutes } from './flight'
import { fmtDur, fmtRange, md, uid, weekday, won } from './util'

/** 사진을 뺀 여행 전체를 주소에 담는다. 서버 없이 링크만으로 동행에게 전달된다. */
export function shareLink(trip: Trip) {
  const lean: Trip = { ...trip, journal: Object.fromEntries(Object.entries(trip.journal).map(([k, v]) => [k, { text: v.text, photos: [] }])) }
  return `${location.origin}${location.pathname}#/import/${LZString.compressToEncodedURIComponent(JSON.stringify(lean))}`
}

export function decodeTrip(data: string): Trip | null {
  try {
    const t = JSON.parse(LZString.decompressFromEncodedURIComponent(data) ?? '') as Trip
    if (!t || !Array.isArray(t.days) || !t.title) return null
    return { ...t, id: uid(), createdAt: Date.now() }
  } catch { return null }
}

export function parseTripFile(text: string): Trip | null {
  try {
    const t = JSON.parse(text) as Trip
    if (!t || !Array.isArray(t.days) || !t.title) return null
    return { ...t, id: uid(), createdAt: Date.now(), journal: Object.fromEntries(Object.entries(t.journal ?? {}).map(([k, v]) => [k, { text: v.text, photos: [] }])) }
  } catch { return null }
}

const flightLine = (t: Trip, date: string) => t.flights.filter((f) => f.depDate === date).map((f) =>
  `${f.depTime} ${airport(f.from)?.city ?? f.from} → ${f.arrTime} ${airport(f.to)?.city ?? f.to} (${airlineOf(f.flightNo)} ${f.flightNo}, ${fmtDur(flightMinutes(f))})`)

/** 블로그에 붙여 넣을 마크다운 */
export function toMarkdown(t: Trip) {
  const out = [`# ${t.title}`, '', `${t.city}${t.country ? `, ${t.country}` : ''} | ${fmtRange(t.start, t.end)} | ${t.members.map((m) => m.name).join(', ')}`, '']
  t.days.forEach((d, i) => {
    out.push(tr('## {0}일차 ({1} {2})', i + 1, md(d.date), weekday(d.date)), '')
    flightLine(t, d.date).forEach((l) => out.push(`- ✈️ ${l}`))
    d.items.forEach((p) => out.push(`- ${p.time ? `**${p.time}** ` : ''}${p.name} _(${CATEGORY[p.category].label}${p.duration ? `, ${fmtDur(p.duration)}` : ''})_${p.note ? ` — ${p.note}` : ''}`))
    const j = t.journal[d.date]?.text?.trim()
    if (j) out.push('', j)
    out.push('')
  })
  const total = t.expenses.reduce((s, e) => s + e.amount * (e.currency === 'KRW' ? 1 : t.rate), 0)
  if (total) out.push(tr('## 경비'), '', tr('총 {0} (1인 {1})', won(total), won(total / t.members.length)), '')
  return out.join('\n')
}

/** 유튜브 영상 설명란용: 날짜별 코스 요약 */
export function toYouTube(t: Trip) {
  const out = [`${t.title} | ${fmtRange(t.start, t.end)}`, '']
  t.days.forEach((d, i) => {
    out.push(`▶ DAY ${i + 1} (${md(d.date)})`)
    const stops = [...flightLine(t, d.date).map((l) => `✈ ${l}`), ...d.items.map((p) => `${p.time ? `${p.time} ` : ''}${p.name}`)]
    out.push(stops.join('\n') || tr('자유 일정'), '')
  })
  const cities = [...new Set((t.legs ?? [t]).map((l) => l.city.replace(/\s/g, '')))]
  out.push([...cities.map((c) => tr('#{0}여행', c)), ...cities.map((c) => `#${c}`), tr('#여행브이로그')].join(' '))
  return out.join('\n')
}
