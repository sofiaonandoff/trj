import { mergePeople } from '../src/lib/people'

let fail = 0
const check = (label: string, ok: boolean, got?: unknown) => { if (!ok) fail++; console.log(ok ? 'PASS' : 'FAIL', label, ok ? '' : JSON.stringify(got)) }
const M = (id: string, name: string, email?: string) => ({ id, name, color: '', email })
const members = [M('a', '나'), M('b', '민지', 'Minji@Gmail.com '), M('c', '준호')]
const editors = [
  { id: 'p0', role: 'owner', email: 'me@gmail.com', name: 'Hyesoo' },
  { id: 'p1', role: 'writer', email: 'minji@gmail.com', name: 'Minji Kim' },
  { id: 'p2', role: 'writer', email: 'sora@gmail.com', name: 'Sora' },
]
const ps = mergePeople(members, editors)
check('나 = Drive 주인', ps[0].me === true && ps[0].editor?.id === 'p0')
check('이름으로 넣은 민지와 초대한 민지 이메일은 한 사람 (대소문자·공백 무시)', ps[1].member?.id === 'b' && ps[1].editor?.id === 'p1')
check('이름만 있는 준호는 편집 권한 없음', ps[2].member?.id === 'c' && !ps[2].editor)
check('동행 목록에 없는 편집자는 따로', ps.length === 4 && !ps[3].member && ps[3].editor?.id === 'p2')
check('함께 편집 전이면 동행만', mergePeople(members, []).every((p) => p.member && !p.editor))
console.log(fail ? `${fail}개 실패` : '모두 통과')
process.exit(fail ? 1 : 0)
