import { tr } from '../i18n'

/**
 * 함께 편집 초대장. Google 공유 알림 대신 trj가 보내는 초대장이라 링크가 맨 앞에 온다.
 * 링크를 누르면 trj가 열리고, 초대받은 Google 계정으로 로그인하면 바로 같은 여행을 고칠 수 있다.
 */
export interface Invitee { name: string; email: string; notified?: boolean }

export function inviteText(title: string, link: string, to?: string) {
  const subject = tr('[trj] {0} 함께 편집 초대', title)
  const body = [
    tr('{0} 일정을 trj에서 함께 짜요.', title),
    '',
    tr('▶ 아래 링크를 누르면 바로 열립니다'),
    link,
    '',
    to ? tr('열 때 이 초대를 받은 Google 계정({0})으로 로그인하세요.', to) : tr('열 때 초대받은 Google 계정으로 로그인하세요.'),
    tr('Google Drive에 보이는 여행 파일(.json)은 열지 않아도 됩니다.'),
  ].join('\n')
  return { subject, body }
}

export const mailtoLink = (to: string, title: string, link: string) => {
  const { subject, body } = inviteText(title, link, to)
  return `mailto:${to.trim().replace(/[\s?&#]/g, '')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}

/** 새 여행을 만들며 권한을 준 동행을 여행 화면에 알려, 초대장 보내기 화면을 띄우게 한다 */
const EVENT = 'trj-invites'
export const announceInvites = (tripId: string, people: Invitee[]) => {
  try { sessionStorage.setItem(`${EVENT}:${tripId}`, JSON.stringify(people)) } catch { /* 저장소를 못 쓰면 이벤트만 */ }
  dispatchEvent(new CustomEvent(EVENT, { detail: { tripId, people } }))
}
export function takeAnnounced(tripId: string): Invitee[] | undefined {
  try {
    const v = sessionStorage.getItem(`${EVENT}:${tripId}`)
    if (!v) return undefined
    sessionStorage.removeItem(`${EVENT}:${tripId}`)
    return JSON.parse(v) as Invitee[]
  } catch { return undefined }
}
export function onAnnounced(tripId: string, cb: (p: Invitee[]) => void) {
  const h = (e: Event) => { const d = (e as CustomEvent<{ tripId: string; people: Invitee[] }>).detail; if (d.tripId === tripId) { takeAnnounced(tripId); cb(d.people) } }
  addEventListener(EVENT, h)
  return () => removeEventListener(EVENT, h)
}
