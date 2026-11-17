import type { StyleSpecification } from 'maplibre-gl'

/** 내보내기 이미지 뒤에 깔 지도의 색 (템플릿마다 다르다) */
export interface MapTint { land: string; water: string; green: string; road: string; minor: string }

export interface MapSnapshot {
  image: HTMLCanvasElement
  /** 경도·위도를 이 이미지 위의 픽셀 좌표로 */
  project: (lng: number, lat: number) => [number, number]
}

/**
 * 글자 없는 지도: 땅, 물, 녹지, 도로만 그린다. 동선이 주인공이고 지도는 윤곽만 보인다.
 * 데이터는 OpenFreeMap(OpenStreetMap)의 벡터 타일. 글자를 쓰지 않으므로 글꼴 파일이 필요 없다.
 */
function style(t: MapTint): StyleSpecification {
  const roads = (classes: string[]) => ['match', ['get', 'class'], classes, true, false] as unknown as boolean
  return {
    version: 8,
    sources: { omt: { type: 'vector', url: 'https://tiles.openfreemap.org/planet' } },
    layers: [
      { id: 'land', type: 'background', paint: { 'background-color': t.land } },
      { id: 'green', type: 'fill', source: 'omt', 'source-layer': 'park', paint: { 'fill-color': t.green } },
      { id: 'wood', type: 'fill', source: 'omt', 'source-layer': 'landcover', filter: ['in', ['get', 'class'], ['literal', ['wood', 'grass', 'farmland']]], paint: { 'fill-color': t.green, 'fill-opacity': 0.6 } },
      { id: 'water', type: 'fill', source: 'omt', 'source-layer': 'water', paint: { 'fill-color': t.water } },
      { id: 'river', type: 'line', source: 'omt', 'source-layer': 'waterway', paint: { 'line-color': t.water, 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.6, 14, 3] } },
      {
        id: 'minor', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 11,
        filter: roads(['secondary', 'tertiary', 'minor']),
        paint: { 'line-color': t.minor, 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 0.4, 15, 2.2] },
      },
      {
        id: 'major', type: 'line', source: 'omt', 'source-layer': 'transportation',
        filter: roads(['motorway', 'trunk', 'primary']),
        paint: { 'line-color': t.road, 'line-width': ['interpolate', ['linear'], ['zoom'], 6, 0.5, 15, 4] },
      },
    ],
  }
}

/** 같은 그림을 여러 번 그리지 않도록 최근 결과를 기억해 둔다 */
const cache = new Map<string, Promise<MapSnapshot | null>>()

/**
 * 화면 밖에서 지도를 그려 이미지로 떠낸다.
 * 연결이 없거나 오래 걸리면 null을 돌려주고, 그때는 지도 없이 동선만 그린다.
 */
export type Pad = { top: number; bottom: number; left: number; right: number }

export function mapSnapshot(points: { lat: number; lng: number }[], w: number, h: number, pad: Pad, tint: MapTint): Promise<MapSnapshot | null> {
  if (!points.length || typeof document === 'undefined' || !navigator.onLine) return Promise.resolve(null)
  const key = JSON.stringify([points.map((p) => [p.lat.toFixed(5), p.lng.toFixed(5)]), w, h, pad, tint])
  const hit = cache.get(key)
  if (hit) return hit
  const job = render(points, Math.round(w), Math.round(h), pad, tint).catch(() => null)
  cache.set(key, job)
  if (cache.size > 24) cache.delete(cache.keys().next().value!)
  job.then((r) => { if (!r) cache.delete(key) })
  return job
}

async function render(points: { lat: number; lng: number }[], w: number, h: number, pad: Pad, tint: MapTint): Promise<MapSnapshot | null> {
  const { Map: MLMap, LngLatBounds } = await import('maplibre-gl')
  const box = document.createElement('div')
  box.style.cssText = `position:fixed;left:-${w + 200}px;top:0;width:${w}px;height:${h}px;pointer-events:none;visibility:hidden`
  document.body.appendChild(box)
  let map: InstanceType<typeof MLMap> | undefined
  try {
    map = new MLMap({
      container: box, style: style(tint), interactive: false, attributionControl: false, pixelRatio: 1, fadeDuration: 0,
      canvasContextAttributes: { preserveDrawingBuffer: true }, center: [points[0].lng, points[0].lat], zoom: 12,
    })
    const m = map
    const ready = new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), 9000)
      m.once('load', () => {
        if (points.length === 1) m.jumpTo({ center: [points[0].lng, points[0].lat], zoom: 13 })
        else {
          const b = new LngLatBounds()
          points.forEach((p) => b.extend([p.lng, p.lat]))
          m.fitBounds(b, { padding: pad, maxZoom: 14.5, animate: false })
        }
        m.once('idle', () => { clearTimeout(timer); resolve(true) })
      })
      m.once('error', () => { clearTimeout(timer); resolve(false) })
    })
    if (!(await ready)) return null
    // WebGL 캔버스를 보통 캔버스로 옮겨 두면 지도를 지운 뒤에도 그림이 남는다
    const image = document.createElement('canvas')
    image.width = w; image.height = h
    image.getContext('2d')!.drawImage(m.getCanvas(), 0, 0, w, h)
    // 지도를 지운 뒤에도 쓸 수 있게 점들의 화면 좌표를 미리 계산해 둔다
    const projected = new Map<string, [number, number]>()
    for (const p of points) { const q = m.project([p.lng, p.lat]); projected.set(`${p.lng},${p.lat}`, [q.x, q.y]) }
    return { image, project: (lng, lat) => projected.get(`${lng},${lat}`) ?? [NaN, NaN] }
  } finally {
    map?.remove()
    box.remove()
  }
}
