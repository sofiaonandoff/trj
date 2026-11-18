import { tr } from '../i18n'
import { Check, Link2, Mail, Pencil, UserPlus, Users, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { driveConfigured, ensureToken, inviteByEmail, joinLink, listEditors, removeEditor, startSharing, tokenValid, useDriveStatus, type Editor } from '../lib/drive'
import { mergePeople, type Person as PersonOf } from '../lib/people'
import { uid } from '../lib/util'
import { MEMBER_COLORS, useStore } from '../store'
import type { Trip } from '../types'
import { Avatar, Sheet, copy, toast } from './ui'

const same = (a?: string, b?: string) => Boolean(a && b && a.trim().toLowerCase() === b.trim().toLowerCase())
const fail = (e: unknown) => toast((e as Error).message || tr('문제가 생겼습니다. 다시 시도하세요'))

type Person = PersonOf<Editor>

/**
 * 동행 관리: 이름 추가·빼기, 이메일 초대, 편집 권한 확인·내보내기를 한 곳에서.
 * - 이름만 있는 동행은 예산 나누기·준비물 담당에만 쓰인다 (앱에서 여행을 보지는 못한다)
 * - 이메일을 넣으면 함께 편집 초대가 가고, 그 사람도 같은 여행을 고칠 수 있다
 * - 동행의 이메일과 Drive 편집자의 이메일이 같으면 한 사람으로 보여 준다
 */
export default function Companions({ trip, open, onClose }: { trip: Trip; open: boolean; onClose: () => void }) {
  const mutate = useStore((s) => s.mutate)
  const status = useDriveStatus()
  const [editors, setEditors] = useState<Editor[]>()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [renaming, setRenaming] = useState<{ id: string; name: string }>()
  const [inviting, setInviting] = useState<{ id: string; email: string }>()
  const fileId = trip.drive?.fileId
  const role = trip.drive?.role
  const owner = !role || role === 'owner'
  const live = status.kind === 'idle' || status.kind === 'syncing'

  const refresh = async (id = fileId) => { if (id && tokenValid() && (role === 'owner' || !role)) setEditors(await listEditors(id).catch(() => undefined)) }
  useEffect(() => { if (open) { setName(''); setEmail(''); setRenaming(undefined); setInviting(undefined); void refresh() } }, [open, fileId, live]) // eslint-disable-line react-hooks/exhaustive-deps

  // 동행과 편집자를 이메일로 묶는다. 여행 주인(Drive owner)은 첫 동행 '나'로 본다
  const people = useMemo(() => mergePeople(trip.members, editors ?? []), [trip.members, editors])

  const run = async (fn: () => Promise<unknown>) => { setBusy(true); try { await fn() } catch (e) { fail(e) } finally { setBusy(false) } }

  /** 함께 편집이 안 켜져 있으면 켜고, 초대 메일을 보낸다 */
  const sendInvite = async (to: string) => {
    if (!driveConfigured) throw new Error(tr('이 앱에는 Google Drive 연결이 설정되어 있지 않습니다'))
    if (!owner) throw new Error(tr('초대받아 함께 고치는 여행입니다. 다른 사람 초대는 여행 주인이 할 수 있습니다.'))
    await ensureToken()
    const id = fileId && role ? fileId : await startSharing(trip.id)
    await inviteByEmail(id, to, tr('{0} 일정을 함께 짜요. 아래 링크를 열고 이 메일을 받은 Google 계정으로 로그인하세요.\n{1}', trip.title, joinLink(id)))
    await refresh(id)
  }

  const add = () => run(async () => {
    const n = name.trim() || email.trim().split('@')[0]
    const e = email.trim()
    if (!n) return
    if (e && !/^\S+@\S+\.\S+$/.test(e)) { toast(tr('이메일 주소를 확인하세요')); return }
    if (trip.members.some((m) => m.name === n)) { toast(tr('같은 이름이 이미 있습니다')); return }
    if (e && trip.members.some((m) => same(m.email, e))) { toast(tr('이미 들어 있는 이메일입니다')); return }
    mutate(trip.id, (t) => { t.members.push({ id: uid(), name: n, color: MEMBER_COLORS[t.members.length % MEMBER_COLORS.length], email: e || undefined }) })
    setName(''); setEmail('')
    if (e) { await sendInvite(e); toast(tr('{0} 님을 넣고 초대 메일을 보냈습니다', n)) } else toast(tr('{0} 님을 넣었습니다', n))
  })

  const remove = (p: Person) => run(async () => {
    const m = p.member
    if (m) {
      if (p.me) { toast(tr('나는 뺄 수 없습니다')); return }
      if (trip.expenses.some((x) => x.payer === m.id)) { toast(tr('{0} 님이 낸 지출이 있어 뺄 수 없습니다. 예산 탭에서 낸 사람을 먼저 바꾸세요', m.name)); return }
    }
    // 편집 권한도 있으면 함께 거둔다
    if (p.editor && p.editor.role !== 'owner' && fileId && owner) { await ensureToken(); await removeEditor(fileId, p.editor.id) }
    if (m) mutate(trip.id, (t) => {
      t.members = t.members.filter((x) => x.id !== m.id)
      t.expenses.forEach((x) => { x.split = x.split.filter((id) => id !== m.id); if (!x.split.length) x.split = [t.members[0].id] })
      t.checklist.forEach((c) => { if (c.assignee === m.id) c.assignee = undefined })
    })
    await refresh()
    toast(p.editor && p.editor.role !== 'owner' ? tr('{0} 님을 빼고 편집 권한도 거뒀습니다', m?.name ?? p.editor.name ?? p.editor.email ?? '') : tr('{0} 님을 뺐습니다', m?.name ?? ''))
  })

  const adopt = (e: Editor) => mutate(trip.id, (t) => {
    t.members.push({ id: uid(), name: e.name ?? e.email?.split('@')[0] ?? tr('동행'), color: MEMBER_COLORS[t.members.length % MEMBER_COLORS.length], email: e.email })
  })

  const saveName = () => {
    if (!renaming) return
    const v = renaming.name.trim()
    if (v && !trip.members.some((m) => m.name === v && m.id !== renaming.id)) mutate(trip.id, (t) => { const m = t.members.find((x) => x.id === renaming.id); if (m) m.name = v })
    setRenaming(undefined)
  }
  const saveInvite = () => run(async () => {
    if (!inviting) return
    const e = inviting.email.trim()
    if (!/^\S+@\S+\.\S+$/.test(e)) { toast(tr('이메일 주소를 확인하세요')); return }
    mutate(trip.id, (t) => { const m = t.members.find((x) => x.id === inviting.id); if (m) m.email = e })
    setInviting(undefined)
    await sendInvite(e)
    toast(tr('{0} 주소로 초대 메일을 보냈습니다', e))
  })

  const statusOf = (p: Person) => {
    if (p.me) return p.editor ? tr('나 · 여행 주인') : tr('여행을 만든 사람')
    if (p.editor && !p.member) return tr('편집 가능 · 동행 목록에는 없음')
    if (p.editor) return tr('함께 편집 중')
    if (p.member?.email) return role ? tr('초대 메일 보냄 · 확인 중') : tr('이메일만 있음 · 아직 초대 안 함')
    return tr('이름만 · 예산 나누기와 준비물 담당에 쓰임')
  }

  return (
    <Sheet open={open} onClose={onClose} title={tr('동행 관리')}>
      <div className="stack">
        <div className="list people">
          {people.map((p) => {
            const m = p.member
            const key = m?.id ?? p.editor!.id
            const label = m?.name ?? p.editor?.name ?? p.editor?.email ?? ''
            return (
              <div key={key} className="person-row">
                {m ? <Avatar m={m} /> : <span className="avatar ghost"><Users size={14} /></span>}
                <span className="grow">
                  {renaming && m && renaming.id === m.id ? (
                    <span className="input-btn">
                      <input className="input" autoFocus value={renaming.name} onChange={(e) => setRenaming({ id: m.id, name: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && saveName()} />
                      <button className="icon-btn" onClick={saveName} aria-label={tr('이름 저장')}><Check size={18} /></button>
                    </span>
                  ) : (
                    <b>{label}{m && <button className="name-edit" onClick={() => setRenaming({ id: m.id, name: m.name })} aria-label={tr('{0} 이름 바꾸기', m.name)}><Pencil size={13} /></button>}</b>
                  )}
                  <small>{[m?.email ?? p.editor?.email, statusOf(p)].filter(Boolean).join(' · ')}</small>
                  {inviting && m && inviting.id === m.id && (
                    <span className="input-btn" style={{ marginTop: 6 }}>
                      <input className="input" type="email" inputMode="email" autoFocus placeholder={tr('{0} 님의 Google 계정 이메일', m.name)} value={inviting.email}
                        onChange={(e) => setInviting({ id: m.id, email: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && saveInvite()} />
                      <button className="btn btn-primary" disabled={busy} onClick={saveInvite}>{tr('초대')}</button>
                    </span>
                  )}
                </span>
                {/* 이름만 있는 동행: 이메일 넣고 초대 / 편집자만 있는 사람: 동행 목록에 넣기 */}
                {m && !p.me && !p.editor && owner && driveConfigured && inviting?.id !== m.id && (
                  <button className="icon-btn" disabled={busy} aria-label={tr('{0} 님 초대', m.name)}
                    onClick={() => (m.email ? run(async () => { await sendInvite(m.email!); toast(tr('{0} 주소로 초대 메일을 다시 보냈습니다', m.email!)) }) : setInviting({ id: m.id, email: '' }))}>
                    <Mail size={18} />
                  </button>
                )}
                {!m && p.editor && <button className="icon-btn" onClick={() => adopt(p.editor!)} aria-label={tr('{0} 님을 동행 목록에 넣기', label)}><UserPlus size={18} /></button>}
                {!p.me && (m || (p.editor && p.editor.role !== 'owner' && owner)) && (
                  <button className="icon-btn" disabled={busy} onClick={() => remove(p)} aria-label={tr('{0} 빼기', label)}><X size={18} /></button>
                )}
              </div>
            )
          })}
        </div>

        <div className="person-add stacked">
          <input className="input" placeholder={tr('이름')} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
          <input className="input" type="email" inputMode="email" placeholder={tr('Google 이메일 (선택)')} value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
          <button className="btn btn-primary" disabled={busy || (!name.trim() && !email.includes('@'))} onClick={add}><UserPlus size={18} />{email.includes('@') ? tr('넣고 초대') : tr('추가')}</button>
        </div>
        <p className="hint" style={{ marginTop: -6 }}>
          {!driveConfigured ? tr('이름으로 넣은 동행은 예산 나누기와 준비물 담당에 쓰입니다.')
            : owner ? tr('이메일을 넣으면 함께 편집 초대가 가서, 그 사람도 같은 여행을 고칠 수 있습니다. 이름만 넣으면 예산 나누기와 준비물 담당에만 쓰입니다.')
            : tr('초대받아 함께 고치는 여행입니다. 이름은 넣을 수 있지만, 다른 사람 초대는 여행 주인이 할 수 있습니다.')}
        </p>
        {fileId && role && (
          <button className="btn btn-ghost btn-block" onClick={() => copy(joinLink(fileId), tr('초대 링크를 복사했습니다'))}><Link2 size={18} />{tr('초대 링크 복사')}</button>
        )}
        {role && !live && <p className="hint">{tr('지금은 Drive에 연결되어 있지 않아 편집 권한을 확인할 수 없습니다. 위쪽 저장 상태 버튼으로 다시 연결하세요.')}</p>}
      </div>
    </Sheet>
  )
}
