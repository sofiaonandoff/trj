import { EN } from './i18n.en'

export type Lang = 'ko' | 'en'
const KEY = 'trj-lang'

/** 고른 언어가 있으면 그것을, 없으면 브라우저 언어가 한국어일 때만 한국어를 쓴다 */
function initial(): Lang {
  try { const saved = localStorage.getItem(KEY); if (saved === 'ko' || saved === 'en') return saved } catch { /* 저장소를 못 쓰는 환경 */ }
  return typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('ko') ? 'ko' : 'en'
}
export const lang: Lang = initial()

/** 영어 사전에 없는 문구 (개발 중 점검용) */
export const missing = new Set<string>()

/**
 * 한국어 문구를 열쇠로 쓰는 번역 함수. {0}, {1} 자리에 값을 넣는다.
 * 영어는 어순이 달라 사전에서 자리 순서를 바꿔 적을 수 있다.
 */
export function tr(ko: string, ...args: unknown[]): string {
  let s = ko
  if (lang === 'en') { const en = EN[ko]; if (en === undefined) missing.add(ko); else s = en }
  return args.length ? s.replace(/\{(\d+)\}/g, (_, i) => String(args[Number(i)] ?? '')) : s
}

/** 언어를 바꾸고 화면을 다시 연다. 모듈에 미리 만들어 둔 문구까지 한 번에 바뀐다 */
export function setLang(next: Lang) {
  try { localStorage.setItem(KEY, next) } catch { /* 저장하지 못해도 이번 화면은 바꾼다 */ }
  location.reload()
}
