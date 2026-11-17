import { tr } from '../i18n'
import { Check, X } from 'lucide-react'
import { useState } from 'react'
import { destination } from '../data/destinations'
import { haptic, uid } from '../lib/util'
import { MEMBER_COLORS, useStore } from '../store'
import type { Trip } from '../types'
import { Avatar, toast } from './ui'

export default function PrepTab({ trip }: { trip: Trip }) {
  const mutate = useStore((s) => s.mutate)
  const [text, setText] = useState('')
  const [group, setGroup] = useState(tr('짐'))
  const [person, setPerson] = useState('')
  const dest = destination(trip.destId)
  const groups = [...new Set(trip.checklist.map((c) => c.group))]
  const done = trip.checklist.filter((c) => c.done).length
  const pct = trip.checklist.length ? done / trip.checklist.length : 0
  const R = 30, C = 2 * Math.PI * R

  const addItem = () => {
    const v = text.trim()
    if (!v) return
    mutate(trip.id, (t) => { t.checklist.push({ id: uid(), text: v, group, done: false }) })
    setText('')
  }
  const addPerson = () => {
    const v = person.trim()
    if (!v) return
    if (trip.members.some((m) => m.name === v)) return toast(tr('같은 이름이 이미 있습니다'))
    mutate(trip.id, (t) => { t.members.push({ id: uid(), name: v, color: MEMBER_COLORS[t.members.length % MEMBER_COLORS.length] }) })
    setPerson('')
  }
  const removePerson = (id: string) => {
    if (trip.expenses.some((e) => e.payer === id || e.split.includes(id))) return toast(tr('지출 기록에 있는 사람은 뺄 수 없습니다'))
    mutate(trip.id, (t) => { t.members = t.members.filter((m) => m.id !== id); t.checklist.forEach((c) => { if (c.assignee === id) c.assignee = undefined }) })
  }
  /** 담당자를 차례로 바꾼다: 없음 → 첫 사람 → … → 없음 */
  const cycle = (itemId: string) => mutate(trip.id, (t) => {
    const c = t.checklist.find((x) => x.id === itemId)!
    const i = t.members.findIndex((m) => m.id === c.assignee)
    c.assignee = t.members[i + 1]?.id
  })

  return (
    <>
      <section className="panel">
        <div className="between">
          <div>
            <h2 style={{ marginBottom: 4 }}>{tr('준비물')}</h2>
            <p className="mute" style={{ fontSize: 13.5 }}>{trip.checklist.length ? (done === trip.checklist.length ? tr('모두 챙겼습니다') : tr('{0}개 남았습니다', trip.checklist.length - done)) : tr('챙길 것을 적어 두세요')}</p>
          </div>
          <div style={{ position: 'relative', width: 74, height: 74 }}>
            <svg className="ring" width="74" height="74" viewBox="0 0 74 74" aria-hidden="true">
              <circle className="bg" cx="37" cy="37" r={R} />
              <circle className="fg" cx="37" cy="37" r={R} strokeDasharray={C} strokeDashoffset={C * (1 - pct)} />
            </svg>
            <span className="num" style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', fontSize: 20 }}>{Math.round(pct * 100)}%</span>
          </div>
        </div>
        {dest && <p className="hint">{tr('{0} 전원: {1}', dest.city, dest.plug)}</p>}
      </section>

      {groups.map((g) => (
        <section className="panel" key={g}>
          <h2 style={{ marginBottom: 4 }}>{g}</h2>
          {trip.checklist.filter((c) => c.group === g).map((c) => {
            const who = trip.members.find((m) => m.id === c.assignee)
            return (
              <div key={c.id} className={`check${c.done ? ' done' : ''}`}>
                <button className="box" role="checkbox" aria-checked={c.done} aria-label={c.text}
                  onClick={() => { haptic(); mutate(trip.id, (t) => { const x = t.checklist.find((y) => y.id === c.id)!; x.done = !x.done }) }}><Check size={16} strokeWidth={3} /></button>
                <span>{c.text}</span>
                {trip.members.length > 1 && (
                  <button onClick={() => cycle(c.id)} aria-label={tr('담당: {0}. 눌러서 바꾸기', who?.name ?? tr('없음'))}>
                    {who ? <Avatar m={who} /> : <span className="avatar" style={{ background: 'var(--sunk)', color: 'var(--mute)' }}>+</span>}
                  </button>
                )}
                <button className="mute" aria-label={tr('{0} 삭제', c.text)} onClick={() => mutate(trip.id, (t) => { t.checklist = t.checklist.filter((x) => x.id !== c.id) })}><X size={16} /></button>
              </div>
            )
          })}
        </section>
      ))}

      <section className="panel">
        <h2>{tr('준비물 추가')}</h2>
        <div className="chips">
          {[...new Set([...groups, tr('짐'), tr('서류'), tr('전자기기')])].map((g) => <button key={g} className="chip" aria-pressed={group === g} onClick={() => setGroup(g)}>{g}</button>)}
        </div>
        <div className="inline-add">
          <input className="input" placeholder={tr('예: 수영복')} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addItem()} />
          <button className="btn btn-primary" disabled={!text.trim()} onClick={addItem}>{tr('추가')}</button>
        </div>
      </section>

      <section className="panel">
        <h2>{tr('함께 가는 사람')}</h2>
        <div className="chips">
          {trip.members.map((m) => (
            <span key={m.id} className="chip"><Avatar m={m} />{m.name}
              {trip.members.length > 1 && <button aria-label={tr('{0} 빼기', m.name)} onClick={() => removePerson(m.id)}><X size={14} /></button>}
            </span>
          ))}
        </div>
        <div className="inline-add">
          <input className="input" placeholder={tr('이름 추가')} value={person} onChange={(e) => setPerson(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addPerson()} />
          <button className="btn btn-ghost" disabled={!person.trim()} onClick={addPerson}>{tr('추가')}</button>
        </div>
        <p className="hint">{tr('여행 전체를 동행에게 보내려면 오른쪽 위 공유 버튼에서 링크를 만드세요.')}</p>
      </section>
    </>
  )
}
