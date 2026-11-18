import { findDates, findName, findTime, findTotal, parseAmount, pickTripDate, readText } from '../src/lib/receipt'

let fail = 0
const check = (label: string, ok: boolean, got?: unknown) => { if (!ok) fail++; console.log(ok ? 'PASS' : 'FAIL', label, ok ? '' : JSON.stringify(got)) }
const days = ['2026-12-02', '2026-12-03', '2026-12-04', '2026-12-05']
const L = (rows: string[], big = 0) => rows.map((text, i) => ({ text, top: i * 40, height: i === big ? 60 : 24 }))

check('2026.12.04', findDates('일시 2026.12.04 13:22', 2026)[0] === '2026-12-04')
check('04/12/2026 (일/월) → 여행 기간 안', pickTripDate('Date: 04/12/2026', days) === '2026-12-04')
check('12/03/26 (월/일) → 여행 기간 안', pickTripDate('12/03/26 9:41 PM', days) === '2026-12-03')
check('태국 불기 04/12/2569', pickTripDate('วันที่ 04/12/2569', days) === '2026-12-04')
check('12월 5일', pickTripDate('체크인 12월 5일 (토)', days) === '2026-12-05')
check('3 Dec 2026', pickTripDate('Check-in: Thu, 3 Dec 2026', days) === '2026-12-03')
check('Dec 4, 2026', pickTripDate('Dec 4, 2026', days) === '2026-12-04')
check('2026年12月3日', pickTripDate('2026年12月3日', days) === '2026-12-03')
check('오후 시각', findTime('결제 오후 2:05') === '14:05', findTime('결제 오후 2:05'))
check('PM 시각', findTime('9:41 PM') === '21:41')
check('금액 1,234.50', parseAmount('TOTAL 1,234.50') === 1234.5)
check('금액 1.234,50', parseAmount('Summe 1.234,50') === 1234.5)
check('금액 12,600', parseAmount('합계 12,600원') === 12600)
check('합계 줄을 고른다', findTotal(['Latte 120.00', 'Cake 95.00', 'Subtotal 215.00', 'VAT 7% 15.05', 'TOTAL 230.05', 'Cash 500.00', 'Change 269.95']) === 230.05)
check('합계 줄이 없으면 통화 붙은 가장 큰 금액', findTotal(['아메리카노 4,500원', '라떼 5,000원']) === 5000)
check('가게 이름: 위쪽의 큰 글자', findName(L(['RECEIPT', 'Blue Whale Cafe', 'Tel 02-123-4567', 'Latte 120.00'], 1)) === 'Blue Whale Cafe')

const cafe = readText(L(['Blue Whale Cafe', '392/37 Maharat Rd', 'Date 04/12/2026 14:31', 'Iced Latte 120.00', 'TOTAL ฿ 120.00'], 0), days, 'THB')
check('카페 영수증 전체', cafe.name === 'Blue Whale Cafe' && cafe.date === '2026-12-04' && cafe.time === '14:31' && cafe.amount === 120 && cafe.currency === 'THB' && cafe.category === 'cafe' && cafe.expenseCategory === 'food', cafe)
const taxi = readText(L(['Grab', 'Your ride on 3 Dec 2026', 'Total ฿250'], 0), days, 'THB')
check('택시는 비용만', taxi.costOnly && taxi.expenseCategory === 'move' && taxi.amount === 250, taxi)
const yen = readText(L(['ローソン', '2026年12月3日', '合計 ¥1,280'], 0), days, 'JPY')
check('일본 편의점 엔화', yen.amount === 1280 && yen.currency === 'JPY' && yen.date === '2026-12-03', yen)
const won = readText(L(['명동교자', '2026-12-02 12:10', '칼국수 11,000', '합계 22,000원'], 0), days, 'KRW')
check('원화 합계', won.amount === 22000 && won.currency === 'KRW' && won.name === '명동교자', won)
console.log(fail ? `${fail}개 실패` : '모두 통과')
process.exit(fail ? 1 : 0)
