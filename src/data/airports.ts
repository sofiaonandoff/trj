import { tr } from '../i18n'

export interface Airport { code: string; city: string; name: string; lat: number; lng: number; tz: string }

const raw: [string, string, string, number, number, string][] = [
  ['ICN', '서울', '인천국제공항', 37.4602, 126.4407, 'Asia/Seoul'],
  ['GMP', '서울', '김포국제공항', 37.5583, 126.7906, 'Asia/Seoul'],
  ['PUS', '부산', '김해국제공항', 35.1795, 128.9382, 'Asia/Seoul'],
  ['CJU', '제주', '제주국제공항', 33.5113, 126.493, 'Asia/Seoul'],
  ['TAE', '대구', '대구국제공항', 35.8941, 128.6589, 'Asia/Seoul'],
  ['CJJ', '청주', '청주국제공항', 36.7166, 127.4991, 'Asia/Seoul'],
  ['NRT', '도쿄', '나리타국제공항', 35.772, 140.3929, 'Asia/Tokyo'],
  ['HND', '도쿄', '하네다공항', 35.5494, 139.7798, 'Asia/Tokyo'],
  ['KIX', '오사카', '간사이국제공항', 34.4347, 135.244, 'Asia/Tokyo'],
  ['FUK', '후쿠오카', '후쿠오카공항', 33.5859, 130.4507, 'Asia/Tokyo'],
  ['CTS', '삿포로', '신치토세공항', 42.7752, 141.6923, 'Asia/Tokyo'],
  ['OKA', '오키나와', '나하공항', 26.1958, 127.6459, 'Asia/Tokyo'],
  ['NGO', '나고야', '주부국제공항', 34.8584, 136.8054, 'Asia/Tokyo'],
  ['TPE', '타이베이', '타오위안국제공항', 25.0797, 121.2342, 'Asia/Taipei'],
  ['TSA', '타이베이', '쑹산공항', 25.0694, 121.5525, 'Asia/Taipei'],
  ['HKG', '홍콩', '홍콩국제공항', 22.308, 113.9185, 'Asia/Hong_Kong'],
  ['PVG', '상하이', '푸둥국제공항', 31.1443, 121.8083, 'Asia/Shanghai'],
  ['PEK', '베이징', '서우두국제공항', 40.0799, 116.6031, 'Asia/Shanghai'],
  ['BKK', '방콕', '수완나품공항', 13.69, 100.7501, 'Asia/Bangkok'],
  ['DMK', '방콕', '돈므앙공항', 13.9126, 100.6068, 'Asia/Bangkok'],
  ['DAD', '다낭', '다낭국제공항', 16.0439, 108.1994, 'Asia/Ho_Chi_Minh'],
  ['SGN', '호찌민', '떤선녓국제공항', 10.8188, 106.652, 'Asia/Ho_Chi_Minh'],
  ['HAN', '하노이', '노이바이국제공항', 21.2212, 105.8072, 'Asia/Ho_Chi_Minh'],
  ['CXR', '나트랑', '깜라인국제공항', 11.9982, 109.2194, 'Asia/Ho_Chi_Minh'],
  ['PQC', '푸꾸옥', '푸꾸옥국제공항', 10.1698, 103.9931, 'Asia/Ho_Chi_Minh'],
  ['SIN', '싱가포르', '창이공항', 1.3644, 103.9915, 'Asia/Singapore'],
  ['KUL', '쿠알라룸푸르', '쿠알라룸푸르국제공항', 2.7456, 101.7099, 'Asia/Kuala_Lumpur'],
  ['MNL', '마닐라', '니노이 아키노 국제공항', 14.5086, 121.0194, 'Asia/Manila'],
  ['CEB', '세부', '막탄세부국제공항', 10.3075, 123.9794, 'Asia/Manila'],
  ['DPS', '발리', '응우라라이국제공항', -8.7482, 115.1672, 'Asia/Makassar'],
  ['GUM', '괌', '괌국제공항', 13.4834, 144.796, 'Pacific/Guam'],
  ['SYD', '시드니', '시드니공항', -33.9399, 151.1753, 'Australia/Sydney'],
  ['DXB', '두바이', '두바이국제공항', 25.2532, 55.3657, 'Asia/Dubai'],
  ['IST', '이스탄불', '이스탄불공항', 41.2753, 28.7519, 'Europe/Istanbul'],
  ['CDG', '파리', '샤를드골공항', 49.0097, 2.5479, 'Europe/Paris'],
  ['LHR', '런던', '히스로공항', 51.47, -0.4543, 'Europe/London'],
  ['FCO', '로마', '피우미치노공항', 41.8003, 12.2389, 'Europe/Rome'],
  ['BCN', '바르셀로나', '엘프라트공항', 41.2974, 2.0833, 'Europe/Madrid'],
  ['MAD', '마드리드', '바라하스공항', 40.4983, -3.5676, 'Europe/Madrid'],
  ['FRA', '프랑크푸르트', '프랑크푸르트공항', 50.0379, 8.5622, 'Europe/Berlin'],
  ['AMS', '암스테르담', '스히폴공항', 52.3105, 4.7683, 'Europe/Amsterdam'],
  ['JFK', '뉴욕', '존 F. 케네디 국제공항', 40.6413, -73.7781, 'America/New_York'],
  ['LAX', '로스앤젤레스', '로스앤젤레스국제공항', 33.9416, -118.4085, 'America/Los_Angeles'],
  ['SFO', '샌프란시스코', '샌프란시스코국제공항', 37.6213, -122.379, 'America/Los_Angeles'],
  ['SEA', '시애틀', '시애틀타코마국제공항', 47.4502, -122.3088, 'America/Los_Angeles'],
  ['HNL', '호놀룰루', '대니얼 K. 이노우에 국제공항', 21.3245, -157.9251, 'Pacific/Honolulu'],
  ['YVR', '밴쿠버', '밴쿠버국제공항', 49.1967, -123.1815, 'America/Vancouver'],
]

/** 자주 가는 공항 (한국어 이름이 있다). 공항 고르기 목록과 도시의 가까운 공항 찾기에 쓴다 */
export const CORE_AIRPORTS: Airport[] = raw.map(([code, city, name, lat, lng, tz]) => ({ code, city: tr(city), name: tr(name), lat, lng, tz }))
/** 아는 모든 공항. 앱이 시작하면 세계 공항(정기편 있는 약 3,200곳)이 더해진다 */
export const AIRPORTS: Airport[] = [...CORE_AIRPORTS]
const byCode = new Map(AIRPORTS.map((a) => [a.code, a]))
export const airport = (code: string) => byCode.get(code)

/** 도시 이름(한국어·영어, 소문자) → 공항 코드들. 항공권 사진에서 'Christchurch', 'Sydney (Kingsford Smith)'처럼 도시로 적힌 구간을 찾는다 */
const cityIndex = new Map<string, string[]>()
const intl = new Set<string>()
const addCity = (city: string, code: string) => {
  const k = city.trim().toLowerCase()
  if (!k) return
  const l = cityIndex.get(k) ?? []
  if (!l.includes(code)) l.push(code)
  cityIndex.set(k, l)
}
raw.forEach(([code, city]) => { addCity(city, code); addCity(tr(city), code) })
/**
 * 도시 이름으로 공항 코드를 찾는다. 같은 이름의 도시가 여럿이면(시드니: 호주·캐나다)
 * 자주 가는 공항 → 국제공항 → 먼저 나온 것 순으로 고른다. 세계 공항을 불러온 뒤에 영어 이름도 찾는다
 */
export function airportByCity(name: string): string | undefined {
  const l = cityIndex.get(name.trim().toLowerCase())
  if (!l) return undefined
  return l.find((c) => CORE_AIRPORTS.some((a) => a.code === c)) ?? l.find((c) => intl.has(c)) ?? l[0]
}

let world: Promise<void> | null = null
/** 세계 공항 목록을 불러와 AIRPORTS에 더한다 (한 번만). 항공편 해석 전에 기다린다 */
export function loadWorldAirports(): Promise<void> {
  world ??= import('./airportsWorld').then(({ default: data }) => {
    for (const line of data.split('\n')) {
      const [code, city, name, lat, lng, tz] = line.split('|')
      if (!code) continue
      addCity(city, code)
      if (/international/i.test(name)) intl.add(code)
      if (byCode.has(code)) continue
      const a = { code, city, name, lat: Number(lat), lng: Number(lng), tz }
      AIRPORTS.push(a)
      byCode.set(code, a)
    }
  }).catch(() => { world = null })
  return world
}

const AIRLINES_KO: Record<string, string> = {
  KE: '대한항공', OZ: '아시아나항공', '7C': '제주항공', LJ: '진에어', TW: '티웨이항공', BX: '에어부산',
  RS: '에어서울', ZE: '이스타항공', YP: '에어프레미아', RF: '에어로케이', JL: '일본항공', NH: '전일본공수',
  MM: '피치항공', CI: '중화항공', BR: '에바항공', CX: '캐세이퍼시픽', TG: '타이항공', VN: '베트남항공',
  VJ: '비엣젯항공', SQ: '싱가포르항공', AF: '에어프랑스', BA: '영국항공', LH: '루프트한자', KL: 'KLM',
  TK: '터키항공', EK: '에미레이트항공', QR: '카타르항공', DL: '델타항공', UA: '유나이티드항공',
  AA: '아메리칸항공', HA: '하와이안항공', AC: '에어캐나다', QF: '콴타스항공', PR: '필리핀항공',
  '5J': '세부퍼시픽', MU: '중국동방항공', CA: '중국국제항공', CZ: '중국남방항공',
  NZ: '에어뉴질랜드', JQ: '젯스타', VA: '버진오스트레일리아', AK: '에어아시아', D7: '에어아시아 X', FD: '타이에어아시아', MH: '말레이시아항공', GA: '가루다인도네시아', EY: '에티하드항공', AY: '핀에어', LX: '스위스항공', AZ: 'ITA항공', IB: '이베리아항공', OS: '오스트리아항공', HX: '홍콩항공', UO: '홍콩익스프레스', GK: '젯스타재팬', TR: '스쿠트', '3K': '젯스타아시아', WN: '사우스웨스트항공', AS: '알래스카항공', B6: '제트블루', FJ: '피지항공', NX: '마카오항공', BI: '로열브루나이항공', SU: '아에로플로트', ET: '에티오피아항공', MS: '이집트항공',
}
export const AIRLINES: Record<string, string> = Object.fromEntries(Object.entries(AIRLINES_KO).map(([code, name]) => [code, tr(name)]))
export const airlineOf = (flightNo: string) => AIRLINES[flightNo.slice(0, 2).toUpperCase()] ?? ''
