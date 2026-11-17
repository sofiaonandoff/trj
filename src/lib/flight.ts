import { AIRLINES, AIRPORTS, airport } from '../data/airports'
import type { Flight } from '../types'
import { addDays } from './util'

function offsetMin(tz: string, date: Date) {
  const part = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' }).formatToParts(date).find((p) => p.type === 'timeZoneName')?.value ?? 'GMT'
  const m = part.match(/GMT([+-])(\d{1,2}):?(\d{2})?/)
  return m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0)) : 0
}

/** 공항 현지 시각을 UTC ms로 */
function utc(code: string, date: string, time: string) {
  const a = airport(code)
  const naive = Date.parse(`${date}T${time}:00Z`)
  if (!a || Number.isNaN(naive)) return naive
  return naive - offsetMin(a.tz, new Date(naive)) * 60000
}

type Times = Pick<Flight, 'from' | 'to' | 'depDate' | 'depTime' | 'arrDate' | 'arrTime'>

/** 비행 시간(분). 두 공항의 시간대 차이를 반영한다. */
export function flightMinutes(f: Times) {
  const m = Math.round((utc(f.to, f.arrDate, f.arrTime) - utc(f.from, f.depDate, f.depTime)) / 60000)
  return Number.isFinite(m) && m > 0 ? m : 0
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
const FLIGHT_NO = /\b([A-Z]{2}|[A-Z]\d|\d[A-Z])\s?(\d{1,4})\b/

/** 예약 확인 메일·e티켓 문구에서 항공편 정보를 뽑아낸다. 항공편 번호마다 한 구간으로 나눈다. */
export function parseFlightText(text: string, fallbackYear = new Date().getFullYear()): Partial<Flight>[] {
  const codes = new Set(AIRPORTS.map((a) => a.code))
  const pnr = text.match(/(?:예약\s*번호|PNR|Booking\s*(?:ref(?:erence)?|code)|Confirmation)[^A-Z0-9]{0,12}([A-Z0-9]{6})\b/i)?.[1]

  // 항공편 번호가 나오는 위치에서 구간을 나눈다. 공항 코드(3글자)와 겹치는 오탐은 제외.
  const starts: number[] = []
  const re = new RegExp(FLIGHT_NO.source, 'g')
  for (let m = re.exec(text); m; m = re.exec(text)) {
    // 'AM 10', 'PM 12' 같은 오탐을 막는다: 띄어 쓴 경우엔 아는 항공사 코드만 인정
    if (AIRLINES[m[1]] || (!/\s/.test(m[0]) && /^[A-Z]{2}$/.test(m[1]) && m[2].length > 1 && !['AM', 'PM'].includes(m[1]))) starts.push(m.index)
  }
  const chunks = starts.map((s, i) => text.slice(s, starts[i + 1] ?? text.length))

  const out: Partial<Flight>[] = []
  for (const chunk of chunks) {
    const no = chunk.match(FLIGHT_NO)
    if (!no) continue
    const iata = [...chunk.matchAll(/\b([A-Z]{3})\b/g)].map((m) => m[1]).filter((c) => codes.has(c))
    const times = [...chunk.matchAll(/\b([01]?\d|2[0-3])[:시]\s?([0-5]\d)/g)].map((m) => `${m[1].padStart(2, '0')}:${m[2]}`)
    const dates: string[] = []
    for (const m of chunk.matchAll(/(20\d{2})[.\-/년]\s?(\d{1,2})[.\-/월]\s?(\d{1,2})/g)) dates.push(`${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`)
    if (!dates.length) {
      for (const m of chunk.matchAll(/\b(\d{1,2})\s?(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\.?\s?(20\d{2})?/gi)) {
        dates.push(`${m[3] ?? fallbackYear}-${String(MONTHS.indexOf(m[2].toUpperCase()) + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}`)
      }
    }
    if (!dates.length) {
      for (const m of chunk.matchAll(/(\d{1,2})월\s?(\d{1,2})일/g)) dates.push(`${fallbackYear}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`)
    }
    const f: Partial<Flight> = { flightNo: `${no[1]}${no[2]}`, from: iata[0], to: iata.find((c) => c !== iata[0]), depTime: times[0], arrTime: times[1], depDate: dates[0] }
    if (pnr) f.pnr = pnr
    if (f.depDate) {
      f.arrDate = dates[1] ?? f.depDate
      // 뒤따르는 날짜가 도착일로 보기에 너무 멀면(하루 넘게 비행) 다른 날짜로 보고 무시한다
      if (dates[1] && f.from && f.to && f.depTime && f.arrTime && flightMinutes(f as Times) > 22 * 60) { f.arrDate = f.depDate; dates.length = 1 }
      // 도착 날짜가 따로 없는데 같은 날로는 계산이 맞지 않으면 다음 날 도착으로 본다
      if (!dates[1] && f.from && f.to && f.depTime && f.arrTime && flightMinutes({ ...(f as Times), arrDate: f.depDate }) === 0) f.arrDate = addDays(f.depDate, 1)
    }
    const seat = chunk.match(/(?:좌석|Seat)\s*:?\s*(\d{1,2}[A-K])\b/i)?.[1]
    if (seat) f.seat = seat
    if (f.from || f.depTime || f.depDate) out.push(f)
  }
  return out
}

export const isComplete = (f: Partial<Flight>): f is Flight =>
  Boolean(f.flightNo && f.from && f.to && f.depDate && f.depTime && f.arrDate && f.arrTime)
