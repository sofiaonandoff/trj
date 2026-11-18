import { AIRPORTS } from '../data/airports'
import { lang, tr } from '../i18n'
import { EN } from '../i18n.en'
import type { Category } from '../types'

export interface GeoResult {
  name: string
  /** 현지 표기 (이름과 다를 때만). 예: ท่าอากาศยานสุวรรณภูมิ */
  local?: string
  detail: string
  lat: number
  lng: number
  country: string
  category: Category
  /** 앱에 들어 있는 공항 목록에서 찾은 결과 */
  airport?: string
}

const guess = (cls: string, type: string): Category => {
  if (/restaurant|fast_food|food_court|bar|pub/.test(type)) return 'food'
  if (/cafe|bakery/.test(type)) return 'cafe'
  if (cls === 'shop' || /mall|marketplace/.test(type)) return 'shop'
  if (/park|garden|beach|peak|forest|nature/.test(type) || cls === 'natural') return 'nature'
  if (/museum|gallery|temple|shrine|place_of_worship|theatre|castle/.test(type)) return 'culture'
  if (/hotel|hostel|guest_house|apartment/.test(type)) return 'stay'
  return 'sight'
}

const norm = (s: string) => s.toLowerCase().normalize('NFKC')
const AIRPORT_WORDS = /\b(airport|international|intl|int'l)\b|국제공항|공항/g

/**
 * 앱에 들어 있는 공항 목록에서 먼저 찾는다. 한국어·영어 이름과 공항 코드로 찾을 수 있다.
 * 예: "bangkok airport", "방콕 공항", "BKK"
 */
export function searchAirports(q: string): GeoResult[] {
  const query = norm(q)
  const words = query.replace(AIRPORT_WORDS, ' ').split(/\s+/).filter(Boolean)
  const askedAirport = AIRPORT_WORDS.test(query) || /^[a-z]{3}$/i.test(q.trim())
  AIRPORT_WORDS.lastIndex = 0
  if (!words.length && !askedAirport) return []
  const enOf = (ko: string) => EN[ko] ?? ''
  return AIRPORTS.filter((a) => {
    // 화면 언어와 상관없이 두 언어 이름을 모두 본다 (데이터는 한국어 이름이 열쇠다)
    const koCity = Object.keys(EN).find((k) => EN[k] === a.city) ?? a.city
    const koName = Object.keys(EN).find((k) => EN[k] === a.name) ?? a.name
    const hay = norm([a.code, a.city, a.name, koCity, koName, enOf(koCity), enOf(koName)].join(' '))
    if (/^[a-z]{3}$/.test(query.trim()) && a.code.toLowerCase() === query.trim()) return true
    return askedAirport && words.every((w) => hay.includes(w))
  }).map((a) => ({
    name: `${a.name} (${a.code})`, detail: `${a.city} · ${tr('공항')}`, lat: a.lat, lng: a.lng, country: '', category: 'sight' as Category, airport: a.code,
  }))
}

type Row = {
  name?: string; display_name: string; lat: string; lon: string; category?: string; type?: string
  address?: { country?: string }; namedetails?: Record<string, string>
}

/**
 * OpenStreetMap Nominatim으로 장소를 찾는다. near가 있으면 그 주변 결과를 먼저 보여 준다.
 * 현지 문자(태국어 등)로만 등록된 곳도 고른 언어 → 영어 → 국제 표기 순으로 읽을 수 있는 이름을 쓴다.
 */
export async function searchPlaces(q: string, near?: { lat: number; lng: number }, signal?: AbortSignal): Promise<GeoResult[]> {
  const u = new URL('https://nominatim.openstreetmap.org/search')
  u.search = new URLSearchParams({ format: 'jsonv2', limit: '8', 'accept-language': `${lang},en`, addressdetails: '1', namedetails: '1', q }).toString()
  if (near) u.searchParams.set('viewbox', `${near.lng - 0.7},${near.lat + 0.7},${near.lng + 0.7},${near.lat - 0.7}`)
  const res = await fetch(u, { signal })
  if (!res.ok) throw new Error(`검색 서버 응답 ${res.status}`)
  const rows = (await res.json()) as Row[]
  const found = rows.map((r): GeoResult => {
    const parts = r.display_name.split(', ')
    const nd = r.namedetails ?? {}
    const local = nd.name ?? r.name ?? parts[0]
    const name = nd[`name:${lang}`] ?? nd['name:en'] ?? nd.int_name ?? nd['official_name:en'] ?? r.name ?? parts[0]
    return {
      name, local: local && local !== name ? local : undefined,
      detail: parts.slice(1, 4).join(', '), lat: Number(r.lat), lng: Number(r.lon),
      country: r.address?.country ?? '', category: guess(r.category ?? '', r.type ?? ''),
    }
  })
  // 앱이 아는 공항은 맨 위에, 같은 공항이 검색 결과에 또 나오면 빼낸다
  const known = searchAirports(q)
  return [...known, ...found.filter((f) => !known.some((k) => Math.abs(k.lat - f.lat) < 0.03 && Math.abs(k.lng - f.lng) < 0.03))]
}

/** 사진의 GPS 위치에 있는 가게·명소 이름을 찾는다 (AI가 사진을 못 읽을 때 쓴다) */
export async function reverseGeocode(lat: number, lng: number): Promise<GeoResult | null> {
  const u = new URL('https://nominatim.openstreetmap.org/reverse')
  u.search = new URLSearchParams({ format: 'jsonv2', lat: String(lat), lon: String(lng), zoom: '18', 'accept-language': `${lang},en`, namedetails: '1', addressdetails: '1' }).toString()
  const res = await fetch(u)
  if (!res.ok) return null
  const r = (await res.json()) as Row & { error?: string }
  if (r.error) return null
  const nd = r.namedetails ?? {}
  const parts = r.display_name.split(', ')
  const name = nd[`name:${lang}`] ?? nd['name:en'] ?? nd.int_name ?? r.name ?? parts[0]
  return { name, detail: parts.slice(1, 4).join(', '), lat, lng, country: r.address?.country ?? '', category: guess(r.category ?? '', r.type ?? '') }
}

/** 화면 언어로 읽을 수 없는 이름인가 (한국어 화면에 한글이 없거나, 영어 화면에 라틴 문자가 아닌 글자가 있으면) */
export const needsLocalName = (name: string) => (lang === 'ko' ? !/[가-힣]/.test(name) : /[^\p{Script=Latin}\p{N}\p{P}\p{S}\s]/u.test(name))

/**
 * 검색 결과 이름을 화면 언어로 바꾼다. 지도에 한국어(영어) 이름이 없는 곳은 trj assistant에게 표기를 받아 쓰고,
 * 원래 이름은 local에 남긴다. AI를 쓸 수 없으면 그대로 돌려준다.
 */
export async function localizeResults(rows: GeoResult[], city?: string): Promise<GeoResult[]> {
  const idx = rows.map((r, i) => (!r.airport && needsLocalName(r.name) ? i : -1)).filter((i) => i >= 0)
  if (!idx.length) return rows
  const { aiLocalizeNames } = await import('./ai')
  const names = await aiLocalizeNames(idx.map((i) => rows[i].name), city).catch(() => null)
  if (!names) return rows
  const out = rows.slice()
  idx.forEach((i, k) => {
    const n = names[k]
    if (n && n !== rows[i].name && !needsLocalName(n)) out[i] = { ...rows[i], name: n, local: rows[i].local ?? rows[i].name }
  })
  return out
}
