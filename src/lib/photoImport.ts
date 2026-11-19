import { tr } from '../i18n'
import type { AirportChoice } from './flightList'
import { knownCurrency } from '../data/currencies'
import type { Expense, Flight, Place, Stay, Trip } from '../types'
import { airlineOf, loadWorldAirports } from '../data/airports'
import { reverseGeocode, searchPlaces } from './geocode'
import { legOf } from './legs'
import { ocrPasses, recognize, recognizeBand, signWords } from './ocr'
import { readExif } from './photos'
import { readText, stayLabelLine, stayOf } from './receipt'
import { putStay, removeStay } from '../store'
import { addDays, fromMin, km, toMin, travelMin, uid } from './util'

/**
 * "사진으로 추가": 영수증·예약 화면·탑승권·장소 사진을 기기 안에서 읽어 일정과 예산에 넣는다 (AI를 쓰지 않는다).
 * - 글자는 기기 안 OCR로 읽고(가게 이름, 날짜, 시각, 합계, 항공편),
 * - 위치는 사진의 GPS → 가게 이름 검색 순으로 찾는다. 글자가 없는 풍경 사진은 GPS 위치의 장소 이름을 쓴다.
 * 날짜는 사진 속 글자 → 사진을 찍은 날 → 지금 보고 있는 날 순으로 정하고, 다른 날의 사진이면 그 날로 옮겨 넣는다.
 */

/** 간판 읽기에서 버리는 낱말 (화면 단추·흔한 영어) */
const SIGN_NOISE = /^(view|book|booking|details?|return|home|room|rooms|hotel|hotels|more|flight|next|done|close|open|save|share|confirm|check|sale|from|with|your|this|that|the)$/i

export type DateFrom = 'image' | 'photo' | 'current'

/** 사진 한 장에서 만든 넣을 거리. 아직 여행에 넣기 전이다 */
export interface Draft {
  date: string
  dateFrom: DateFrom
  place?: Place
  expense?: Omit<Expense, 'payer' | 'split'>
  flight?: Flight
  /** 숙소 예약이면 숙소로 넣는다 (체크인·체크아웃이 일정 위아래에 붙는다) */
  stay?: Stay
  /** 위치를 찾지 못해 일정에는 넣지 않은 경우 */
  noPlace?: boolean
  /** 같은 이름의 숙소가 여럿이면 고를 수 있는 다른 후보 (예: 시드니의 Quest 호텔들) */
  choices?: StayChoice[]
  /** 줄임말 공항(KK: 콘깬·끄라비·코타키나발루)의 다른 후보 */
  airportChoices?: AirportChoice[]
}

export interface StayChoice { name: string; lat: number; lng: number; address?: string }

/** 날짜 정하기: 여행 기간 안에 드는 것만 믿는다 */
export function pickDate(days: string[], imageDate: string | undefined, photoDate: string | undefined, current: string): { date: string; from: DateFrom } {
  if (imageDate && days.includes(imageDate)) return { date: imageDate, from: 'image' }
  if (photoDate && days.includes(photoDate)) return { date: photoDate, from: 'photo' }
  return { date: current, from: 'current' }
}

/** 통화를 예산 탭이 계산할 수 있는 형태로 맞춘다: 원화, 여행지 통화, 아는 통화, 아니면 원화로 바꾼 값 */
export function toBudget(trip: Pick<Trip, 'currency'>, amount: number, currency: string, krw: number): { amount: number; currency: string; extra?: string } | null {
  if (!(amount > 0)) return null
  const cur = currency.toUpperCase()
  if (cur === 'KRW') return { amount: Math.round(amount), currency: 'KRW' }
  if (!cur || cur === trip.currency) return { amount, currency: trip.currency }
  // 아는 통화면 그 통화 그대로 남긴다 (예산 탭이 그 통화의 환율로 계산한다)
  if (knownCurrency(cur)) return { amount, currency: cur }
  if (krw > 0) return { amount: Math.round(krw), currency: 'KRW', extra: `${amount.toLocaleString()} ${cur}` }
  return null
}

/** 사진 한 장을 읽는다. onStage로 지금 하는 일을 알린다 */
export async function readTripPhoto(file: File, trip: Trip, current: string, onStage?: (s: string) => void): Promise<Draft[]> {
  const days = trip.days.map((d) => d.date)
  const pdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name)
  const exif = pdf ? {} : await readExif(file)
  const here = legOf(trip, current)
  onStage?.(tr('글자를 읽는 중'))
  const ocr = pdf
    ? { lines: await import('./pdfText').then((m) => m.pdfLines(file)).catch(() => []), langs: [] as string[], scale: 1, confidence: 100 }
    : await recognize(file, ocrPasses(here.country ?? trip.country), (p) => onStage?.(tr('글자 인식 준비 중 {0}%', Math.round(p * 100)))).catch(() => ({ lines: [], langs: [] as string[], scale: 1, confidence: 0 }))
  const lines = ocr.lines
  await loadWorldAirports()
  const r = readText(lines, days, trip.currency)

  // 숙소 화면인데 체크인·체크아웃이 제대로 안 읽혔으면 그 칸만 크게 키워 다시 읽는다
  const st = r.stay
  const shaky = !st?.checkIn || !st.checkOut || st.checkOut <= st.checkIn || !st.inTime || !st.outTime
  const label = !pdf && r.category === 'stay' && shaky ? stayLabelLine(lines) : undefined
  if (label) {
    onStage?.(tr('체크인·체크아웃을 다시 읽는 중'))
    const k = ocr.scale || 1
    const band = await recognizeBand(file, (label.top - label.height) / k, (label.top + label.height * 6) / k, ocr.langs.length ? ocr.langs : ['eng', 'kor']).catch(() => [])
    const again = stayOf(band.map((l) => l.text), days)
    if (again?.checkIn) {
      const keep = r.stay ?? {}
      r.stay = {
        ...keep,
        checkIn: again.checkIn,
        checkOut: again.checkOut && again.checkOut > again.checkIn ? again.checkOut : keep.checkOut,
        inTime: again.inTime ?? keep.inTime,
        outTime: again.outTime ?? keep.outTime,
      }
    }
  }
  const out: Draft[] = r.flights.map((f, i) => ({ date: f.depDate, dateFrom: 'image' as const, flight: f, airportChoices: r.flightChoices?.[i] }))
  if (out.length) {
    // 항공권: 항공편으로 넣고, 금액이 있으면 교통비로 예산에 남긴다 (일정에 장소로는 넣지 않는다)
    const money = r.amount ? toBudget(trip, r.amount, r.currency ?? trip.currency, 0) : null
    const f = out[0].flight!
    if (money) {
      // 항공편을 넣으면 여행 기간이 그 날까지 늘어나므로 출발일을 그대로 쓴다
      const date = f.depDate
      out.push({ date, dateFrom: 'image', expense: { id: uid(), title: tr('{0} 항공권 ({1}→{2})', f.flightNo, f.from, f.to), amount: money.amount, currency: money.currency, category: 'move', date } })
    }
    return out
  }

  const { date, from } = pickDate(days, r.date, exif.date, current)
  const near = legOf(trip, date)
  const money = r.amount ? toBudget(trip, r.amount, r.currency ?? trip.currency, 0) : null
  const documentLike = Boolean(r.amount || r.date)
  const gps = exif.lat !== undefined && exif.lng !== undefined && km(near, { lat: exif.lat, lng: exif.lng }) <= 250 ? { lat: exif.lat, lng: exif.lng } : undefined

  onStage?.(tr('장소를 찾는 중'))
  let name = r.name
  let where: { lat: number; lng: number } | undefined
  // 숙소 화면에서 주소를 읽었으면 그 주소로 위치를 찾는다 ('Tauranga의 숙소'의 도시 이름을 함께 붙여서)
  const stayAddress = r.category === 'stay' && r.stay?.address
    ? (r.stay.city && !r.stay.address.toLowerCase().includes(r.stay.city.toLowerCase()) ? `${r.stay.address}, ${r.stay.city}` : r.stay.address)
    : undefined
  if (stayAddress) {
    const around = legOf(trip, r.stay?.checkIn ?? date)
    const tries = r.stay?.city ? [stayAddress, r.stay.address!] : [stayAddress]
    for (const q of tries) {
      const hits = (await searchPlaces(q, around).catch(() => [])).filter((x) => !x.airport)
      // 도시 이름까지 맞춰 찾은 결과는 여행 도시와 멀어도 믿는다 (다른 도시 숙소). 주소만이면 가까운 곳만
      const hit = q === stayAddress && r.stay?.city ? hits[0] : hits.find((x) => km(around, x) <= 150)
      if (hit) { where = { lat: hit.lat, lng: hit.lng }; break }
    }
  }
  // 숙소인데 주소가 없으면: 숙소 이름(도시로 지은 이름이 아닐 때) → 사진 속 간판 이름 → 화면의 지명(도시) 순으로 지도에서 찾는다
  let choices: StayChoice[] | undefined
  /** 숙소 이름으로 지도에서 찾았으면 그 주소 */
  let foundAddress: string | undefined
  if (r.category === 'stay' && !where && !gps) {
    const around = legOf(trip, r.stay?.checkIn ?? date)
    const city = r.stay?.city
    const generated = !name || Boolean(city && name === tr('{0} 숙소', city))
    // 화면 글에 숙소 이름이 없으면 사진 속 간판·로고(예: 호텔 건물의 'QUEST')를 읽어 그 이름의 숙소를 그 도시에서 찾는다
    if (generated && !pdf) {
      onStage?.(tr('사진 속 간판을 읽는 중'))
      const brands = [...new Set((await signWords(file).catch(() => [] as string[]))
        .map((w) => w.replace(/[^A-Za-z&' -]/g, ' ').replace(/\s+/g, ' ').trim())
        .filter((w) => /[A-Za-z]{4,}/.test(w) && !SIGN_NOISE.test(w)))].slice(0, 3)
      for (const brand of brands) {
        const seen = new Set<string>()
        const hits: StayChoice[] = []
        for (const q of [`${brand} ${city ?? ''}`.trim(), `${brand} hotel ${city ?? ''}`.trim()]) {
          for (const x of await searchPlaces(q, around).catch(() => [])) {
            if (x.airport || !x.name.toLowerCase().includes(brand.toLowerCase()) || seen.has(x.name)) continue
            // 도시 이름까지 넣어 찾았으면 여행 도시와 멀어도 믿는다. 도시를 모르면 가까운 곳만
            if (!city && km(around, x) > 150) continue
            seen.add(x.name); hits.push({ name: x.name, lat: x.lat, lng: x.lng, address: x.detail })
          }
          if (hits.length) break
        }
        if (hits.length) {
          name = hits[0].name
          where = { lat: hits[0].lat, lng: hits[0].lng }
          if (hits.length > 1) choices = hits.slice(0, 6)
          break
        }
      }
    }
    const own = !where && name && !(city && name === tr('{0} 숙소', city)) ? name : undefined
    // 이름에 도시가 이미 있으면(Quest North Sydney) 그대로, 없으면 도시를 붙여 찾는다
    const withCity = own && city && !own.toLowerCase().includes(city.toLowerCase()) ? `${own}, ${city}` : own
    for (const q of (where ? [] : [withCity, own !== withCity ? own : undefined, city]).filter(Boolean) as string[]) {
      const hits = (await searchPlaces(q, around).catch(() => [])).filter((x) => !x.airport)
      // 숙소 이름으로 찾았으면 이름이 맞는 결과를 먼저
      const named = q !== city && own ? hits.find((x) => x.name.toLowerCase().includes(own.toLowerCase().split(' ')[0])) : undefined
      const hit = named ?? (city ? hits[0] : hits.find((x) => km(around, x) <= 80))
      if (hit) { where = { lat: hit.lat, lng: hit.lng }; if (q !== city) foundAddress = hit.detail; break }
    }
  }
  // 투어·액티비티 바우처: 미팅 포인트 주소로 위치를 찾는다. 번지가 잘못 읽혔을 수 있어 번지를 뺀 주소로도 찾는다
  const tour = r.tour
  if (tour && !where) {
    const a = tour.address
    const tries = a ? [a, a.replace(/^\s*\d+[\w/-]*\s+/, ''), a.split(',').slice(0, 2).join(',').replace(/^\s*\d+[\w/-]*\s+/, '')] : []
    for (const q of [...new Set(tries)]) {
      const hits = (await searchPlaces(q, near).catch(() => [])).filter((x) => !x.airport)
      // 주소에 도시·우편번호까지 있으면 여행 도시와 멀어도 믿는다 (다른 도시의 투어)
      const hit = /,/.test(q) ? hits[0] : hits.find((x) => km(near, x) <= 150)
      if (hit) { where = { lat: hit.lat, lng: hit.lng }; break }
    }
    // 주소가 없으면 투어 이름의 앞부분(첫 장소 이름: '페더데일 동물원 & 블루마운틴…' → '페더데일 동물원')으로 근처에서 찾는다
    if (!where && name) {
      const parts = [...new Set([name.split(/\s*[&+(/:]\s*|\s+-\s+/)[0], name.split(':')[0]])].filter((x) => x && x.length >= 3)
      for (const q of parts) {
        const hit = (await searchPlaces(q, near).catch(() => [])).find((x) => !x.airport && km(near, x) <= 150)
        if (hit) { where = { lat: hit.lat, lng: hit.lng }; break }
      }
    }
  }
  if (!r.costOnly && !where) {
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
  if (r.category === 'stay' && name && r.stay?.checkIn) {
    // 숙소: 위치를 못 찾았으면 그 도시 가운데로 두고 이름으로 고칠 수 있게 한다
    const loc = where ?? { lat: near.lat, lng: near.lng }
    const checkIn = r.stay.checkIn
    const checkOut = r.stay.checkOut && r.stay.checkOut > checkIn ? r.stay.checkOut : addDays(checkIn, 1)
    out.push({
      date: checkIn, dateFrom: 'image', expense: expense && { ...expense, category: 'stay', date: checkIn },
      choices,
      stay: {
        id: uid(), name, ...loc, checkIn, checkOut, inTime: r.stay.inTime, outTime: r.stay.outTime, code: r.code,
        address: stayAddress ?? choices?.[0]?.address ?? foundAddress,
        note: [r.stay.room && tr('객실 {0}', r.stay.room), r.stay.host && tr('호스트 {0}', r.stay.host)].filter(Boolean).join(' · ') || undefined,
      },
    })
    return out
  }
  if (tour && name) {
    // 위치를 못 찾았어도 투어는 일정에 넣는다 (그 날 머무는 도시에 두고, 미팅 포인트는 메모로)
    const loc = where ?? { lat: near.lat, lng: near.lng }
    const note = [
      r.code && tr('예약번호 {0}', r.code),
      tour.option && tr('옵션 {0}', tour.option),
      tour.address && tr('미팅 포인트 {0}', tour.address),
      tour.meeting,
      tour.alt,
    ].filter(Boolean).join('\n')
    out.push({
      date, dateFrom: from, expense,
      place: { id: uid(), name, ...loc, address: tour.address, category: r.category, note: note || undefined, time: r.time, duration: tour.duration ?? 120 },
    })
    return out
  }
  if (where && name) {
    out.push({
      date, dateFrom: from, expense,
      place: { id: uid(), name, ...where, category: r.category, note: r.code ? tr('예약번호 {0}', r.code) : undefined, time: r.time ?? (from === 'photo' ? exif.time : undefined), duration: r.category === 'stay' ? 60 : r.category === 'cafe' ? 45 : 60 },
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
  stayId?: string
  stayAdded?: boolean
  /** 같은 이름 숙소 후보 (다른 지점으로 바꿀 수 있게) */
  choices?: StayChoice[]
  airportChoices?: AirportChoice[]
  checkOut?: string
  /** 이미 넣은 것과 같아 다시 넣지 않았다 */
  duplicate?: boolean
}

/** 넣을 거리를 여행에 넣는다 (mutate 안에서 부른다). 같은 영수증을 두 번 올려도 겹치지 않게 한다 */
export function applyDraft(t: Trip, d: Draft, putFlight: (t: Trip, f: Flight) => unknown): Applied {
  const res: Applied = { date: d.date, dateFrom: d.dateFrom, title: d.place?.name ?? d.flight?.flightNo ?? d.expense?.title ?? '', noPlace: d.noPlace }
  if (d.flight) {
    const same = t.flights.find((f) => f.flightNo === d.flight!.flightNo && f.depDate === d.flight!.depDate && f.depTime === d.flight!.depTime)
    if (same) res.duplicate = true
    else { putFlight(t, d.flight); res.flightId = d.flight.id; res.airportChoices = d.airportChoices }
    res.time = d.flight.depTime
    // 편명이 없으면 항공사 이름과 구간으로 보여 준다: '스쿠트 SIN → BKK'
    res.title = `${/\d/.test(d.flight.flightNo) ? d.flight.flightNo : airlineOf(d.flight.flightNo) || d.flight.flightNo} ${d.flight.from} → ${d.flight.to}`
  }
  if (d.stay) {
    const same = (t.stays ?? []).find((s) => s.name === d.stay!.name && s.checkIn === d.stay!.checkIn)
    if (same) { res.duplicate = true; res.stayId = same.id }
    else {
      // 숙박비는 숙소에 묶어 둔다 (숙소를 지우면 함께 지워진다)
      putStay(t, { ...d.stay }, d.expense ? { amount: d.expense.amount, currency: d.expense.currency } : undefined)
      res.stayId = d.stay.id
      res.stayAdded = true
    }
    const s = t.stays!.find((x) => x.id === res.stayId)!
    res.title = s.name
    if (d.choices && res.stayAdded) res.choices = d.choices
    res.checkOut = s.checkOut
    if (d.expense) res.amount = { value: d.expense.amount, currency: d.expense.currency }
    return res
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
      // 새로 넣은 장소면 비용을 장소에 묶는다 (장소에서 금액·통화를 고치고, 장소를 지우면 함께 지워진다)
      if (res.placeAdded) { const p = day?.items.find((x) => x.id === res.placeId); if (p) p.expenseId = e.id }
    }
    res.amount = { value: e.amount, currency: e.currency }
  }
  return res
}

/** 넣은 것을 되돌린다 */
export function undoApplied(t: Trip, a: Applied) {
  if (a.stayId && a.stayAdded) removeStay(t, a.stayId)
  if (a.placeId && a.placeAdded) for (const d of t.days) d.items = d.items.filter((p) => p.id !== a.placeId)
  if (a.expenseId) t.expenses = t.expenses.filter((e) => e.id !== a.expenseId)
  if (a.flightId) t.flights = t.flights.filter((f) => f.id !== a.flightId)
}

export const dateFromLabel = (from: DateFrom) => (from === 'image' ? tr('사진 속 날짜') : from === 'photo' ? tr('찍은 날짜') : tr('보고 있던 날'))

/** 숙소를 다른 후보(같은 이름의 다른 지점)로 바꾼다 */
/** 줄임말 공항을 다른 후보로 바꾼다 (같은 사진의 같은 줄임말은 함께) */
export function switchAirport(t: Trip, flightId: string, side: 'from' | 'to', code: string) {
  const f = t.flights.find((x) => x.id === flightId)
  if (f) f[side] = code
}

export function switchStay(t: Trip, stayId: string, c: StayChoice) {
  const s = t.stays?.find((x) => x.id === stayId)
  if (!s) return
  s.name = c.name; s.lat = c.lat; s.lng = c.lng
  if (c.address) s.address = c.address
  const e = s.expenseId ? t.expenses.find((x) => x.id === s.expenseId) : undefined
  if (e) e.title = c.name
}
