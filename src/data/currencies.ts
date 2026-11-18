import { lang, tr } from '../i18n'
import type { Trip } from '../types'

/**
 * 지출에 쓸 수 있는 통화와 어림 환율 (1단위 = 원, 2026년 11월 무렵).
 * 여행마다 예산 탭에서 실제 환율로 고쳐 쓴다 (Trip.rate는 여행지 통화, Trip.rates는 그 밖의 통화).
 */
export const CURRENCIES: { code: string; name: string; rate: number }[] = [
  { code: 'KRW', name: tr('원'), rate: 1 },
  { code: 'USD', name: tr('미국 달러'), rate: 1400 },
  { code: 'JPY', name: tr('엔'), rate: 9.4 },
  { code: 'EUR', name: tr('유로'), rate: 1520 },
  { code: 'CNY', name: tr('위안'), rate: 195 },
  { code: 'TWD', name: tr('대만 달러'), rate: 44 },
  { code: 'HKD', name: tr('홍콩 달러'), rate: 180 },
  { code: 'THB', name: tr('바트'), rate: 41 },
  { code: 'VND', name: tr('동'), rate: 0.055 },
  { code: 'PHP', name: tr('페소'), rate: 24 },
  { code: 'SGD', name: tr('싱가포르 달러'), rate: 1060 },
  { code: 'MYR', name: tr('링깃'), rate: 320 },
  { code: 'IDR', name: tr('루피아'), rate: 0.087 },
  { code: 'AUD', name: tr('호주 달러'), rate: 910 },
  { code: 'NZD', name: tr('뉴질랜드 달러'), rate: 820 },
  { code: 'GBP', name: tr('파운드'), rate: 1820 },
  { code: 'CHF', name: tr('스위스 프랑'), rate: 1700 },
  { code: 'CAD', name: tr('캐나다 달러'), rate: 1000 },
  { code: 'AED', name: tr('디르함'), rate: 380 },
  { code: 'TRY', name: tr('리라'), rate: 34 },
  { code: 'MNT', name: tr('투그릭'), rate: 0.41 },
]
const BY = new Map(CURRENCIES.map((c) => [c.code, c]))
export const knownCurrency = (code: string) => BY.has(code.toUpperCase())

type RateTrip = Pick<Trip, 'currency' | 'rate' | 'rates' | 'base' | 'ratesEdited'>

/**
 * 환율은 안에서 모두 '1단위 = 몇 원'으로 둔다 (원화를 가운데 두고 바꾼다).
 * 화면에는 여행의 기준 화폐(Trip.base, 없으면 원화)로 바꿔 보여 준다.
 */
/** 이 여행에서 1단위 = 몇 원인가 */
export function rateOf(trip: Pick<Trip, 'currency' | 'rate' | 'rates'>, code: string) {
  if (code === 'KRW') return 1
  if (code === trip.currency) return trip.rate
  return trip.rates?.[code] ?? BY.get(code)?.rate ?? 0
}
export const toWon = (trip: Pick<Trip, 'currency' | 'rate' | 'rates'>, amount: number, code: string) => amount * rateOf(trip, code)
/** 화면에 쓰는 통화 이름: 원화는 '원', 나머지는 코드 */
export const unit = (code: string) => (code === 'KRW' ? tr('원') : code)

/** 새 여행의 기준 화폐: 한국어로 쓰면 원화, 영어로 쓰면 달러 */
export const defaultBase = () => (lang === 'en' ? 'USD' : 'KRW')
/** 합계·예산·정산을 보여 줄 화폐 */
export const baseOf = (trip: Pick<Trip, 'base'>) => trip.base ?? 'KRW'
/** 원화 금액을 기준 화폐로 */
export const krwToBase = (trip: RateTrip, krw: number) => { const r = rateOf(trip, baseOf(trip)); return r > 0 ? krw / r : 0 }
/** 어떤 화폐 금액을 기준 화폐로 */
export const toBase = (trip: RateTrip, amount: number, code: string) => krwToBase(trip, toWon(trip, amount, code))

/** 소수점 없이 쓰는 화폐 */
const NO_DECIMALS = new Set(['KRW', 'JPY', 'VND', 'IDR', 'MNT', 'TWD'])
/** 금액 표시: 원화는 '12,300원'(영어 화면은 ₩12,300), 다른 화폐는 '12.30 USD' */
export function money(n: number, code: string) {
  if (code === 'KRW') return lang === 'en' ? `₩${Math.round(n).toLocaleString('en-US')}` : `${Math.round(n).toLocaleString('ko-KR')}원`
  const digits = NO_DECIMALS.has(code) || Math.abs(n) >= 1000 ? 0 : 2
  return `${n.toLocaleString(lang === 'en' ? 'en-US' : 'ko-KR', { minimumFractionDigits: digits, maximumFractionDigits: digits })} ${code}`
}
/** 짧은 금액 (일정 머리말 등): 원화는 '14.2만원', 다른 화폐는 소수점 없이 */
export function moneyShort(n: number, code: string) {
  if (code === 'KRW') {
    if (lang === 'en') return Math.abs(n) >= 1e6 ? `₩${+(n / 1e6).toFixed(1)}M` : Math.abs(n) >= 1000 ? `₩${Math.round(n / 1000)}K` : money(n, code)
    return Math.abs(n) >= 10000 ? `${+(n / 10000).toFixed(1)}만원` : money(n, code)
  }
  return `${Math.round(n).toLocaleString(lang === 'en' ? 'en-US' : 'ko-KR')} ${code}`
}

/**
 * 환율 칸에 보여 줄 값: '1 NZD = 0.58 USD'. 1단위가 기준 화폐로 너무 작으면 100·1,000… 단위로 ('10,000 KRW = 7.14 USD')
 */
export function rateInBase(trip: RateTrip, code: string): { per: number; value: number } {
  const v = rateOf(trip, code) / (rateOf(trip, baseOf(trip)) || 1)
  const per = v >= 1 || v <= 0 ? 1 : 10 ** Math.ceil(Math.log10(1 / v))
  return { per, value: v * per }
}
const pivot = (t: Trip, code: string, krw: number) => {
  if (code === 'KRW') return
  if (code === t.currency) t.rate = krw
  else t.rates = { ...t.rates, [code]: krw }
}
/** 사용자가 고친 환율을 넣는다: per 단위의 code = value 기준 화폐 */
export function setRateInBase(t: Trip, code: string, per: number, value: number) {
  if (!(value > 0) || !(per > 0)) return
  const base = baseOf(t)
  const one = value / per // 1단위 = one 기준 화폐
  // 원화의 환율을 고치면 기준 화폐가 원화로 얼마인지가 바뀐다
  const target = code === 'KRW' ? base : code
  if (code === 'KRW') pivot(t, base, 1 / one)
  else pivot(t, code, one * rateOf(t, base))
  if (target !== 'KRW') t.ratesEdited = [...new Set([...(t.ratesEdited ?? []), target])]
}
/** 기본 어림 환율 */
export const defaultRate = (code: string) => BY.get(code)?.rate ?? 0
/** 직접 고친 환율인가 (원화 줄은 기준 화폐의 환율을 고쳤는지) */
export function customRate(t: RateTrip, code: string): boolean {
  const c = code === 'KRW' ? baseOf(t) : code
  return c !== 'KRW' && Boolean(t.ratesEdited?.includes(c))
}
/** 기본 어림 환율로 되돌린다 */
export function resetRate(t: Trip, code: string) {
  const c = code === 'KRW' ? baseOf(t) : code
  if (c === 'KRW') return
  if (c === t.currency) { if (defaultRate(c)) t.rate = defaultRate(c) }
  else if (t.rates) { const { [c]: _gone, ...rest } = t.rates; t.rates = rest }
  t.ratesEdited = (t.ratesEdited ?? []).filter((x) => x !== c)
}
/** 기준 화폐를 바꾼다. 예산 금액은 새 기준 화폐로 바꿔 둔다 */
export function setBase(t: Trip, code: string) {
  const from = rateOf(t, baseOf(t)), to = rateOf(t, code)
  if (t.budget > 0 && to > 0) t.budget = Math.round((t.budget * from) / to * 100) / 100
  t.base = code
}
