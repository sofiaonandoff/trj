import { tr } from '../i18n'
import { tx, useTranslations } from '../lib/translate'
import { ArrowRight, Plus, Trash2 } from 'lucide-react'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { md, today, uid, won } from '../lib/util'
import { CURRENCIES, baseOf, customRate, krwToBase, money, rateInBase, rateOf, resetRate, setBudget, setRateInBase, setViewerBase, onBaseChange, budgetCurrency, budgetKrw as budgetInKrw, toWon as wonOf, unit } from '../data/currencies'
import CurrencySelect from './CurrencySelect'
import { RotateCcw } from 'lucide-react'
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

/** readOnly: 로그인 없이 보는 링크에서 쓴다 (고치는 칸과 버튼을 숨긴다) */
export default function BudgetTab({ trip, readOnly = false }: { trip: Trip; readOnly?: boolean }) {
  useTranslations()
  const mutate = useStore((s) => s.mutate)
  const [edit, setEdit] = useState<Expense | 'new'>()
  const toWon = (e: Expense) => wonOf(trip, e.amount, e.currency)
  const total = trip.expenses.reduce((s, e) => s + toWon(e), 0)
  const byCat = CATS.map((c) => ({ c, v: trip.expenses.filter((e) => e.category === c).reduce((s, e) => s + toWon(e), 0) })).filter((x) => x.v > 0)
  const transfers = settle(trip, toWon)
  const name = (id: string) => trip.members.find((m) => m.id === id)
  useSyncExternalStore(onBaseChange, baseOf)
  const base = baseOf(trip)
  /** 원화로 계산한 금액을 기준 화폐로 보여 준다 */
  const M = (krw: number) => money(krwToBase(trip, krw), base)
  const budgetKrw = budgetInKrw(trip)
  // 예산 칸: 예산이 다른 화폐로 적혀 있으면 내 기준 화폐로 바꿔 보여 준다
  const budgetShown = !trip.budget ? 0 : budgetCurrency(trip) === base ? trip.budget : Math.round(krwToBase(trip, budgetKrw) * 100) / 100
  const over = trip.budget > 0 && total > budgetKrw
  // 환율을 보여 줄 화폐: 여행지 화폐와 지출에 쓴 화폐 (기준 화폐는 빼고)
  const used = [...new Set([trip.currency, ...trip.expenses.map((e) => e.currency)])].filter((c) => c !== base)
  // 결제한 사람별: 낸 돈과 자기 몫
  const byPayer = trip.members.map((m) => ({
    m,
    paid: trip.expenses.filter((e) => e.payer === m.id).reduce((s, e) => s + toWon(e), 0),
    count: trip.expenses.filter((e) => e.payer === m.id).length,
    share: trip.expenses.reduce((s, e) => (e.split.includes(m.id) ? s + toWon(e) / e.split.length : s), 0),
  }))
  const totalBase = krwToBase(trip, total)

  return (
    <>
      <section className="panel">
        <div className="between">
          <h2 style={{ margin: 0 }}>{tr('지금까지 쓴 돈')}</h2>
          <span className="mute" style={{ fontSize: 13 }}>{tr('1인 {0}', M(total / trip.members.length))}</span>
        </div>
        <div className="big" style={{ marginTop: 10, color: over ? 'var(--warn)' : undefined }}>
          {totalBase.toLocaleString('ko-KR', { maximumFractionDigits: base === 'KRW' || totalBase >= 1000 ? 0 : 2 })}<small>{base === 'KRW' ? unit(base) : ` ${base}`}</small>
        </div>
        <div className="meter" role="img" aria-label={tr('항목별 지출 비율')}>
          {byCat.map(({ c, v }) => <i key={c} style={{ width: `${(v / Math.max(total, budgetKrw || 0)) * 100}%`, background: CAT[c].color }} />)}
        </div>
        <div className="legend">{byCat.map(({ c, v }) => <span key={c}><i className="dot" style={{ background: CAT[c].color }} />{CAT[c].label} {M(v)}</span>)}</div>
        {readOnly ? (
          trip.budget > 0 && <p className="hint">{tr('전체 예산 {0}', money(budgetShown, base))}</p>
        ) : <div className="row" style={{ marginTop: 16 }}>
          <label className="field"><span>{tr('전체 예산 ({0})', unit(base))}</span>
            <input type="number" inputMode="decimal" min={0} step="any" value={budgetShown || ''} placeholder={tr('정하지 않음')} onChange={(e) => mutate(trip.id, (t) => setBudget(t, Number(e.target.value) || 0))} /></label>
          <CurrencySelect trip={trip} value={base} label={tr('내 기준 화폐')} onChange={setViewerBase} />
        </div>}
        {trip.budget > 0 && <p className="hint">{over ? tr('예산을 {0} 넘었습니다', M(total - budgetKrw)) : tr('예산이 {0} 남았습니다', M(budgetKrw - total))}</p>}
      </section>

      {/* 쓴 돈 바로 아래에서도 지출을 기록할 수 있게 */}
      {!readOnly && <div style={{ margin: '12px 20px 0' }}><button className="btn btn-primary btn-block" onClick={() => setEdit('new')}><Plus size={18} />{tr('지출 기록')}</button></div>}

      {used.length > 0 && (
        <section className="panel">
          <div className="between"><h2 style={{ margin: 0 }}>{tr('환율')}</h2>{readOnly && <span className="mute" style={{ fontSize: 13 }}>{tr('기준 화폐 {0}', base)}</span>}</div>
          <div className="rates">
            {used.map((c) => {
              const { per, value } = rateInBase(trip, c)
              const mine = customRate(trip, c)
              return (
                <div className="rate-row" key={c}>
                  <span className="rate-from">{per.toLocaleString('ko-KR')} {c} =</span>
                  {readOnly ? <b className="num">{+value.toPrecision(4)} {base}</b> : <>
                    <input className="input" type="number" inputMode="decimal" min={0} step="any" aria-label={tr('{0} 환율', c)}
                      defaultValue={+value.toPrecision(4)} key={`${c}${base}${value.toPrecision(6)}`}
                      onBlur={(e) => { const v = Number(e.target.value); if (v > 0 && Math.abs(v - value) / value > 1e-6) mutate(trip.id, (t) => setRateInBase(t, c, per, v)) }}
                      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />
                    <span className="rate-to">{base}</span>
                    {mine
                      ? <button className="icon-btn" aria-label={tr('{0} 환율을 기본값으로', c)} title={tr('기본값으로')} onClick={() => mutate(trip.id, (t) => resetRate(t, c))}><RotateCcw size={16} /></button>
                      : <span className="rate-tag">{tr('어림값')}</span>}
                  </>}
                </div>
              )
            })}
          </div>
        </section>
      )}

      {trip.members.length > 1 && total > 0 && (
        <section className="panel">
          <h2>{tr('사람별로 쓴 돈')}</h2>
          {byPayer.map(({ m, paid, count, share }) => (
            <div className="payer" key={m.id}>
              <Avatar m={m} />
              <span className="grow"><b>{m.name}</b>
                <small>{count ? tr('{0}건 결제', count) : tr('결제 없음')}</small></span>
              <span style={{ textAlign: 'right' }}>
                <b className="num">{M(paid)}</b>
                <small>{tr('자기 몫 {0}', M(share))}</small>
              </span>
            </div>
          ))}
        </section>
      )}

      {trip.members.length > 1 && transfers.length > 0 && (
        <section className="panel">
          <h2>{tr('이렇게 보내면 정산 끝')}</h2>
          {transfers.map((t, i) => (
            <div className="settle" key={i}>
              {name(t.from) && <Avatar m={name(t.from)!} />}<span>{name(t.from)?.name}</span>
              <ArrowRight size={16} className="mute" />
              {name(t.to) && <Avatar m={name(t.to)!} />}<span>{name(t.to)?.name}</span>
              <span className="num">{M(t.amount)}</span>
            </div>
          ))}
        </section>
      )}

      <section style={{ padding: '16px 20px 0' }}>
        {trip.expenses.length ? (
          <div className="list">
            {[...trip.expenses].sort((a, b) => b.date.localeCompare(a.date)).map((e) => (
              <button key={e.id} onClick={() => !readOnly && setEdit(e)} disabled={readOnly} className={readOnly ? 'static' : undefined}>
                <i className="dot" style={{ background: CAT[e.category].color }} />
                <span className="grow"><b>{tx(e.title)}</b><small>{tr('{0} · {1} 결제 · {2}명', md(e.date), name(e.payer)?.name ?? '?', e.split.length)}</small></span>
                <span style={{ textAlign: 'right' }}>
                  <b className="num" style={{ fontSize: 17 }}>{e.amount.toLocaleString('ko-KR')} {unit(e.currency)}</b>
                  {e.currency !== base && <small>{M(toWon(e))}</small>}
                </span>
              </button>
            ))}
          </div>
        ) : <div className="empty"><strong>{tr('기록한 지출이 없습니다')}</strong>{readOnly ? null : tr('결제한 사람과 나눌 사람을 고르면 정산까지 계산합니다.')}</div>}
        {!readOnly && <button className="btn btn-primary btn-block" style={{ marginTop: 14 }} onClick={() => setEdit('new')}><Plus size={18} />{tr('지출 기록')}</button>}
      </section>

      {!readOnly && <ExpenseSheet trip={trip} edit={edit} onClose={() => setEdit(undefined)} />}
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
  // 자주 쓰는 통화: 여행지 통화, 원화, 이 여행에서 이미 쓴 통화
  const quick = [...new Set([trip.currency, 'KRW', ...trip.expenses.map((e) => e.currency), ...(d ? [d.currency] : [])])].filter((c) => c !== '')

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
          </div>
          <div className="field"><span>{tr('통화')}</span>
            <div className="chips">
              {quick.map((c) => <button key={c} className="chip" aria-pressed={d.currency === c} onClick={() => set({ currency: c })}>{c === 'KRW' ? tr('원 (KRW)') : c}</button>)}
              <select className="chip cur-select" aria-label={tr('다른 통화')} value={quick.includes(d.currency) ? '' : d.currency} onChange={(e) => e.target.value && set({ currency: e.target.value })}>
                <option value="">{tr('다른 통화…')}</option>
                {CURRENCIES.filter((c) => !quick.includes(c.code)).map((c) => <option key={c.code} value={c.code}>{c.code} · {c.name}</option>)}
              </select>
            </div>
            {d.currency !== baseOf(trip) && d.amount > 0 && (() => { const x = rateInBase(trip, d.currency); return <small className="hint" style={{ marginTop: 6 }}>{tr('약 {0} ({1} {2} = {3} {4})', money(krwToBase(trip, wonOf(trip, d.amount, d.currency)), baseOf(trip)), x.per.toLocaleString('ko-KR'), d.currency, +x.value.toPrecision(4), baseOf(trip))}</small> })()}
          </div>
          <div className="field"><span>{tr('항목')}</span>
            <div className="chips">{CATS.map((c) => <button key={c} className="chip" aria-pressed={d.category === c} onClick={() => set({ category: c })}>{CAT[c].label}</button>)}</div>
          </div>
          <label className="field"><span>{tr('날짜')}</span><input type="date" value={d.date} onChange={(e) => set({ date: e.target.value })} /></label>
          <div className="field"><span>{tr('결제한 사람')}</span>
            <div className="chips">{trip.members.map((m) => <button key={m.id} className="chip" aria-pressed={d.payer === m.id} onClick={() => set({ payer: m.id })}>{m.name}</button>)}</div>
          </div>
          {trip.members.length > 1 && (
            <div className="field"><span>{tr('나눌 사람 ({0}명', d.split.length)}{d.amount > 0 && d.split.length ? tr(', 1인 {0} {1}', (Math.round((d.amount / d.split.length) * 10) / 10).toLocaleString('ko-KR'), unit(d.currency)) : ''})</span>
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
