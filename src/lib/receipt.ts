import { lang, tr } from '../i18n'
import { flightList, type AirportChoice } from './flightList'
import { categoryByName } from '../data/destinations'
import type { Category, ExpenseCategory, Flight } from '../types'
import { AIRLINES, AIRPORTS, airportByCity } from '../data/airports'
import { isComplete, parseFlightText } from './flight'
import { addDays, dateRange } from './util'

/**
 * 사진에서 읽은 글자(OCR)로 영수증·예약 화면·탑승권을 해석한다. AI 없이 기기 안에서만 동작한다.
 * 여기 함수들은 화면과 상관없는 순수 함수라 테스트로 확인한다.
 */

export interface OcrLine { text: string; height: number; top: number }

export interface Reading {
  name?: string
  /** 예약번호·주문번호 */
  code?: string
  date?: string
  time?: string
  amount?: number
  currency?: string
  category: Category
  expenseCategory: ExpenseCategory
  /** 들를 곳 없이 비용만 있는 것 (택시, 교통카드 등) */
  costOnly: boolean
  flights: Flight[]
  /** 항공편마다 줄임말 공항(KK 등)의 다른 후보 */
  flightChoices?: (AirportChoice[] | undefined)[]
  /** 숙소 예약 화면이면 체크인·체크아웃 */
  stay?: { checkIn?: string; checkOut?: string; inTime?: string; outTime?: string; address?: string; city?: string; host?: string; room?: string }
  /** 투어·액티비티 바우처(GetYourGuide, Klook, KKday 등)면 만나는 곳과 안내 */
  tour?: TourInfo
  /** 버스·기차 승차권: 출발·도착 정류장, 회사, 좌석 */
  ride?: RideInfo
}

export interface TourInfo {
  /** 다른 언어로 적힌 투어 이름 (한국어 화면이면 영어 이름) */
  alt?: string
  option?: string
  /** 미팅 포인트 주소 */
  address?: string
  /** 미팅 포인트 안내 (어디서 만나는지, 몇 분 전에 오라는지) */
  meeting?: string
  /** 소요 시간(분) */
  duration?: number
}

const IN = /체크\s*인|check[\s-]*in|入住|チェックイン|เช็คอิน/i
const OUT = /체크\s*아웃|check[\s-]*out|退房|チェックアウト|เช็คเอาท์/i

/** OCR 줄에서 칸(여러 칸 띄어 쓴 덩어리)을 나눈다: "12월 5일 (토)        12월 7일 (월)" */
const columns = (l: string) => l.split(/\s{3,}|\s*[|│]\s*/).map((x) => x.trim()).filter(Boolean)

/**
 * 숙소 시각: "오후 3:00", "오후 3.00", "15:00", "3 PM". OCR이 오전·오후를 깨뜨려 읽기도 해서("272110:00")
 * 마지막 HH:MM을 쓰고, 오전·오후 표시가 없으면 체크인 1~9시는 오후로 본다 (체크인은 거의 오후다).
 */
export function stayTime(s: string, checkin: boolean): string | undefined {
  const all = [...s.matchAll(/(\d{1,2})\s*[:.]\s*([0-5]\d)(?!\d)/g)]
  const m = all[all.length - 1]
  if (!m) return undefined
  let h = Number(m[1])
  if (h > 23) h = h % 10
  const pm = /오후|후|PM|p\.m|午後/i.test(s), am = /오전|전|AM|a\.m|午前/i.test(s)
  if (pm && h < 12) h += 12
  else if (am && h === 12) h = 0
  else if (!pm && !am && checkin && h >= 1 && h <= 9) h += 12
  return `${String(h).padStart(2, '0')}:${m[2]}`
}

/** 숙소 예약의 체크인·체크아웃 날짜와 시각 */
export function findStayDates(text: string, days: string[]): Reading['stay'] {
  setDateRef(days)
  const year = Number((days[0] ?? '').slice(0, 4)) || new Date().getFullYear()
  const lines = text.split('\n')

  // 1) 나란히 놓인 모양 (에어비앤비 등): "체크인   체크아웃" 다음 줄들에 날짜 두 칸, 시각 두 칸
  const both = lines.findIndex((l) => IN.test(l) && OUT.test(l))
  if (both >= 0) {
    const after = lines.slice(both + 1, both + 5)
    const dateRow = after.map((l) => columns(l).map((c) => findDates(c, year)[0])).find((cs) => cs.filter(Boolean).length >= 1)
    const ds = dateRow?.filter(Boolean) as string[] | undefined
    const timeRow = after.map(columns).find((cs) => cs.length >= 2 && cs.every((c) => /\d\s*[:.]\s*\d\d/.test(c)))
    if (ds?.length) {
      return {
        checkIn: ds[0], checkOut: ds[1],
        inTime: timeRow ? stayTime(timeRow[0], true) : undefined,
        outTime: timeRow ? stayTime(timeRow[timeRow.length - 1], false) : undefined,
      }
    }
  }

  // 2) 한 줄에 날짜가 두 개: "Sun, Dec 13 → Mon, Dec 14" (아고다 등). 앞이 체크인, 뒤가 체크아웃
  //    시각은 그 아래·위 줄에서: 왼쪽 칸 시각은 체크인, 'Check-out' 옆 시각은 체크아웃
  if (both < 0) {
    for (let i = 0; i < lines.length; i++) {
      const ds = [...new Set(findDates(lines[i], year))].sort()
      if (ds.length !== 2 || ds[1] <= ds[0] || dateRange(ds[0], ds[1]).length > 32) continue
      // 같은 줄에 시각이 있으면: "13 Dec 14:00 - 14 Dec" → 구분 기호 앞은 체크인, 뒤는 체크아웃
      const halves = lines[i].split(/\s+[-~–—→]\s+|\s*→\s*/)
      if (halves.length === 2 && /\d\s*:\s*\d\d/.test(lines[i])) {
        const tIn = /\d\s*:\s*\d\d/.test(halves[0]) ? stayTime(halves[0].replace(/\d{4}/g, ''), true) : undefined
        const tOut = /\d\s*:\s*\d\d/.test(halves[1]) ? stayTime(halves[1].replace(/\d{4}/g, ''), false) : undefined
        return { checkIn: ds[0], checkOut: ds[1], inTime: tIn, outTime: tOut }
      }
      const near = [lines[i + 1] ?? '', lines[i - 1] ?? ''].find((l) => /\d\s*[:.]\s*\d\d/.test(l) && !findDates(l, year).length) ?? ''
      const cs = columns(near)
      const inCol = cs.find((c) => /\d\s*[:.]\s*\d\d/.test(c) && !OUT.test(c))
      const outCol = cs.find((c) => /\d\s*[:.]\s*\d\d/.test(c) && OUT.test(c)) ?? (cs.length >= 2 && cs[cs.length - 1] !== inCol && /\d\s*[:.]\s*\d\d/.test(cs[cs.length - 1]) ? cs[cs.length - 1] : undefined)
      return { checkIn: ds[0], checkOut: ds[1], inTime: inCol ? stayTime(inCol, true) : undefined, outTime: outCol ? stayTime(outCol, false) : undefined }
    }
  }

  // 3) 항목마다 줄이 있는 모양: "체크인 2026.12.02 15:00" 또는 "체크인" 다음 줄에 날짜
  const pick = (re: RegExp, checkin: boolean) => {
    const i = lines.findIndex((l) => re.test(l) && !(IN.test(l) && OUT.test(l)) && findDates(l, year).length)
    const at = i >= 0 ? i : lines.findIndex((l, k) => re.test(l) && !(IN.test(l) && OUT.test(l)) && k + 1 < lines.length && findDates(lines[k + 1], year).length)
    if (at < 0) return {}
    const l = i >= 0 ? lines[at] : `${lines[at]} ${lines[at + 1]}${lines[at + 2] && !findDates(lines[at + 2], year).length ? ` ${lines[at + 2]}` : ''}`
    const rest = l.replace(/\d{4}\s*[-./년]\s*\d{1,2}\s*[-./월]\s*\d{1,2}\s*일?|\d{1,2}\s*월\s*\d{1,2}\s*일/g, ' ')
    return { date: findDates(l, year)[0], time: /\d\s*[:.]\s*\d\d/.test(rest) ? stayTime(rest, checkin) : undefined }
  }
  const a = pick(IN, true), b = pick(OUT, false)
  if (!a.date && !b.date) {
    const r = findDateRange(text, year)
    return r ? { checkIn: r[0], checkOut: r[1] } : undefined
  }
  return { checkIn: a.date, checkOut: b.date, inTime: a.time, outTime: b.time }
}

/** 체크인·체크아웃 항목이 있는 줄 (나란히 놓인 모양이면 그 줄). 그 부분만 다시 읽을 때 쓴다 */
export const stayLabelLine = (lines: OcrLine[]) => lines.find((l) => IN.test(l.text) && OUT.test(l.text)) ?? lines.find((l) => IN.test(l.text))

/**
 * 이름 앞에 붙은 사진 찌꺼기 떼기: 숙소 사진 썸네일이 '#4', '8', 'p18' 같은 글자로 읽혀 이름 앞에 붙는다.
 * 대문자·한글로 시작하는 낱말 앞의 짧은 숫자·기호 덩어리만 뗀다 ('7-Eleven', '1 Hotel'처럼 이름의 일부일 수 있는 건
 * 뒤 낱말이 하나뿐이면 남긴다)
 */
export function stripLeadJunk(name: string): string {
  const m = name.match(/^((?:(?=\S*[\d#@*%&|\\/])\S{1,4}\s+)+)([\p{Lu}가-힣].*)$/u)
  return m && m[2].trim().split(/\s+/).length >= 2 ? m[2].trim() : name
}

/**
 * 숙소 이름·주소·호스트 (에어비앤비 같은 숙소 앱 화면).
 * - 이름: '숙소' 제목 아래의 숙소 소개 제목, 없으면 'OO의 숙소' 제목
 * - 도시: 'Tauranga의 숙소'의 Tauranga (주소로 위치를 찾을 때 함께 쓴다)
 * - 주소: '찾아가는 방법'·'주소'·'Address' 다음 줄
 */
export function findStayInfo(lines: string[]): { name?: string; city?: string; address?: string; host?: string; room?: string } {
  const out: { name?: string; city?: string; address?: string; host?: string; room?: string } = {}
  const clean = (s: string) => s.replace(/^[^\p{L}\p{N}]+/u, '').replace(/\s+/g, ' ').trim()
  // 예약 목록의 숙소 카드 (아고다 일정 등): 날짜 두 개가 있는 줄 바로 위가 숙소 이름, 바로 아래가 도시
  //   "Confirmed / Quest North Sydney / 13 Dec 14:00 - 14 Dec / Sydney"
  const year = new Date().getFullYear()
  const di = lines.findIndex((l) => new Set(findDates(l, year)).size === 2 && !IN.test(l) && !OUT.test(l))
  if (di > 0) {
    const skip = /confirmed|확정|예약\s*완료|booking\s*id|^\W*id\b|체크|check|\d{6,}/i
    const tidy = (l: string) => {
      // 사진 옆 글자 찌꺼기를 떼고, 칸이 나뉘어 있으면 가장 긴 글자 칸을 쓴다
      const cols = l.split(/\s{2,}/).map((x) => x.trim()).filter((x) => /\p{L}{2,}/u.test(x))
      const best = cols.sort((a, b) => b.length - a.length)[0] ?? ''
      return stripLeadJunk(best.replace(/^[^\p{L}\p{N}]+/u, '').replace(/^(?:[a-z]{1,4}\s+)+(?=[\p{Lu}가-힣])/u, '').trim())
    }
    // 바로 위 줄만 본다 (문장·항목 이름은 숙소 이름이 아니다)
    const prev = lines[di - 1] ?? ''
    const nm = !skip.test(prev) ? tidy(prev) : ''
    const sentence = /[.!?]$|\b(you|your|will|the next|in the|we)\b/i.test(nm) || nm.split(' ').length > 7
    if (nm.length >= 4 && nm.length <= 60 && !sentence && /\p{L}{3,}/u.test(nm)) out.name = nm
    const nx = tidy(lines[di + 1] ?? '')
    if (/^[\p{Lu}가-힣][\p{L} .'-]{1,30}$/u.test(nx) && nx.split(' ').length <= 3 && !skip.test(nx) && !/room|night|guest|adult|박|객실/i.test(nx)) out.city = nx
  }
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim()
    // 'OO의 숙소', OCR이 '의'를 '2]', 'al|', 'l|'로 읽은 경우도
    const t = l.match(/^\W*([\p{L}][\p{L}\s.'-]{1,30}?)\s*(?:의|2\]|l\||[|\]]+)\s*\|?\s*(숙소|방|집|객실|아파트|콘도|빌라|주택|공간|캐빈|오두막)\s*$/u)
    if (t && !out.city) { out.city = t[1].trim(); if (!out.name) out.name = `${out.city}의 ${t[2]}` }
    const h = l.match(/(?:호스트|host(?:ed by)?)?\s*[:：]\s*([\p{L}][\p{L} .'-]{0,30}?)\s*님\s*$|hosted by\s+([\p{L}][\p{L} .'-]{0,30})$/iu)
    if (h && !out.host) out.host = (h[1] ?? h[2]).trim()
    if (/찾아가는\s*방법|^\W*주소\b|\baddress\b|getting there|所在地|住所/i.test(l) && !out.address) {
      const own = l.replace(/.*(찾아가는\s*방법|주소|address|getting there|所在地|住所)\s*[:：]?/i, '').trim()
      const next = clean(lines[i + 1] ?? '')
      const cand = own.length > 4 ? own : next
      if (cand && /\d|\p{L}{3,}/u.test(cand) && !IN.test(cand) && cand.length <= 80) out.address = cand
    }
    // 도시: 'More Hotels in Sydney', 'Hotels in Bangkok', '시드니의 다른 숙소'
    const c = l.match(/\b(?:hotels?|stays?|properties|homes?)\s+in\s+([A-Z][\p{L} .'-]{1,30})$/iu) ?? l.match(/([\p{L}]{2,20})(?:의)?\s*(?:다른\s*)?(?:숙소|호텔)\s*더\s*보기/u)
    if (c && !out.city) out.city = c[1].trim()
    // 객실 선택 화면: 머리글 다음 줄이 객실 이름 ('객실 선택' / 'Biggy King Bunk')
    if (/^\W*(?:객실\s*선택|select\s*(?:a\s*)?room|choose\s*(?:your\s*)?room)\s*$/i.test(l) && !out.room) {
      const n = clean(lines[i + 1] ?? '')
      if (/^[\p{L}][\p{L}\d .'&()/-]{3,40}$/u.test(n) && !/환불|선택|취소|refund|cancel/i.test(n)) out.room = n
    }
    // 객실: 'Studio Superior', '디럭스 더블룸'
    const r = l.match(/(?:^|\s)((?:(?:studio|superior|deluxe|standard|premier|executive|family|junior|grand)\s+)*(?:studio|superior|deluxe|standard|suite|double|twin|king|queen|single|room|dorm)(?:\s+(?:room|suite|double|twin|king|queen|view|city|ocean|river|with\s+[\w ]+))*|[가-힣]*(?:디럭스|스탠다드|슈페리어|스위트|트윈|더블|싱글|패밀리)[가-힣 ]*룸?)\s*$/i)
    if (r && !out.room && r[1].length >= 5 && !/^room$/i.test(r[1])) out.room = r[1].trim()
    // '숙소' 제목 다음 줄: 숙소 소개 제목 (한두 글자로 끊겨 읽힌 줄은 이어 붙인다)
    if (/^\W{0,4}[A-Za-z]{0,3}\s*숙소\s*$/.test(l) && !/의|이용/.test(l)) {
      let n = clean(lines[i + 1] ?? '')
      if (n.length <= 2 && lines[i + 2]) n = clean(n + (lines[i + 2] ?? ''))
      if (n.length >= 4) out.name = n.slice(0, 48)
    }
  }
  return out
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 }
const pad = (n: number) => String(n).padStart(2, '0')
const valid = (y: number, m: number, d: number) => m >= 1 && m <= 12 && d >= 1 && d <= 31 && y > 2000 && y < 2100
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`

/** 글자 속 날짜 후보를 모두 찾는다. 태국 불기(2569 → 2026)와 연도 없는 날짜도 받는다 */
/**
 * 연도 없이 '2월 12일'만 적힌 날짜의 연도를 고를 기준 (여행 첫날).
 * 12월에 시작하는 여행의 '2월 12일'은 다음 해다. readText·flightFromTable이 여행 날짜로 정한다.
 */
let refDate: string | undefined
export const setDateRef = (days: string[]) => { refDate = days[0] }
const yearFor = (year: number, m: number, d: number) => {
  if (!refDate || !valid(year, m, d)) return year
  const ref = Date.parse(refDate)
  // 여행 첫날에서 가장 가까운 해 (앞뒤 한 해까지)
  return [year - 1, year, year + 1].filter((y) => valid(y, m, d)).sort((a, b) => Math.abs(Date.parse(iso(a, m, d)) - ref) - Math.abs(Date.parse(iso(b, m, d)) - ref))[0] ?? year
}

export function findDates(text: string, year: number): string[] {
  const out: string[] = []
  const push = (y: number, m: number, d: number, guessed = false) => {
    if (guessed) y = yearFor(y, m, d)
    if (y > 2400 && y < 2700) y -= 543
    if (y < 100) y += 2000
    // OCR이 연도 한 자리를 잘못 읽은 경우(2226, 2O26 → 2026): 여행 연도와 한 자리만 다르면 고친다.
    // 바로 앞뒤 해(2026 ↔ 2027)는 해를 넘기는 여행일 수 있어 그대로 둔다
    if (y !== year && Math.abs(y - year) > 1 && [...String(y)].filter((c, i) => c !== String(year)[i]).length === 1 && String(y).length === 4) y = year
    if (valid(y, m, d)) out.push(iso(y, m, d))
  }
  const t = text.replace(/\s+/g, ' ')
  for (const m of t.matchAll(/(\d{4})\s*[-./년]\s*(\d{1,2})\s*[-./월]\s*(\d{1,2})/g)) push(+m[1], +m[2], +m[3])
  // '2027년 2월 12일'의 '년'을 4·L로 읽은 것: 20274 2월 12일, 2027L 2월 12일
  for (const m of t.matchAll(/(?<!\d)(20\d{2})(?:4|[Ll'’|])\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/g)) push(+m[1], +m[2], +m[3])
  // 앱 예약 화면의 짧은 연도 표기: 27.2.12 - 27.2.13 (연.월.일). 여행 연도와 맞으면 이것으로 읽는다
  const yy = (a: string) => Math.abs(2000 + Number(a) - year) <= 1
  for (const m of t.matchAll(/(?<![\d.])(\d{2})\.\s?(\d{1,2})\.\s?(\d{1,2})(?![\d.])/g)) if (yy(m[1])) push(2000 + +m[1], +m[2], +m[3])
  for (const m of t.matchAll(/(?<![\d.])(\d{1,2})[./-](\d{1,2})[./-](\d{4}|\d{2})(?![\d])/g)) {
    if (/^\d{1,2}\.\d{1,2}\.\d{1,2}$/.test(m[0].replace(/\s/g, '')) && yy(m[1]) && valid(2000 + +m[1], +m[2], +m[3])) continue
    // 일/월/년이 흔하지만 월/일/년일 수도 있다: 둘 다 후보로 둔다
    push(+m[3], +m[2], +m[1]); push(+m[3], +m[1], +m[2])
  }
  for (const m of t.matchAll(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/g)) push(year, +m[1], +m[2], true)
  const month = (w: string) => MONTHS[w.toLowerCase().slice(0, 4)] ?? MONTHS[w.toLowerCase().slice(0, 3)]
  for (const m of t.matchAll(/\b(\d{1,2})(?:st|nd|rd|th)?\s*([A-Za-z]{3,9})\.?,?\s*(\d{4})?/g)) { const mo = month(m[2]); if (mo) push(m[3] ? +m[3] : year, mo, +m[1], !m[3]) }
  for (const m of t.matchAll(/\b([A-Za-z]{3,9})\.?\s*(\d{1,2})(?:st|nd|rd|th)?\b(?!\s*[:.]\s*\d\d),?\s*(\d{4})?/g)) { const mo = month(m[1]); if (mo) push(m[3] ? +m[3] : year, mo, +m[2], !m[3]) }
  for (const m of t.matchAll(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/g)) push(+m[1], +m[2], +m[3])
  // 항공권 표기: 02DEC26, 04DEC
  for (const m of t.matchAll(/\b(\d{2})(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)(\d{2})?\b/gi)) push(m[3] ? 2000 + +m[3] : year, MONTHS[m[2].toLowerCase()], +m[1], !m[3])
  return [...new Set(out)]
}

/**
 * 날짜 범위: 에어비앤비 같은 예약 확인 화면은 체크인·체크아웃 항목 없이 기간만 보여 준다.
 *   2026년 12월 3일~5일 / 2026년 12월 30일~1월 2일 / Dec 3 – 5, 2026 / 3–5 Dec 2026 / Dec 30, 2026 – Jan 2, 2027
 * OCR이 '년'을 4로, '월'을 2·%로 읽는 경우도 받는다 (20264 12% 8일~10일, 2026년 122 8일~10일).
 */
export function findDateRange(text: string, year: number): [string, string] | undefined {
  const t = text.replace(/\s+/g, ' ')
  const SEP = '\\s*[~\\-–—→]\\s*'
  const mk = (y: number, m: number, d: number) => { if (y > 2400 && y < 2700) y -= 543; return valid(y, m, d) ? iso(y, m, d) : undefined }
  const done = (a?: string, b?: string): [string, string] | undefined => {
    if (!a || !b) return undefined
    // 끝 날짜가 앞서면 다음 달·다음 해로 넘어간 것 (12월 30일~2일)
    if (b <= a) { const [y, m, d] = b.split('-').map(Number); b = m === 12 ? mk(y + 1, 1, d) ?? b : mk(y, m + 1, d) ?? b }
    return b > a ? [a, b] : undefined
  }
  const yr = '(\\d{4})\\s*(?:년|4(?=\\s))\\s*'
  const mo = '(\\d{1,2})\\s*(?:월|%|(?<=\\d)[29](?=\\s))\\s*'
  let m = t.match(new RegExp(`${yr}${mo}(\\d{1,2})\\s*일?${SEP}(?:(\\d{4})\\s*년\\s*)?(?:(\\d{1,2})\\s*월\\s*)?(\\d{1,2})\\s*일`))
  if (m) { const y = +m[1], a = mk(y, +m[2], +m[3]); return done(a, mk(m[4] ? +m[4] : y, m[5] ? +m[5] : +m[2], +m[6])) }
  m = t.match(new RegExp(`(?<!\\d)${mo}(\\d{1,2})\\s*일${SEP}(?:(\\d{1,2})\\s*월\\s*)?(\\d{1,2})\\s*일`))
  if (m) return done(mk(year, +m[1], +m[2]), mk(year, m[3] ? +m[3] : +m[1], +m[4]))
  const month = (w?: string) => (w ? MONTHS[w.toLowerCase().slice(0, 4)] ?? MONTHS[w.toLowerCase().slice(0, 3)] : undefined)
  // Dec 3 – 5, 2026 / Dec 30, 2026 – Jan 2, 2027
  m = t.match(new RegExp(`\\b([A-Za-z]{3,9})\\.?\\s+(\\d{1,2}),?\\s*(\\d{4})?${SEP}(?:([A-Za-z]{3,9})\\.?\\s+)?(\\d{1,2}),?\\s*(\\d{4})?`))
  if (m && month(m[1]) && (!m[4] || month(m[4]))) {
    const y1 = m[3] ? +m[3] : m[6] ? +m[6] : year
    return done(mk(y1, month(m[1])!, +m[2]), mk(m[6] ? +m[6] : y1, month(m[4]) ?? month(m[1])!, +m[5]))
  }
  // 3–5 Dec 2026
  m = t.match(new RegExp(`\\b(\\d{1,2})${SEP}(\\d{1,2})\\s+([A-Za-z]{3,9})\\.?,?\\s*(\\d{4})?`))
  if (m && month(m[3])) { const y = m[4] ? +m[4] : year; return done(mk(y, month(m[3])!, +m[1]), mk(y, month(m[3])!, +m[2])) }
  // 날짜 둘을 ~·–·→로 이은 것
  m = t.match(new RegExp(`(\\d{4}[-./]\\d{1,2}[-./]\\d{1,2})[^\\d]{0,8}${SEP}(\\d{4}[-./]\\d{1,2}[-./]\\d{1,2})`))
  if (m) return done(findDates(m[1], year)[0], findDates(m[2], year)[0])
  return undefined
}

/** 여행 기간 안의 날짜가 있으면 그것을, 없으면 처음 찾은 날짜를 돌려준다 */
const DATE_LABEL = /체크\s*인|check[\s-]*in|이용\s*일|방문\s*일|관람\s*일|visit(?:ing)?\s*date|travel\s*date|date\s*of\s*visit|출발|departure|탑승일|日付|ご利用日|วันที่/i
const NOT_DATE_LABEL = /기한|환불|취소|cancel|refund|까지|체크\s*아웃|check[\s-]*out|예약\s*일|결제\s*일|booked\s*on|booking\s*date|발행|issued|만료|expir/i

export function pickTripDate(text: string, days: string[]): string | undefined {
  setDateRef(days)
  const year = Number((days[0] ?? '').slice(0, 4)) || new Date().getFullYear()
  const lines = text.split('\n')
  // 체크인·이용일처럼 '그 날'을 가리키는 줄의 날짜를 먼저 본다. 체크아웃·예약일 줄은 뒤로 미룬다
  const labeled = lines.filter((l) => DATE_LABEL.test(l) && !NOT_DATE_LABEL.test(l)).flatMap((l) => findDates(l, year))
  const plain = lines.filter((l) => !NOT_DATE_LABEL.test(l)).flatMap((l) => findDates(l, year))
  const all = [...labeled, ...plain, ...findDates(text, year)]
  return all.find((d) => days.includes(d)) ?? all[0]
}

export function findTime(text: string): string | undefined {
  // 오전/오후·AM/PM이 붙은 시각을 먼저 믿는다 (오후가 '2%'처럼 깨져 읽힌 '1:30' 대신 'at 1:30 PM')
  const all = [...text.matchAll(/(오전|오후|午前|午後)?\s*(?<!\d)([01]?\d|2[0-3])\s*:\s*([0-5]\d)(?:\s*:\s*[0-5]\d)?\s*(AM|PM|am|pm|A\.M\.|P\.M\.)?/g)]
  const m = all.find((x) => x[1] || x[4]) ?? all[0]
  if (!m) return undefined
  let h = Number(m[2])
  const ap = (m[4] ?? m[1])?.toLowerCase().replace(/\./g, '')
  if ((ap === 'pm' || ap === '오후' || ap === '午後') && h < 12) h += 12
  if ((ap === 'am' || ap === '오전' || ap === '午前') && h === 12) h = 0
  return `${pad(h)}:${m[3]}`
}

/** 예약번호·확인번호·주문번호 (JOMO parse.ts에서 가져와 넓힘) */
export function findCode(text: string): string | undefined {
  const re = /(예약\s*번호|확인\s*번호|예약\s*코드|승인\s*번호|주문\s*번호|예매\s*번호|booking\s*(?:reference|ref\.?|number|no\.?|id|code)|confirmation\s*(?:number|no\.?|code|#)|reservation\s*(?:number|no\.?|code|id)|record\s*locator|PNR|order\s*(?:number|no\.?|id|#)|(?<![A-Za-z])ID(?=\s*[:：#]\s*\d{6})|itinerary\s*(?:number|no\.?)|予約番号|受付番号)\s*[:：#.]?\s*([A-Z0-9][A-Z0-9-]{3,24})/i
  const m = re.exec(text)
  return m ? m[2].toUpperCase() : undefined
}

const CURRENCY: [RegExp, string][] = [
  [/฿|THB|บาท/i, 'THB'], [/₩|KRW|원(?![가-힣])|\bW(?=\d{1,3}[,.]\d)/, 'KRW'], [/NT\$|TWD|NTD|元/i, 'TWD'], [/¥|円|JPY/i, 'JPY'], [/CNY|RMB|人民币/i, 'CNY'],
  [/₫|VND|đ(?![a-z])/i, 'VND'], [/€|EUR/i, 'EUR'], [/£|GBP/i, 'GBP'], [/HK\$|HKD/i, 'HKD'], [/S\$|SGD/i, 'SGD'], [/NZ\$|\bNZD\b/, 'NZD'], [/A\$|\bAUD\b/, 'AUD'], [/C\$|\bCAD\b/, 'CAD'], [/\bMYR\b|\bRM(?=\s?\d)/, 'MYR'],
  [/₱|\bPHP\b/, 'PHP'], [/\bIDR\b|\bRp(?=\s?\d)/, 'IDR'], [/\bCHF\b/, 'CHF'], [/\bAED\b/, 'AED'], [/US\$|USD|\$/i, 'USD'],
]
export function findCurrency(text: string, fallback: string): string {
  for (const [re, code] of CURRENCY) if (re.test(text)) return code === 'USD' && /HK\$|S\$|NT\$|NZ\$|A\$|C\$/.test(text) ? fallback : code
  return fallback
}

/** "1,234.50", "1.234,50", "12 600" 같은 금액을 숫자로 */
const CUR_AFTER = /(\d{1,3}(?:[ ,.]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)\s*(?:원|₩|円|บาท|THB|KRW|JPY|USD|EUR|AUD|NZD)/i
const CUR_BEFORE = /(?:[฿₩¥€£₫$\\]|THB|KRW|JPY|USD|EUR|AUD|NZD)\s*(\d{1,3}(?:[ ,.]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)/i
export function parseAmount(s: string): number | undefined {
  // 통화가 붙은 금액이 있으면 그것 ('총 금액 105,800원 +16'의 적립 포인트 +16을 피한다)
  const c = s.match(CUR_AFTER) ?? s.match(CUR_BEFORE)
  if (c) { const n = parsePlain(c[1]); if (n !== undefined) return n }
  // '+16', '+1' 같은 덧붙임 숫자(적립·다음 날 표시)는 금액이 아니다
  return parsePlain(s.replace(/\+\s*\d{1,3}(?![\d,.])/g, ' '))
}
function parsePlain(s: string): number | undefined {
  // 숫자 사이에 끼어 읽힌 O·o·l·I는 0·1로 본다 (1O0.00 → 100.00)
  // 바트 기호(฿)가 "[4", "(8"처럼 괄호+숫자로 읽힌 경우: 그 숫자는 기호로 본다
  s = s.replace(/[[(|{]\s*[48B](?=\d)/g, ' ')
  const fixed = s.replace(/(?<=\d)[Oo](?=[\d.,])|(?<=[\d.,])[Oo](?=\d)/g, '0').replace(/(?<=\d)[lI|](?=\d)/g, '1')
  // "2 200"처럼 천 단위를 띄어 읽은 것도 한 금액으로 본다
  const m = fixed.replace(/[^\d.,\s]/g, ' ').trim().match(/\d{1,3}(?:[ ,.]\d{3})+(?:[.,]\d{1,2})?(?!\d)|\d[\d.,]*\d|\d/g)
  if (!m) return undefined
  const raw = m[m.length - 1].replace(/\s/g, '')
  let n: number
  if (/^\d{1,3}([.,]\d{3})+$/.test(raw)) n = Number(raw.replace(/[.,]/g, '')) // 천 단위 구분만 있는 경우
  else if (/^\d{1,3}(,\d{3})*\.\d{1,2}$/.test(raw)) n = Number(raw.replace(/,/g, ''))
  else if (/^\d{1,3}(\.\d{3})*,\d{1,2}$/.test(raw)) n = Number(raw.replace(/\./g, '').replace(',', '.'))
  else n = Number(raw.replace(/,/g, ''))
  return Number.isFinite(n) && n > 0 ? n : undefined
}

const TOTAL = /[\d,]\s*원?\s*예약(?:하기)?\s*$|reserve\s*$|book\s*now|^[^\p{L}\d]*금\s*액|grand\s*total|t[o0]ta[l1i]|^\s*총\b|결제\s*완료|payment\s*complete|\bpaid\b|카드\s*결제|신용\s*카드|paid\s*by|card\s*payment|amount\s*(due|paid)?|balance|합\s*계|총\s*(액|금액|결제)|결제\s*금액|받을\s*금액|청구\s*금액|合\s*計|お会計|ご請求|総額|รวม(ทั้งสิ้น|เงิน)?|ยอดรวม|ยอดสุทธิ|tổng|montant|summe|totale/iu
const NOT_TOTAL = /sub\s*total|소계|vat|tax|세액|부가세|change|거스름|잔돈|お釣|ทอน|discount|할인|cash\s*tendered|받은\s*금액/i

/** 합계 줄의 금액을 찾는다. 없으면 통화 기호가 붙은 가장 큰 금액 */
export function findTotal(lines: string[]): number | undefined {
  const totals = lines.filter((l) => TOTAL.test(l) && !NOT_TOTAL.test(l)).map(parseAmount).filter((n): n is number => n !== undefined)
  if (totals.length) return Math.max(...totals)
  const priced = lines.filter((l) => /[฿₩¥€£₫$\\]|\bW(?=\d)|THB|KRW|JPY|USD|EUR|원|円|บาท/.test(l) && !NOT_TOTAL.test(l)).map(parseAmount).filter((n): n is number => n !== undefined)
  return priced.length ? Math.max(...priced) : undefined
}

const KINDS: { re: RegExp; cat: Category; exp: ExpenseCategory; costOnly?: boolean }[] = [
  { re: /객실\s*선택|(?:킹|퀸|더블|트윈|싱글|이층)\s*침대|침대\s*\d|[\d,]\s*~?\s*\/\s*박|select\s*(?:a\s*)?room|bunk|king\s*bed|queen\s*bed|hotel|hostel|resort|check[\s-]?in|check[\s-]?out|\b\d+\s*(?:x\s*)?rooms?\b|add rooms|\b\d+\s*nights?\b|객실\s*\d|\d\s*박\b|호텔|숙박|숙소|체크\s*인|호스트|에어비앤비|리조트|게스트하우스|ホテル|旅館|โรงแรม|airbnb|agoda|booking\.com|게스트\s*\d+\s*명|\d+\s*guests?\b|저택|호실|별채|펜션|민박|빌라|콘도|아파트|단독\s*주택|공동\s*주택|집\s*전체|개인실|게스트용|타운하우스|캐빈|오두막|entire\s+(home|place|rental)|guest\s*suite|guesthouse|private\s+room|room\s+in|apartment|condo|villa|cottage|cabin|bungalow|townhouse|loft/i, cat: 'stay', exp: 'stay' },
  { re: /taxi|grab|bolt|uber|bts|mrt|metro|subway|railway|train|bus|ferry|택시|지하철|버스|기차|열차|교통|suica|pasmo|タクシー|電車|แท็กซี่|รถไฟ/i, cat: 'sight', exp: 'move', costOnly: true },
  { re: /\bspa\b|스파|온천|hot\s*pools?|sauna|사우나|찜질|massage|마사지|onsen|温泉/i, cat: 'relax', exp: 'play' },
  { re: /cafe|café|coffee|starbucks|카페|커피|喫茶|カフェ|กาแฟ|bakery|베이커리/i, cat: 'cafe', exp: 'food' },
  { re: /restaurant|bistro|kitchen|ramen|sushi|bbq|bar\b|pub|식당|레스토랑|음식|라멘|스시|食堂|レストラン|ร้านอาหาร|food|noodle|menu|국수|교자|김밥|찌개|국밥|치킨|고기|ラーメン|うどん|そば|寿司|居酒屋|ก๋วยเตี๋ยว|phở/i, cat: 'food', exp: 'food' },
  { re: /admission|entrance|museum|ticket|tour|입장|관람|박물관|미술관|투어|入場|チケット|ค่าเข้า/i, cat: 'culture', exp: 'play' },
  { re: /mart|7-?eleven|family\s?mart|lawson|store|shop|mall|market|duty\s?free|편의점|마트|면세|쇼핑|ドン・キホーテ|コンビニ|ร้านค้า/i, cat: 'shop', exp: 'shop' },
]

/** 주소 줄: 이름으로 쓰지 않는다 */
const ADDRESS = /\d+\s*(번?길|로|가)\b|[가-힣]+(시|구|군)\s+[가-힣]+(구|동|로|길)|\d+[\/-]\d+\s+\w+\s+(rd|road|st|street|ave|soi)\b|\b(rd|road|street|soi|moo)\b.*\d|[都道府県区市]\S*\d+[-−]\d+|丁目/i
const HEADER = /^[\s~.\-]*예약이\s*$|확정되었습니다|예약이\s*확정|^(you'?re\s+(all\s+set|going)|booking\s+confirmed|reservation\s+confirmed)|^(다음|next|done|확인)\s*$|^(?:\d{1,2}[.)]\s*)?(예약|구매|결제|주문|booking|reservation|order|purchase|payment)?\s*(확정|확인|완료|안내|내역|confirm(?:ed|ation)?|complete[d]?|receipt|details?)[\s\-—–.]*$|^e-?ticket(\s*receipt)?$|^your\s+(booking|order|receipt)$/i
const JUNK = /receipt|tax\s*invoice|invoice|confirmation|영수증|매출|전표|\btel\b|phone|전화|사업자|\bvat\b|no\.|\bdate\b|\btime\b|cashier|\bpos\b|\btable\b|\border\b|주문|領収|レシート|ใบเสร็จ|www\.|http|@/i

/** 가게·장소 이름: 위쪽에 있는 가장 큰 글자 줄 중 의미 있는 것 */
export function findName(lines: OcrLine[]): string | undefined {
  const good = lines
    .map((l) => ({ ...l, text: l.text.replace(/[|_~=*#<>]+/g, ' ').replace(/\s+/g, ' ').trim() }))
      .filter((l) => /[\p{L}\p{N}]/u.test(l.text))
    .filter((l) => !HEADER.test(l.text) && !findCode(l.text) && !ADDRESS.test(l.text) && !/^(체크|check|seat|좌석|객실|room|guest|승객|passenger|pickup|drop)/i.test(l.text))
    .filter((l) => l.text.length >= 2 && l.text.length <= 48 && /\p{L}{2,}/u.test(l.text) && !JUNK.test(l.text) && (l.text.match(/\d/g)?.length ?? 0) <= l.text.length / 3)
  if (!good.length) return undefined
  // 숙소 확인서: 호텔·리조트 이름이 든 줄을 먼저
  const stay = good.find((l) => /hotel|resort|inn\b|hostel|suites?|ryokan|호텔|리조트|료칸|게스트하우스|ホテル|旅館/i.test(l.text) && !/(번호|number)/i.test(l.text))
  if (stay) return stay.text
  const maxTop = Math.max(...lines.map((l) => l.top), 1)
  // 위쪽 40% 안에서 글자가 가장 큰 줄. 크기가 비슷하면 위에 있는 줄
  const top = good.filter((l) => l.top <= maxTop * 0.4)
  const pool = top.length ? top : good
  return pool.reduce((a, b) => (b.height > a.height * 1.15 ? b : a)).text
}

/**
 * 줄이 나뉜 항공권 화면에서 항공편을 만든다. 두 가지 모양을 받는다.
 * 1) 항목: 값 표 (예약 확인 단계):  SYD 시드니 ✈ ICN 서울/인천 / 출발일 2026-12-14(월) / 편명 TW502 / 출/도착 시간 12:15~21:15
 * 2) 시간표 (항공사 앱 예약 조회): 2026년 12월 02일 / 18:25 ICN / 09:55 +1일 AKL / KE411 B787-10 / 좌석 45B
 * parseFlightText는 편명 뒤의 글자만 보므로, 편명 앞에 나오는 구간·날짜·시각을 화면 전체에서 채운다.
 */
/** 표 머리글·상태 낱말 중 도시 이름과 겹치는 것 */
const NOT_CITY = new Set(['date', 'status', 'economy', 'business', 'terminal', 'confirmed', 'flight', 'operated', 'departing', 'arriving', 'non-stop', 'aircraft', 'sale', 'class', 'premium', 'first', 'seat', 'gate', 'time', 'est', 'journey', 'total', 'amount', 'card', 'master', 'reference', 'issued'])

export function flightFromTable(text: string, days: string[]): Flight | null {
  setDateRef(days)
  const year = Number((days[0] ?? '').slice(0, 4)) || new Date().getFullYear()
  const lines = text.split('\n')
  const codes = new Set(AIRPORTS.map((a) => a.code))
  const NOT_AIRPORT = new Set(['KRW', 'USD', 'JPY', 'EUR', 'THB', 'PNR', 'VAT', 'ETA', 'ETD', 'GMT', 'UTC', 'PAY', 'AND', 'THE'])
  const isAirport = (c: string) => codes.has(c) && !NOT_AIRPORT.has(c)

  // 편명: "편명 TW502"처럼 항목이 있으면 그것, 없으면 아는 항공사 코드로 시작하는 낱말 (B787-10 같은 기종은 뺀다)
  // 표의 머리글 줄(Flight Number)과 값 줄이 나뉜 화면, OCR이 소문자로 읽은 "Nz501"도 받는다
  let flightNo: string | undefined
  const labeled = text.match(/(?:편명|항공편|flight\s*(?:no\.?|number)?|便名)\s*[:：]?\s*([A-Z0-9]{2})\s?(\d{1,4})\b/i)
  if (labeled && AIRLINES[labeled[1].toUpperCase()]) flightNo = `${labeled[1].toUpperCase()}${labeled[2]}`
  else {
    for (const m of text.matchAll(/(?<![A-Z0-9-])([A-Z]{2}|[A-Z]\d|\d[A-Z])\s?(\d{2,4})(?![\d-])/g)) {
      if (AIRLINES[m[1]] && !/^[AB]\d{3}/.test(m[0])) { flightNo = `${m[1]}${m[2]}`; break }
    }
    if (!flightNo) for (const m of text.matchAll(/(?<![A-Za-z0-9-])([A-Za-z]{2}|[A-Za-z]\d|\d[A-Za-z])\s?(\d{3,4})(?![\d:-])/g)) {
      const c = m[1].toUpperCase()
      if (AIRLINES[c] && !/^[AB]\d{3}/i.test(m[0])) { flightNo = `${c}${m[2]}`; break }
    }
  }
  if (!flightNo) return null

  // 구간: 아는 공항 코드 둘이 한 줄에 있으면 그 줄, 아니면 나온 순서대로 앞의 둘.
  // 코드가 흐리게 찍혀 못 읽으면 "Auckland to Christchurch"처럼 도시 이름 구간으로 찾는다
  let from: string | undefined, to: string | undefined
  const allCodes: string[] = []
  for (const l of lines) {
    const iata = [...l.matchAll(/\b([A-Z]{3})\b/g)].map((m) => m[1]).filter(isAirport)
    if (!from && iata.length >= 2 && iata[0] !== iata[1]) [from, to] = iata
    for (const c of iata) if (!allCodes.includes(c)) allCodes.push(c)
  }
  if (!from) {
    const byCity = (name: string) => (name.trim().length >= 3 ? airportByCity(name.replace(/[^\p{L} .'-]/gu, '').trim()) : undefined)
    for (const l of lines) {
      const m = l.match(/^(.*?\S)\s+(?:to|→|->|–|—|-|✈)\s+(\S.*)$/i)
      if (!m) continue
      const left = m[1].split(/\s+/), right = m[2].split(/\s+/)
      // "New York to San Francisco"처럼 여러 낱말 도시도 받는다: 왼쪽은 끝에서, 오른쪽은 앞에서 1~3낱말
      const pick = (words: string[], end: boolean) => [3, 2, 1].map((n) => byCity((end ? words.slice(-n) : words.slice(0, n)).join(' '))).find(Boolean)
      const x = pick(left, true), y = pick(right, false)
      if (x && y && x !== y) { [from, to] = [x, y]; break }
    }
  }
  // 표 모양 일정표 (Departing | Arriving 칸): 편명이 있는 줄부터 몇 줄 안에 나오는 도시 이름을 순서대로
  //   10 Dec 26  QF 8765 operated by  Christchurch 6:10PM  Sydney (Kingsford Smith) 7:40PM
  if (!from) {
    const at = lines.findIndex((l) => l.replace(/\s/g, '').toUpperCase().includes(flightNo!))
    const near = at >= 0 ? lines.slice(at, at + 4) : []
    const found: string[] = []
    for (const l of near) {
      const words = l.replace(/\([^)]*\)?/g, ' ').split(/[^\p{L}'.-]+/u).filter(Boolean)
      for (let i = 0; i < words.length; i++) {
        for (const n of [3, 2, 1]) {
          const w = words.slice(i, i + n)
          if (w.length < n || !/^\p{Lu}/u.test(w[0]) || NOT_CITY.has(w.join(' ').toLowerCase())) continue
          const c = airportByCity(w.join(' '))
          if (c) { if (!found.includes(c)) found.push(c); i += n - 1; break }
        }
      }
    }
    if (found.length >= 2) [from, to] = found
  }
  if (!from && allCodes.length >= 2) [from, to] = allCodes
  if (!from || !to) return null

  // 출발일: 출발일 항목이 있으면 그 줄, 없으면 화면의 첫 날짜
  const depLine = lines.find((l) => /출발\s*일|departure\s*date|출국|가는\s*날|出発日/i.test(l)) ?? ''
  // 편명 줄과 그 근처의 날짜를 먼저 본다 (발권일 'Issued 29 Oct 26' 같은 다른 날짜를 피한다)
  const fi = lines.findIndex((l) => l.replace(/\s/g, '').toUpperCase().includes(flightNo))
  const nearDates = fi >= 0 ? findDates(lines.slice(Math.max(0, fi - 1), fi + 4).join('\n'), year) : []
  const depDate = findDates(depLine, year)[0] ?? nearDates[0] ?? findDates(text, year)[0] ?? pickTripDate(text, days)

  // 시각: "12:15~21:15", "1:05pm → 2:30pm", 출발/도착 시간 항목, 또는 공항 코드와 같은 줄의 시각.
  // 체크인·탑승 마감 시각은 항공편 시각이 아니므로 뺀다
  const T = '(?<![\\d:])([01]?\\d|2[0-3])\\s*:\\s*([0-5]\\d)(?![\\d:])\\s*([AaPp]\\.?\\s?[Mm]\\.?)?'
  const to24 = (h: string, mm: string, ap?: string) => {
    let n = Number(h); const p = ap?.[0]?.toLowerCase()
    if (p === 'p' && n < 12) n += 12
    if (p === 'a' && n === 12) n = 0
    return `${String(n).padStart(2, '0')}:${mm}`
  }
  const hhmm = (l: string) => { const m = l.match(new RegExp(T)); return m ? to24(m[1], m[2], m[3]) : undefined }
  const NOT_FLIGHT_TIME = /close|마감|check[\s-]*in|boarding|탑승|gate|게이트|체크인|journey|duration|flight\s*time|소요|비행\s*시간/i
  const timeLines = lines.filter((l) => !NOT_FLIGHT_TIME.test(l))
  const range = timeLines.map((l) => l.match(new RegExp(`${T}\\s*(?:[~\\-–—>→]|to)\\s*${T}(\\s*\\(?\\+1\\)?)?`))).find(Boolean)
  const labeledTime = (re: RegExp) => { const l = lines.find((x) => re.test(x)); return l ? hhmm(l.replace(re, ' ')) : undefined }
  const besideCode = (code: string) => { const l = timeLines.find((x) => new RegExp(`\\b${code}\\b`).test(x) && hhmm(x)); return l ? hhmm(l) : undefined }
  const times = timeLines.map(hhmm).filter((t): t is string => Boolean(t))
  const depTime = range ? to24(range[1], range[2], range[3]) : labeledTime(/출발\s*시간|departure\s*time|出発時刻/i) ?? besideCode(from) ?? times[0]
  const arrTime = range ? to24(range[4], range[5], range[6]) : labeledTime(/도착\s*시간|arrival\s*time|到着時刻/i) ?? besideCode(to) ?? times.find((t) => t !== depTime)
  if (!depDate || !depTime || !arrTime) return null

  // 도착일: +1일 표시가 있거나, 도착 시각이 출발보다 이르면 다음 날
  const plus = text.match(/\+\s*([12])\s*(일|day|日)|\(\+([12])\)|翌日|next\s*day/i)
  const add = plus ? Number(plus[1] ?? plus[3] ?? 1) : arrTime < depTime ? 1 : 0
  const flight: Flight = { id: '', flightNo, from, to, depDate, depTime, arrDate: add ? addDays(depDate, add) : depDate, arrTime }
  const pnr = findCode(text)
  if (pnr && /^[A-Z0-9]{5,8}$/.test(pnr)) flight.pnr = pnr
  // 좌석: "좌석 45B" 또는 좌석 안내가 있는 화면의 "45B"
  const seat = text.match(/(?:좌석|seat)\s*[:：]?\s*(\d{1,2}[A-K])\b/i)?.[1] ?? (/좌석|seat/i.test(text) ? text.match(/(?<![\w-])(\d{1,2}[A-K])(?![\w-])/)?.[1] : undefined)
  if (seat) flight.seat = seat
  return flight
}

const CHROME = /^\W*(?:safari|chrome|instagram|kakaotalk|카카오톡)\b|^\s*\d{1,2}:\d{2}\d?\s*(?:[\\«»/|]|\S{0,2}\s+(?:all|ail|al|ul)\b)|\b[\w-]+\.(com|net|org|co|kr|jp|io|travel|app)(\.[a-z]{2})?\b|ask\s*gemini|new\s*tab|all\s*tabs|^\s*[<←]\s|결제하기|다음\s*단계|^[\s+©@]*$/i

/** 흔한 체인점 이름은 OCR이 조금 틀려도 바로잡는다 (T-ELEVEN → 7-Eleven) */
const BRANDS = ['7-Eleven', 'FamilyMart', 'Lawson', 'Starbucks', 'Starbucks Reserve', 'McDonald\'s', 'Burger King', 'KFC', 'Subway', 'Don Quijote', 'Uniqlo', 'Muji', 'Tops', 'Big C', 'Lotus\'s', 'Boots', 'Watsons', 'MaxValu', 'Daiso', 'Olive Young', 'GS25', 'CU', 'emart24', 'Grab', 'Bolt', 'Uber']
const flat = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
function close(a: string, b: string) {
  if (Math.abs(a.length - b.length) > 1) return false
  let diff = 0
  for (let i = 0, j = 0; i < a.length || j < b.length; i++, j++) {
    if (a[i] === b[j]) continue
    if (++diff > 1) return false
    if (a.length > b.length) j--; else if (a.length < b.length) i--
  }
  return true
}
export function fixBrand(name: string): string {
  const f = flat(name)
  if (f.length < 4) return name
  return BRANDS.find((b) => flat(b) === f || close(flat(b), f)) ?? name
}

/** 숙소 화면에서 읽은 날짜·시각·주소를 한데 모은다 */
/**
 * 경유 항공권: 한 화면에 편명이 둘 이상이면 편명마다 구간을 나눠 읽는다.
 *   China Eastern / MU5084 / 11:30AM Cheongju / 12:30PM Shanghai Pudong / 1h 25m connection /
 *   China Eastern / MU8611 · Operated by Shanghai Airlines / 1:55PM Shanghai Pudong / 5:50PM Bangkok Suvarnabhumi
 * 날짜가 첫 구간 위에만 있으면 모든 구간에 쓰고, 다음 구간이 앞 구간 도착보다 이르면 다음 날로 본다.
 */
const DIGIT_LIKE: Record<string, string> = { B: '8', O: '0', o: '0', S: '5', I: '1', l: '1', Z: '2' }
/** OCR이 편명에 끼워 읽은 글자 고치기: MUB8611 → MU8611, MUB611 → MU8611 */
export function fixFlightNos(line: string): string {
  return line.replace(/(?<![A-Za-z0-9])([A-Z]{2}|[A-Z]\d|\d[A-Z])([BOoSIlZ])(\d{2,4})(?![\d:])/g, (all, code: string, x: string, digits: string) => {
    if (!AIRLINES[code]) return all
    return digits.length === 4 ? `${code}${digits}` : `${code}${DIGIT_LIKE[x]}${digits}`
  })
}
const FLIGHT_NO = /(?<![A-Za-z0-9-])([A-Z]{2}|[A-Z]\d|\d[A-Z])\s?(\d{2,4})(?![\d:-])/g
export function connectingFlights(text: string, days: string[]): Flight[] {
  setDateRef(days)
  const year = Number((days[0] ?? '').slice(0, 4)) || new Date().getFullYear()
  // '운항: 상하이항공'은 도시 이름이 아니다
  const lines = text.split('\n').map((l) => fixFlightNos(l).replace(/\b(operated\s+by|운항\s*[:：]?|공동\s*운항)\b.*$/i, '$1'))
  const starts: number[] = [], seen: string[] = []
  lines.forEach((l, i) => {
    for (const m of l.matchAll(FLIGHT_NO)) {
      const no = `${m[1]}${m[2]}`
      if (AIRLINES[m[1]] && !/^[AB]\d{3}/.test(m[0]) && !seen.includes(no)) { seen.push(no); starts.push(i); break }
    }
  })
  if (starts.length < 2) return []
  const dateText = lines.slice(0, starts[0] + 1).filter((l) => findDates(l, year).length).join('\n')
  const legs: Flight[] = []
  starts.forEach((at, k) => {
    const block = lines.slice(at, starts[k + 1] ?? lines.length).join('\n')
    const f = flightFromTable(findDates(block, year).length ? block : `${dateText}\n${block}`, days)
    if (f) legs.push(f)
  })
  if (legs.length < 2) return []
  // 구간을 이어 붙인다: 다음 구간 출발이 앞 구간 도착보다 이르면 하루 뒤
  for (let i = 1; i < legs.length; i++) {
    const prev = legs[i - 1], cur = legs[i]
    if (cur.depDate === prev.depDate && prev.arrDate > prev.depDate) { cur.depDate = prev.arrDate; cur.arrDate = addDays(cur.arrDate, 1) }
    if (cur.depDate === prev.arrDate && cur.depTime < prev.arrTime) { cur.depDate = addDays(cur.depDate, 1); cur.arrDate = addDays(cur.arrDate, 1) }
  }
  return legs
}

export function stayOf(lines: string[], days: string[]): Reading['stay'] {
  setDateRef(days)
  const d = findStayDates(lines.join('\n'), days)
  const info = findStayInfo(lines)
  if (!d && !info.address) return undefined
  return { ...d, address: info.address, city: info.city, host: info.host }
}

/** 투어·액티비티 바우처 */
const TOUR = /get\s*your\s*guide|getyourguide|\bGYG[A-Z0-9]{6,}|klook|kkday|viator|마이리얼트립|와그|미팅\s*포인트|meeting\s*point|집합\s*(장소|시간)|만나는\s*곳|\btour\b|투어|액티비티|activity|체험|excursion|cruise|크루즈/i
const OUTDOOR = /kayak|카약|hike|hiking|trek|하이킹|트레킹|snorkel|스노클|dive|diving|다이빙|cruise|크루즈|whale|고래|seal|물개|dolphin|돌고래|national\s*park|국립공원|glacier|빙하|rafting|래프팅|surf|서핑|horse|승마|safari|사파리|mountain|마운틴|산행|bike|자전거|별보기|stargaz|선셋|sunset|동물원|zoo|wildlife/i
const MEET = /^\s*(?:\S{0,3}\s*)?(미팅\s*포인트|meeting\s*point|집합\s*장소|만나는\s*곳|pick-?\s*up\s*(point|location)?|픽업\s*(장소|위치)?)\s*[:：]?\s*/i
/** 줄이 나뉘어 OCR된 주소의 흔한 오타 */
const fixAddress = (a: string) => a.replace(/\bZ\W?a?aland\b|Z\S{0,2}aland\b/i, 'Zealand').replace(/\s{2,}.*$/, '').replace(/^[^\p{L}\p{N}]+/u, '').trim()

/**
 * 투어·액티비티 바우처를 읽는다.
 *   GYG32LV5GNAQ / 카이코우라: 물개 관람 페달 카약 투어 / Kaikoura: Seal-Watching Pedal Kayak Tour / 옵션 (Seal Kayak tour)
 *   2026년 12월 9일 수 오후 1:30 / 미팅 포인트 18 Beach Road, Kaikōura 7300, New Zealand / 블랙 래빗 피자 건너편에서 만나요 …
 */
/* ── 버스·기차 승차권 ── */
export interface RideInfo { kind: 'bus' | 'train'; from: string; to: string; company?: string; grade?: string; seat?: string; date?: string; time?: string }
const RIDE = /승차권|고속\s*버스|시외\s*버스|버스|터미널|KTX|SRT|ITX|무궁화|새마을|열차|기차|코레일|korail|\bbus\b|\btrain\b|coach/i
const TRAIN = /KTX|SRT|ITX|무궁화|새마을|열차|기차|코레일|korail|\btrain\b|호차/i
/** '출발 청주시외', 'ㅇ 출발 인천공항71' → 정류장 이름. OCR 찌꺼기(ㅇ, o, ©)와 붙어 읽힌 T1→71을 고친다 */
const stop = (s: string) => s.replace(/^[^\p{L}\d]*(?:[ㅇoO0©@]\s+)?/u, '').replace(/(공항|터미널)\s*[7T1Il|]([12])$/u, '$1T$2').replace(/\s{2,}.*$/, '').trim()
export function readRide(lines: string[], days: string[]): RideInfo | undefined {
  const year = Number((days[0] ?? '').slice(0, 4)) || new Date().getFullYear()
  setDateRef(days)
  let from: string | undefined, to: string | undefined, seat: string | undefined
  for (const l of lines) {
    const f = l.match(/(?:^|\s)(?:출발(?!\s*(?:일|시각|시간|일시))|from)\s*[:：]?\s*(\S.{0,30})$/i)
    if (f && !from) from = stop(f[1])
    const t = l.match(/(?:^|\s)(?:도착(?!\s*(?:일|시각|시간|일시))|to)\s*[:：]?\s*(\S.{0,30})$/i)
    if (t && !to) to = stop(t[1])
    const s = l.match(/좌석\s*(?:번호)?\s*[:：]?\s*(\d{1,3}[A-Z]?(?:\s*[,번]\s*\d{1,3}[A-Z]?)*)\s*번?\s*$/) ?? l.match(/(\d{1,2})\s*호차\s*(\d{1,3}[A-Z]?)/)
    if (s && !seat) seat = s[2] ? `${s[1]}호차 ${s[2]}` : s[1]
  }
  if (!from || !to || from.length < 2 || to.length < 2) return undefined
  const text = lines.join('\n')
  // 타는 날짜·시각: 결제기한·취소 안내가 아닌 줄에서 날짜와 시각이 함께 있는 줄
  const when = lines.find((l) => findDates(l, year).length && /\d{1,2}\s*:\s*\d{2}/.test(l) && !/기한|까지|취소|환불|결제|발권|예매일|deadline|cancel/i.test(l))
  const company = text.match(/([가-힣]{2,6}고속|[가-힣]{2,6}여객|[가-힣]{2,6}교통|[가-힣]{2,6}운수|코레일|KTX(?:-산천|-이음)?|SRT|ITX-?[가-힣A-Za-z]*|무궁화호?|새마을호?)/)?.[1]
  const grade = text.match(/(심야\s*우등|프리미엄|우등|일반실|특실|일반)(?=\s|$)/)?.[1]?.replace(/\s/g, '')
  return {
    kind: TRAIN.test(text) ? 'train' : 'bus', from, to, company, grade, seat,
    date: when ? findDates(when, year)[0] : undefined,
    time: when?.match(/(\d{1,2})\s*:\s*(\d{2})(?!.*\d{1,2}\s*:\s*\d{2})/)?.slice(1).map((x, i) => (i ? x : x.padStart(2, '0'))).join(':'),
  }
}

export function readTour(lines: string[]): { name?: string; code?: string; info: TourInfo } {
  // 오른쪽 칸(지도 글씨, QR 옆 글씨)은 두 칸 넘게 띄어져 읽히므로 왼쪽 칸만 쓴다
  // (맨 앞이 '-' 같은 기호만인 칸이면 글자가 있는 첫 칸)
  const clean = lines.map((l) => { const cols = l.replace(/[|_=*#<>]+/g, ' ').trim().split(/\s{3,}/); return (cols.find((c) => /\p{L}{2,}/u.test(c)) ?? cols[0]).replace(/\s+/g, ' ').trim() })
  // 예약번호: 항목이 없어도 맨 위의 영문·숫자가 섞인 긴 낱말 (GetYourGuide의 GYG…)
  const gyg = lines.join(' ').match(/\bGYG[A-Z0-9]{6,14}\b/)?.[0]
  const loose = lines.slice(0, 6).flatMap((l) => l.split(/\s+/)).find((w) => /^(?=[A-Z0-9]*\d)(?=[A-Z0-9]*[A-Z])[A-Z0-9]{8,16}$/.test(w))
  const code = gyg ?? loose
  // 투어 이름: '투어·tour·체험…'이 든 앞쪽 줄. 한국어 화면이면 한글 줄, 아니면 영어 줄을 이름으로
  const titles = clean.slice(0, 14).map((l) => l.replace(/\b[A-Z0-9]{8,16}\b/g, '').replace(/\d+\s*\/\s*\d+\s*(페이지|page)/i, '').trim())
    .filter((l) => l.length >= 6 && l.length <= 70 && /tour|투어|체험|activity|액티비티|cruise|크루즈|ticket|입장권|pass|class|클래스|kayak|카약|excursion/i.test(l) && !/^\(|옵션|option/i.test(l) && !/^\S{0,4}\s*\([^)]*\)\s*$/.test(l) && !MEET.test(l))
    // 한글 이름 앞에 붙어 읽힌 로고 글씨(GET YOUR GUIDE → 'sSUIDE')는 뗀다
    .map((l) => l
      // 판매 문구 머리표 ([11월 한정], [특가], [ME 한정]처럼 깨져 읽힌 것)와 이모지·화살표를 뗀다
      .replace(/^[^\p{L}\p{N}[]+/u, '').replace(/^\[[^\]]{1,12}\]\s*/, '').replace(/^[^\p{L}\p{N}]+/u, '').replace(/[\s>›»]+$/, ''))
    .map((l) => (/[가-힣]/.test(l) && !/^[가-힣\d]/.test(l) && /^[A-Za-z]{2,8}\s/.test(l) ? l.slice(l.search(/[가-힣]/)) : l).replace(/\s*:\s*/, ': ').trim())
    // '호주무한투어'처럼 여행사 이름만 있는 짧은 줄은 투어 이름이 아니다
    .filter((l) => !/^\S{0,3}:\s*\S+(투어|tour|travel|여행사)$/i.test(l))
  const ko = titles.find((l) => /[가-힣]/.test(l))
  const en = titles.find((l) => !/[가-힣]/.test(l))
  const name = lang === 'ko' ? ko ?? en : en ?? ko
  const alt = name === ko ? en : ko
  // 예약 옵션: 마이리얼트립·클룩 예약 내역의 '성인(만14세~), [뉴페별]페더데일+블루마운틴 / 1개' 또는 '옵션 (Seal Kayak tour)'
  const option = clean.find((l) => /(성인|아동|유아|adult|child|person|인원)/i.test(l) && /\/\s*\d+\s*(개|명|매|인)|[x×]\s*\d+|\d+\s*(명|매)/i.test(l) && l.length <= 80)
    ?? clean.filter((l) => !titles.some((t) => l.includes(t.slice(0, 12)))).map((l) => l.match(/(?:옵션|option)?\s*\(([^()]{3,40})\)\s*$/i)).find((m) => m && /tour|투어|option|옵션|kayak|카약|class|코스|course|ticket|권/i.test(m[1]))?.[1]
  // 미팅 포인트: 항목 다음 줄(또는 같은 줄)부터 한글 안내 문장이 나오기 전까지가 주소, 그 뒤 몇 줄이 안내
  let address: string | undefined, meeting: string | undefined
  const mi = clean.findIndex((l) => MEET.test(l))
  if (mi >= 0) {
    const rest = [clean[mi].replace(MEET, ''), ...clean.slice(mi + 1, mi + 9)].filter(Boolean)
    let k = rest.findIndex((l) => /[가-힣]{2,}/.test(l))
    if (k < 0) k = Math.min(rest.length, 3)
    const addrLines = rest.slice(0, Math.min(k, 3))
    if (addrLines.length) {
      const joined = addrLines.join(' ')
      // 우편번호까지가 주소 (그 뒤에 섞여 읽힌 지도 글씨는 버린다). 나라 이름은 따로 찾아 붙인다
      const upto = joined.match(/^.*?,[^,]*?\b\d{4,6}\b/)?.[0] ?? addrLines[0]
      const country = /zealand/i.test(fixAddress(joined)) ? 'New Zealand' : fixAddress(joined).match(/australia|japan|south\s*korea|korea|thailand|vietnam|united\s*states|usa|united\s*kingdom|france|italy|spain|germany|switzerland|singapore|taiwan|indonesia|philippines|malaysia/i)?.[0]
      address = fixAddress(upto.replace(/,\s*$/, '')) + (country && !upto.toLowerCase().includes(country.toLowerCase().split(/\s+/)[0]) ? `, ${country.replace(/\s+/, ' ')}` : '')
    }
    let guide = rest.slice(k, k + 5).filter((l) => /[가-힣a-z]{2,}/i.test(l) && !/^(google|map data)/i.test(l))
    // 문장이 끝나는 마지막 줄까지만 (그 아래는 지도 글씨)
    const last = guide.map((l) => /[.!요다]\s*$/.test(l)).lastIndexOf(true)
    if (last >= 0) guide = guide.slice(0, last + 1)
    // OCR이 깨뜨린 낱말('{Ct2t', '2fap')은 뺀다
    meeting = guide.join(' ').split(' ').filter((w) => !/[{}]|^(?=\S*\d)(?=\S*[a-z])\S{2,6}$/i.test(w) || /^\d+(분|시|시간|min|am|pm)/i.test(w)).join(' ').replace(/\s+/g, ' ').trim() || undefined
  }
  // 소요 시간: "소요 시간 3시간", "Duration 2.5 hours"
  const dur = clean.join(' ').match(/(?:소요\s*시간|duration|진행\s*시간)\s*[:：]?\s*(\d+(?:\.\d+)?)\s*(시간|hours?|hrs?|분|min)/i)
  const all = clean.join(' ')
  const duration = dur ? Math.round(Number(dur[1]) * (/분|min/i.test(dur[2]) ? 1 : 60))
    : /반일|half[\s-]*day/i.test(all) ? 240 : /일일\s*투어|종일|full[\s-]*day|day\s*tour|day\s*trip/i.test(all) ? 480 : undefined
  return { name, code, info: { alt, option, address, meeting, duration } }
}

const PROMO = /book another|more hotels|flight to\s|you might also|recommended for you|similar (?:hotels|properties)|함께 (?:예약|보면)|다른 숙소|추천 (?:숙소|항공)|항공권 할인|최대\s*\d+%\s*할인|up to \d+% off/i

export function readText(all: OcrLine[], days: string[], tripCurrency: string): Reading {
  setDateRef(days)
  // 예약 확인 화면 아래의 광고·추천(다른 객실·숙소 예약, 항공권 할인)은 내 예약이 아니다: 거기부터 잘라 낸다.
  // 다만 'More Hotels in Sydney'처럼 도시 이름은 거기서도 얻는다
  const promoAt = all.findIndex((l) => PROMO.test(l.text))
  const lines = promoAt > 2 ? all.slice(0, promoAt) : all
  const promo = promoAt > 2 ? all.slice(promoAt).map((l) => l.text) : []
  const text = lines.map((l) => l.text).join('\n')
  const year = Number((days[0] ?? '').slice(0, 4)) || new Date().getFullYear()
  // 숙소 확인 화면(체크아웃이 있는)에서는 항공편을 만들지 않는다
  const hotelPage = /check[\s-]*out|체크\s*아웃|チェックアウト/i.test(text) && !/편명|flight\s*no|boarding|탑승/i.test(text)
  // 메모에 적어 둔 항공편 목록 (편명이 없어도, 여러 편을 한 번에)
  const listed = hotelPage ? [] : flightList(lines.map((l) => l.text), days)
  const flightChoices = listed.map((f) => f.choices)
  let flights: Flight[] = hotelPage ? [] : listed.length ? listed.map(({ choices: _c, ...f }) => f) : parseFlightText(text, year).filter(isComplete)
  // 경유 항공권: 편명이 둘 이상이면 구간마다
  if (flights.length < 2 && !hotelPage && !listed.length) { const legs = connectingFlights(lines.filter((l) => !CHROME.test(l.text)).map((l) => l.text).join('\n'), days); if (legs.length >= 2) flights = legs }
  if (!flights.length && !hotelPage) { const t = flightFromTable(lines.filter((l) => !CHROME.test(l.text)).map((l) => l.text).join('\n'), days); if (t) flights = [t] }
  flights = flights.map((f, i) => ({ ...f, id: `ocr${Date.now()}${i}` }))
  // 투어·액티비티 바우처: 숙소(체크아웃 있는) 화면이 아니면, 피자집 안내 같은 낱말보다 먼저 본다
  // 버스·기차 승차권: 출발·도착 정류장이 있는 화면
  const ride = !flights.length && !hotelPage && RIDE.test(text) ? readRide(lines.filter((l) => !CHROME.test(l.text)).map((l) => l.text), days) : undefined
  const tourPage = !flights.length && !hotelPage && !ride && TOUR.test(text)
  const kind = flights.length ? { cat: 'sight' as Category, exp: 'move' as ExpenseCategory, costOnly: true }
    : ride ? { cat: 'move' as Category, exp: 'move' as ExpenseCategory, costOnly: false }
    : tourPage ? { cat: (OUTDOOR.test(text) ? 'nature' : 'sight') as Category, exp: 'play' as ExpenseCategory, costOnly: false }
    : KINDS.find((k) => k.re.test(text))
  // 휴대폰 상태 표시줄(시계·배터리)과 브라우저 주소창·메뉴 줄은 내용이 아니다.
  // 맨 위 줄이 시각으로 시작하면 상태 표시줄로 본다 ("3:309 all T EX"처럼 깨져 읽혀도)
  const maxTop = Math.max(1, ...lines.map((l) => l.top))
  const statusBar = (l: OcrLine) => l.top <= maxTop * 0.04 && /^\s*\d{1,2}\s*[:.]?\s*\d{2}/.test(l.text) && !/[~\-–—]\s*\d{1,2}:\d{2}/.test(l.text)
  const body = lines.filter((l) => !CHROME.test(l.text) && !statusBar(l))
  // 숙소·항공권 화면에는 이름·예약번호·비행시간 같은 숫자가 많아, 합계·결제·운임 항목이 붙은 금액만 믿는다
  const labelledOnly = kind?.cat === 'stay' || flights.length > 0
  const amount = findTotal(body.map((l) => l.text).filter((t) => !labelledOnly || ((TOTAL.test(t) || (flights.length > 0 && /운임|요금|항공료|fare|price/i.test(t))) && !NOT_TOTAL.test(t))))
  const name = findName(body)
  // 통화 기호를 못 읽었을 때: 한글 위주면 원화, 가나가 있으면 엔화로 본다
  const hangul = (text.match(/\p{Script=Hangul}/gu) ?? []).length
  const kana = /[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text)
  const guessCur = hangul > 15 && !/[฿$€¥]|THB|USD|JPY|EUR|บาท/.test(text) ? 'KRW' : kana && !/[฿$€₩]|THB|USD|KRW|EUR/.test(text) ? 'JPY' : tripCurrency
  const info = kind?.cat === 'stay' ? findStayInfo(body.map((l) => l.text)) : {}
  if (kind?.cat === 'stay') { const p = findStayInfo(promo); info.city ??= p.city; info.room ??= p.room }
  // 숙소 이름: 화면에 숙소 이름이 없는 예약 확인 화면(아고다 등)이면 머리말 대신 'Sydney 숙소'처럼 도시로
  const hotelLine = body.map((l) => l.text).find((t) => /hotel|resort|\binn\b|suites?\b|hostel|apartments?\b|호텔|리조트|ホテル/i.test(t) && !/hotels?\s+in\b|book another|호텔\s*더/i.test(t) && t.length <= 48)
  // 숙소 앱 상세 화면의 맨 위 제목 줄 ('< ⌂ 아사이 방콕 차이나타운 ⇪ 🔖'): 아이콘 찌꺼기 사이의 가장 긴 글자 덩어리
  const titleName = (() => {
    if (kind?.cat !== 'stay') return undefined
    // '<' 뒤로 가기가 있는 제목 줄은 브라우저 줄로 빠지므로 body가 아닌 전체 줄에서 찾는다
    const top = lines.filter((l) => l.top <= maxTop * 0.14 && !statusBar(l)).map((l) => l.text)
    for (const t of top) {
      const runs = (t.match(/[\p{L}][\p{L}\d .'&-]*[\p{L}\d]/gu) ?? []).map((x) => x.trim()).filter((x) => (x.match(/\p{L}/gu) ?? []).length >= 4)
      const best = runs.sort((x, y) => y.length - x.length)[0]
      if (best && !/^(객실|스테이|리뷰|예약|결제|숙소)(\s*(정보|선택|소개))?$|^(select\s*)?rooms?$|^reviews?$|^overview$|^details?$/i.test(best) && !/\b(am|pm)\b|all\b/i.test(best)) return best
    }
    return undefined
  })()
  const stayName = kind?.cat === 'stay' ? info.name ?? (hotelLine ? stripLeadJunk(hotelLine.replace(/^[^\p{L}\p{N}]+/u, '').trim()) : undefined) ?? titleName ?? (info.city ? tr('{0} 숙소', info.city) : undefined) : undefined
  const stay = kind?.cat === 'stay' ? stayOf(body.map((l) => l.text), days) : undefined
  const tour = tourPage ? readTour(body.map((l) => l.text)) : undefined
  return {
    name: ride ? `${ride.from} → ${ride.to}` : stayName ?? tour?.name ?? (name && fixBrand(name)),
    code: findCode(text) ?? tour?.code,
    date: ride?.date ?? pickTripDate(text, days),
    time: ride?.time ?? findTime(lines.filter((l) => /시간|시각|time|체크\s*인|check[\s-]*in|입장|時/i.test(l.text)).map((l) => l.text).join('\n')) ?? findTime(body.map((l) => l.text).join('\n')),
    amount,
    currency: amount ? findCurrency(text, guessCur) : undefined,
    category: (tour?.name && categoryByName(tour.name)) || (kind?.cat ?? 'sight'),
    expenseCategory: kind?.exp ?? (amount ? 'etc' : 'play'),
    costOnly: Boolean(kind?.costOnly),
    flights,
    flightChoices: listed.length && flightChoices.some(Boolean) ? flightChoices : undefined,
    stay: stay || info.city ? { ...stay, city: stay?.city ?? info.city, room: info.room } : undefined,
    tour: tour?.info,
    ride,
  }
}
