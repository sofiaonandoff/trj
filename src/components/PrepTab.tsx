import { tr } from '../i18n'
import { Check, Mail, UserPlus, X } from 'lucide-react'
import { useState } from 'react'
import { destination } from '../data/destinations'
import { haptic, uid } from '../lib/util'
import { MEMBER_COLORS, useStore } from '../store'
import type { Trip } from '../types'
import Companions from './Companions'
import { Avatar, toast } from './ui'

export default function PrepTab({ trip }: { trip: Trip }) {
  const mutate = useStore((s) => s.mutate)
  const [text, setText] = useState('')
  const [group, setGroup] = useState(tr('짐'))
  const [people, setPeople] = useState(false)
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
        <div className="between"><h2 style={{ margin: 0 }}>{tr('함께 가는 사람')}</h2>
          <button className="btn btn-quiet" onClick={() => setPeople(true)}><UserPlus size={16} />{tr('동행 관리')}</button>
        </div>
        <div className="chips" style={{ marginTop: 10 }}>
          {trip.members.map((m) => <span key={m.id} className="chip"><Avatar m={m} />{m.name}{m.email && <Mail size={12} aria-label={tr('초대함')} />}</span>)}
        </div>
        <p className="hint">{tr('동행 추가·빼기와 이메일 초대는 동행 관리에서 합니다. 여행 화면 위의 얼굴 아이콘으로도 열 수 있습니다.')}</p>
      </section>
      <Companions trip={trip} open={people} onClose={() => setPeople(false)} />
    </>
  )
}
