import type { Category, ExpenseCategory, Flight } from '../types'
import { isComplete, parseFlightText } from './flight'

/**
 * 사진에서 읽은 글자(OCR)로 영수증·예약 화면·탑승권을 해석한다. AI 없이 기기 안에서만 동작한다.
 * 여기 함수들은 화면과 상관없는 순수 함수라 테스트로 확인한다.
 */

export interface OcrLine { text: string; height: number; top: number }

export interface Reading {
  name?: string
  date?: string
  time?: string
  amount?: number
  currency?: string
  category: Category
  expenseCategory: ExpenseCategory
  /** 들를 곳 없이 비용만 있는 것 (택시, 교통카드 등) */
  costOnly: boolean
  flights: Flight[]
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 }
const pad = (n: number) => String(n).padStart(2, '0')
const valid = (y: number, m: number, d: number) => m >= 1 && m <= 12 && d >= 1 && d <= 31 && y > 2000 && y < 2100
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`

/** 글자 속 날짜 후보를 모두 찾는다. 태국 불기(2569 → 2026)와 연도 없는 날짜도 받는다 */
export function findDates(text: string, year: number): string[] {
  const out: string[] = []
  const push = (y: number, m: number, d: number) => { if (y > 2400) y -= 543; if (y < 100) y += 2000; if (valid(y, m, d)) out.push(iso(y, m, d)) }
  const t = text.replace(/\s+/g, ' ')
  for (const m of t.matchAll(/(\d{4})\s*[-./년]\s*(\d{1,2})\s*[-./월]\s*(\d{1,2})/g)) push(+m[1], +m[2], +m[3])
  for (const m of t.matchAll(/(?<![\d.])(\d{1,2})[./-](\d{1,2})[./-](\d{4}|\d{2})(?![\d])/g)) {
    // 일/월/년이 흔하지만 월/일/년일 수도 있다: 둘 다 후보로 둔다
    push(+m[3], +m[2], +m[1]); push(+m[3], +m[1], +m[2])
  }
  for (const m of t.matchAll(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/g)) push(year, +m[1], +m[2])
  for (const m of t.matchAll(/(\d{1,2})\s*([A-Za-z]{3,4})[a-z]*\.?,?\s*(\d{4})?/g)) { const mo = MONTHS[m[2].toLowerCase()]; if (mo) push(m[3] ? +m[3] : year, mo, +m[1]) }
  for (const m of t.matchAll(/([A-Za-z]{3,4})[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s*(\d{4})?/g)) { const mo = MONTHS[m[1].toLowerCase()]; if (mo) push(m[3] ? +m[3] : year, mo, +m[2]) }
  for (const m of t.matchAll(/(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日/g)) push(+m[1], +m[2], +m[3])
  return [...new Set(out)]
}

/** 여행 기간 안의 날짜가 있으면 그것을, 없으면 처음 찾은 날짜를 돌려준다 */
export function pickTripDate(text: string, days: string[]): string | undefined {
  const year = Number((days[0] ?? '').slice(0, 4)) || new Date().getFullYear()
  const all = findDates(text, year)
  return all.find((d) => days.includes(d)) ?? all[0]
}

export function findTime(text: string): string | undefined {
  const m = text.match(/(오전|오후|午前|午後)?\s*(?<!\d)([01]?\d|2[0-3])\s*:\s*([0-5]\d)(?:\s*:\s*[0-5]\d)?\s*(AM|PM|am|pm)?/)
  if (!m) return undefined
  let h = Number(m[2])
  const ap = (m[4] ?? m[1])?.toLowerCase()
  if ((ap === 'pm' || ap === '오후' || ap === '午後') && h < 12) h += 12
  if ((ap === 'am' || ap === '오전' || ap === '午前') && h === 12) h = 0
  return `${pad(h)}:${m[3]}`
}

const CURRENCY: [RegExp, string][] = [
  [/฿|THB|บาท/i, 'THB'], [/₩|KRW|원(?![가-힣])/i, 'KRW'], [/NT\$|TWD|NTD|元/i, 'TWD'], [/¥|円|JPY/i, 'JPY'], [/CNY|RMB|人民币/i, 'CNY'],
  [/₫|VND|đ(?![a-z])/i, 'VND'], [/€|EUR/i, 'EUR'], [/£|GBP/i, 'GBP'], [/HK\$|HKD/i, 'HKD'], [/S\$|SGD/i, 'SGD'], [/US\$|USD|\$/i, 'USD'],
]
export function findCurrency(text: string, fallback: string): string {
  for (const [re, code] of CURRENCY) if (re.test(text)) return code === 'USD' && /HK\$|S\$|NT\$/.test(text) ? fallback : code
  return fallback
}

/** "1,234.50", "1.234,50", "12 600" 같은 금액을 숫자로 */
export function parseAmount(s: string): number | undefined {
  const m = s.replace(/[^\d.,\s]/g, ' ').trim().match(/\d[\d.,\s]*\d|\d/g)
  if (!m) return undefined
  const raw = m[m.length - 1].replace(/\s/g, '')
  let n: number
  if (/^\d{1,3}([.,]\d{3})+$/.test(raw)) n = Number(raw.replace(/[.,]/g, '')) // 천 단위 구분만 있는 경우
  else if (/^\d{1,3}(,\d{3})*\.\d{1,2}$/.test(raw)) n = Number(raw.replace(/,/g, ''))
  else if (/^\d{1,3}(\.\d{3})*,\d{1,2}$/.test(raw)) n = Number(raw.replace(/\./g, '').replace(',', '.'))
  else n = Number(raw.replace(/,/g, ''))
  return Number.isFinite(n) && n > 0 ? n : undefined
}

const TOTAL = /grand\s*total|total|amount\s*(due|paid)?|balance|합\s*계|총\s*(액|금액|결제)|결제\s*금액|받을\s*금액|청구\s*금액|合\s*計|お会計|ご請求|総額|รวม(ทั้งสิ้น|เงิน)?|ยอดรวม|ยอดสุทธิ|tổng|montant|summe|totale/i
const NOT_TOTAL = /sub\s*total|소계|vat|tax|세액|부가세|change|거스름|잔돈|お釣|ทอน|discount|할인|cash\s*tendered|받은\s*금액/i

/** 합계 줄의 금액을 찾는다. 없으면 통화 기호가 붙은 가장 큰 금액 */
export function findTotal(lines: string[]): number | undefined {
  const totals = lines.filter((l) => TOTAL.test(l) && !NOT_TOTAL.test(l)).map(parseAmount).filter((n): n is number => n !== undefined)
  if (totals.length) return Math.max(...totals)
  const priced = lines.filter((l) => /[฿₩¥€£₫$]|THB|KRW|JPY|USD|EUR|원|円|บาท/.test(l) && !NOT_TOTAL.test(l)).map(parseAmount).filter((n): n is number => n !== undefined)
  return priced.length ? Math.max(...priced) : undefined
}

const KINDS: { re: RegExp; cat: Category; exp: ExpenseCategory; costOnly?: boolean }[] = [
  { re: /hotel|hostel|resort|check[\s-]?in|호텔|숙박|리조트|게스트하우스|ホテル|旅館|โรงแรม|airbnb|agoda|booking\.com/i, cat: 'stay', exp: 'stay' },
  { re: /taxi|grab|bolt|uber|bts|mrt|metro|subway|railway|train|bus|ferry|택시|지하철|버스|기차|열차|교통|suica|pasmo|タクシー|電車|แท็กซี่|รถไฟ/i, cat: 'sight', exp: 'move', costOnly: true },
  { re: /cafe|café|coffee|starbucks|카페|커피|喫茶|カフェ|กาแฟ|bakery|베이커리/i, cat: 'cafe', exp: 'food' },
  { re: /restaurant|bistro|kitchen|ramen|sushi|bbq|bar\b|pub|식당|레스토랑|음식|라멘|스시|食堂|レストラン|ร้านอาหาร|food|noodle|menu|국수|교자|김밥|찌개|국밥|치킨|고기|ラーメン|うどん|そば|寿司|居酒屋|ก๋วยเตี๋ยว|phở/i, cat: 'food', exp: 'food' },
  { re: /admission|entrance|museum|ticket|tour|입장|관람|박물관|미술관|투어|入場|チケット|ค่าเข้า/i, cat: 'culture', exp: 'play' },
  { re: /mart|7-?eleven|family\s?mart|lawson|store|shop|mall|market|duty\s?free|편의점|마트|면세|쇼핑|ドン・キホーテ|コンビニ|ร้านค้า/i, cat: 'shop', exp: 'shop' },
]

const JUNK = /receipt|tax\s*invoice|invoice|영수증|매출|전표|tel|phone|전화|사업자|vat|no\.|date|time|cashier|pos|table|order|주문|領収|レシート|ใบเสร็จ|www\.|http|@/i

/** 가게·장소 이름: 위쪽에 있는 가장 큰 글자 줄 중 의미 있는 것 */
export function findName(lines: OcrLine[]): string | undefined {
  const good = lines
    .map((l) => ({ ...l, text: l.text.replace(/[|_~=*#<>]+/g, ' ').replace(/\s+/g, ' ').trim() }))
      .filter((l) => /[\p{L}\p{N}]/u.test(l.text))
    .filter((l) => l.text.length >= 2 && l.text.length <= 48 && /\p{L}{2,}/u.test(l.text) && !JUNK.test(l.text) && (l.text.match(/\d/g)?.length ?? 0) <= l.text.length / 3)
  if (!good.length) return undefined
  const maxTop = Math.max(...lines.map((l) => l.top), 1)
  // 위쪽 40% 안에서 글자가 가장 큰 줄. 크기가 비슷하면 위에 있는 줄
  const top = good.filter((l) => l.top <= maxTop * 0.4)
  const pool = top.length ? top : good
  return pool.reduce((a, b) => (b.height > a.height * 1.15 ? b : a)).text
}

export function readText(lines: OcrLine[], days: string[], tripCurrency: string): Reading {
  const text = lines.map((l) => l.text).join('\n')
  const year = Number((days[0] ?? '').slice(0, 4)) || new Date().getFullYear()
  const flights = parseFlightText(text, year).filter(isComplete).map((f, i) => ({ ...f, id: `ocr${Date.now()}${i}` }))
  const kind = KINDS.find((k) => k.re.test(text))
  const amount = findTotal(lines.map((l) => l.text))
  return {
    name: findName(lines),
    date: pickTripDate(text, days),
    time: findTime(text),
    amount,
    currency: amount ? findCurrency(text, tripCurrency) : undefined,
    category: kind?.cat ?? 'sight',
    expenseCategory: kind?.exp ?? (amount ? 'etc' : 'play'),
    costOnly: Boolean(kind?.costOnly),
    flights,
  }
}
