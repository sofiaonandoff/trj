import { tr } from '../i18n'
import { FolderDown, Plus } from 'lucide-react'
import { useState } from 'react'
import { diffDays, fmtRange, haptic, today } from '../lib/util'
import { sampleTrip, useStore } from '../store'
import type { Trip } from '../types'
import { DriveChip, ImportSheet } from './DriveUI'
import { Avatars, LangButton, Logo, RouteArt, go } from './ui'

function when(t: Trip) {
  const now = today()
  if (now > t.end) return { big: tr('다녀옴'), small: '' }
  if (now >= t.start) return { big: `DAY ${diffDays(t.start, now) + 1}`, small: tr('여행 중') }
  const d = diffDays(now, t.start)
  return { big: `D-${d}`, small: tr('출발까지') }
}

export default function Home() {
  const trips = useStore((s) => s.trips)
  const add = useStore((s) => s.add)
  const [importing, setImporting] = useState(false)
  const now = today()
  const upcoming = trips.filter((t) => t.end >= now).sort((a, b) => a.start.localeCompare(b.start))
  const past = trips.filter((t) => t.end < now).sort((a, b) => b.start.localeCompare(a.start))
  const [next, ...rest] = upcoming

  return (
    <div className="shell">
      <header className="home-top">
        <div className="wordmark">
          <span><Logo height={30} /><span className="brand-full">THEREALJOURNEY</span></span>
          <span className="head-actions">
            <LangButton />
            <DriveChip />
            <button className="icon-btn" aria-label={tr('여행 불러오기')} onClick={() => setImporting(true)}><FolderDown size={20} /></button>
          </span>
        </div>
        <h1>{next ? (now >= next.start ? tr('{0}에서의 오늘', next.city) : tr('다음 궤적은 {0}', next.city)) : tr('어디로 선을 그어 볼까요')}</h1>
      </header>

      <main className="home-body">
        {next ? (
          <button className="hero" onClick={() => go(`/trip/${next.id}`)}>
            <div className="hero-art">
              <RouteArt trip={next} animate />
              <div className="dday">{when(next).big}<small>{when(next).small}</small></div>
            </div>
            <div className="hero-info">
              <div>
                <h2>{next.title}</h2>
                <p>{fmtRange(next.start, next.end)}</p>
              </div>
              <Avatars members={next.members} />
            </div>
          </button>
        ) : (
          <div className="hero">
            <div className="empty">
              <strong>{tr('아직 여행이 없습니다')}</strong>
              {tr('목적지와 날짜만 고르면 동선까지 이은 일정 초안을 만들어 드립니다.')}
              <div style={{ marginTop: 16 }}>
                <button className="btn btn-quiet" onClick={() => { const t = sampleTrip(); add(t); haptic(); go(`/trip/${t.id}`) }}>{tr('예시 여행 둘러보기')}</button>
              </div>
            </div>
          </div>
        )}

        {rest.length > 0 && <h2 className="sec-title">{tr('그다음 여행')}</h2>}
        {rest.map((t) => <Row key={t.id} t={t} />)}
        {past.length > 0 && <h2 className="sec-title">{tr('지난 여행')}</h2>}
        {past.map((t) => <Row key={t.id} t={t} />)}
        <a className="foot-link" href="/privacy.html">{tr('개인정보처리방침')}</a>
      </main>

      <button className="btn btn-primary fab" onClick={() => go('/new')}><Plus size={20} />{tr('새 여행 만들기')}</button>
      <ImportSheet open={importing} onClose={() => setImporting(false)} />
    </div>
  )
}

function Row({ t }: { t: Trip }) {
  return (
    <button className="trip-row" onClick={() => go(`/trip/${t.id}`)}>
      <span className="thumb"><RouteArt trip={t} dots={false} /></span>
      <span>
        <h3>{t.title}</h3>
        <p>{fmtRange(t.start, t.end)}</p>
      </span>
      <span className="when">{when(t).big}</span>
    </button>
  )
}
