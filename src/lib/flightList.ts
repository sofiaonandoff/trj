import { AIRLINES_KO, AIRPORTS, airport, airportByCity, type Airport } from '../data/airports'
import type { Flight } from '../types'
import { addDays, km } from './util'

/**
 * 메모장·메시지에 적어 둔 항공편 목록을 읽는다 (편명이 없어도).
 *   1. 8 Feb 0640 - 0815 scoot SG - BKK
 *   2. 9 Feb 1745 - 1850 Thai Airasia BKK - KK
 *   12/3 09:10~13:40 대한항공 KE651 인천 - 방콕
 * 줄마다 날짜·출발/도착 시각·항공사(또는 편명)·출발지-도착지를 찾는다.
 * 출발지·도착지는 공항 코드, 도시 이름, 흔한 줄임말(SG, KL, HK, KK…)을 받고,
 * 줄임말이 여러 곳일 수 있으면(KK: 코타키나발루·콘깬·끄라비) 비행시간이 가장 그럴듯한 곳을 고른다.
 */

/** 흔한 도시 줄임말 → 후보 공항 */
const SHORT: Record<string, string[]> = {
  SG: ['SIN'], SGP: ['SIN'], KL: ['KUL'], HK: ['HKG'], KK: ['BKI', 'KKC', 'KBV'], BKI: ['BKI'],
  HCM: ['SGN'], HCMC: ['SGN'], SAIGON: ['SGN'], HN: ['HAN'], DN: ['DAD'], NT: ['CXR'], PQ: ['PQC'],
  CM: ['CNX'], CNX: ['CNX'], PK: ['HKT'], BALI: ['DPS'], LA: ['LAX'], NY: ['JFK'], NYC: ['JFK'], SF: ['SFO'],
  TYO: ['NRT', 'HND'], OSA: ['KIX'], SEL: ['ICN'], SEOUL: ['ICN'], TPE: ['TPE'], MNL: ['MNL'], CEB: ['CEB'],
  '인천': ['ICN'], '김포': ['GMP'], '김해': ['PUS'], '부산': ['PUS'], '제주': ['CJU'], '청주': ['CJJ'], '대구': ['TAE'], '서울': ['ICN'],
  JB: ['JHB'], PG: ['PEN'], LGK: ['LGK'], BJ: ['PEK'], SH: ['PVG'], MC: ['MFM'], DPS: ['DPS'], LDN: ['LHR'],
}

/** 항공사 이름(영어·한국어, 소문자) → 코드 */
const NAMES: Record<string, string> = {
  scoot: 'TR', 'thai airasia': 'FD', 'thai air asia': 'FD', 'airasia x': 'D7', 'air asia x': 'D7', airasia: 'AK', 'air asia': 'AK',
  'thai airways': 'TG', 'thai lion': 'SL', 'bangkok airways': 'PG', 'nok air': 'DD', 'singapore airlines': 'SQ', jetstar: 'JQ', 'jetstar asia': '3K',
  'korean air': 'KE', asiana: 'OZ', 'jeju air': '7C', 'jin air': 'LJ', "t'way": 'TW', tway: 'TW', 'air busan': 'BX', 'air seoul': 'RS',
  vietjet: 'VJ', 'vietnam airlines': 'VN', 'bamboo airways': 'QH', 'cathay pacific': 'CX', cathay: 'CX', 'hk express': 'UO',
  'cebu pacific': '5J', 'philippine airlines': 'PR', 'japan airlines': 'JL', jal: 'JL', ana: 'NH', 'all nippon': 'NH', peach: 'MM',
  'malaysia airlines': 'MH', batik: 'OD', 'batik air': 'OD', 'garuda': 'GA', 'eva air': 'BR', 'china airlines': 'CI', starlux: 'JX',
  emirates: 'EK', qatar: 'QR', 'qatar airways': 'QR', etihad: 'EY', 'turkish airlines': 'TK', qantas: 'QF', 'air new zealand': 'NZ',
  'virgin australia': 'VA', lufthansa: 'LH', 'air france': 'AF', klm: 'KL', 'british airways': 'BA', finnair: 'AY', united: 'UA', delta: 'DL',
  'american airlines': 'AA',
}
for (const [code, name] of Object.entries(AIRLINES_KO)) NAMES[name.toLowerCase()] ??= code

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 }
const pad = (n: number) => String(n).padStart(2, '0')
const hhmm = (t: string) => { const d = t.replace(/\D/g, '').padStart(4, '0'); const h = +d.slice(0, -2), m = +d.slice(-2); return h < 24 && m < 60 ? `${pad(h)}:${d.slice(-2)}` : undefined }
const mins = (t: string) => +t.slice(0, 2) * 60 + +t.slice(3)

/** 시간대의 UTC와의 차이(분), 그 날짜 기준 */
function offset(tz: string, date: string) {
  try {
    const s = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'shortOffset' }).formatToParts(new Date(`${date}T12:00:00Z`)).find((p) => p.type === 'timeZoneName')?.value ?? ''
    const m = s.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/)
    return m ? (m[1] === '-' ? -1 : 1) * (+m[2] * 60 + +(m[3] ?? 0)) : 0
  } catch { return 0 }
}

/** 출발지·도착지 낱말의 후보 공항 */
function places(word: string): Airport[] {
  const w = word.trim().replace(/[.,]$/, '')
  const found = placesOnce(w)
  if (found.length || !/^[A-Za-z0-9]{2,4}$/.test(w)) return found
  // OCR이 헷갈린 글자 (SG → Sq, BKK → 8KK, KUL → KU1)
  const fixed = w.toUpperCase().replace(/Q/g, 'G').replace(/0/g, 'O').replace(/8/g, 'B').replace(/1/g, 'I').replace(/5/g, 'S')
  return fixed !== w.toUpperCase() ? placesOnce(fixed) : found
}
function placesOnce(w: string): Airport[] {
  const up = w.toUpperCase()
  const codes = SHORT[up] ?? (/^[A-Z]{3}$/.test(up) && airport(up) ? [up] : [])
  const out = codes.map((c) => airport(c)).filter((a): a is Airport => Boolean(a))
  if (!out.length) { const c = airportByCity(w); const a = c ? airport(c) : undefined; if (a) out.push(a) }
  // 공항 이름으로 (인천 → 인천국제공항, Changi → Singapore Changi Airport)
  if (!out.length && w.length >= 2) { const a = AIRPORTS.find((x) => x.name.toLowerCase().startsWith(w.toLowerCase())); if (a) out.push(a) }
  return out
}

/** 날짜 낱말 → 'MM-DD' */
function monthDay(s: string): [number, number] | undefined {
  let m = s.match(/^(\d{1,2})\s*([A-Za-z]{3,9})\.?$/)
  if (m && MONTHS[m[2].toLowerCase().slice(0, 3)]) return [MONTHS[m[2].toLowerCase().slice(0, 3)], +m[1]]
  m = s.match(/^([A-Za-z]{3,9})\.?\s*(\d{1,2})$/)
  if (m && MONTHS[m[1].toLowerCase().slice(0, 3)]) return [MONTHS[m[1].toLowerCase().slice(0, 3)], +m[2]]
  m = s.match(/^(\d{1,2})\s*월\s*(\d{1,2})\s*일?$/)
  if (m) return [+m[1], +m[2]]
  m = s.match(/^(\d{1,2})[./](\d{1,2})$/)
  if (m) return [+m[1], +m[2]]
  return undefined
}

/** 연도: 여행 기간에 들어가는 해, 없으면 여행 시작(또는 오늘) 이후 처음 오는 그 날 */
function withYear(md: [number, number], days: string[]) {
  const ref = days[0] ?? new Date().toISOString().slice(0, 10)
  const y0 = +ref.slice(0, 4)
  for (const y of [y0, y0 + 1, y0 - 1]) { const d = `${y}-${pad(md[0])}-${pad(md[1])}`; if (days.includes(d)) return d }
  const d = `${y0}-${pad(md[0])}-${pad(md[1])}`
  return d >= addDays(ref, -60) ? d : `${y0 + 1}-${pad(md[0])}-${pad(md[1])}`
}

const DATE = String.raw`(\d{1,2}\s*[A-Za-z]{3,9}\.?|[A-Za-z]{3,9}\.?\s*\d{1,2}|\d{1,2}\s*월\s*\d{1,2}\s*일?|\d{1,2}[./]\d{1,2})`
const TIME = String.raw`(\d{1,2}:?\d{2})`
const LINE = new RegExp(String.raw`^\s*(?:\d{1,2}\s*[.)]\s*)?${DATE}\s+${TIME}\s*(?:-|–|—|~|to|→)\s*${TIME}\s*(\(?\+1\)?)?\s+(.+?)\s+([A-Za-z가-힣][A-Za-z가-힣.]{1,15})\s*(?:-|–|—|→|>|to)\s*([A-Za-z가-힣][A-Za-z가-힣.]{1,15})\s*[|l]?\s*$`, 'i')

/** 줄임말이 여러 공항일 수 있을 때 고를 수 있는 다른 후보 */
export interface AirportChoice { side: 'from' | 'to'; word: string; options: string[] }

export function flightList(lines: string[], days: string[]): (Flight & { choices?: AirportChoice[] })[] {
  const out: (Flight & { choices?: AirportChoice[] })[] = []
  for (const raw of lines) {
    const m = raw.replace(/[‐‑]/g, '-').match(LINE)
    if (!m) continue
    const md = monthDay(m[1].trim())
    const dep = hhmm(m[2]), arr = hhmm(m[3])
    if (!md || !dep || !arr) continue
    const date = withYear(md, days)
    // 항공사: 편명(TR 868)이 있으면 그것, 없으면 이름으로 코드만
    const mid = m[5].trim()
    const no = mid.match(/\b([A-Z0-9]{2})\s?(\d{2,4})\b/)
    const name = mid.toLowerCase().replace(/\s+/g, ' ')
    const code = no?.[1] ?? Object.keys(NAMES).sort((a, b) => b.length - a.length).map((k) => (name.includes(k) ? NAMES[k] : undefined)).find(Boolean)
    const fromC = places(m[6]), toC = places(m[7])
    if (!fromC.length || !toC.length) continue
    const plus = m[4] ? 1 : mins(arr) < mins(dep) ? 1 : 0
    const arrDate = plus ? addDays(date, 1) : date
    // 후보가 여럿이면 실제 비행시간(시간대 차이를 뺀)과 거리로 어림한 비행시간이 가장 가까운 짝
    let best: [Airport, Airport] | undefined, gap = Infinity
    for (const a of fromC) for (const b of toC) {
      if (a.code === b.code) continue
      const actual = mins(arr) + plus * 1440 - mins(dep) - (offset(b.tz, arrDate) - offset(a.tz, date))
      const expected = (km(a, b) / 780) * 60 + 30
      const g = Math.abs(actual - expected)
      if (g < gap) { gap = g; best = [a, b] }
    }
    if (!best) continue
    if (out.some((f) => f.depDate === date && f.depTime === dep && f.from === best![0].code)) continue
    const choices: AirportChoice[] = []
    if (fromC.length > 1) choices.push({ side: 'from', word: m[6].trim(), options: [best[0].code, ...fromC.map((a) => a.code).filter((c) => c !== best![0].code)] })
    if (toC.length > 1) choices.push({ side: 'to', word: m[7].trim(), options: [best[1].code, ...toC.map((a) => a.code).filter((c) => c !== best![1].code)] })
    out.push({ id: '', flightNo: no ? `${no[1]}${no[2]}` : code ?? '', from: best[0].code, to: best[1].code, depDate: date, depTime: dep, arrDate, arrTime: arr, ...(choices.length ? { choices } : {}) })
  }
  return out
}
