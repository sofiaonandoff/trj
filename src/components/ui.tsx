import { lang, setLang, tr } from '../i18n'
import { AnimatePresence, motion, useDragControls } from 'framer-motion'
import { X } from 'lucide-react'
import { useEffect, useSyncExternalStore, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { BRAND, LOGO } from '../brand'
import type { Member, Trip } from '../types'

/* ── 라우터: 주소 해시 + 화면 전환(View Transitions) ── */
const listeners = new Set<() => void>()
const current = () => location.hash.replace(/^#/, '') || '/'
addEventListener('popstate', () => listeners.forEach((l) => l()))
addEventListener('hashchange', () => listeners.forEach((l) => l()))

export function useRoute() {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l) }, current)
}
export function go(path: string, replace = false) {
  const apply = () => {
    if (replace) history.replaceState(null, '', `#${path}`); else history.pushState(null, '', `#${path}`)
    flushSync(() => listeners.forEach((l) => l()))
    scrollTo(0, 0)
  }
  const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown }
  if (doc.startViewTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches) doc.startViewTransition(apply); else apply()
}

/* ── 토스트 ── */
let toastMsg = ''
let toastTimer = 0
const toastSubs = new Set<() => void>()
export function toast(msg: string) {
  toastMsg = msg
  toastSubs.forEach((l) => l())
  clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => { toastMsg = ''; toastSubs.forEach((l) => l()) }, 2200)
}
export function Toast() {
  const msg = useSyncExternalStore((l) => { toastSubs.add(l); return () => toastSubs.delete(l) }, () => toastMsg)
  return (
    <AnimatePresence>
      {msg && (
        <motion.div className="toast" role="status" key={msg} initial={{ opacity: 0, y: 12, x: '-50%' }} animate={{ opacity: 1, y: 0, x: '-50%' }} exit={{ opacity: 0, y: 8, x: '-50%' }}>
          {msg}
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export async function copy(text: string, done = tr('복사했습니다')) {
  try { await navigator.clipboard.writeText(text); toast(done) } catch { toast(tr('복사하지 못했습니다. 브라우저 권한을 확인하세요')) }
}

/* ── 바텀 시트: 손잡이를 끌어내리면 닫힌다 ── */
export function Sheet({ open, onClose, title, children, foot }: { open: boolean; onClose: () => void; title: string; children: ReactNode; foot?: ReactNode }) {
  const controls = useDragControls()
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => { removeEventListener('keydown', onKey); document.body.style.overflow = '' }
  }, [open, onClose])
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div className="scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.div
            className="sheet" role="dialog" aria-modal="true" aria-label={title}
            initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} transition={{ type: 'spring', damping: 32, stiffness: 340 }}
            drag="y" dragControls={controls} dragListener={false} dragConstraints={{ top: 0, bottom: 0 }} dragElastic={{ top: 0, bottom: 0.7 }}
            onDragEnd={(_, info) => { if (info.offset.y > 110 || info.velocity.y > 600) onClose() }}
          >
            <div className="sheet-grab" onPointerDown={(e) => controls.start(e)}><i /></div>
            <div className="sheet-head">
              <h2>{title}</h2>
              <button className="icon-btn" onClick={onClose} aria-label={tr('닫기')}><X size={22} /></button>
            </div>
            <div className="sheet-body">{children}</div>
            {foot && <div className="sheet-foot">{foot}</div>}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

export const Avatar = ({ m }: { m: Member }) => <span className="avatar" style={{ background: m.color }} title={m.name}>{m.name.slice(0, 1)}</span>
export const Avatars = ({ members }: { members: Member[] }) => <span className="avatars">{members.slice(0, 5).map((m) => <Avatar key={m.id} m={m} />)}</span>

/* ── 궤적 그림: 여행의 실제 동선을 그대로 선으로 그린다 ── */
export function RouteArt({ trip, animate = false, dots = true }: { trip: Trip; animate?: boolean; dots?: boolean }) {
  const W = 320, H = 168, P = 30
  let pts = trip.days.flatMap((d) => d.items.map((i) => [i.lng, i.lat * 1.2] as [number, number]))
  if (pts.length < 2) pts = [[0, 0], [1, 0.9], [2.2, 0.5], [3, 1.4]] // 아직 일정이 없을 때의 기본 곡선
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1])
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
  const s = Math.min((W - P * 2) / (x1 - x0 || 1), (H - P * 2) / (y1 - y0 || 1))
  const ox = (W - (x1 - x0) * s) / 2, oy = (H - (y1 - y0) * s) / 2
  const xy = pts.map(([x, y]) => [ox + (x - x0) * s, H - oy - (y - y0) * s])
  // 점 사이를 부드럽게 잇는다
  let d = `M${xy[0][0].toFixed(1)},${xy[0][1].toFixed(1)}`
  for (let i = 1; i < xy.length; i++) {
    const [px, py] = xy[i - 1], [cx, cy] = xy[i]
    d += ` Q${px.toFixed(1)},${py.toFixed(1)} ${((px + cx) / 2).toFixed(1)},${((py + cy) / 2).toFixed(1)}`
  }
  d += ` L${xy[xy.length - 1][0].toFixed(1)},${xy[xy.length - 1][1].toFixed(1)}`
  const last = xy[xy.length - 1]
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <path d={d} fill="none" stroke={BRAND.sand} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" pathLength={1} className={animate ? 'route-line' : undefined} />
      {dots && xy.slice(0, -1).map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="3.5" fill={BRAND.forest} stroke={BRAND.linen} strokeWidth="2" className={animate ? 'route-dot' : undefined}
          style={animate ? { animationDelay: `${0.2 + (i / xy.length) * 1.4}s`, transformOrigin: `${x}px ${y}px` } : undefined} />
      ))}
      <circle cx={last[0]} cy={last[1]} r="6.5" fill={BRAND.linen} className={animate ? 'route-dot' : undefined}
        style={animate ? { animationDelay: '1.6s', transformOrigin: `${last[0]}px ${last[1]}px` } : undefined} />
    </svg>
  )
}

/** 언어 전환: 지금 한국어면 영어로, 영어면 한국어로 */
export function LangButton() {
  return (
    <button className="drive-chip" onClick={() => setLang(lang === 'ko' ? 'en' : 'ko')} aria-label={lang === 'ko' ? 'Switch to English' : '한국어로 보기'}>
      {lang === 'ko' ? 'EN' : '한국어'}
    </button>
  )
}

/** trj. 워드마크. 높이만 주면 비율에 맞춰 그린다. 색은 글자색(currentColor)을 따른다 */
export function Logo({ height = 28, title = BRAND.full }: { height?: number; title?: string }) {
  const [x, y, w, h] = LOGO.viewBox
  return (
    <svg className="logo" viewBox={`${x} ${y} ${w} ${h}`} height={height} width={(height * w) / h} role="img" aria-label={title}>
      <path d={LOGO.d} fill="currentColor" />
    </svg>
  )
}
