import { tr } from '../i18n'
import type { Expense, Flight, Place, Trip } from '../types'
import { reverseGeocode, searchPlaces } from './geocode'
import { legOf } from './legs'
import { ocrLangs, recognizeLines } from './ocr'
import { readExif } from './photos'
import { readText } from './receipt'
import { fromMin, km, toMin, travelMin, uid } from './util'

/**
 * "사진으로 추가": 영수증·예약 화면·탑승권·장소 사진을 기기 안에서 읽어 일정과 예산에 넣는다 (AI를 쓰지 않는다).
 * - 글자는 기기 안 OCR로 읽고(가게 이름, 날짜, 시각, 합계, 항공편),
 * - 위치는 사진의 GPS → 가게 이름 검색 순으로 찾는다. 글자가 없는 풍경 사진은 GPS 위치의 장소 이름을 쓴다.
 * 날짜는 사진 속 글자 → 사진을 찍은 날 → 지금 보고 있는 날 순으로 정하고, 다른 날의 사진이면 그 날로 옮겨 넣는다.
 */

export type DateFrom = 'image' | 'photo' | 'current'

/** 사진 한 장에서 만든 넣을 거리. 아직 여행에 넣기 전이다 */
export interface Draft {
  date: string
  dateFrom: DateFrom
  place?: Place
  expense?: Omit<Expense, 'payer' | 'split'>
  flight?: Flight
  /** 위치를 찾지 못해 일정에는 넣지 않은 경우 */
  noPlace?: boolean
}

/** 날짜 정하기: 여행 기간 안에 드는 것만 믿는다 */
export function pickDate(days: string[], imageDate: string | undefined, photoDate: string | undefined, current: string): { date: string; from: DateFrom } {
  if (imageDate && days.includes(imageDate)) return { date: imageDate, from: 'image' }
  if (photoDate && days.includes(photoDate)) return { date: photoDate, from: 'photo' }
  return { date: current, from: 'current' }
}

/** 통화를 예산 탭이 계산할 수 있는 형태로 맞춘다: 원화, 여행지 통화, 아니면 원화로 바꾼 값 */
export function toBudget(trip: Pick<Trip, 'currency'>, amount: number, currency: string, krw: number): { amount: number; currency: string; extra?: string } | null {
  if (!(amount > 0)) return null
  const cur = currency.toUpperCase()
  if (cur === 'KRW') return { amount: Math.round(amount), currency: 'KRW' }
  if (!cur || cur === trip.currency) return { amount, currency: trip.currency }
  if (krw > 0) return { amount: Math.round(krw), currency: 'KRW', extra: `${amount.toLocaleString()} ${cur}` }
  return null
}

/** 사진 한 장을 읽는다. onStage로 지금 하는 일을 알린다 */
export async function readTripPhoto(file: File, trip: Trip, current: string, onStage?: (s: string) => void): Promise<Draft[]> {
  const days = trip.days.map((d) => d.date)
  const exif = await readExif(file)
  const here = legOf(trip, current)
  onStage?.(tr('글자를 읽는 중'))
  const lines = await recognizeLines(file, ocrLangs(here.country ?? trip.country), (p) => onStage?.(tr('글자 인식 준비 중 {0}%', Math.round(p * 100)))).catch(() => [])
  const r = readText(lines, days, trip.currency)
  const out: Draft[] = r.flights.map((f) => ({ date: f.depDate, dateFrom: 'image' as const, flight: f }))
  if (out.length && !r.amount) return out

  const { date, from } = pickDate(days, r.date, exif.date, current)
  const near = legOf(trip, date)
  const money = r.amount ? toBudget(trip, r.amount, r.currency ?? trip.currency, 0) : null
  const documentLike = Boolean(r.amount || r.date)
  const gps = exif.lat !== undefined && exif.lng !== undefined && km(near, { lat: exif.lat, lng: exif.lng }) <= 250 ? { lat: exif.lat, lng: exif.lng } : undefined

  onStage?.(tr('장소를 찾는 중'))
  let name = r.name
  let where: { lat: number; lng: number } | undefined
  if (!r.costOnly) {
    if (gps) {
      where = gps
      // 영수증이면 글자 속 가게 이름을, 풍경 사진이면 그 위치의 장소 이름을 쓴다
      if (!documentLike || !name) name = (await reverseGeocode(gps.lat, gps.lng).catch(() => null))?.name ?? name
    } else if (name) {
      const hit = (await searchPlaces(name, near).catch(() => [])).find((x) => !x.airport && km(near, x) <= 80)
      if (hit) where = { lat: hit.lat, lng: hit.lng }
    }
  }
  const title = name ?? (r.costOnly ? tr('교통비') : tr('사진 속 결제'))
  const expense = money ? { id: uid(), title: money.extra ? `${title} (${money.extra})` : title, amount: money.amount, currency: money.currency, category: r.expenseCategory, date } : undefined
  if (where && name) {
    out.push({
      date, dateFrom: from, expense,
      place: { id: uid(), name, ...where, category: r.category, time: r.time ?? (from === 'photo' ? exif.time : undefined), duration: r.category === 'stay' ? 60 : r.category === 'cafe' ? 45 : 60 },
    })
  } else if (expense) out.push({ date, dateFrom: from, expense, noPlace: !r.costOnly })
  return out
}

export interface Applied {
  date: string
  dateFrom: DateFrom
  title: string
  placeId?: string
  /** 이번에 새로 넣은 장소인가 (이미 있던 장소에 비용만 붙였으면 false) */
  placeAdded?: boolean
  expenseId?: string
  flightId?: string
  amount?: { value: number; currency: string }
  time?: string
  noPlace?: boolean
  /** 이미 넣은 것과 같아 다시 넣지 않았다 */
  duplicate?: boolean
}

/** 넣을 거리를 여행에 넣는다 (mutate 안에서 부른다). 같은 영수증을 두 번 올려도 겹치지 않게 한다 */
export function applyDraft(t: Trip, d: Draft, putFlight: (t: Trip, f: Flight) => void): Applied {
  const res: Applied = { date: d.date, dateFrom: d.dateFrom, title: d.place?.name ?? d.flight?.flightNo ?? d.expense?.title ?? '', noPlace: d.noPlace }
  if (d.flight) {
    const same = t.flights.find((f) => f.flightNo === d.flight!.flightNo && f.depDate === d.flight!.depDate)
    if (same) res.duplicate = true
    else { putFlight(t, d.flight); res.flightId = d.flight.id }
    res.time = d.flight.depTime
  }
  const day = t.days.find((x) => x.date === d.date)
  if (d.place && day) {
    const same = day.items.find((p) => p.name === d.place!.name)
    if (same) res.placeId = same.id
    else {
      const p = { ...d.place }
      const last = [...day.items].reverse().find((x) => x.time)
      if (!p.time && last?.time) p.time = fromMin(Math.round((toMin(last.time) + (last.duration ?? 60) + travelMin(km(last, p))) / 10) * 10)
      day.items.push(p)
      // 시각이 있는 곳은 시간 순서대로 둔다
      if (p.time) day.items.sort((a, b) => (a.time ?? '99').localeCompare(b.time ?? '99'))
      res.placeId = p.id
      res.placeAdded = true
    }
    res.time = day.items.find((x) => x.id === res.placeId)?.time
  }
  if (d.expense) {
    const e = d.expense
    const same = t.expenses.find((x) => x.title === e.title && x.amount === e.amount && x.date === e.date)
    if (same) res.duplicate = res.duplicate ?? !res.placeId
    else {
      const me = t.members[0]?.id ?? ''
      t.expenses.push({ ...e, payer: me, split: t.members.map((m) => m.id) })
      res.expenseId = e.id
    }
    res.amount = { value: e.amount, currency: e.currency }
  }
  return res
}

/** 넣은 것을 되돌린다 */
export function undoApplied(t: Trip, a: Applied) {
  if (a.placeId && a.placeAdded) for (const d of t.days) d.items = d.items.filter((p) => p.id !== a.placeId)
  if (a.expenseId) t.expenses = t.expenses.filter((e) => e.id !== a.expenseId)
  if (a.flightId) t.flights = t.flights.filter((f) => f.id !== a.flightId)
}

export const dateFromLabel = (from: DateFrom) => (from === 'image' ? tr('사진 속 날짜') : from === 'photo' ? tr('찍은 날짜') : tr('보고 있던 날'))
