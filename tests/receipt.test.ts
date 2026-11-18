import { despaceCJK } from '../src/lib/ocr'
import { findCode, findDates, findName, findTime, findTotal, fixBrand, parseAmount, pickTripDate, readText } from '../src/lib/receipt'

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
check('긴 달 이름', pickTripDate('Check-in: Thursday, December 3, 2026\nCheck-out: Saturday, December 5, 2026', days) === '2026-12-03', pickTripDate('Check-in: Thursday, December 3, 2026', days))
check('체크인 날짜를 체크아웃보다 먼저', pickTripDate('체크아웃 2026.12.05\n체크인 2026.12.03', days) === '2026-12-03')
check('OCR 연도 오류 2226 → 2026', pickTripDate('체크인 2226.12.02 (수)', days) === '2026-12-02')
check('호텔 이름 (Hotel 속 tel)', findName(L(['Agoda booking confirmation', 'Riva Surya Bangkok Hotel', 'Booking ID: 1987654321'], 1)) === 'Riva Surya Bangkok Hotel')
check('예약 확정 머리말은 이름이 아니다', findName(L(['예약 확정', '아바니 리버사이드 방콕', '체크인 2026.12.02'], 0)) === '아바니 리버사이드 방콕')
check('주소 줄은 이름이 아니다', findName(L(['서울 중구 명동10길 29', '사업자 201-81-12345'], 0)) === undefined)
check('예약번호', findCode('Booking ID: 1987654321') === '1987654321' && findCode('예약번호 1234567890') === '1234567890')
check('바트 기호가 [4로 읽힘', parseAmount('Total paid [4250.00') === 250)
check('천 단위 띄어 읽힘', parseAmount('合計 ¥2 200') === 2200)
check('체인 이름 보정', fixBrand('T-ELEVEN') === '7-Eleven')
check('CJK 띄어 읽힘 붙이기', despaceCJK('명 동 교 자 본점') === '명동교자 본점' && despaceCJK('一 蘭 渋谷 店') === '一蘭渋谷店' && despaceCJK('2026 年 12 月 3 日') === '2026年12月3日', [despaceCJK('명 동 교 자 본점'), despaceCJK('一 蘭 渋谷 店'), despaceCJK('2026 年 12 月 3 日')])
check('평범한 한국어 띄어쓰기는 그대로', despaceCJK('총 결제금액 482,300') === '총 결제금액 482,300')
// 실제 사용자 캡처(항공사 예약 확인 단계)를 OCR한 줄 그대로
const trinity = readText(['3:20                                     all 수 114', 'ㅡ                 m.trinityairways.com       M       …', '<    선택 내역 확인 및 규정 동의    X', '04. 예약 확인                                                      —', '구간 1', 'SYD 시드니 ㆍ ICN 서울/인천', '출발일                                      2026-12-14(월)', '편명                                                     TW502', '기종                                                 A330-300', '출/도착 시간                                              12:15~21:15', '비행 시간                                              11h 00m', '운항 구분                                                   직항', '실제 운항사                                        트리니티항공', '운임 종류                                             비즈니스 운임', '전체 탑승객 편도 총액                   KRW 3,743,900 V', '총액                                              KRW3,743,900', '결제하기', '+      ©', 'Ask Gemini                 New Tab                   All Tabs'].map((text, i) => ({ text, top: i * 40, height: 30 })), ['2026-12-10', '2026-12-14'], 'AUD')
const tf = trinity.flights[0]
check('표 형식 항공권: 편명·구간·날짜·시각', tf?.flightNo === 'TW502' && tf.from === 'SYD' && tf.to === 'ICN' && tf.depDate === '2026-12-14' && tf.depTime === '12:15' && tf.arrTime === '21:15' && tf.arrDate === '2026-12-14', tf)
check('표 형식 항공권: 총액은 원화 교통비', trinity.amount === 3743900 && trinity.currency === 'KRW' && trinity.expenseCategory === 'move', trinity)
check('상태 표시줄 시계(3:20)는 시각이 아니다', trinity.time === '12:15', trinity.time)
check('주소창·단계 머리말은 이름이 아니다', !/trinityairways|예약 확인/.test(trinity.name ?? ''), trinity.name)
console.log(fail ? `${fail}개 실패` : '모두 통과')
process.exit(fail ? 1 : 0)
