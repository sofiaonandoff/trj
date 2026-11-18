import { useSyncExternalStore } from 'react'
import { lang } from '../i18n'
import { AiError, call } from './ai'

/**
 * 함께 쓰는 여행의 글을 보는 사람의 화면 언어로 보여 준다 (저장된 글은 그대로 두고 보여 줄 때만 바꾼다).
 * 영어 화면에서는 한글이 든 글을, 한국어 화면에서는 한글이 없는 영어 글을 옮긴다.
 * 옮긴 결과는 이 기기에 저장해 두고 다시 묻지 않는다. 고치는 칸에는 원래 글이 그대로 나온다.
 */
const KEY = 'trj-translations-v1'
const OFF = 'trj-translate-off'
const MAX = 3000

let cache: Record<string, string> = (() => { try { return JSON.parse(localStorage.getItem(KEY) ?? '{}') } catch { return {} } })()
let version = 0
const listeners = new Set<() => void>()
const emit = () => { version++; listeners.forEach((f) => f()) }
const k = (text: string) => `${lang}\u0001${text}`

export const translateOn = () => { try { return localStorage.getItem(OFF) !== '1' } catch { return true } }
export function setTranslateOn(on: boolean) {
  try { if (on) localStorage.removeItem(OFF); else localStorage.setItem(OFF, '1') } catch { /* 저장 못 해도 이번엔 반영 */ }
  emit()
}

/** 이 글을 옮겨야 하나 */
export function needs(text: string | undefined): text is string {
  if (!text || text.length < 2) return false
  const t = text.trim()
  if (lang === 'en') return /[가-힣]/.test(t)
  // 한국어 화면: 한글이 없고 영어 낱말이 있는 글 (예약번호·편명·주소처럼 보이는 것은 그대로)
  if (/[가-힣]/.test(t) || !/[A-Za-z]{3,}/.test(t)) return false
  if (/^[A-Z0-9 \-/:.,#]+$/.test(t)) return false
  return true
}

/* 옮길 글을 모았다가 한 번에 묻는다 */
const queue = new Set<string>()
let timer: ReturnType<typeof setTimeout> | undefined
let pausedUntil = 0
const failed = new Set<string>()

function schedule() {
  clearTimeout(timer)
  timer = setTimeout(flush, 600)
}
async function flush() {
  if (Date.now() < pausedUntil) return
  const batch = [...queue].slice(0, 40)
  if (!batch.length) return
  batch.forEach((t) => queue.delete(t))
  try {
    const data = await call<{ texts?: unknown[] }>({ mode: 'texts', texts: batch })
    const got = Array.isArray(data.texts) ? data.texts : []
    if (got.length === batch.length) {
      batch.forEach((t, i) => { const v = typeof got[i] === 'string' ? (got[i] as string).trim() : ''; if (v) cache[k(t)] = v; else failed.add(k(t)) })
      const keys = Object.keys(cache)
      if (keys.length > MAX) cache = Object.fromEntries(keys.slice(keys.length - MAX).map((x) => [x, cache[x]]))
      try { localStorage.setItem(KEY, JSON.stringify(cache)) } catch { /* 저장 공간이 차면 이번 실행에서만 */ }
      emit()
    } else batch.forEach((t) => failed.add(k(t)))
  } catch (e) {
    // 한도 초과·키 없음이면 30분 동안 묻지 않는다. 그동안은 원래 글을 보여 준다
    if (e instanceof AiError && ['quota', 'not_configured', 'auth'].includes(e.code)) pausedUntil = Date.now() + 30 * 60_000
    else batch.forEach((t) => failed.add(k(t)))
  }
  if (queue.size) schedule()
}

/** 보여 줄 글: 옮긴 것이 있으면 그것, 없으면 원래 글 (그리고 옮겨 달라고 줄을 세운다) */
export function tx(text: string): string
export function tx(text: string | undefined): string | undefined
export function tx(text: string | undefined): string | undefined {
  if (!needs(text) || !translateOn()) return text
  const hit = cache[k(text)]
  if (hit) return hit
  if (!failed.has(k(text)) && !queue.has(text)) { queue.add(text); schedule() }
  return text
}

/** 옮긴 글이 도착하면 다시 그리게 한다. 화면 컴포넌트에서 한 번 부른다 */
export function useTranslations() {
  useSyncExternalStore((f) => { listeners.add(f); return () => { listeners.delete(f) } }, () => version)
  return tx
}
