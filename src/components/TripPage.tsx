import { tr } from '../i18n'
import { motion } from 'framer-motion'
import { ArrowLeft, BookOpen, Download, Link2, ListChecks, MoreHorizontal, Route, Share2, Wallet } from 'lucide-react'
import { useState } from 'react'
import { shareLink } from '../lib/share'
import { diffDays, download, fmtRange, haptic, today } from '../lib/util'
import { useStore } from '../store'
import type { Trip } from '../types'
import BudgetTab from './BudgetTab'
import { CoEdit, DriveChip } from './DriveUI'
import JournalTab from './JournalTab'
import PlanTab from './PlanTab'
import PrepTab from './PrepTab'
import TripSettings from './TripSettings'
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
  const [managing, setManaging] = useState(false)

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
          <button className="icon-btn" aria-label={tr('여행 관리')} onClick={() => setManaging(true)}><MoreHorizontal size={22} /></button>
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

      <TripSettings trip={trip} open={managing} onClose={() => setManaging(false)} />
      <ShareSheet trip={trip} open={sharing} onClose={() => setSharing(false)} onJournal={() => { setTab('journal'); scrollTo(0, 0) }} onManage={() => setManaging(true)} />
    </div>
  )
}

function ShareSheet({ trip, open, onClose, onJournal, onManage }: { trip: Trip; open: boolean; onClose: () => void; onJournal: () => void; onManage: () => void }) {

  const send = async () => {
    const url = shareLink(trip)
    if (navigator.share) {
      try { await navigator.share({ title: trip.title, text: tr('{0} 일정을 함께 봐요', trip.title), url }); return } catch { /* 공유 창을 닫은 경우 링크 복사로 넘어간다 */ }
    }
    copy(url, tr('링크를 복사했습니다. 받은 사람이 열면 여행이 그대로 담깁니다'))
  }
  return (
    <Sheet open={open} onClose={onClose} title={tr('공유와 내보내기')}>
      <div className="stack">
        <CoEdit trip={trip} />
        <div className="list">
          <button onClick={send}><Link2 size={20} /><span className="grow"><b>{tr('복사본 링크 보내기')}</b><small>{tr('받은 사람은 따로 고치는 사본을 갖습니다 (로그인 없음)')}</small></span></button>
          <button onClick={() => { onClose(); onJournal() }}><BookOpen size={20} /><span className="grow"><b>{tr('이미지·블로그·유튜브용 내보내기')}</b><small>{tr('기록 탭에서 할 수 있습니다')}</small></span></button>
          <button onClick={() => { download(`${trip.title}.trj.json`, JSON.stringify(trip, null, 2), 'application/json'); toast(tr('파일로 저장했습니다')) }}><Download size={20} /><span className="grow"><b>{tr('파일로 저장')}</b><small>{tr('내 드라이브에 보관하고, 홈에서 다시 불러올 수 있습니다')}</small></span></button>
        </div>
        <button className="btn btn-quiet" onClick={() => { onClose(); onManage() }}><MoreHorizontal size={16} />{tr('기간 바꾸기·여행 삭제는 여행 관리에서')}</button>
      </div>
    </Sheet>
  )
}
