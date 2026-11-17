import { tr } from '../i18n'
import { ArrowRight, Plus, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { md, today, uid, won } from '../lib/util'
import { useStore } from '../store'
import type { Expense, ExpenseCategory, Trip } from '../types'
import { Avatar, Sheet, toast } from './ui'

const CAT: Record<ExpenseCategory, { label: string; color: string }> = {
  food: { label: tr('식비'), color: '#B0603A' }, stay: { label: tr('숙박'), color: '#2F5D57' }, move: { label: tr('교통'), color: '#5C7F4E' },
  play: { label: tr('관광'), color: '#5E5A86' }, shop: { label: tr('쇼핑'), color: '#96506A' }, etc: { label: tr('기타'), color: '#7A8580' },
}
const CATS = Object.keys(CAT) as ExpenseCategory[]

/** 누가 누구에게 얼마를 보내면 끝나는지, 송금 횟수가 적게 나오도록 계산한다 */
function settle(trip: Trip, toWon: (e: Expense) => number) {
  const bal = new Map(trip.members.map((m) => [m.id, 0]))
  for (const e of trip.expenses) {
    const split = e.split.filter((id) => bal.has(id))
    if (!bal.has(e.payer) || !split.length) continue
    const total = toWon(e)
    bal.set(e.payer, bal.get(e.payer)! + total)
    split.forEach((id) => bal.set(id, bal.get(id)! - total / split.length))
  }
  const debt = [...bal].filter(([, v]) => v < -1).map(([id, v]) => ({ id, v: -v })).sort((a, b) => b.v - a.v)
  const cred = [...bal].filter(([, v]) => v > 1).map(([id, v]) => ({ id, v })).sort((a, b) => b.v - a.v)
  const out: { from: string; to: string; amount: number }[] = []
  let i = 0, j = 0
  while (i < debt.length && j < cred.length) {
    const amount = Math.min(debt[i].v, cred[j].v)
    out.push({ from: debt[i].id, to: cred[j].id, amount })
    debt[i].v -= amount; cred[j].v -= amount
    if (debt[i].v < 1) i++
    if (cred[j].v < 1) j++
  }
  return out
}

export default function BudgetTab({ trip }: { trip: Trip }) {
  const mutate = useStore((s) => s.mutate)
  const [edit, setEdit] = useState<Expense | 'new'>()
  const toWon = (e: Expense) => e.amount * (e.currency === 'KRW' ? 1 : trip.rate)
  const total = trip.expenses.reduce((s, e) => s + toWon(e), 0)
  const byCat = CATS.map((c) => ({ c, v: trip.expenses.filter((e) => e.category === c).reduce((s, e) => s + toWon(e), 0) })).filter((x) => x.v > 0)
  const transfers = settle(trip, toWon)
  const name = (id: string) => trip.members.find((m) => m.id === id)
  const over = trip.budget > 0 && total > trip.budget
  const foreign = trip.currency !== 'KRW'

  return (
    <>
      <section className="panel">
        <div className="between">
          <h2 style={{ margin: 0 }}>{tr('지금까지 쓴 돈')}</h2>
          <span className="mute" style={{ fontSize: 13 }}>{tr('1인 {0}', won(total / trip.members.length))}</span>
        </div>
        <div className="big" style={{ marginTop: 10, color: over ? 'var(--warn)' : undefined }}>{Math.round(total).toLocaleString('ko-KR')}<small>{tr('원')}</small></div>
        <div className="meter" role="img" aria-label={tr('항목별 지출 비율')}>
          {byCat.map(({ c, v }) => <i key={c} style={{ width: `${(v / Math.max(total, trip.budget || 0)) * 100}%`, background: CAT[c].color }} />)}
        </div>
        <div className="legend">{byCat.map(({ c, v }) => <span key={c}><i className="dot" style={{ background: CAT[c].color }} />{CAT[c].label} {won(v)}</span>)}</div>
        <div className="row" style={{ marginTop: 16 }}>
          <label className="field"><span>{tr('전체 예산(원)')}</span>
            <input type="number" inputMode="numeric" min={0} step={10000} value={trip.budget || ''} placeholder={tr('정하지 않음')} onChange={(e) => mutate(trip.id, (t) => { t.budget = Number(e.target.value) || 0 })} /></label>
          {foreign && <label className="field"><span>{tr('환율 (1 {0} = 원)', trip.currency)}</span>
            <input type="number" inputMode="decimal" min={0} step="any" value={trip.rate} onChange={(e) => mutate(trip.id, (t) => { t.rate = Number(e.target.value) || 0 })} /></label>}
        </div>
        {trip.budget > 0 && <p className="hint">{over ? tr('예산을 {0} 넘었습니다', won(total - trip.budget)) : tr('예산이 {0} 남았습니다', won(trip.budget - total))}</p>}
        {foreign && <p className="hint">{tr('환율은 어림값으로 들어가 있습니다. 실제 환전·결제 환율로 고쳐 쓰세요.')}</p>}
      </section>

      {trip.members.length > 1 && transfers.length > 0 && (
        <section className="panel">
          <h2>{tr('이렇게 보내면 정산 끝')}</h2>
          {transfers.map((t, i) => (
            <div className="settle" key={i}>
              {name(t.from) && <Avatar m={name(t.from)!} />}<span>{name(t.from)?.name}</span>
              <ArrowRight size={16} className="mute" />
              {name(t.to) && <Avatar m={name(t.to)!} />}<span>{name(t.to)?.name}</span>
              <span className="num">{won(t.amount)}</span>
            </div>
          ))}
        </section>
      )}

      <section style={{ padding: '16px 20px 0' }}>
        {trip.expenses.length ? (
          <div className="list">
            {[...trip.expenses].sort((a, b) => b.date.localeCompare(a.date)).map((e) => (
              <button key={e.id} onClick={() => setEdit(e)}>
                <i className="dot" style={{ background: CAT[e.category].color }} />
                <span className="grow"><b>{e.title}</b><small>{tr('{0} · {1} 결제 · {2}명', md(e.date), name(e.payer)?.name ?? '?', e.split.length)}</small></span>
                <span style={{ textAlign: 'right' }}>
                  <b className="num" style={{ fontSize: 17 }}>{e.amount.toLocaleString('ko-KR')} {e.currency === 'KRW' ? tr('원') : e.currency}</b>
                  {e.currency !== 'KRW' && <small>{won(toWon(e))}</small>}
                </span>
              </button>
            ))}
          </div>
        ) : <div className="empty"><strong>{tr('기록한 지출이 없습니다')}</strong>{tr('결제한 사람과 나눌 사람을 고르면 정산까지 계산합니다.')}</div>}
        <button className="btn btn-primary btn-block" style={{ marginTop: 14 }} onClick={() => setEdit('new')}><Plus size={18} />{tr('지출 기록')}</button>
      </section>

      <ExpenseSheet trip={trip} edit={edit} onClose={() => setEdit(undefined)} />
    </>
  )
}

function ExpenseSheet({ trip, edit, onClose }: { trip: Trip; edit?: Expense | 'new'; onClose: () => void }) {
  const mutate = useStore((s) => s.mutate)
  const existing = edit && edit !== 'new' ? edit : undefined
  const [d, setD] = useState<Expense>()
  useEffect(() => {
    if (!edit) return
    const t = today()
    setD(existing ? { ...existing } : {
      id: uid(), title: '', amount: 0, currency: trip.currency, category: 'food', payer: trip.members[0].id,
      split: trip.members.map((m) => m.id), date: t >= trip.start && t <= trip.end ? t : trip.start,
    })
  }, [edit]) // eslint-disable-line react-hooks/exhaustive-deps
  const set = (p: Partial<Expense>) => setD((x) => (x ? { ...x, ...p } : x))
  const ok = d && d.title.trim() && d.amount > 0 && d.split.length > 0

  const save = () => {
    if (!d) return
    mutate(trip.id, (t) => { const i = t.expenses.findIndex((e) => e.id === d.id); if (i >= 0) t.expenses[i] = d; else t.expenses.push(d) })
    toast(tr('지출을 기록했습니다')); onClose()
  }
  const remove = () => { mutate(trip.id, (t) => { t.expenses = t.expenses.filter((e) => e.id !== d?.id) }); toast(tr('지출을 삭제했습니다')); onClose() }

  return (
    <Sheet open={Boolean(edit && d)} onClose={onClose} title={existing ? tr('지출 수정') : tr('지출 기록')}
      foot={<>
        {existing && <button className="btn btn-ghost" style={{ flex: 'none', color: 'var(--warn)' }} onClick={remove} aria-label={tr('지출 삭제')}><Trash2 size={18} /></button>}
        <button className="btn btn-primary" disabled={!ok} onClick={save}>{existing ? tr('변경 내용 저장') : tr('지출 기록')}</button>
      </>}>
      {d && (
        <div className="stack">
          <label className="field"><span>{tr('내용')}</span><input value={d.title} onChange={(e) => set({ title: e.target.value })} placeholder={tr('예: 저녁 라멘')} /></label>
          <div className="row">
            <label className="field"><span>{tr('금액')}</span><input type="number" inputMode="decimal" min={0} value={d.amount || ''} onChange={(e) => set({ amount: Number(e.target.value) })} /></label>
            {trip.currency !== 'KRW' ? (
              <div className="field"><span>{tr('통화')}</span>
                <div className="seg" style={{ height: 48 }}>
                  {[trip.currency, 'KRW'].map((c) => <button key={c} style={{ height: 42 }} aria-pressed={d.currency === c} onClick={() => set({ currency: c })}>{c === 'KRW' ? tr('원') : c}</button>)}
                </div>
              </div>
            ) : null}
          </div>
          <div className="field"><span>{tr('항목')}</span>
            <div className="chips">{CATS.map((c) => <button key={c} className="chip" aria-pressed={d.category === c} onClick={() => set({ category: c })}>{CAT[c].label}</button>)}</div>
          </div>
          <label className="field"><span>{tr('날짜')}</span><input type="date" value={d.date} onChange={(e) => set({ date: e.target.value })} /></label>
          <div className="field"><span>{tr('결제한 사람')}</span>
            <div className="chips">{trip.members.map((m) => <button key={m.id} className="chip" aria-pressed={d.payer === m.id} onClick={() => set({ payer: m.id })}>{m.name}</button>)}</div>
          </div>
          {trip.members.length > 1 && (
            <div className="field"><span>{tr('나눌 사람 ({0}명', d.split.length)}{d.amount > 0 && d.split.length ? tr(', 1인 {0} {1}', (Math.round((d.amount / d.split.length) * 10) / 10).toLocaleString('ko-KR'), d.currency === 'KRW' ? tr('원') : d.currency) : ''})</span>
              <div className="chips">{trip.members.map((m) => (
                <button key={m.id} className="chip" aria-pressed={d.split.includes(m.id)} onClick={() => set({ split: d.split.includes(m.id) ? d.split.filter((x) => x !== m.id) : [...d.split, m.id] })}>{m.name}</button>
              ))}</div>
            </div>
          )}
        </div>
      )}
    </Sheet>
  )
}
