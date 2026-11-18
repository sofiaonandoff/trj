import type { Day, JournalEntry, Place, Trip } from '../types'
import { dateRange } from './util'

/** 여행 기본 정보: 한 묶음으로 나중에 고친 쪽을 따른다 */
const META = ['title', 'city', 'country', 'destId', 'lat', 'lng', 'start', 'end', 'currency', 'rate', 'rates', 'base', 'ratesEdited', 'budget', 'legs'] as const
const metaSig = (t: Trip) => JSON.stringify(META.map((k) => t[k] ?? null))

type Entity = { id: string; u?: number }
const sig = (x: object) => JSON.stringify({ ...x, u: undefined })
const ids = (d?: Day) => (d?.items ?? []).map((p) => p.id).join(',')
const places = (t: Trip) => new Map(t.days.flatMap((d) => d.items.map((p) => [p.id, { p, date: d.date }] as const)))

/**
 * 고친 뒤(next)를 고치기 전(prev)과 견주어, 바뀐 항목에 시각을 찍고 지운 항목을 기록한다.
 * 화면 코드가 일일이 시각을 챙기지 않아도 병합에 필요한 정보가 남는다.
 */
export function stamp(prev: Trip, next: Trip, now = Date.now()) {
  const del = (next.deleted ??= {})
  const track = (a: Entity[], b: Entity[]) => {
    const old = new Map(a.map((x) => [x.id, sig(x)]))
    for (const x of b) if (old.get(x.id) !== sig(x)) x.u = now
    const kept = new Set(b.map((x) => x.id))
    for (const x of a) if (!kept.has(x.id)) del[x.id] = now
  }
  track(prev.flights, next.flights)
  track(prev.stays ?? [], next.stays ?? [])
  track(prev.members, next.members)
  track(prev.expenses, next.expenses)
  track(prev.checklist, next.checklist)

  // 장소는 어느 날에 있는지까지 내용으로 본다 (다른 날로 옮기면 고친 것)
  const before = places(prev), after = places(next)
  for (const [id, { p, date }] of after) {
    const o = before.get(id)
    if (!o || o.date !== date || sig(o.p) !== sig(p)) p.u = now
  }
  for (const id of before.keys()) if (!after.has(id)) del[id] = now

  for (const d of next.days) if (ids(prev.days.find((x) => x.date === d.date)) !== ids(d)) d.u = now
  for (const [date, j] of Object.entries(next.journal)) if ((prev.journal[date]?.text ?? '') !== j.text) j.u = now
  for (const [date, j] of Object.entries(prev.journal)) {
    const kept = new Set(next.journal[date]?.photos ?? [])
    for (const k of j.photos) if (k.startsWith('drive:') && !kept.has(k)) del[k] = now
  }
  if (metaSig(prev) !== metaSig(next)) next.metaU = now
  if (content(prev) !== content(next)) next.updatedAt = now
}

/** 기기 사이에 오가는 내용만 남긴다: 동기화 상태와 사진 키(이 기기 전용)는 뺀다 */
export function shared(t: Trip): Trip {
  const { drive: _drive, ...rest } = t
  return { ...rest, journal: Object.fromEntries(Object.entries(t.journal).map(([k, v]) => [k, { ...v, photos: v.photos.filter((p) => p.startsWith('drive:')) }])) }
}

const byId = <T extends Entity>(a: T[]) => [...a].sort((x, y) => x.id.localeCompare(y.id))
/** 내용 비교용 표준 형태. 순서가 의미 없는 목록은 id 순으로 놓는다. */
function content(t: Trip) {
  const s = shared(t)
  return JSON.stringify({
    meta: META.map((k) => s[k]), days: s.days.map((d) => [d.date, d.items]),
    flights: byId(s.flights), stays: byId(s.stays ?? []), members: byId(s.members), expenses: byId(s.expenses), checklist: byId(s.checklist),
    journal: Object.entries(s.journal).filter(([, v]) => v.text || v.photos.length).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, v.text, v.photos]),
  })
}
export const sameContent = (a: Trip, b: Trip) => content(a) === content(b)

/**
 * 같은 여행의 두 사본을 합친다.
 * - 서로 다른 항목을 고쳤으면 둘 다 남는다.
 * - 같은 항목을 둘 다 고쳤으면 나중에 고친 쪽이 남는다.
 * - 한쪽에서 지운 항목은, 그 뒤에 다른 쪽에서 고치지 않았다면 지워진다.
 */
export function mergeTrips(local: Trip, remote: Trip): Trip {
  const deleted: Record<string, number> = { ...(remote.deleted ?? {}) }
  for (const [id, t] of Object.entries(local.deleted ?? {})) deleted[id] = Math.max(deleted[id] ?? 0, t)
  const alive = (x: Entity) => !(x.id in deleted) || deleted[x.id] < (x.u ?? 0)

  const list = <T extends Entity>(a: T[], b: T[]): T[] => {
    const m = new Map(a.map((x) => [x.id, x]))
    for (const x of b) { const cur = m.get(x.id); if (!cur || (x.u ?? 0) > (cur.u ?? 0)) m.set(x.id, x) }
    return [...m.values()].filter(alive)
  }

  const meta = (remote.metaU ?? 0) > (local.metaU ?? 0) ? remote : local
  const out: Trip = { ...local, deleted }
  for (const k of META) (out as unknown as Record<string, unknown>)[k] = meta[k]
  out.metaU = meta.metaU
  out.flights = list(local.flights, remote.flights).sort((a, b) => `${a.depDate}${a.depTime}`.localeCompare(`${b.depDate}${b.depTime}`))
  const stays = list(local.stays ?? [], remote.stays ?? []).sort((a, b) => `${a.checkIn}${a.id}`.localeCompare(`${b.checkIn}${b.id}`))
  if (stays.length || local.stays || remote.stays) out.stays = stays
  out.members = list(local.members, remote.members)
  out.expenses = list(local.expenses, remote.expenses)
  out.checklist = list(local.checklist, remote.checklist)

  // 장소: 항목별로 나중에 고친 쪽의 내용과 날짜를 따른다
  const win = new Map<string, { p: Place; date: string }>()
  for (const [id, v] of places(local)) win.set(id, v)
  for (const [id, v] of places(remote)) { const cur = win.get(id); if (!cur || (v.p.u ?? 0) > (cur.p.u ?? 0)) win.set(id, v) }
  for (const [id, v] of win) if (!alive(v.p)) win.delete(id)

  const dates = dateRange(out.start, out.end)
  const lastDate = dates[dates.length - 1]
  const placed = new Set<string>()
  out.days = dates.map((date) => {
    const l = local.days.find((d) => d.date === date), r = remote.days.find((d) => d.date === date)
    // 순서는 그 날을 나중에 정리한 쪽을 따르고, 다른 쪽에서 새로 넣은 장소는 뒤에 붙인다
    const [first, second] = (r?.u ?? 0) > (l?.u ?? 0) ? [r, l] : [l, r]
    const order = [...(first?.items ?? []), ...(second?.items ?? [])].map((p) => p.id)
    const items: Place[] = []
    for (const id of order) {
      const v = win.get(id)
      if (v && v.date === date && !placed.has(id)) { items.push(v.p); placed.add(id) }
    }
    return { date, items, u: Math.max(l?.u ?? 0, r?.u ?? 0) || undefined }
  })
  // 기간이 줄어 갈 곳이 없어진 장소는 마지막 날에 둔다
  for (const [id, v] of win) {
    if (placed.has(id)) continue
    ;(out.days.find((d) => d.date === v.date) ?? out.days.find((d) => d.date === lastDate)!).items.push(v.p)
  }

  // 기록: 글은 나중에 쓴 쪽, 사진은 이 기기 것을 그대로 둔다
  const journal: Record<string, JournalEntry> = {}
  for (const date of new Set([...Object.keys(local.journal), ...Object.keys(remote.journal)])) {
    const l = local.journal[date], r = remote.journal[date]
    const text = r && (r.u ?? 0) > (l?.u ?? 0) ? r : l ?? r!
    // 사진: 이 기기의 사진에 다른 쪽에서 백업한 사진을 더한다. 어느 쪽에서든 지운 사진은 뺀다
    const photos = [...(l?.photos ?? [])]
    for (const k of r?.photos ?? []) if (k.startsWith('drive:') && !photos.includes(k)) photos.push(k)
    journal[date] = { text: text.text, u: text.u, photos: photos.filter((k) => !(k in deleted)) }
  }
  out.journal = journal
  out.updatedAt = Math.max(local.updatedAt ?? local.createdAt, remote.updatedAt ?? remote.createdAt)
  return out
}
