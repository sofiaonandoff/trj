import { lang } from '../i18n'

const EN = lang === 'en'
export const uid = () => Math.random().toString(36).slice(2, 10)

export const toISO = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
export const parseISO = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d) }
export const addDays = (s: string, n: number) => { const d = parseISO(s); d.setDate(d.getDate() + n); return toISO(d) }
export const diffDays = (a: string, b: string) => Math.round((parseISO(b).getTime() - parseISO(a).getTime()) / 86400000)
export const dateRange = (start: string, end: string) => { const out: string[] = []; for (let i = 0; i <= Math.max(0, diffDays(start, end)); i++) out.push(addDays(start, i)); return out }
export const today = () => toISO(new Date())

const WD = EN ? ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] : ['일', '월', '화', '수', '목', '금', '토']
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const weekday = (s: string) => WD[parseISO(s).getDay()]
export const md = (s: string) => { const d = parseISO(s); return EN ? `${MON[d.getMonth()]} ${d.getDate()}` : `${d.getMonth() + 1}.${d.getDate()}` }
export const fmtRange = (a: string, b: string) => (EN ? `${md(a)} – ${md(b)}` : `${md(a)} ${weekday(a)} – ${md(b)} ${weekday(b)}`)

export const won = (n: number) => (EN ? `₩${Math.round(n).toLocaleString('en-US')}` : `${Math.round(n).toLocaleString('ko-KR')}원`)
export const wonShort = (n: number) => {
  if (EN) return Math.abs(n) >= 1e6 ? `₩${+(n / 1e6).toFixed(1)}M` : Math.abs(n) >= 1000 ? `₩${Math.round(n / 1000)}K` : won(n)
  return Math.abs(n) >= 10000 ? `${+(n / 10000).toFixed(1)}만원` : won(n)
}

export const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m }
export const fromMin = (n: number) => `${String(Math.floor(n / 60) % 24).padStart(2, '0')}:${String(Math.round(n % 60)).padStart(2, '0')}`
export const fmtDur = (min: number) => {
  const h = Math.floor(min / 60), m = min % 60
  if (EN) return h ? `${h}h${m ? ` ${m}m` : ''}` : `${m} min`
  return h ? `${h}시간${m ? ` ${m}분` : ''}` : `${m}분`
}

type LL = { lat: number; lng: number }
/** 두 좌표 사이 거리(km) */
export function km(a: LL, b: LL) {
  const R = 6371, r = Math.PI / 180
  const dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}
/** 도심 이동 시간 추정(분): 가까우면 도보, 멀면 대중교통. 직선거리 기준 어림값이다. */
export function travelMin(d: number) { return d < 1.2 ? Math.max(5, Math.round(d * 13)) : Math.round(12 + d * 3.2) }
export const travelLabel = (d: number) => (EN ? `${d < 1.2 ? 'Walk' : 'Transit'} ~${fmtDur(travelMin(d))}` : `${d < 1.2 ? '도보' : '이동'} 약 ${fmtDur(travelMin(d))}`)
export const distLabel = (d: number) => (d < 1 ? `${Math.round(d * 1000)}m` : `${d.toFixed(1)}km`)

/** 대권 경로 보간 ([lng, lat]) */
export function arc(a: [number, number], b: [number, number], n = 64): [number, number][] {
  const r = Math.PI / 180
  const [lng1, lat1, lng2, lat2] = [a[0] * r, a[1] * r, b[0] * r, b[1] * r]
  const d = 2 * Math.asin(Math.sqrt(Math.sin((lat2 - lat1) / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin((lng2 - lng1) / 2) ** 2))
  if (d === 0) return [a, b]
  const out: [number, number][] = []
  let prev = a[0]
  for (let i = 0; i <= n; i++) {
    const f = i / n
    const A = Math.sin((1 - f) * d) / Math.sin(d), B = Math.sin(f * d) / Math.sin(d)
    const x = A * Math.cos(lat1) * Math.cos(lng1) + B * Math.cos(lat2) * Math.cos(lng2)
    const y = A * Math.cos(lat1) * Math.sin(lng1) + B * Math.cos(lat2) * Math.sin(lng2)
    const z = A * Math.sin(lat1) + B * Math.sin(lat2)
    let lng = Math.atan2(y, x) / r
    while (lng - prev > 180) lng -= 360
    while (lng - prev < -180) lng += 360
    prev = lng
    out.push([lng, Math.atan2(z, Math.sqrt(x * x + y * y)) / r])
  }
  return out
}

export const haptic = (ms = 8) => { try { navigator.vibrate?.(ms) } catch { /* 미지원 기기 */ } }

export function download(name: string, text: string, type = 'text/plain') {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([text], { type }))
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 2000)
}
