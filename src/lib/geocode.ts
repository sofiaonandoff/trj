import { lang } from '../i18n'
import type { Category } from '../types'

export interface GeoResult { name: string; detail: string; lat: number; lng: number; country: string; category: Category }

const guess = (cls: string, type: string): Category => {
  if (/restaurant|fast_food|food_court|bar|pub/.test(type)) return 'food'
  if (/cafe|bakery/.test(type)) return 'cafe'
  if (cls === 'shop' || /mall|marketplace/.test(type)) return 'shop'
  if (/park|garden|beach|peak|forest|nature/.test(type) || cls === 'natural') return 'nature'
  if (/museum|gallery|temple|shrine|place_of_worship|theatre|castle/.test(type)) return 'culture'
  if (/hotel|hostel|guest_house|apartment/.test(type)) return 'stay'
  return 'sight'
}

/** OpenStreetMap Nominatim으로 장소를 찾는다. near가 있으면 그 주변 결과를 먼저 보여 준다. */
export async function searchPlaces(q: string, near?: { lat: number; lng: number }, signal?: AbortSignal): Promise<GeoResult[]> {
  const u = new URL('https://nominatim.openstreetmap.org/search')
  u.search = new URLSearchParams({ format: 'jsonv2', limit: '8', 'accept-language': lang, addressdetails: '1', q }).toString()
  if (near) u.searchParams.set('viewbox', `${near.lng - 0.7},${near.lat + 0.7},${near.lng + 0.7},${near.lat - 0.7}`)
  const res = await fetch(u, { signal })
  if (!res.ok) throw new Error(`검색 서버 응답 ${res.status}`)
  const rows = (await res.json()) as { name?: string; display_name: string; lat: string; lon: string; category?: string; type?: string; address?: { country?: string } }[]
  return rows.map((r) => {
    const parts = r.display_name.split(', ')
    return {
      name: r.name || parts[0], detail: parts.slice(1, 4).join(', '), lat: Number(r.lat), lng: Number(r.lon),
      country: r.address?.country ?? '', category: guess(r.category ?? '', r.type ?? ''),
    }
  })
}
