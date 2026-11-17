import { tr } from '../i18n'
import { Download, Images, Share2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { posterName, RATIOS, renderPoster, THEMES, toBlob, type Page, type PosterOptions, type Ratio, type ThemeId } from '../lib/poster'
import type { Trip } from '../types'
import { Sheet, toast } from './ui'

const save = (blob: Blob, name: string) => {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob); a.download = name; a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 3000)
}

/** 여행을 템플릿 이미지로 내보낸다: 비율 3가지 × 템플릿 3가지 × (요약 또는 하루) */
export default function ExportSheet({ trip, open, onClose }: { trip: Trip; open: boolean; onClose: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [ratio, setRatio] = useState<Ratio>('story')
  const [theme, setTheme] = useState<ThemeId>('forest')
  const [page, setPage] = useState<Page>('summary')
  const [busy, setBusy] = useState(false)
  const current: Page = page !== 'summary' && page >= trip.days.length ? 'summary' : page
  const opt: PosterOptions = { ratio, theme, page: current }

  const [rendering, setRendering] = useState(false)
  const [withMap, setWithMap] = useState(true)
  const turn = useRef(0)
  useEffect(() => {
    if (!open || !canvas.current) return
    // 옵션을 빨리 바꾸면 늦게 끝난 이전 그림이 덮어쓰지 않도록, 가장 최근 요청만 화면에 올린다
    const mine = ++turn.current
    const off = document.createElement('canvas')
    setRendering(true)
    renderPoster(off, trip, { ratio, theme, page: current }, withMap).then(() => {
      if (mine !== turn.current || !canvas.current) return
      canvas.current.width = off.width; canvas.current.height = off.height
      canvas.current.getContext('2d')!.drawImage(off, 0, 0)
    }).finally(() => { if (mine === turn.current) setRendering(false) })
  }, [open, trip, ratio, theme, current, withMap])

  const one = async () => {
    setBusy(true)
    try { save(await toBlob(canvas.current!), posterName(trip, opt)); toast(tr('이미지를 저장했습니다')) }
    catch (e) { toast((e as Error).message) } finally { setBusy(false) }
  }
  const all = async () => {
    setBusy(true)
    try {
      const off = document.createElement('canvas')
      const pages: Page[] = ['summary', ...trip.days.map((_, i) => i)]
      for (const p of pages) {
        const o = { ratio, theme, page: p }
        await renderPoster(off, trip, o, withMap)
        save(await toBlob(off), posterName(trip, o))
        await new Promise((r) => setTimeout(r, 350)) // 브라우저가 연속 내려받기를 막지 않도록 간격을 둔다
      }
      toast(tr('이미지 {0}장을 저장했습니다', pages.length))
    } catch (e) { toast((e as Error).message) } finally { setBusy(false) }
  }
  const share = async () => {
    setBusy(true)
    try {
      const file = new File([await toBlob(canvas.current!)], posterName(trip, opt), { type: 'image/png' })
      if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: trip.title })
      else { save(file, file.name); toast(tr('이 브라우저는 이미지 공유를 지원하지 않아 저장했습니다')) }
    } catch { /* 공유 창을 닫은 경우 */ } finally { setBusy(false) }
  }

  return (
    <Sheet open={open} onClose={onClose} title={tr('이미지로 내보내기')}
      foot={<>
        <button className="btn btn-ghost" style={{ flex: 'none' }} disabled={busy || rendering} onClick={share} aria-label={tr('이미지 공유')}><Share2 size={18} /></button>
        <button className="btn btn-ghost" disabled={busy || rendering} onClick={all}><Images size={18} />{tr('전체 {0}장', trip.days.length + 1)}</button>
        <button className="btn btn-primary" disabled={busy || rendering} onClick={one}><Download size={18} />{tr('이 장 저장')}</button>
      </>}>
      <div className="stack">
        <div className={`poster-preview ${ratio}${rendering ? ' busy' : ''}`}><canvas ref={canvas} aria-label={tr('내보낼 이미지 미리 보기')} /></div>
        <div className="toggle">
          <div><b>{tr('지도 윤곽 넣기')}</b><small>{tr('동선 뒤에 실제 지도를 브랜드 색으로 깝니다. 인터넷 연결이 필요합니다')}</small></div>
          <button className="switch" role="switch" aria-checked={withMap} aria-label={tr('지도 윤곽 넣기')} onClick={() => setWithMap(!withMap)} />
        </div>
        <div className="field"><span>{tr('화면 비율')}</span>
          <div className="seg">
            {(Object.keys(RATIOS) as Ratio[]).map((r) => (
              <button key={r} aria-pressed={ratio === r} onClick={() => setRatio(r)}>{RATIOS[r].label} <small>{RATIOS[r].hint}</small></button>
            ))}
          </div>
        </div>
        <div className="field"><span>{tr('템플릿')}</span>
          <div className="chips">
            {(Object.keys(THEMES) as ThemeId[]).map((id) => (
              <button key={id} className="chip" aria-pressed={theme === id} onClick={() => setTheme(id)}>
                <i className="swatch" style={{ background: THEMES[id].bg, boxShadow: `inset 0 0 0 3px ${THEMES[id].accent}` }} />{THEMES[id].label}
              </button>
            ))}
          </div>
        </div>
        <div className="field"><span>{tr('담을 내용')}</span>
          <div className="chips">
            <button className="chip" aria-pressed={current === 'summary'} onClick={() => setPage('summary')}>{tr('전체 요약')}</button>
            {trip.days.map((d, i) => <button key={d.date} className="chip" aria-pressed={current === i} onClick={() => setPage(i)}>{tr('{0}일차', i + 1)}</button>)}
          </div>
        </div>
      </div>
    </Sheet>
  )
}
