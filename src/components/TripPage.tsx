import { tr } from '../i18n'
import { motion } from 'framer-motion'
import { ArrowLeft, BookOpen, Copy, Download, Eye, Link2, ListChecks, MoreHorizontal, Route, Send, Share2, UserPlus, Wallet } from 'lucide-react'
import { useEffect, useState } from 'react'
import { onAnnounced, takeAnnounced, type Invitee } from '../lib/invite'
import { shareLink, snapshotViewLink } from '../lib/share'
import { driveConfigured, startViewLink, stopViewLink, viewLink } from '../lib/drive'
import { diffDays, download, fmtRange, haptic, today } from '../lib/util'
import { useStore } from '../store'
import type { Trip } from '../types'
import BudgetTab from './BudgetTab'
import { CoEdit, DriveChip } from './DriveUI'
import JournalTab from './JournalTab'
import PlanTab from './PlanTab'
import PrepTab from './PrepTab'
import TripSettings from './TripSettings'
import Companions from './Companions'
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
  const [people, setPeople] = useState(false)
  const [invites, setInvites] = useState<Invitee[]>()
  // 새 여행을 만들며 편집 권한을 준 동행이 있으면, 동행 관리를 열어 초대장을 보내게 한다
  useEffect(() => {
    const show = (p: Invitee[]) => { setInvites(p); setPeople(true) }
    const waiting = takeAnnounced(id)
    if (waiting) show(waiting)
    return onAnnounced(id, show)
  }, [id])

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
          <span className="head-actions"><DriveChip compact /><button className="avatars-btn" onClick={() => setPeople(true)} aria-label={tr('동행 관리')}><Avatars members={trip.members} /><UserPlus size={15} /></button></span>
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
      <Companions trip={trip} open={people} invites={invites} onClose={() => { setPeople(false); setInvites(undefined) }} />
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
        <ViewLink trip={trip} />
        <CoEdit trip={trip} />
        <div className="list">
          <button onClick={send}><Link2 size={20} /><span className="grow"><b>{tr('고칠 수 있는 사본 보내기')}</b><small>{tr('받은 사람은 따로 고치는 사본을 갖습니다 (로그인 없음)')}</small></span></button>
          <button onClick={() => { onClose(); onJournal() }}><BookOpen size={20} /><span className="grow"><b>{tr('이미지·블로그·유튜브용 내보내기')}</b><small>{tr('기록 탭에서 할 수 있습니다')}</small></span></button>
          <button onClick={() => { download(`${trip.title}.trj.json`, JSON.stringify(trip, null, 2), 'application/json'); toast(tr('파일로 저장했습니다')) }}><Download size={20} /><span className="grow"><b>{tr('파일로 저장')}</b><small>{tr('내 드라이브에 보관하고, 홈에서 다시 불러올 수 있습니다')}</small></span></button>
        </div>
        <button className="btn btn-quiet" onClick={() => { onClose(); onManage() }}><MoreHorizontal size={16} />{tr('기간 바꾸기·여행 삭제는 여행 관리에서')}</button>
      </div>
    </Sheet>
  )
}

/** 로그인 없이 보는 링크. 받는 사람은 앱 설치·로그인 없이 일정·항공편·숙소를 본다 */
function ViewLink({ trip }: { trip: Trip }) {
  const [busy, setBusy] = useState(false)
  const v = trip.drive?.view
  const owner = trip.drive?.role !== 'editor'
  const send = async (url: string) => {
    const text = tr('{0} 일정이에요. 로그인 없이 볼 수 있어요', trip.title)
    if (navigator.share) { try { await navigator.share({ title: trip.title, text, url }); return } catch { /* 닫으면 복사로 */ } }
    copy(url, tr('보기 링크를 복사했습니다'))
  }
  const run = async (fn: () => Promise<unknown>) => { setBusy(true); try { await fn() } catch (e) { toast((e as Error).message) } finally { setBusy(false) } }
  const make = () => run(async () => { const id = await startViewLink(trip.id); toast(tr('보기 링크를 만들었습니다')); await send(viewLink(id)) })
  const stop = () => run(async () => { await stopViewLink(trip.id); toast(tr('보기 링크를 껐습니다. 전에 보낸 링크는 더 열리지 않습니다')) })
  return (
    <section className="coedit">
      <h3><Eye size={18} />{tr('로그인 없이 일정 보여 주기')}</h3>
      {v ? (
        <>
          <p className="hint" style={{ marginTop: 0 }}>{tr('보기 링크가 켜져 있습니다. 링크가 있는 사람은 로그인 없이 일정·항공편·숙소를 보고, 고친 내용도 1분 안팎으로 반영됩니다. 지출·준비물·이메일·예약번호는 보이지 않습니다.')}</p>
          <div className="row">
            <button className="btn btn-primary" disabled={busy} onClick={() => send(viewLink(v.fileId))}><Send size={16} />{tr('보기 링크 보내기')}</button>
            <button className="btn btn-ghost" disabled={busy} onClick={() => copy(viewLink(v.fileId), tr('보기 링크를 복사했습니다'))} aria-label={tr('보기 링크 복사')}><Copy size={16} /></button>
            {owner && <button className="btn btn-quiet" disabled={busy} onClick={stop}>{tr('끄기')}</button>}
          </div>
        </>
      ) : driveConfigured && owner ? (
        <>
          <p className="hint" style={{ marginTop: 0 }}>{tr('받는 사람은 로그인 없이 일정·항공편·숙소를 보고, 내가 고치면 1분 안팎으로 반영됩니다. 지출·준비물·이메일·예약번호는 보이지 않습니다. 처음 한 번 내 Google 계정 연결이 필요합니다.')}</p>
          <button className="btn btn-primary btn-block" disabled={busy} onClick={make}><Eye size={18} />{tr('보기 링크 만들기')}</button>
        </>
      ) : null}
      <button className="btn btn-quiet btn-block" style={{ marginTop: 6 }} onClick={() => send(snapshotViewLink(trip))}>
        <Link2 size={16} />{v || (driveConfigured && owner) ? tr('Google 없이 지금 일정 그대로 보내기') : tr('지금 일정 그대로 보내기')}
      </button>
    </section>
  )
}

