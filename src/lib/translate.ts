import { useSyncExternalStore } from 'react'
import { lang, type Lang } from '../i18n'
import { useStore } from '../store'
import type { Trip } from '../types'
import { savedViewLink } from './viewLink'

/**
 * 함께 쓰는 여행의 글을 보는 사람의 화면 언어로 보여 준다 (저장된 원래 글은 그대로, 보여 줄 때만 바꾼다).
 * 영어 화면에서는 한글이 든 글을, 한국어 화면에서는 한글이 없는 영어 글을 옮긴다. 고치는 칸에는 원래 글이 나온다.
 *
 * 빨리 보이도록 네 곳을 차례로 본다.
 *  1. 여행 파일 안의 번역 (Trip.tx): 글을 쓴 기기가 미리 만들어 넣어 둔다 → 동기화와 함께 바로 보인다
 *  2. 이 기기에 저장해 둔 번역
 *  3. 브라우저의 기기 안 번역 (크롬의 Translator API, 인터넷 없이 즉시)
 *  4. 앱 서버 /api/translate (Cloudflare Workers AI, 없으면 Gemini)
 */
/** 번역 방식의 판 (Workers AI Gemma 3). 판이 바뀌면 이 기기와 여행 파일의 예전 번역을 버린다 */
export const TXV = 2
const KEY = `trj-translations-v${TXV}`
const OFF = 'trj-translate-off'
const MAX = 3000

try { localStorage.removeItem('trj-translations-v1') } catch { /* 예전 번역(품질이 나쁜 판)은 버린다 */ }
let cache: Record<string, string> = (() => { try { return JSON.parse(localStorage.getItem(KEY) ?? '{}') } catch { return {} } })()
let version = 0
const listeners = new Set<() => void>()
const emit = () => { version++; listeners.forEach((f) => f()) }
const ck = (to: Lang, text: string) => `${to}\u0001${text}`
const saveCache = () => {
  const keys = Object.keys(cache)
  if (keys.length > MAX) cache = Object.fromEntries(keys.slice(keys.length - MAX).map((x) => [x, cache[x]]))
  try { localStorage.setItem(KEY, JSON.stringify(cache)) } catch { /* 저장 공간이 차면 이번 실행에서만 */ }
}

export const translateOn = () => { try { return localStorage.getItem(OFF) !== '1' } catch { return true } }
export function setTranslateOn(on: boolean) {
  try { if (on) localStorage.removeItem(OFF); else localStorage.setItem(OFF, '1') } catch { /* 이번 실행에서만 */ }
  emit()
}

/** 이 글을 to 언어로 옮겨야 하나 */
export function needsFor(text: string | undefined, to: Lang): text is string {
  if (!text || text.trim().length < 2) return false
  const t = text.trim()
  if (to === 'en') return /[가-힣]/.test(t)
  if (/[가-힣]/.test(t) || !/[A-Za-z]{3,}/.test(t)) return false
  // 예약번호·편명·코드처럼 대문자·숫자뿐인 글은 그대로
  return !/^[A-Z0-9 \-/:.,#]+$/.test(t)
}
export const needs = (text: string | undefined): text is string => needsFor(text, lang)

/* ── 여행 파일 안의 번역 ── */
let tripTx = new Map<string, { en?: string; ko?: string }>()
const extra = new Map<string, Trip['tx']>()
function rebuild() {
  const m = new Map<string, { en?: string; ko?: string }>()
  for (const t of [...useStore.getState().trips.filter((x) => x.txv === TXV).map((x) => x.tx), ...extra.values()]) for (const [k, v] of Object.entries(t ?? {})) m.set(k, { ...m.get(k), ...v })
  tripTx = m
  emit()
}
let lastTrips: unknown
useStore.subscribe((s) => { if (s.trips !== lastTrips) { lastTrips = s.trips; rebuild() } })
// 저장소에서 바로 불러온 여행들의 번역도 처음부터 쓴다
lastTrips = useStore.getState().trips
rebuild()
/** 보기 링크처럼 이 기기에 저장되지 않은 여행의 번역도 쓴다 */
export function useTripTranslations(trip: Trip | null | undefined) {
  const id = trip?.id
  const txs = trip?.txv === TXV ? trip.tx : undefined
  if (id && extra.get(id) !== txs) { extra.set(id, txs); queueMicrotask(rebuild) }
}

/* ── 기기 안 번역 (크롬 Translator API) ── */
type Tr = { translate: (s: string) => Promise<string> }
const local = new Map<string, Promise<Tr | null>>()
function onDevice(from: Lang, to: Lang): Promise<Tr | null> {
  const key = `${from}>${to}`
  let p = local.get(key)
  if (!p) {
    p = (async () => {
      const T = (globalThis as { Translator?: { availability: (o: object) => Promise<string>; create: (o: object) => Promise<Tr> } }).Translator
      if (!T) return null
      const opt = { sourceLanguage: from, targetLanguage: to }
      // 이미 받아 둔 언어 모델만 쓴다 (받기는 사용자 동작이 필요하다)
      if ((await T.availability(opt).catch(() => 'unavailable')) !== 'available') return null
      return T.create(opt).catch(() => null)
    })()
    local.set(key, p)
  }
  return p
}

/** 여러 글을 to 언어로 옮긴다. 옮기지 못한 것은 원래 글 그대로 */
export async function translateTexts(texts: string[], to: Lang): Promise<string[]> {
  const out: (string | undefined)[] = texts.map((t) => cache[ck(to, t)] ?? tripTx.get(t)?.[to])
  const from: Lang = to === 'en' ? 'ko' : 'en'
  const dev = await onDevice(from, to)
  if (dev) await Promise.all(texts.map(async (t, i) => { if (!out[i]) out[i] = await dev.translate(t).catch(() => undefined) }))
  const rest = texts.map((t, i) => (out[i] ? -1 : i)).filter((i) => i >= 0)
  for (let i = 0; i < rest.length; i += 40) {
    const part = rest.slice(i, i + 40)
    const r = await fetch('/api/translate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ texts: part.map((k) => texts[k]), target: to }) })
    if (!(r.headers.get('content-type') ?? '').includes('json')) throw new Error('not_configured')
    const data = await r.json()
    if (!r.ok) throw Object.assign(new Error(data?.error ?? 'upstream'), { code: data?.error })
    const got = Array.isArray(data.texts) ? data.texts : []
    part.forEach((k, j) => { if (typeof got[j] === 'string' && got[j].trim() && got[j].trim() !== texts[k]) out[k] = got[j].trim() })
  }
  texts.forEach((t, i) => { if (out[i]) cache[ck(to, t)] = out[i]! })
  saveCache()
  return texts.map((t, i) => out[i] ?? t)
}

/* ── 보여 줄 때: 없으면 모았다가 한 번에 묻는다 ── */
const queue = new Set<string>()
const failed = new Set<string>()
let timer: ReturnType<typeof setTimeout> | undefined
let pausedUntil = 0
let busy = 0
const schedule = (ms = 250) => { clearTimeout(timer); timer = setTimeout(flush, ms) }
async function flush() {
  if (Date.now() < pausedUntil || !queue.size) return
  const batch = [...queue].slice(0, 80)
  batch.forEach((t) => queue.delete(t))
  busy++; emit()
  try {
    const got = await translateTexts(batch, lang)
    batch.forEach((t, i) => { if (got[i] === t) failed.add(ck(lang, t)) })
  } catch (e) {
    const code = (e as { code?: string }).code ?? (e as Error).message
    // 한도 초과·설정 없음이면 30분 동안 묻지 않는다. 그동안은 원래 글을 보여 준다
    if (['quota', 'not_configured', 'auth'].includes(code)) pausedUntil = Date.now() + 30 * 60_000
    else batch.forEach((t) => failed.add(ck(lang, t)))
  } finally { busy--; emit() }
  if (queue.size) schedule()
}

const lookup = (text: string) => tripTx.get(text)?.[lang] ?? cache[ck(lang, text)]

/** 보여 줄 글: 옮긴 것이 있으면 그것, 없으면 원래 글 (그리고 옮겨 달라고 줄을 세운다) */
export function tx(text: string): string
export function tx(text: string | undefined): string | undefined
export function tx(text: string | undefined): string | undefined {
  if (!needs(text) || !translateOn()) return text
  const hit = lookup(text)
  if (hit) return hit
  if (!failed.has(ck(lang, text)) && !queue.has(text)) { queue.add(text); schedule() }
  return text
}

/** 여행의 옮길 글 */
export function tripTexts(t: Trip): string[] {
  const out = new Set<string>()
  const add = (s?: string) => { if (s && s.trim()) out.add(s) }
  add(t.title)
  for (const d of t.days) for (const p of d.items) { add(p.name); add(p.note) }
  for (const s of t.stays ?? []) { add(s.name); add(s.note) }
  for (const e of t.expenses) add(e.title)
  for (const c of t.checklist) { add(c.text); add(c.group) }
  return [...out]
}

/** 여행을 열 때 그 여행의 글을 한꺼번에 옮겨 달라고 한다 (탭을 넘길 때마다 조금씩 묻지 않게) */
export function prefetchTrip(t: Trip | null | undefined) {
  if (!t || !translateOn()) return
  let added = false
  for (const s of tripTexts(t)) if (needs(s) && !lookup(s) && !failed.has(ck(lang, s)) && !queue.has(s)) { queue.add(s); added = true }
  if (added) schedule(0)
}

/** 옮기는 중인가 (화면에 '번역 중' 표시) */
export const translating = () => busy > 0 || queue.size > 0

/** 옮긴 글이 도착하면 다시 그리게 한다. 화면 컴포넌트에서 한 번 부른다 */
export function useTranslations() {
  useSyncExternalStore((f) => { listeners.add(f); return () => { listeners.delete(f) } }, () => version)
  return tx
}

/* ── 글을 쓴 기기가 번역을 여행 파일에 넣어 둔다 ── */
/**
 * 함께 쓰는 여행(Drive 함께 편집 또는 보기 링크)에 한글 글이 있으면 영어 번역을, 영어 글이 있으면 한국어 번역을 만들어
 * Trip.tx에 넣는다. 동기화로 다른 사람에게 원래 글과 함께 가므로, 받는 사람은 번역을 기다리지 않는다.
 * 이미 있는 번역은 다시 만들지 않고, 여행에서 없어진 글의 번역은 지운다.
 */
let writerStarted = false
export function initTripTranslations() {
  if (writerStarted) return
  writerStarted = true
  let t2: ReturnType<typeof setTimeout> | undefined
  let running = false
  const run = async () => {
    if (running || Date.now() < pausedUntil) return
    running = true
    try {
      for (const trip of useStore.getState().trips) {
        const shared = Boolean(trip.drive?.role || savedViewLink(trip.id))
        if (!shared) continue
        const texts = tripTexts(trip)
        const tx = trip.txv === TXV ? trip.tx ?? {} : {}
        const want: Record<Lang, string[]> = { en: [], ko: [] }
        for (const s of texts) for (const to of ['en', 'ko'] as Lang[]) if (needsFor(s, to) && !tx[s]?.[to]) want[to].push(s)
        const stale = Object.keys(tx).filter((k) => !texts.includes(k))
        if (!want.en.length && !want.ko.length && !stale.length && trip.txv === TXV) continue
        const got: Record<string, { en?: string; ko?: string }> = {}
        for (const to of ['en', 'ko'] as Lang[]) {
          if (!want[to].length) continue
          const res = await translateTexts(want[to].slice(0, 80), to)
          want[to].slice(0, 80).forEach((s, i) => { if (res[i] && res[i] !== s) got[s] = { ...got[s], [to]: res[i] } })
        }
        if (!Object.keys(got).length && !stale.length && trip.txv === TXV) continue
        useStore.getState().mutate(trip.id, (t) => {
          const next: NonNullable<Trip['tx']> = {}
          const keep = new Set(tripTexts(t))
          for (const [k, v] of Object.entries(t.txv === TXV ? t.tx ?? {} : {})) if (keep.has(k)) next[k] = v
          for (const [k, v] of Object.entries(got)) if (keep.has(k)) next[k] = { ...next[k], ...v }
          t.tx = Object.keys(next).length ? next : undefined
          t.txv = TXV
        })
      }
    } catch (e) {
      const code = (e as { code?: string }).code ?? (e as Error).message
      if (['quota', 'not_configured', 'auth'].includes(code)) pausedUntil = Date.now() + 30 * 60_000
    } finally { running = false }
  }
  useStore.subscribe((s, prev) => { if (s.trips !== prev.trips) { clearTimeout(t2); t2 = setTimeout(run, 2500) } })
  setTimeout(run, 3000)
}
