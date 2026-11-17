import { tr } from '../i18n'
import { Cloud, CloudOff, FileUp, Link2, RefreshCw, Users, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import {
  connectDrive, driveConfigured, inviteByEmail, joinLink, listBackups, listEditors, openSharedTrip, reconnectDrive, removeEditor,
  restoreBackup, sharingConfigured, startSharing, syncNow, tokenValid, useDriveStatus, whoAmI, type Backup, type Editor,
} from '../lib/drive'
import { parseTripFile } from '../lib/share'
import { useStore } from '../store'
import type { Trip } from '../types'
import { LangButton, Logo, Sheet, copy, go, toast } from './ui'

const fail = (e: unknown) => toast((e as Error).message || tr('문제가 생겼습니다. 다시 시도하세요'))
const ago = (iso: string) => {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000)
  return m < 1 ? tr('방금') : m < 60 ? tr('{0}분 전', m) : m < 1440 ? tr('{0}시간 전', Math.round(m / 60)) : tr('{0}일 전', Math.round(m / 1440))
}

/** Drive 저장 상태를 보여 주고, 누르면 그 상태에서 할 일을 한다 */
export function DriveChip({ compact = false }: { compact?: boolean }) {
  const s = useDriveStatus()
  const [busy, setBusy] = useState(false)
  if (!driveConfigured) return null
  const run = (fn: () => Promise<unknown>, done?: string) => async () => {
    setBusy(true)
    try { await fn(); if (done) toast(done) } catch (e) { fail(e) } finally { setBusy(false) }
  }
  const view = {
    off: { label: tr('Drive에 저장'), Icon: CloudOff, warn: false, on: run(connectDrive, tr('Drive에 연결했습니다. 여행이 TRJ 폴더에 저장됩니다')) },
    idle: { label: tr('Drive에 저장됨'), Icon: Cloud, warn: false, on: run(() => syncNow({ pull: true }), tr('최신 상태입니다')) },
    syncing: { label: tr('저장 중'), Icon: RefreshCw, warn: false, on: undefined },
    reconnect: { label: s.kind === 'reconnect' && s.pending ? tr('다시 연결 ({0}개 대기)', s.pending) : tr('다시 연결'), Icon: CloudOff, warn: true, on: run(reconnectDrive, tr('Drive에 다시 연결했습니다')) },
    offline: { label: tr('오프라인'), Icon: CloudOff, warn: false, on: undefined },
    error: { label: tr('저장 실패 · 다시 시도'), Icon: CloudOff, warn: true, on: run(() => syncNow({ pull: true })) },
  }[s.kind]
  return (
    <button className={`drive-chip${view.warn ? ' warn' : ''}${compact && !view.warn ? ' compact' : ''}`} onClick={view.on} disabled={busy || !view.on} aria-label={view.label}
      title={s.kind === 'error' ? s.message : s.kind === 'reconnect' ? tr('Google 로그인이 만료되었습니다. 누르면 다시 연결합니다') : undefined}>
      <view.Icon size={15} className={s.kind === 'syncing' || busy ? 'spin' : undefined} />{compact && !view.warn ? null : view.label}
    </button>
  )
}

/** 홈: 파일이나 Drive에서 여행을 불러온다 */
export function ImportSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const add = useStore((s) => s.add)
  const trips = useStore((s) => s.trips)
  const file = useRef<HTMLInputElement>(null)
  const [backups, setBackups] = useState<Backup[]>()
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (!open) setBackups(undefined) }, [open])

  const fromFile = async (f?: File) => {
    if (!f) return
    const t = parseTripFile(await f.text())
    if (!t) return toast(tr('TRJ에서 저장한 여행 파일이 아닙니다'))
    add(t); toast(tr('여행을 불러왔습니다')); onClose(); go(`/trip/${t.id}`)
  }
  const load = async () => { setBusy(true); try { setBackups(await listBackups()) } catch (e) { fail(e) } finally { setBusy(false) } }
  const restore = async (b: Backup) => {
    setBusy(true)
    try { const id = await restoreBackup(b.id); toast(tr('Drive에서 여행을 불러왔습니다')); onClose(); go(`/trip/${id}`) } catch (e) { fail(e) } finally { setBusy(false) }
  }

  return (
    <Sheet open={open} onClose={onClose} title={tr('여행 불러오기')}>
      <div className="stack">
        <div className="list">
          <button onClick={() => file.current?.click()}><FileUp size={20} /><span className="grow"><b>{tr('파일에서 불러오기')}</b><small>{tr('\'파일로 저장\'으로 받은 .trj.json')}</small></span></button>
          {driveConfigured && <button onClick={load} disabled={busy}><Cloud size={20} /><span className="grow"><b>{tr('Google Drive에서 불러오기')}</b><small>{tr('기기를 바꿨거나 브라우저 데이터를 지웠을 때')}</small></span></button>}
        </div>
        <input ref={file} type="file" accept="application/json,.json" hidden onChange={(e) => { fromFile(e.target.files?.[0]); e.target.value = '' }} />
        {backups && (backups.length ? (
          <div className="list">
            {backups.map((b) => {
              const here = trips.some((t) => t.id === b.tripId)
              return (
                <button key={b.id} onClick={() => restore(b)} disabled={busy}>
                  <span className="grow"><b>{b.name}</b><small>{tr('{0} 저장', ago(b.modifiedTime))}{here ? tr(' · 이 기기에도 있음 (합칩니다)') : ''}</small></span>
                </button>
              )
            })}
          </div>
        ) : <div className="empty"><strong>{tr('Drive에 저장된 여행이 없습니다')}</strong>{tr('이 Google 계정의 TRJ 폴더가 비어 있습니다.')}</div>)}
      </div>
    </Sheet>
  )
}

/** 공유 시트 안: 같은 여행을 동행과 함께 고친다 */
export function CoEdit({ trip }: { trip: Trip }) {
  const status = useDriveStatus()
  const [busy, setBusy] = useState(false)
  const [email, setEmail] = useState('')
  const [editors, setEditors] = useState<Editor[]>()
  const fileId = trip.drive?.fileId
  const role = trip.drive?.role
  const live = status.kind === 'idle' || status.kind === 'syncing'

  useEffect(() => {
    if (role === 'owner' && fileId && tokenValid()) listEditors(fileId).then(setEditors)
  }, [role, fileId, live])

  if (!driveConfigured) return null
  const run = async (fn: () => Promise<unknown>) => { setBusy(true); try { await fn() } catch (e) { fail(e) } finally { setBusy(false) } }
  const link = fileId ? joinLink(fileId) : ''

  if (!role || !fileId) {
    return (
      <section className="coedit">
        <h3><Users size={18} />{tr('함께 편집')}</h3>
        <p className="hint" style={{ marginTop: 0 }}>{tr('여행을 내 Google Drive에 올리고 동행을 초대합니다. 각자 고친 내용이 30초 안에 서로에게 반영됩니다.')}</p>
        <button className="btn btn-primary btn-block" disabled={busy} onClick={() => run(async () => { await startSharing(trip.id); toast(tr('함께 편집을 시작했습니다. 동행을 초대하세요')) })}>{tr('함께 편집 시작')}</button>
      </section>
    )
  }

  const send = async () => {
    if (navigator.share) { try { await navigator.share({ title: trip.title, text: tr('{0} 일정을 함께 짜요', trip.title), url: link }); return } catch { /* 공유 창을 닫으면 복사로 넘어간다 */ } }
    copy(link, tr('초대 링크를 복사했습니다'))
  }
  const invite = () => run(async () => {
    await inviteByEmail(fileId, email, tr('{0} 일정을 함께 짜요. 아래 링크를 열고 이 메일을 받은 Google 계정으로 로그인하세요.\n{1}', trip.title, link))
    toast(tr('{0} 님에게 초대 메일을 보냈습니다', email.trim())); setEmail(''); setEditors(await listEditors(fileId))
  })

  return (
    <section className="coedit">
      <h3><Users size={18} />{tr('함께 편집 중')}</h3>
      {trip.drive?.error && <p className="parsed miss">{trip.drive.error}</p>}
      {trip.drive?.modifiedBy && trip.drive.modifiedAt && <p className="hint" style={{ marginTop: 0 }}>{tr('{0} 님이 {1} 고쳤습니다', trip.drive.modifiedBy, ago(trip.drive.modifiedAt))}</p>}
      {!live && <p className="hint" style={{ marginTop: 0 }}>{tr('지금은 Drive에 연결되어 있지 않습니다. 위쪽 저장 상태 버튼으로 다시 연결하면 이어서 맞춰집니다.')}</p>}
      {role === 'owner' ? (
        <>
          <div className="inline-add" style={{ marginTop: 0 }}>
            <input className="input" type="email" inputMode="email" placeholder={tr('동행의 Google 계정 이메일')} value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && email.includes('@') && invite()} />
            <button className="btn btn-primary" disabled={busy || !email.includes('@') || !live} onClick={invite}>{tr('초대')}</button>
          </div>
          <p className="hint">{tr('초대한 계정만 열 수 있습니다. 메일이 안 보이면 아래 링크를 직접 보내세요.')}</p>
          {editors && editors.length > 0 && (
            <div className="list" style={{ marginTop: 10 }}>
              {editors.map((m) => (
                <div key={m.id}>
                  <span className="grow"><b>{m.name ?? m.email}</b><small>{m.role === 'owner' ? tr('주인') : tr('편집 가능')}{m.email && m.name ? ` · ${m.email}` : ''}</small></span>
                  {m.role !== 'owner' && <button className="icon-btn" aria-label={tr('{0} 내보내기', m.name ?? m.email)} disabled={busy}
                    onClick={() => run(async () => { await removeEditor(fileId, m.id); setEditors(await listEditors(fileId)); toast(tr('편집 권한을 거뒀습니다')) })}><X size={18} /></button>}
                </div>
              ))}
            </div>
          )}
        </>
      ) : <p className="hint" style={{ marginTop: 0 }}>{tr('초대받아 함께 고치는 여행입니다. 다른 사람 초대는 여행 주인이 할 수 있습니다.')}</p>}
      <button className="btn btn-ghost btn-block" style={{ marginTop: 10 }} onClick={send}><Link2 size={18} />{tr('초대 링크 보내기')}</button>
    </section>
  )
}

/** 초대 링크로 들어온 화면: #/join/<파일 id> */
export function JoinPage({ fileId }: { fileId: string }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [account, setAccount] = useState<string | null>(null)

  const open = async (switchAccount = false) => {
    setBusy(true); setError(''); setAccount(null)
    try {
      const id = await openSharedTrip(fileId, switchAccount)
      if (id) { toast(tr('함께 편집하는 여행을 열었습니다')); go(`/trip/${id}`, true) } else setAccount((await whoAmI()) ?? '')
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }

  return (
    <div className="shell">
      <header className="home-top" style={{ paddingBottom: 40 }}>
        <div className="wordmark"><span><Logo height={30} /><span className="brand-full">THEREALJOURNEY</span></span><LangButton /></div>
        <h1>{tr('함께 짜는 여행에 초대받았습니다')}</h1>
      </header>
      <main className="pad stack" style={{ paddingTop: 24, paddingBottom: 40 }}>
        <p className="mute">{tr('초대 메일을 받은 Google 계정으로 열면 일정·항공편·예산·준비물을 동행과 함께 고칠 수 있습니다. Google 화면이 뜨면 초대받은 여행 파일을 한 번 선택하세요. TRJ는 그 파일에만 접근합니다.')}</p>
        {driveConfigured && sharingConfigured
          ? <button className="btn btn-primary btn-block" disabled={busy} onClick={() => open()}>{busy ? tr('여는 중') : tr('Google 계정으로 열기')}</button>
          : <p className="parsed miss">{tr('이 TRJ에는 Google 연결 설정이 없어 초대 링크를 열 수 없습니다.')}</p>}
        {error && <p className="parsed miss">{error}</p>}
        {account !== null && (
          <div className="panel" style={{ margin: 0 }}>
            <h2>{tr('여행 파일이 보이지 않았나요')}</h2>
            <p className="hint" style={{ marginTop: 0 }}>
              {account ? tr('지금 연결된 계정은 {0} 입니다. ', account) : ''}{tr('이 계정이 아직 초대되지 않았을 수 있습니다. 여행 주인에게 이 이메일로 초대해 달라고 하거나, 초대받은 다른 계정으로 여세요.')}
            </p>
            <div className="stack" style={{ marginTop: 12, gap: 8 }}>
              <button className="btn btn-primary" disabled={busy} onClick={() => open(true)}>{tr('다른 Google 계정으로 열기')}</button>
              {account && <button className="btn btn-ghost" onClick={() => copy(account, tr('이메일을 복사했습니다'))}>{tr('내 이메일 복사')}</button>}
            </div>
          </div>
        )}
        <button className="btn btn-ghost btn-block" onClick={() => go('/', true)}>{tr('내 여행 보기')}</button>
      </main>
    </div>
  )
}
