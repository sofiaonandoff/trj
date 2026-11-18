import { tr } from '../i18n'
import { useStore } from '../store'
import type { Trip } from '../types'
import { viewOf } from './share'

/**
 * 로그인 없이 보는 짧은 링크 (#/v/<id>). 일정은 앱 서버(/api/view)에 두고,
 * 만든 기기는 토큰을 이 기기에만 기억해 여행을 고칠 때마다 같은 링크의 내용을 새로 올린다.
 */
interface Saved { id: string; token: string; sent?: string }
const KEY = 'trj-view-links'
const read = (): Record<string, Saved> => { try { return JSON.parse(localStorage.getItem(KEY) ?? '{}') } catch { return {} } }
const write = (all: Record<string, Saved>) => { try { localStorage.setItem(KEY, JSON.stringify(all)) } catch { /* 저장 못 하면 다음에 새 링크 */ } }

export const shortViewLink = (id: string) => `${location.origin}${location.pathname}#/v/${id}`
export const savedViewLink = (tripId: string) => read()[tripId]

/** 서버에 보기 저장소가 없을 때 (Cloudflare에 KV를 아직 연결하지 않은 배포) */
export class NoViewServer extends Error {}

async function post(body: object) {
  const r = await fetch('/api/view', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  if (r.status === 503 || (r.status === 404 && !('id' in body))) throw new NoViewServer(tr('보기 링크 서버가 아직 준비되지 않았습니다'))
  if (r.status === 413) throw new Error(tr('여행이 너무 커서 보기 링크에 담지 못했습니다'))
  return r
}

/** 보기 링크를 만든다 (이미 있으면 그대로). 링크 id를 돌려준다 */
export async function createViewLink(t: Trip): Promise<string> {
  const have = read()[t.id]
  if (have) { await pushView(t.id); return have.id }
  const data = JSON.stringify(viewOf(t))
  const r = await post({ data: JSON.parse(data) })
  if (!r.ok) throw new Error(tr('보기 링크를 만들지 못했습니다'))
  const { id, token } = await r.json() as { id: string; token: string }
  write({ ...read(), [t.id]: { id, token, sent: data } })
  emit()
  return id
}

/** 바뀐 내용이 있으면 같은 링크에 새로 올린다 */
export async function pushView(tripId: string) {
  const all = read(), v = all[tripId]
  const t = useStore.getState().trips.find((x) => x.id === tripId)
  if (!v || !t) return
  const data = JSON.stringify(viewOf(t))
  if (data === v.sent) return
  const r = await post({ id: v.id, token: v.token, data: JSON.parse(data) })
  // 서버에서 지워졌으면(만료 등) 이 기기의 기록도 지운다
  if (r.status === 404 || r.status === 403) { const { [tripId]: _gone, ...rest } = read(); write(rest); emit(); return }
  if (r.ok) write({ ...read(), [tripId]: { ...v, sent: data } })
}

/** 보기 링크를 끈다: 전에 보낸 링크도 더는 열리지 않는다 */
export async function removeViewLink(tripId: string) {
  const v = read()[tripId]
  if (!v) return
  const r = await fetch(`/api/view/${v.id}`, { method: 'DELETE', headers: { 'X-View-Token': v.token } })
  if (!r.ok && r.status !== 404) throw new Error(tr('보기 링크를 끄지 못했습니다'))
  const { [tripId]: _gone, ...rest } = read(); write(rest); emit()
}

/** 받는 사람: 로그인 없이 받는다. 없거나 꺼졌으면 null */
export async function fetchShortView(id: string): Promise<{ trip: Trip; at: number } | null> {
  const r = await fetch(`/api/view/${encodeURIComponent(id)}`, { cache: 'no-store' })
  if (r.status === 404) return null
  if (!r.ok) throw new Error(tr('일정을 받지 못했습니다. 잠시 뒤 다시 열어 보세요'))
  const { data, at } = await r.json() as { data: Trip; at: number }
  return data && Array.isArray(data.days) ? { trip: data, at } : null
}

/* 보기 링크가 켜진 여행이 바뀌면 3초 뒤에 올린다 */
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((f) => f())
export const onViewLinks = (f: () => void) => { listeners.add(f); return () => { listeners.delete(f) } }

let started = false
export function initViewSync() {
  if (started) return
  started = true
  let timer: ReturnType<typeof setTimeout> | undefined
  const flush = () => { for (const id of Object.keys(read())) void pushView(id).catch(() => undefined) }
  useStore.subscribe((s, prev) => {
    if (s.trips === prev.trips) return
    clearTimeout(timer)
    timer = setTimeout(flush, 3000)
  })
  // 오프라인이었다가 돌아오면, 그리고 앱을 열 때 한 번
  addEventListener('online', flush)
  setTimeout(flush, 2000)
}
