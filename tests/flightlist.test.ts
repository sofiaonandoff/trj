import { loadWorldAirports } from '../src/data/airports'
import { flightList } from '../src/lib/flightList'

let fails = 0
const check = (label: string, ok: boolean, got?: unknown) => { if (!ok) fails++; console.log(ok ? 'PASS' : 'FAIL', label, ok ? '' : JSON.stringify(got)) }
await loadWorldAirports()

// 메모장에 적은 항공편 목록 (OCR이 SG를 Sq로 읽은 줄 포함)
const lines = ['12:55 \\  ull LTE 5', 'E  1.8Feb0640- 0815 scoot SG- BKK ®    +', '1. 8 Feb 0640 - 0815 scoot SG - BKK', '2. 9 Feb 1745 - 1850 Thai Airasia BKK - KK', '3. 12 Feb 1215 - 1315 Thai Airasia KK - BKK', '4. 13 Feb 2015 - 2350 scoot BKK - Sq']
const days = ['2027-02-07', '2027-02-08', '2027-02-09', '2027-02-12', '2027-02-13']
const f = flightList(lines, days)
const s = f.map((x) => `${x.flightNo} ${x.from}-${x.to} ${x.depDate} ${x.depTime}-${x.arrTime}`)
check('네 편 모두', s.join(' | ') === 'TR SIN-BKK 2027-02-08 06:40-08:15 | FD BKK-KKC 2027-02-09 17:45-18:50 | FD KKC-BKK 2027-02-12 12:15-13:15 | TR BKK-SIN 2027-02-13 20:15-23:50', s)
check('KK는 다른 후보도 알려 준다', JSON.stringify(f[1].choices) === JSON.stringify([{ side: 'to', word: 'KK', options: ['KKC', 'BKI', 'KBV'] }]), f[1].choices)
// 비행시간이 길면 코타키나발루 (시간대 1시간 차이까지 빼고)
const long = flightList(['10 Feb 1000 - 1500 airasia BKK - KK'], days)[0]
check('4시간 걸리면 KK = 코타키나발루', long?.to === 'BKI' && long.flightNo === 'AK', long)
// 한국어·편명 있는 줄, 다음 날 도착
const ko = flightList(['12/3 22:40 - 05:30 대한항공 KE651 인천 - 방콕'], ['2026-12-03'])[0]
check('한국어 줄: 편명·도시 이름·다음 날 도착', ko?.flightNo === 'KE651' && ko.from === 'ICN' && ko.to === 'BKK' && ko.arrDate === '2026-12-04', ko)
check('항공편이 아닌 줄은 읽지 않는다', flightList(['8 Feb 0640 - 0815 회의 사무실 - 집', 'Total 12,000'], days).length === 0)

console.log(fails ? `\n${fails}개 실패` : '\n모두 통과')
process.exit(fails ? 1 : 0)
