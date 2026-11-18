import { tr } from '../i18n'
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

/** 이 여행에서 1단위 = 몇 원인가 */
export function rateOf(trip: Pick<Trip, 'currency' | 'rate' | 'rates'>, code: string) {
  if (code === 'KRW') return 1
  if (code === trip.currency) return trip.rate
  return trip.rates?.[code] ?? BY.get(code)?.rate ?? 0
}
export const toWon = (trip: Pick<Trip, 'currency' | 'rate' | 'rates'>, amount: number, code: string) => amount * rateOf(trip, code)
/** 화면에 쓰는 통화 이름: 원화는 '원', 나머지는 코드 */
export const unit = (code: string) => (code === 'KRW' ? tr('원') : code)
