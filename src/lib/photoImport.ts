import { tr } from '../i18n'
import type { Category, Expense, ExpenseCategory, Flight, Place, Trip } from '../types'
import { aiReadPhoto, type PhotoRaw } from './ai'
import { reverseGeocode, searchPlaces } from './geocode'
import { legOf } from './legs'
import { readExif, toBase64Jpeg, type Exif } from './photos'
import { fromMin, km, toMin, travelMin, uid } from './util'

/**
 * "사진으로 추가": 영수증·예약 화면·탑승권·장소 사진을 읽어 일정과 예산에 넣는다.
 * 날짜는 사진 속 글자 → 사진을 찍은 날 → 지금 보고 있는 날 순으로 정하고,
 * 다른 날의 사진이면 그 날로 옮겨 넣는다.
 */

const CATS: Category[] = ['sight', 'food', 'cafe', 'shop', 'nature', 'culture', 'night', 'stay']
const EXP: ExpenseCategory[] = ['food', 'stay', 'move', 'play', 'shop', 'etc']
const isDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
const isTime = (v: unknown): v is string => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v)
const text = (v: unknown, max = 80) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const pos = (v: unknown) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : 0 }

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

async function locate(name: string, address: string, raw: PhotoRaw, exif: Exif, near: { lat: number; lng: number }) {
  const close = (p: { lat: number; lng: number }, limit: number) => km(near, p) <= limit
  // 현장에서 찍은 사진이면 GPS가 가장 정확하다 (화면 캡처에는 GPS가 없다)
  if (exif.lat !== undefined && exif.lng !== undefined && close({ lat: exif.lat, lng: exif.lng }, 250)) return { lat: exif.lat, lng: exif.lng }
  for (const q of [address && `${name} ${address}`, name].filter(Boolean) as string[]) {
    const hit = (await searchPlaces(q, near).catch(() => [])).find((r) => !r.airport && close(r, 80))
    if (hit) return { lat: hit.lat, lng: hit.lng }
  }
  const lat = Number(raw.lat), lng = Number(raw.lng)
  if (Number.isFinite(lat) && Number.isFinite(lng) && (lat || lng) && close({ lat, lng }, 250)) return { lat, lng }
  return null
}

/** 모델이 읽은 항목 하나를 확인해 넣을 거리로 만든다 */
async function toDraft(raw: PhotoRaw, trip: Trip, exif: Exif, current: string): Promise<Draft | null> {
  const days = trip.days.map((d) => d.date)
  const kind = raw.kind === 'flight' || raw.kind === 'expense' ? raw.kind : 'place'
  const name = text(raw.name)

  if (kind === 'flight') {
    const no = text(raw.flight_no, 10).toUpperCase().replace(/\s/g, '')
    const from = text(raw.from_iata, 3).toUpperCase(), to = text(raw.to_iata, 3).toUpperCase()
    if (/^[A-Z0-9]{2}\d{1,4}$/.test(no) && /^[A-Z]{3}$/.test(from) && /^[A-Z]{3}$/.test(to) && isDate(raw.dep_date) && isTime(raw.dep_time)) {
      const arrDate = isDate(raw.arr_date) ? raw.arr_date : raw.dep_date
      const arrTime = isTime(raw.arr_time) ? raw.arr_time : raw.dep_time
      return {
        date: raw.dep_date, dateFrom: 'image',
        flight: { id: uid(), flightNo: no, from, to, depDate: raw.dep_date, depTime: raw.dep_time, arrDate, arrTime, seat: text(raw.seat, 6) || undefined, pnr: text(raw.pnr, 10) || undefined },
      }
    }
    // 항공편 정보가 모자라면 비용만 남긴다
  }

  const { date, from } = pickDate(days, isDate(raw.date) ? raw.date : undefined, exif.date, current)
  const money = toBudget(trip, pos(raw.amount), text(raw.currency, 3), pos(raw.amount_krw))
  const expCat = EXP.includes(raw.expense_category as ExpenseCategory) ? (raw.expense_category as ExpenseCategory) : 'etc'
  const note = text(raw.note, 120)
  const expense = money && name ? { id: uid(), title: money.extra ? `${name} (${money.extra})` : name, amount: money.amount, currency: money.currency, category: expCat, date } : undefined

  if (kind !== 'place' || !name) return expense ? { date, dateFrom: from, expense } : null
  const where = await locate(name, text(raw.address, 120), raw, exif, legOf(trip, date))
  if (!where) return expense ? { date, dateFrom: from, expense, noPlace: true } : null
  const time = isTime(raw.time) ? raw.time : from === 'photo' && exif.time ? exif.time : undefined
  const duration = Math.round(Number(raw.duration))
  return {
    date, dateFrom: from, expense,
    place: {
      id: uid(), name, ...where,
      category: CATS.includes(raw.category as Category) ? (raw.category as Category) : 'sight',
      time, duration: Number.isFinite(duration) && duration > 0 ? Math.min(600, Math.max(15, duration)) : 60,
      note: note || undefined,
    },
  }
}

/** 사진 한 장을 읽는다. AI를 쓸 수 없으면 사진의 GPS 위치로 장소만이라도 찾는다 */
export async function readTripPhoto(file: File, trip: Trip, current: string): Promise<Draft[]> {
  const exif = await readExif(file)
  const leg = legOf(trip, current)
  let raws: PhotoRaw[]
  try {
    raws = await aiReadPhoto(await toBase64Jpeg(file), { city: leg.city, country: leg.country, start: trip.start, end: trip.end, taken: exif.date })
  } catch (e) {
    if (exif.lat === undefined || exif.lng === undefined) throw e
    const spot = await reverseGeocode(exif.lat, exif.lng).catch(() => null)
    if (!spot) throw e
    raws = [{ kind: 'place', name: spot.name, lat: spot.lat, lng: spot.lng, category: spot.category }]
  }
  const out: Draft[] = []
  for (const r of raws) { const d = await toDraft(r, trip, exif, current); if (d) out.push(d) }
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
