import { despaceCJK } from '../src/lib/ocr'
import { findCode, findStayDates, findStayInfo, stayTime, findDates, findName, findTime, findTotal, fixBrand, parseAmount, pickTripDate, readText, fixFlightNos } from '../src/lib/receipt'

import { loadWorldAirports } from '../src/data/airports'
await loadWorldAirports()

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
// 실제 사용자 캡처(항공사 앱 예약 조회: 시각과 공항이 줄마다 나뉜 모양, 편명에 항목 없음)
const ke = readText(['10:38 \\                         all > [25 ]', '<                   예약 조회                  X', '2026년 12월 02일 (수)', '© 18:25                            ICN', ': _서울/인천ㆍ터미널 2', 'ㅇ                  11시간 30분', 'e 09:55 +1일                      AKL', '오클랜드ㆍ터미널 I (International)', '@ KE411 B787-10', '일반석(@)   D Zz', '일반석 스탠다드', '좌석 및 서비스 신청', 'OH HYESOO                                  PA', '45B           초과 수하물             기타 서비스'].map((text, i) => ({ text, top: i * 40, height: 30 })), ['2026-12-02', '2026-12-03'], 'NZD')
const kf = ke.flights[0]
check('시간표 항공권: KE411 인천→오클랜드, +1일 도착, 좌석', kf?.flightNo === 'KE411' && kf.from === 'ICN' && kf.to === 'AKL' && kf.depDate === '2026-12-02' && kf.depTime === '18:25' && kf.arrDate === '2026-12-03' && kf.arrTime === '09:55' && kf.seat === '45B', kf)
// 에어뉴질랜드 웹 일정표: 공항 코드가 흐려 도시 이름 구간으로, 12시간제 시각, 체크인 마감 시각은 빼고, 소문자로 읽힌 편명, 비행시간은 금액이 아님
const nz = readText(['MS JINIM PARK                                Booking Reference: VAG3BH', 'Ticket number: 0862340209404', 'Auckland to Christchurch sx. -crc', '.  ® checkin & Bag Drop closes at 12:35pm', '= Departs                              LL Arrives', '1:05pm             >         2:30pm', 'Tue, 8 Dec 2026                      Tue, 8 Dec 2026                Economy - Seat + Bag Fare', 'Operator                            Flight Number         Flight Duration         Booking Class: K        Status: Confirmed', 'AIR NEW ZEALAND                 € Nz501                1h 25m'].map((text, i) => ({ text, top: i * 40, height: 30 })), ['2026-12-07', '2026-12-08'], 'NZD')
const nf = nz.flights[0]
check('웹 일정표 항공권: NZ501 오클랜드→크라이스트처치 13:05→14:30, 금액 없음', nf?.flightNo === 'NZ501' && nf.from === 'AKL' && nf.to === 'CHC' && nf.depDate === '2026-12-08' && nf.depTime === '13:05' && nf.arrTime === '14:30' && nf.pnr === 'VAG3BH' && nz.amount === undefined, { nf, amount: nz.amount })
// 콴타스 e-티켓 영수증: 표 칸의 도시 이름(Christchurch, Sydney (Kingsford Smith)), 발권일이 아닌 편명 줄 날짜, 비행시간 03:30은 시각이 아님, NZD
const qf = readText(['E-Ticket Itinerary & Receipt', 'Passenger Ticket Information', 'Passenger Name      Frequent Flyer No.      Ticket No.      Issued      Ticket Total', 'Ms Hyesoo Oh      QF 2024757318      081-2395391472      29 Oct 26      446.71', 'Frequent Flyer Bronze', 'Ticket Total for all passengers*      893.42 NZD', 'Your Itinerary', 'Date      Flight Number      Departing      Arriving      Status      Flight Information', '10 Dec 26      QF 8765 operated by Christchurch      Sydney (Kingsford       Economy      Est journey Time: 03:30', 'Emirates      6:10PM      Smith)      Economy Sale      Non-Stop', '7:40PM      Confirmed      Aircraft Type: Airbus A380', '10 Dec 26', 'Terminal 1', 'Total Amount Payable:      893.42 NZD'].map((text, i) => ({ text, top: i * 40, height: 30 })), ['2026-12-09', '2026-12-10'], 'AUD')
const qff = qf.flights[0]
check('e-티켓 영수증: QF8765 크라이스트처치→시드니 12.10 18:10→19:40, 893.42 NZD, 숙소 아님', qff?.flightNo === 'QF8765' && qff.from === 'CHC' && qff.to === 'SYD' && qff.depDate === '2026-12-10' && qff.depTime === '18:10' && qff.arrTime === '19:40' && qf.amount === 893.42 && qf.currency === 'NZD' && qf.category !== 'stay', { qff, amount: qf.amount, currency: qf.currency, category: qf.category })
// GetYourGuide 투어 바우처: 투어 이름, GYG 예약번호, 오후 1:30(깨진 '2% 1:30'보다 'at 1:30 PM'), 미팅 포인트 주소와 안내, 피자집 안내에도 식당이 아님
const gy = readText(['SET    GYG32LV5GNAQ                                        1/3페이지', 'sSUIDE 카이코우라:물개 관람페달카약 투어', 'Kaikoura: Seal-Watching Pedal Kayak Tour', '24M (Seal Kayak tour)', '(%) 2026년 12월 9일 수 2% 1:30                        &  2    |      2', 'Wed, December 9, 2026 at 1:30 PM                       oS      ola', 'A 성인(연령14-99)              iD 유효기간1일', '8 영어', 'HYESOO OH (1/2)', '미팅 포인트                                            |', '678 Beach Road, Kaikoura 7300, New 13101 Kaikoura),', 'Z&aland', '블랙 래빗 피자와 인도 레스토랑 건너편에서', '만나요. #{Ct2t Seal Kayak Kaikoura 28 2fap', '카약으로 가득 찬 트레일러를 찾으세요.', '시간: 미팅 시각 15분 전에 도착하세요.                      카이코운라', '니티니1티| 1 ue             Kaikoura', 'Google                                     Map data ©2026 Google'].map((text, i) => ({ text, top: i * 40, height: i === 0 ? 40 : 30 })), ['2026-12-08', '2026-12-09'], 'NZD')
check('투어 바우처: 이름·예약번호·날짜·오후 시각·자연 카테고리·미팅 포인트', /Kayak Tour|카약 ?투어/.test(gy.name ?? '') && gy.code === 'GYG32LV5GNAQ' && gy.date === '2026-12-09' && gy.time === '13:30' && gy.category === 'nature' && gy.expenseCategory === 'play'
  && gy.tour?.address === '678 Beach Road, Kaikoura 7300, New Zealand' && /건너편에서 만나요/.test(gy.tour?.meeting ?? '') && /15분 전/.test(gy.tour?.meeting ?? '') && !/카이코운라|니티니/.test(gy.tour?.meeting ?? '') && gy.tour?.option === 'Seal Kayak tour', gy)
// 마이리얼트립 예약 내역: '[11월 한정]' 머리표·이모지·'>'를 뗀 투어 이름, 여행사 줄은 이름이 아님, 이용일, 총 상품 금액(원), 일일투어 8시간
const mr = readText(['-   [ME 한정] @ 페더데일 동물원 & 블루마운틴 선셋+별보기 투어 (프리미엄 일일투어) >', '뿔: 호주무한투어', '예약 취소                                            환불 규정 보기                이 예약만 취소               전체 예약 취소', '최종 환불 금액은 취소 완료시 안내됩니다.', '예약 내역', '이용일', '2026년 12월 12일 (토)', '성인(만14세~), [뉴페별]페더데일+블루마운틴 / 1개', '총 상품 금액                                                                     74,258원'].map((text, i) => ({ text, top: i * 40, height: 30 })), ['2026-12-11', '2026-12-12'], 'AUD')
check('예약 내역 투어: 이름·이용일·금액·옵션·일일투어', mr.name === '페더데일 동물원 & 블루마운틴 선셋+별보기 투어 (프리미엄 일일투어)' && mr.date === '2026-12-12' && mr.amount === 74258 && mr.currency === 'KRW' && mr.expenseCategory === 'play'
  && mr.tour?.option === '성인(만14세~), [뉴페별]페더데일+블루마운틴 / 1개' && mr.tour?.duration === 480, mr)
// 스파·온천: 이름으로 '스파·휴식' (예전에는 public_bath의 'pub'이 술집으로 잡혀 식사가 됐다)
{
  const { categoryByName } = await import('../src/data/destinations')
  check('스파·온천은 스파·휴식', ['Polynesian Spa', '폴리네시안 스파', 'Hanmer Springs Thermal Pools', '하코네 온천', '찜질방', 'Day Spa Bangkok'].every((n) => categoryByName(n) === 'relax') && categoryByName('Spark Bar') === undefined && categoryByName('Sky Tower') === undefined)
}
const sk = findStayDates('예약 확정\n아바니 리버사이드 방콕 호텔\n체크인 2026.12.02 (수) 15:00\n체크아웃 2026.12.05 (토) 12:00', days)
check('숙소 예약: 체크인·체크아웃 날짜와 시각', JSON.stringify(sk) === JSON.stringify({ checkIn: '2026-12-02', checkOut: '2026-12-05', inTime: '15:00', outTime: '12:00' }), sk)
const se = findStayDates('Riva Surya Bangkok Hotel\nCheck-in: Thursday, December 3, 2026\nCheck-out: Saturday, December 5, 2026', days)
check('숙소 예약(영문 PDF): 날짜', se?.checkIn === '2026-12-03' && se?.checkOut === '2026-12-05', se)
const sn = findStayDates('체크인\n2026년 12월 3일 (목) 15:00\n체크아웃\n2026년 12월 5일 (토) 11:00', days)
check('숙소 예약: 날짜가 다음 줄에 있는 화면', sn?.checkIn === '2026-12-03' && sn?.checkOut === '2026-12-05' && sn?.inTime === '15:00', sn)
// 실제 사용자 캡처: 에어비앤비 예약 화면 (체크인·체크아웃이 나란히, OCR이 오전·오후를 깨뜨려 읽음)
const nzDays = ['2026-12-02', '2026-12-14']
const ab = (rows: string[]) => findStayDates(rows.join('\n'), nzDays)
check('에어비앤비: 나란히 놓인 체크인·체크아웃', JSON.stringify(ab(['체크인            체크아웃', '12월 3일 (목)        12월 5일 (토)', '오후 3.00          오후 12:00'])) === JSON.stringify({ checkIn: '2026-12-03', checkOut: '2026-12-05', inTime: '15:00', outTime: '12:00' }), ab(['체크인            체크아웃', '12월 3일 (목)        12월 5일 (토)', '오후 3.00          오후 12:00']))
check('에어비앤비: 오전이 깨져 읽힌 시각(272110:00)', JSON.stringify(ab(['체크인                                  체크아웃', '12월 7일 (월)                      12월 8일 (화)', '23 2:00                           272110:00'])) === JSON.stringify({ checkIn: '2026-12-07', checkOut: '2026-12-08', inTime: '14:00', outTime: '10:00' }), ab(['체크인                                  체크아웃', '12월 7일 (월)                      12월 8일 (화)', '23 2:00                           272110:00']))
check('숙소 시각: 오후 12:00은 정오', stayTime('오후 12:00', false) === '12:00' && stayTime('오전10:00', false) === '10:00')
const info = findStayInfo(['Taurangal| 숙소', '2 A E:Shaina 님', '체크인            체크아웃', '© 찾아가는 방법', '15 Lily Way', 'O09 숙소이용규칙'])
check('에어비앤비: 도시·호스트·주소', info.city === 'Tauranga' && info.host === 'Shaina' && info.address === '15 Lily Way', info)
const info2 = findStayInfo(['od 숙소', '프', '리미엄 마스터 욕조 |15분 - 공항', '© 찾아가는 방법', '38 Hamilton Road'])
check('에어비앤비: 숙소 소개 제목(끊겨 읽힌 줄 잇기)', info2.name === '프리미엄 마스터 욕조 |15분 - 공항' && info2.address === '38 Hamilton Road', info2)
// 실제 사용자 캡처: 아고다 예약 확인 (날짜 두 개가 한 줄, 체크인 라벨 없음, 숙소 이름 없음, 아래에 항공권 광고)
const ag = readText(['8:36 \\', '« Safari                                              all =', 'Confirmation', 'Your booking is confirmed.', 'In the next 10 minutes you will receive a booking', 'Booking ID                          1784314613', 'Sun, Dec13 _, Mon, Dec 14             1 0', '14:00                   Check-out                  Room', 'View booking details', 'Return home', 'ㅡ~       -』 Book another room                   N', '4 = dd    Studio Superior', 'pi UE More Hotels in Sydney', 'Flight to Sydney', '13 Dec - 2 Passengers - One-way - GMP to SYD [4', ')_  Jetstar Airways Trinity Airways', '21:50 —— 10:05+1    21:40 ——1C', 'ICN     10h 15m 86        ICN     10h 35m oy', '₩ 313,531                         w 42;'].map((text, i) => ({ text, top: i * 40, height: 30 })), nzDays, 'AUD')
check('아고다: 체크인 12.13 14:00 → 체크아웃 12.14', ag.stay?.checkIn === '2026-12-13' && ag.stay?.checkOut === '2026-12-14' && ag.stay?.inTime === '14:00', ag.stay)
check('아고다: 이름은 도시로, 객실·예약번호', /Sydney/.test(ag.name ?? '') && ag.stay?.city === 'Sydney' && ag.stay?.room === 'Studio Superior' && ag.code === '1784314613', [ag.name, ag.stay, ag.code])
check('아고다: 아래 항공권 광고는 항공편·금액이 아니다', ag.flights.length === 0 && ag.amount === undefined, [ag.flights, ag.amount])
// 실제 사용자 캡처: 아고다 일정의 숙소 카드 (이름이 날짜 줄 바로 위, 시각이 날짜 줄 안, 도시가 아래)
const ag2 = readText(['8:37 \\                             EH', '« Safari                                      20680 | | | 1', 'Sydney ©', '13-14 Dec 2026 (5 ㆍ @@ 1 booking', 'Itinerary                         Saved', 'Day 1 ㆍ Sun, 13 Dec', '=    @ Confirmed', 'sith  Quest North Sydney', 'ama fl 13 Dec 14:00 - 14 Dec', '고    fi Sydney', '< Directions', '1 Booking + 1 room                                A', 'ID: 1784314613', '[J   A  1 x Studio Superior', '도일 2 Adults ㆍ11\\/6500', 'Contact us      Add rooms'].map((text, i) => ({ text, top: i * 40, height: 30 })), nzDays, 'AUD')
check('아고다 일정 카드: Quest North Sydney, 12.13 14:00 → 12.14', ag2.name === 'Quest North Sydney' && ag2.stay?.checkIn === '2026-12-13' && ag2.stay?.checkOut === '2026-12-14' && ag2.stay?.inTime === '14:00' && ag2.stay?.city === 'Sydney', [ag2.name, ag2.stay])
check('아고다 일정 카드: 예약번호, 엉뚱한 금액 없음', ag2.code === '1784314613' && ag2.amount === undefined, [ag2.code, ag2.amount])
// 트립닷컴 항공권 (2027.2.12 콘깬 → 돈므앙): '년'을 4로, '총'을 =로 읽고, 적립 포인트 +16이 같은 줄에 붙는다
const kkcRows = (head: string) => [head, '변경 및 취소 규정', '> 20274 2월 12일. 1시간                   A', '모든 시간은 현지 시간으로 표시됩니다', '12:15    KKC 21 공항 +1', '@ 타이 에어아시아 FD3249 일반석               N', '에어버스 A320(ZE) | W 위탁 수하물 허용량 불포함', '13:15     DMK 돈므앙 국제공항 12'].map((text, i) => ({ text, top: i * 40, height: 30 }))
for (const head of ['총 금액 105,800원                      +16', '= 금액 105,800원                      +16']) {
  const k = readText(kkcRows(head), ['2026-12-07', '2026-12-08', '2026-12-09'], 'THB')
  check(`트립닷컴 항공권 (${head.slice(0, 6)}): FD3249 KKC→DMK 2027-02-12 12:15–13:15, 105,800원`, k.flights[0]?.flightNo === 'FD3249' && k.flights[0].from === 'KKC' && k.flights[0].to === 'DMK' && k.flights[0].depDate === '2027-02-12' && k.flights[0].arrDate === '2027-02-12' && k.flights[0].depTime === '12:15' && k.flights[0].arrTime === '13:15' && k.amount === 105800 && k.currency === 'KRW', [k.flights, k.amount, k.currency])
}
check('연도 없는 날짜는 여행에 가까운 해로: 12월 여행의 2월 12일 → 다음 해', readText(kkcRows('x').map((l) => ({ ...l, text: l.text.replace('20274 ', '') })), ['2026-12-20'], 'THB').flights[0]?.depDate === '2027-02-12')
check('금액: 통화가 붙은 숫자를 먼저, +16 같은 덧붙임은 빼고', parseAmount('총 금액 105,800원 +16') === 105800 && parseAmount('Total 1,250 +3') === 1250 && parseAmount('합계 22,000원') === 22000)
// 경유 항공권 (Kiwi 다크 모드): 청주 → 상하이 푸둥 → 방콕, 둘째 편명을 MUB8611로 읽음
const mu = readText(['1:53 mm                        all T &', '<', 'Bangkok', 'from Cheongju', 'Tuesday, February 9, 2027', '® 8h20m © 1stop', 'China Eastern                                                 «', 'MU5084', 'e 11:30AM Cheongju', '® 2hOm                     More info Vv', 'e 12:30PM Shanghai Pudong', '® 1h 25m connection in airport', 'China Eastern                                             «', 'MUB8611 - Operated by Shanghai Airlines', 'e 1:55PM Shanghai Pudong', '® 4h55m                    More info Vv', 'e 5:50PM Bangkok Suvarnabhumi'].map((text, i) => ({ text, top: i * 40, height: 30 })), ['2027-02-09', '2027-02-10'], 'THB')
const legs = mu.flights.map((f) => `${f.flightNo} ${f.from}-${f.to} ${f.depDate} ${f.depTime}-${f.arrDate} ${f.arrTime}`).join(' / ')
check('경유 항공권: 두 구간으로 (MU5084 CJJ→PVG, MU8611 PVG→BKK)', legs === 'MU5084 CJJ-PVG 2027-02-09 11:30-2027-02-09 12:30 / MU8611 PVG-BKK 2027-02-09 13:55-2027-02-09 17:50', legs)
check('편명에 끼어 읽힌 글자 고치기', fixFlightNos('MUB8611 -') === 'MU8611 -' && fixFlightNos('KEO17') === 'KE017' && fixFlightNos('A320 B787') === 'A320 B787')
// 아고다 일정 (2027.2.13–14 Eastin Grand): 'Feb 14:00'을 날짜로 읽지 않고, 썸네일 찌꺼기(#4, 8)를 이름에서 뗀다
for (const junk of ['p18  #4 ', '8 ']) {
  const eg = readText(['Bangkok ©', '13-14 Feb 2027 (5 ㆍ @@ 1 booking', 'Itinerary     Bookings     Saved', 'Day 1 - Sat, 13 Feb', '=    @ Confirmed', `${junk}Eastin Grand Hotel Phayathai`, 'BRIE] 13 Feb 14:00 — 14 Feb 12:00', '=  zo Bangkok', '< Directions', '1 Booking + 1 room                                A', 'ID: 1801660379', ':   + 1x SUPERIOR PANORAMA', ')    2 Adults ㆍ11\\/6500', 'View and edit      Contact us       Add ro', 'Day 2 - Sun, 14 Feb', '=    12:00 Check out + Eastin Grand Hotel Phayathai'].map((text, i) => ({ text, top: i * 40, height: 30 })), ['2027-02-13', '2027-02-14'], 'THB')
  check(`아고다 일정 (${junk.trim()}): Eastin Grand Hotel Phayathai, 2.13 14:00 → 2.14 12:00, Bangkok`, eg.name === 'Eastin Grand Hotel Phayathai' && eg.stay?.checkIn === '2027-02-13' && eg.stay?.checkOut === '2027-02-14' && eg.stay?.inTime === '14:00' && eg.stay?.outTime === '12:00' && eg.stay?.city === 'Bangkok' && eg.code === '1801660379', [eg.name, eg.stay, eg.code])
}
check('날짜 뒤 시각은 날짜가 아니다: 13 Feb 14:00 — 14 Feb 12:00', findDates('13 Feb 14:00 — 14 Feb 12:00', 2027).join() === '2027-02-13,2027-02-14', findDates('13 Feb 14:00 — 14 Feb 12:00', 2027))
// 숙소 앱 객실 선택 화면 (아사이 방콕 차이나타운): 제목 줄의 숙소 이름, 27.2.12-27.2.13, 객실, 예약 버튼 금액. 환불 기한 '2월 11일'은 날짜가 아니다
const asai = readText(['12:40 a=                        all © &', '< (OO _ 아사이방콕차이나타운 [| [J', '객실 선택', 'Biggy King Bunk', '기본형 / 최대 4명                        상세정보 >', '킹 침대 1, 이층 침대 2', '환불 조건', '@ 환불 불가                                              +0 원', '2월 11일 19:00까지 전액 환불 가능        +41159 원', '선택 사항', '@ == WiFi                                              +0 원', '무료 아침 식사, 무료 WiFi                 +33,599 원', 'As       W370,422 예약', '0,                  ~', '10% W353,414                         ZHAI 서태', 'a ey |', '27.2.12-27.2.13 / 4%'].map((text, i) => ({ text, top: i * 40, height: 30 })), ['2027-02-12', '2027-02-13'], 'THB')
check('객실 선택 화면: 아사이방콕차이나타운 2027.2.12→2.13, Biggy King Bunk, 370,422원', asai.category === 'stay' && asai.name === '아사이방콕차이나타운' && asai.stay?.checkIn === '2027-02-12' && asai.stay?.checkOut === '2027-02-13' && asai.stay?.room === 'Biggy King Bunk' && asai.amount === 370422 && asai.currency === 'KRW' && asai.date !== '2027-02-11', [asai.category, asai.name, asai.stay, asai.amount, asai.currency, asai.date])
check('짧은 연도 표기 27.2.12 → 2027-02-12 (일.월.년 2012-02-27로 읽지 않는다)', findDates('27.2.12-27.2.13', 2027).join() === '2027-02-12,2027-02-13' && findDates('04.12.26', 2026).join() === '2026-12-04,2026-04-12', [findDates('27.2.12-27.2.13', 2027), findDates('04.12.26', 2026)])
console.log(fail ? `${fail}개 실패` : '모두 통과')
process.exit(fail ? 1 : 0)
