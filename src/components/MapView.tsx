import { LngLatBounds, Map as MLMap, Marker, setWorkerUrl } from 'maplibre-gl'
// 번들 후에도 지도 워커를 찾을 수 있게 워커를 따로 묶어 주소를 넘긴다
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useEffect, useRef, useState } from 'react'

export interface MapPoint { lat: number; lng: number; label: string; air?: boolean; stay?: boolean; title?: string }
interface Props {
  points: MapPoint[]
  /** 항공편 대권 경로 ([lng, lat][]) */
  arcs?: [number, number][][]
  /** 땅 위 동선 ([lng, lat][] 구간들). 없으면 장소를 순서대로 잇는다 */
  route?: [number, number][][]
  center: { lat: number; lng: number }
  onPick?: (index: number) => void
}

setWorkerUrl(workerUrl)

/** 숙소 핀 (lucide bed-double 모양) */
const BED = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 20v-8a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v8"/><path d="M4 10V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v4"/><path d="M12 4v6"/><path d="M2 18h20"/></svg>'

const line = (coords: [number, number][][]) => ({
  type: 'FeatureCollection' as const,
  features: coords.filter((c) => c.length > 1).map((c) => ({ type: 'Feature' as const, properties: {}, geometry: { type: 'LineString' as const, coordinates: c } })),
})

/** 지도 타일은 OpenFreeMap(OpenStreetMap 데이터)을 쓴다. API 키가 필요 없다. */
export default function MapView({ points, arcs = [], route, center, onPick }: Props) {
  const el = useRef<HTMLDivElement>(null)
  const map = useRef<MLMap | null>(null)
  const markers = useRef<Marker[]>([])
  const [ready, setReady] = useState(false)
  const pick = useRef(onPick)
  pick.current = onPick

  useEffect(() => {
    if (!el.current) return
    const dark = matchMedia('(prefers-color-scheme: dark)').matches
    const m = new MLMap({
      container: el.current,
      style: `https://tiles.openfreemap.org/styles/${dark ? 'dark' : 'positron'}`,
      center: [center.lng, center.lat], zoom: 10.5, attributionControl: { compact: true },
      dragRotate: false, pitchWithRotate: false,
    })
    m.touchZoomRotate.disableRotation()
    m.on('load', () => {
      m.addSource('route', { type: 'geojson', data: line([]) })
      m.addSource('arcs', { type: 'geojson', data: line([]) })
      m.addLayer({ id: 'route-case', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': dark ? '#1C2C29' : '#F8F6F1', 'line-width': 7, 'line-opacity': 0.9 } })
      m.addLayer({ id: 'route', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': dark ? '#D2B698' : '#1C2C29', 'line-width': 3.5 } })
      m.addLayer({ id: 'arcs', type: 'line', source: 'arcs', layout: { 'line-cap': 'round' }, paint: { 'line-color': dark ? '#D2B698' : '#8F6E4B', 'line-width': 2.5, 'line-dasharray': [0.5, 2.2] } })
      setReady(true)
    })
    map.current = m
    return () => { m.remove(); map.current = null; setReady(false) }
    // 지도는 한 번만 만든다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const key = JSON.stringify([points, arcs, route])
  useEffect(() => {
    const m = map.current
    if (!m || !ready) return
    const places = points.filter((p) => !p.air)
    ;(m.getSource('route') as unknown as { setData: (d: unknown) => void }).setData(line(route ?? [places.map((p) => [p.lng, p.lat])]))
    ;(m.getSource('arcs') as unknown as { setData: (d: unknown) => void }).setData(line(arcs))
    markers.current.forEach((k) => k.remove())
    markers.current = points.map((p, i) => {
      const node = document.createElement('button')
      node.className = `pin${p.air ? ' air' : ''}${p.stay ? ' stay' : ''}`
      if (p.stay) node.innerHTML = BED
      else node.textContent = p.label
      node.setAttribute('aria-label', p.title ?? p.label)
      node.onclick = () => pick.current?.(i)
      return new Marker({ element: node }).setLngLat([p.lng, p.lat]).addTo(m)
    })
    // 장소가 있으면 장소에, 없으면 항공 경로에 화면을 맞춘다
    const focus = places.length ? places : points
    if (focus.length === 1) m.easeTo({ center: [focus[0].lng, focus[0].lat], zoom: focus[0].air ? 9 : 13.5, duration: 600 })
    else if (focus.length > 1) {
      const b = new LngLatBounds()
      focus.forEach((p) => b.extend([p.lng, p.lat]))
      m.fitBounds(b, { padding: { top: 48, bottom: 40, left: 44, right: 44 }, maxZoom: 14.5, duration: 700 })
    } else m.easeTo({ center: [center.lng, center.lat], zoom: 10.5, duration: 600 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ready])

  return <div ref={el} className="map" />
}
