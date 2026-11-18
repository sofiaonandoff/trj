import { tr } from '../i18n'
import LZString from 'lz-string'
import { airlineOf, airport } from '../data/airports'
import { CATEGORY } from '../data/destinations'
import type { Trip } from '../types'
import { toWon } from '../data/currencies'
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

/**
 * 로그인 없이 보는 링크에 담는 여행. 일정·항공편·숙소·지출·준비물을 담고,
 * 동행 이메일·항공 예약번호·좌석·숙소 예약번호·기록(일기와 사진)은 뺀다 (링크를 가진 누구나 볼 수 있으므로).
 */
export function viewOf(t: Trip): Trip {
  return {
    id: t.id, title: t.title, city: t.city, country: t.country, destId: t.destId, lat: t.lat, lng: t.lng, start: t.start, end: t.end,
    legs: t.legs, currency: t.currency, rate: t.rate, rates: t.rates, budget: t.budget, createdAt: t.createdAt, updatedAt: t.updatedAt,
    days: t.days.map((d) => ({ date: d.date, items: d.items.map(({ u: _u, ...p }) => p) })),
    flights: t.flights.map(({ u: _u, pnr: _p, seat: _s, ...f }) => f),
    stays: (t.stays ?? []).map(({ u: _u, code: _c, ...st }) => st),
    members: t.members.map((m) => ({ id: m.id, name: m.name, color: m.color })),
    expenses: t.expenses.map(({ u: _u, ...e }) => e),
    checklist: t.checklist.map(({ u: _u, ...c }) => c),
    journal: {},
  }
}

/** 로그인 없이 보는 링크 (지금 일정 그대로, 서버 없이 주소에 담는다) */
export const snapshotViewLink = (t: Trip) => `${location.origin}${location.pathname}#/view/s/${LZString.compressToEncodedURIComponent(JSON.stringify(viewOf(t)))}`
export function decodeView(data: string): Trip | null {
  try {
    const t = JSON.parse(LZString.decompressFromEncodedURIComponent(data) ?? '') as Trip
    return t && Array.isArray(t.days) && t.title ? t : null
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
  const total = t.expenses.reduce((s, e) => s + toWon(t, e.amount, e.currency), 0)
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
