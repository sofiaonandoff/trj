import { tr } from '../i18n'
import { motion } from 'framer-motion'
import { ArrowLeft, BookOpen, Copy, Download, ImageDown, Link2, ListChecks, Route, Share2, Trash2, Wallet } from 'lucide-react'
import { useState } from 'react'
import { shareLink, toMarkdown, toYouTube } from '../lib/share'
import { diffDays, download, fmtRange, haptic, today } from '../lib/util'
import { fitLegs } from '../lib/legs'
import { syncDays, useStore } from '../store'
import type { Trip } from '../types'
import BudgetTab from './BudgetTab'
import { CoEdit, DriveChip } from './DriveUI'
import ExportSheet from './ExportSheet'
import JournalTab from './JournalTab'
import PlanTab from './PlanTab'
import PrepTab from './PrepTab'
import { Avatars, RouteArt, Sheet, copy, go, toast } from './ui'

const TABS = [
  { id: 'plan', label: tr('일정'), Icon: Route },
  { id: 'budget', label: tr('예산'), Icon: Wallet },
  { id: 'prep', label: tr('준비'), Icon: ListChecks },
  { id: 'journal', label: tr('기록'), Icon: BookOpen },
] as const
type TabId = (typeof TABS)[number]['id']

export default function TripPage({ id }: { id: string }) {
  const trip = useStore((s) => s.trips.find((t) => t.id === id))
  const mutate = useStore((s) => s.mutate)
  const [tab, setTab] = useState<TabId>('plan')
  const [sharing, setSharing] = useState(false)
  const [exporting, setExporting] = useState(false)

  if (!trip) {
    return (
      <div className="shell"><div className="empty" style={{ paddingTop: 120 }}>
        <strong>{tr('여행을 찾을 수 없습니다')}</strong>{tr('이 기기에 저장되지 않았거나 삭제된 여행입니다.')}
        <div style={{ marginTop: 16 }}><button className="btn btn-primary" onClick={() => go('/', true)}>{tr('내 여행 보기')}</button></div>
      </div></div>
    )
  }

  const now = today()
  const badge = now > trip.end ? tr('다녀옴') : now >= trip.start ? `DAY ${diffDays(trip.start, now) + 1}` : `D-${diffDays(now, trip.start)}`

  return (
    <div className="shell wide">
      <header className="trip-head">
        <div className="topbar">
          <button className="icon-btn" aria-label={tr('내 여행으로')} onClick={() => go('/')}><ArrowLeft size={22} /></button>
          <input className="title-input" aria-label={tr('여행 이름')} value={trip.title} onChange={(e) => mutate(trip.id, (t) => { t.title = e.target.value })} />
          <button className="icon-btn" aria-label={tr('공유와 내보내기')} onClick={() => setSharing(true)}><Share2 size={20} /></button>
        </div>
        <div className="meta">
          <p><span className="num">{badge}</span>{fmtRange(trip.start, trip.end)}</p>
          <span className="head-actions"><DriveChip compact /><Avatars members={trip.members} /></span>
        </div>
      </header>

      <main className="trip-main">
        {tab === 'plan' && <PlanTab trip={trip} />}
        {tab === 'budget' && <BudgetTab trip={trip} />}
        {tab === 'prep' && <PrepTab trip={trip} />}
        {tab === 'journal' && <JournalTab trip={trip} />}
        {tab !== 'plan' && <div className="side-art"><RouteArt trip={trip} animate /></div>}
      </main>

      <nav className="tabbar" role="tablist" aria-label={tr('여행 메뉴')}>
        {TABS.map(({ id: t, label, Icon }) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => { setTab(t); haptic(); scrollTo(0, 0) }}>
            {tab === t && <motion.i layoutId="tab-pill" className="pill" transition={{ type: 'spring', damping: 30, stiffness: 400 }} />}
            <Icon size={22} strokeWidth={tab === t ? 2.4 : 1.9} />
            {label}
          </button>
        ))}
      </nav>

      <ShareSheet trip={trip} open={sharing} onClose={() => setSharing(false)} onExport={() => { setSharing(false); setExporting(true) }} />
      <ExportSheet trip={trip} open={exporting} onClose={() => setExporting(false)} />
    </div>
  )
}

function ShareSheet({ trip, open, onClose, onExport }: { trip: Trip; open: boolean; onClose: () => void; onExport: () => void }) {
  const mutate = useStore((s) => s.mutate)
  const remove = useStore((s) => s.remove)
  const [confirm, setConfirm] = useState(false)

  const send = async () => {
    const url = shareLink(trip)
    if (navigator.share) {
      try { await navigator.share({ title: trip.title, text: tr('{0} 일정을 함께 봐요', trip.title), url }); return } catch { /* 공유 창을 닫은 경우 링크 복사로 넘어간다 */ }
    }
    copy(url, tr('링크를 복사했습니다. 받은 사람이 열면 여행이 그대로 담깁니다'))
  }
  const setDates = (start: string, end: string) => {
    if (end < start) return toast(tr('돌아오는 날이 떠나는 날보다 빠릅니다'))
    mutate(trip.id, (t) => { const prev = t.start; t.start = start; t.end = end; syncDays(t); fitLegs(t, prev) })
  }

  return (
    <Sheet open={open} onClose={() => { setConfirm(false); onClose() }} title={tr('공유와 내보내기')}>
      <div className="stack">
        <CoEdit trip={trip} />
        <div className="list">
          <button onClick={onExport}><ImageDown size={20} /><span className="grow"><b>{tr('이미지로 내보내기')}</b><small>{tr('템플릿 3가지, 스토리·피드·영상용 비율')}</small></span></button>
          <button onClick={send}><Link2 size={20} /><span className="grow"><b>{tr('복사본 링크 보내기')}</b><small>{tr('받은 사람은 따로 고치는 사본을 갖습니다 (로그인 없음)')}</small></span></button>
          <button onClick={() => copy(toMarkdown(trip), tr('블로그용 글을 복사했습니다'))}><Copy size={20} /><span className="grow"><b>{tr('블로그용 글 복사')}</b><small>{tr('날짜별 코스와 기록을 마크다운으로')}</small></span></button>
          <button onClick={() => copy(toYouTube(trip), tr('영상 설명란용 글을 복사했습니다'))}><Copy size={20} /><span className="grow"><b>{tr('유튜브 설명란용 복사')}</b><small>{tr('DAY별 코스 요약과 해시태그')}</small></span></button>
          <button onClick={() => { download(`${trip.title}.trj.json`, JSON.stringify(trip, null, 2), 'application/json'); toast(tr('파일로 저장했습니다')) }}><Download size={20} /><span className="grow"><b>{tr('파일로 저장')}</b><small>{tr('내 드라이브에 보관하고, 홈에서 다시 불러올 수 있습니다')}</small></span></button>
        </div>
        <div className="row">
          <label className="field"><span>{tr('떠나는 날')}</span><input type="date" value={trip.start} onChange={(e) => setDates(e.target.value, e.target.value > trip.end ? e.target.value : trip.end)} /></label>
          <label className="field"><span>{tr('돌아오는 날')}</span><input type="date" value={trip.end} min={trip.start} onChange={(e) => setDates(trip.start, e.target.value)} /></label>
        </div>
        <p className="hint" style={{ marginTop: -6 }}>{tr('기간을 줄이면 빠지는 날의 일정은 마지막 날로 옮겨집니다.')}</p>
        {confirm ? (
          <div className="row">
            <button className="btn btn-ghost" onClick={() => setConfirm(false)}>{tr('취소')}</button>
            <button className="btn" style={{ background: 'var(--warn)', color: '#fff' }} onClick={() => { remove(trip.id); toast(tr('여행을 삭제했습니다')); go('/', true) }}>{tr('여행 삭제')}</button>
          </div>
        ) : (
          <button className="btn btn-ghost" style={{ color: 'var(--warn)' }} onClick={() => setConfirm(true)}><Trash2 size={18} />{tr('여행 삭제')}</button>
        )}
        {confirm && <p className="hint" style={{ marginTop: -6 }}>{trip.drive?.fileId ? tr('이 기기에서만 지웁니다. Google Drive의 TRJ 폴더에 있는 파일은 남아 있어 홈에서 다시 불러올 수 있습니다.') : tr('삭제하면 이 기기에서 되돌릴 수 없습니다. 남겨 두려면 먼저 파일로 저장하세요.')}</p>}
      </div>
    </Sheet>
  )
}
