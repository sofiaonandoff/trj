import type { Member } from '../types'

/** Drive 파일의 사용자 권한 (drive.ts의 Editor와 같은 모양) */
export interface EditorLike { id: string; role: string; email?: string; name?: string }

/** 한 사람: 여행의 동행(이름, 예산·준비물에 쓰임)과 Drive 편집 권한(이메일)을 묶은 것 */
export interface Person<E extends EditorLike = EditorLike> { member?: Member; editor?: E; me?: boolean }

const same = (a?: string, b?: string) => Boolean(a && b && a.trim().toLowerCase() === b.trim().toLowerCase())

/**
 * 동행과 편집자를 이메일로 묶는다 (대소문자·앞뒤 공백 무시).
 * 첫 동행 '나'에게 이메일이 없으면 Drive의 주인(owner)을 나로 본다.
 * 동행 목록에 없는 편집자는 따로 뒤에 붙인다.
 */
export function mergePeople<E extends EditorLike>(members: Member[], editors: E[]): Person<E>[] {
  const used = new Set<string>()
  const out: Person<E>[] = members.map((m, i) => {
    let ed = editors.find((e) => !used.has(e.id) && same(e.email, m.email))
    if (!ed && i === 0 && !m.email) ed = editors.find((e) => e.role === 'owner' && !used.has(e.id))
    if (ed) used.add(ed.id)
    return { member: m, editor: ed, me: i === 0 }
  })
  for (const e of editors) if (!used.has(e.id)) out.push({ editor: e })
  return out
}
