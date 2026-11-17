import { lang, tr } from '../i18n'
import type { Category, Day, Place, Trip } from '../types'
import { dateRange, km, uid } from './util'

/** 서버 함수(/api/plan)가 알려 준 실패 이유 */
export class AiError extends Error {
  constructor(public code: string, public detail = '') { super(code) }
}

/** 실패 이유를 사용자가 할 수 있는 일로 바꿔 말한다 */
export function aiMessage(e: unknown): string {
  const code = e instanceof AiError ? e.code : 'network'
  switch (code) {
    case 'not_configured': return tr('AI 추천이 설정되지 않았습니다 (서버의 GEMINI_API_KEY)')
    case 'auth': return tr('Gemini API 키가 거절되었습니다. 키를 확인하세요')
    case 'busy': return tr('Gemini가 지금 붐빕니다. 1~2분 뒤에 다시 시도하세요')
    case 'quota': return tr('Gemini 무료 한도를 다 썼습니다. 잠시 뒤에 다시 시도하세요')
    case 'too_long': return tr('AI 추천은 14일 이하 여행까지 됩니다')
    case 'timeout': return tr('AI 응답이 너무 오래 걸립니다. 다시 시도하세요')
    case 'network': return tr('AI 서버에 연결하지 못했습니다. 연결을 확인하세요')
    case 'bad_output': return tr('AI가 일정을 제대로 만들지 못했습니다. 다시 시도하세요')
    default: return tr('AI 추천에 실패했습니다. 다시 시도하세요')
  }
}

async function call<T>(body: object): Promise<T> {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), 60_000)
  try {
    const res = await fetch('/api/plan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, lang }), signal: ac.signal })
    // 서버 함수가 없는 곳(정적 호스팅)에서는 JSON이 아닌 답이 온다
    if (!(res.headers.get('content-type') ?? '').includes('json')) throw new AiError('not_configured')
    const data = await res.json()
    if (!res.ok) throw new AiError(data?.error ?? 'upstream', data?.detail ?? '')
    return data as T
  } catch (e) {
    if (e instanceof AiError) throw e
    throw new AiError((e as Error).name === 'AbortError' ? 'timeout' : 'network')
  } finally { clearTimeout(timer) }
}

const CATS: Category[] = ['sight', 'food', 'cafe', 'shop', 'nature', 'culture', 'night', 'stay']
type Raw = Record<string, unknown>

/** 모델이 준 값을 그대로 믿지 않고 형식과 범위를 확인해 장소로 만든다 */
function toPlace(r: Raw, center?: { lat: number; lng: number }): Place | null {
  const name = typeof r.name === 'string' ? r.name.trim().slice(0, 80) : ''
  const lat = Number(r.lat), lng = Number(r.lng)
  if (!name || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null
  // 목적지에서 터무니없이 먼 좌표는 잘못된 것으로 보고 버린다
  if (center && km(center, { lat, lng }) > 250) return null
  const duration = Math.round(Number(r.duration))
  const cost = Math.round(Number(r.cost_krw))
  const note = typeof r.note === 'string' ? r.note.trim().slice(0, 120) : ''
  return {
    id: uid(), name, lat, lng,
    category: CATS.includes(r.category as Category) ? (r.category as Category) : 'sight',
    time: typeof r.start === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(r.start) ? r.start : undefined,
    duration: Number.isFinite(duration) ? Math.min(600, Math.max(15, duration)) : 60,
    cost: Number.isFinite(cost) && cost > 0 ? cost : undefined,
    note: note || undefined,
  }
}

export interface AiTripInput { city: string; country?: string; lat?: number; lng?: number; start: string; end: string; pace: string; interests: Category[] }

/** 여행 전체 일정을 Gemini에게 받는다. 날짜 수는 여행 기간에 맞춘다 */
export async function aiPlanTrip(i: AiTripInput): Promise<Day[]> {
  const data = await call<{ days?: { items?: Raw[] }[] }>({ mode: 'trip', ...i })
  const center = i.lat !== undefined && i.lng !== undefined ? { lat: i.lat, lng: i.lng } : undefined
  const days = dateRange(i.start, i.end).map((date, k) => ({
    date,
    items: (data.days?.[k]?.items ?? []).map((r) => toPlace(r, center)).filter((p): p is Place => Boolean(p))
      .sort((a, b) => (a.time ?? '99').localeCompare(b.time ?? '99')),
  }))
  if (!days.some((d) => d.items.length)) throw new AiError('bad_output')
  return days
}

/** 그 날 동선 가까이에서 더 갈 만한 곳을 받는다 */
export async function aiSuggest(trip: Trip, dayIndex: number): Promise<Place[]> {
  const items = trip.days[dayIndex]?.items ?? []
  const near = items.length
    ? { lat: items.reduce((s, p) => s + p.lat, 0) / items.length, lng: items.reduce((s, p) => s + p.lng, 0) / items.length }
    : { lat: trip.lat, lng: trip.lng }
  const data = await call<{ items?: Raw[] }>({
    mode: 'more', city: trip.city, country: trip.country, near,
    exclude: trip.days.flatMap((d) => d.items.map((p) => p.name)),
  })
  const have = new Set(trip.days.flatMap((d) => d.items.map((p) => p.name)))
  const out = (data.items ?? []).map((r) => toPlace(r, trip)).filter((p): p is Place => Boolean(p) && !have.has(p!.name))
  if (!out.length) throw new AiError('bad_output')
  // 이 화면에서는 시각을 쓰지 않는다: 넣을 때 앞 장소에 이어서 정한다
  return out.map((p) => ({ ...p, time: undefined }))
}
