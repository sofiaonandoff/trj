import { baseOf, customRate, krwToBase, money, rateInBase, resetRate, setBase, setRateInBase, toBase } from '../src/data/currencies'
import type { Trip } from '../src/types'

let fails = 0
const check = (label: string, ok: boolean, got?: unknown) => { if (!ok) fails++; console.log(ok ? 'PASS' : 'FAIL', label, ok ? '' : JSON.stringify(got)) }
const near = (a: number, b: number) => Math.abs(a - b) < 1e-6 * Math.max(1, Math.abs(b))

const t = { currency: 'NZD', rate: 820, budget: 1_640_000 } as Trip
check('기준 화폐가 없으면 원화', baseOf(t) === 'KRW' && near(toBase(t, 10, 'NZD'), 8200))
check('원화 기준: 1 NZD = 820원', JSON.stringify(rateInBase(t, 'NZD')) === JSON.stringify({ per: 1, value: 820 }))

setBase(t, 'USD') // 1 USD = 1400원
check('기준 화폐를 바꾸면 예산도 그 화폐로 (1,640,000원 → 1,171.43 USD)', t.base === 'USD' && near(t.budget, 1171.43), t.budget)
check('NZD를 USD로: 10 NZD = 5.857 USD', near(toBase(t, 10, 'NZD'), 8200 / 1400))
const k = rateInBase(t, 'KRW')
check('원화는 10,000원 단위로 보여 준다 (10,000 KRW = 7.14 USD)', k.per === 10000 && near(k.value, 10000 / 1400), k)

setRateInBase(t, 'NZD', 1, 0.6) // 직접 넣은 환율: 1 NZD = 0.6 USD
check('직접 고친 환율: 1 NZD = 0.6 USD, 10 NZD = 6 USD', near(toBase(t, 10, 'NZD'), 6) && customRate(t, 'NZD'), t)
check('원화로 계산해도 맞다 (1 NZD = 840원)', near(t.rate, 840))
setRateInBase(t, 'EUR', 1, 1.1)
check('다른 화폐도 고친다: 1 EUR = 1.1 USD', near(toBase(t, 1, 'EUR'), 1.1) && customRate(t, 'EUR'))
setRateInBase(t, 'KRW', 10000, 7)
check('원화 환율을 고치면 기준 화폐의 원화 값이 바뀐다 (10,000원 = 7 USD → 1 USD = 1428.57원)', near(krwToBase(t, 10000), 7) && near(t.rates!.USD, 10000 / 7), t.rates)
resetRate(t, 'EUR')
check('기본값으로 되돌리기', !customRate(t, 'EUR') && t.rates!.EUR === undefined)
check('금액 표시', ['12,300원', '₩12,300'].includes(money(12300, 'KRW')) && money(12.3, 'USD') === '12.30 USD' && money(1234.5, 'NZD') === '1,235 NZD' && money(1500, 'JPY') === '1,500 JPY', [money(12300, 'KRW'), money(12.3, 'USD'), money(1234.5, 'NZD')])

console.log(fails ? `\n${fails}개 실패` : '\n모두 통과')
process.exit(fails ? 1 : 0)
