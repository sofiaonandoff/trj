import { tr } from '../i18n'
import { Copy, Mail, Send } from 'lucide-react'
import { inviteText, mailtoLink, type Invitee } from '../lib/invite'
import { copy } from './ui'

/**
 * 편집 권한을 준 뒤 보이는 '초대장 보내기' 칸.
 * Google 알림 메일 대신, trj 링크가 맨 앞에 오는 초대장을 메일 앱·다른 앱(카카오톡·메시지)·링크 복사로 보낸다.
 */
export default function InviteSend({ title, link, people, onDone }: { title: string; link: string; people: Invitee[]; onDone?: () => void }) {
  if (!people.length) return null
  const share = async (to?: string) => {
    const { body } = inviteText(title, link, to)
    if (navigator.share) { try { await navigator.share({ title: tr('[trj] {0} 함께 편집 초대', title), text: body }); return } catch { /* 닫으면 복사로 */ } }
    copy(body, tr('초대 문구를 복사했습니다. 메시지에 붙여 넣으세요'))
  }
  return (
    <section className="invite-send">
      <p className="invite-head"><Send size={16} />{tr('편집 권한을 줬습니다. 이제 초대장을 보내세요')}</p>
      <p className="hint" style={{ marginTop: 0 }}>{tr('초대장에는 trj 링크가 맨 앞에 들어 있어, 누르면 바로 여행이 열립니다.')}</p>
      {people.map((p) => (
        <div key={p.email} className="invite-row">
          <span className="grow"><b>{p.name}</b><small>{p.email}{p.notified ? ` · ${tr('Google 알림 메일도 갔습니다')}` : ''}</small></span>
          <a className="btn btn-primary" href={mailtoLink(p.email, title, link)}><Mail size={16} />{tr('메일')}</a>
          <button className="btn btn-ghost" onClick={() => share(p.email)} aria-label={tr('{0} 님에게 다른 앱으로 보내기', p.name)}><Send size={16} /></button>
        </div>
      ))}
      {people.some((p) => p.notified) && <p className="hint">{tr('Google 계정이 아닌 주소에는 Google이 알림 메일을 보냅니다. 그 메일의 파일 대신 초대장의 링크로 열라고 알려 주세요.')}</p>}
      <div className="row">
        <button className="btn btn-quiet" onClick={() => copy(link, tr('초대 링크를 복사했습니다'))}><Copy size={16} />{tr('링크만 복사')}</button>
        {onDone && <button className="btn btn-quiet" onClick={onDone}>{tr('다 보냈어요')}</button>}
      </div>
    </section>
  )
}
