import { tr } from '../i18n'
import { CalendarCheck, Loader2, Plane, Receipt, Undo2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { applyDraft, dateFromLabel, readTripPhoto, undoApplied, type Applied } from '../lib/photoImport'
import { md, won } from '../lib/util'
import { putFlight, useStore } from '../store'
import type { Trip } from '../types'
import { Sheet } from './ui'

interface Job { id: number; url: string; status: 'reading' | 'done' | 'error'; stage?: string; results: (Applied & { undone?: boolean })[]; error?: string }

const money = (a: { value: number; currency: string }) => (a.currency === 'KRW' ? won(a.value) : `${a.value.toLocaleString()} ${a.currency}`)

/**
 * 고른 사진들을 차례로 읽어 바로 일정·예산에 넣고, 무엇을 어느 날에 넣었는지 보여 준다.
 * 잘못 들어간 것은 여기서 바로 뺄 수 있다.
 */
export default function PhotoImport({ trip, files, current, onClose, onGo }: { trip: Trip; files: File[] | null; current: string; onClose: () => void; onGo: (date: string) => void }) {
  const mutate = useStore((s) => s.mutate)
  const [jobs, setJobs] = useState<Job[]>([])
  const seq = useRef(0)
  const tripRef = useRef(trip)
  tripRef.current = trip

  useEffect(() => {
    if (!files?.length) return
    const batch = files.slice(0, 10).map((f) => ({ f, job: { id: ++seq.current, url: URL.createObjectURL(f), status: 'reading' as const, results: [] } }))
    setJobs(batch.map((b) => b.job))
    const set = (id: number, patch: Partial<Job>) => setJobs((js) => js.map((j) => (j.id === id ? { ...j, ...patch } : j)))
    let alive = true
    ;(async () => {
      // 글자 인식은 무거우니 한 장씩 읽는다
      const queue = [...batch]
      const worker = async () => {
        for (let b = queue.shift(); b; b = queue.shift()) {
          try {
            const drafts = await readTripPhoto(b.f, tripRef.current, current, (stage) => { if (alive) set(b.job.id, { stage }) })
            if (!alive) return
            const results: Applied[] = []
            mutate(trip.id, (t) => { for (const d of drafts) results.push(applyDraft(t, d, putFlight)) })
            set(b.job.id, { status: 'done', results })
          } catch (e) {
            if (alive) set(b.job.id, { status: 'error', error: (e as Error).message || tr('사진을 읽지 못했습니다') })
          }
        }
      }
      await worker()
    })()
    return () => { alive = false; batch.forEach((b) => URL.revokeObjectURL(b.job.url)) }
  }, [files]) // eslint-disable-line react-hooks/exhaustive-deps

  const dayNo = (date: string) => trip.days.findIndex((d) => d.date === date) + 1
  const undo = (jobId: number, k: number) => {
    const a = jobs.find((j) => j.id === jobId)?.results[k]
    if (!a) return
    mutate(trip.id, (t) => undoApplied(t, a))
    setJobs((js) => js.map((j) => (j.id === jobId ? { ...j, results: j.results.map((r, i) => (i === k ? { ...r, undone: true } : r)) } : j)))
  }
  const busy = jobs.some((j) => j.status === 'reading')
  const moved = jobs.flatMap((j) => j.results).find((r) => !r.undone && !r.flightId && r.date !== current && dayNo(r.date) > 0)

  return (
    <Sheet open={Boolean(files?.length)} onClose={onClose} title={busy ? tr('사진을 읽는 중') : tr('사진에서 넣은 것')}>
      <div className="imports">
        {jobs.map((j) => (
          <div className="import" key={j.id}>
            <img src={j.url} alt="" />
            <div className="grow">
              {j.status === 'reading' && <p className="mute"><Loader2 size={15} className="spin" /> {j.stage ?? tr('사진을 여는 중')}</p>}
              {j.status === 'error' && <p className="parsed miss">{j.error}</p>}
              {j.status === 'done' && !j.results.length && <p className="mute">{tr('일정에 넣을 내용을 찾지 못했습니다')}</p>}
              {j.results.map((r, k) => (
                <div className={`import-row${r.undone ? ' undone' : ''}`} key={k}>
                  <span className="grow">
                    <b>{r.flightId ? <Plane size={14} /> : r.noPlace ? <Receipt size={14} /> : null} {r.title}</b>
                    <small>
                      {[
                        r.flightId ? tr('항공편') : tr('{0}일차', dayNo(r.date)),
                        md(r.date), r.time,
                        r.amount && (r.expenseId ? tr('{0} 예산에 기록', money(r.amount)) : money(r.amount)),
                      ].filter(Boolean).join(' · ')}
                    </small>
                    {!r.undone && r.date !== current && !r.flightId && dayNo(r.date) > 0 && (
                      <small className="moved"><CalendarCheck size={13} />{tr('{0}에 맞춰 {1}일차에 넣었습니다', dateFromLabel(r.dateFrom), dayNo(r.date))}</small>
                    )}
                    {r.noPlace && <small className="mute">{tr('위치를 찾지 못해 예산에만 기록했습니다')}</small>}
                    {r.duplicate && <small className="mute">{tr('이미 들어 있어 다시 넣지 않았습니다')}</small>}
                    {r.undone && <small className="mute">{tr('뺐습니다')}</small>}
                  </span>
                  {!r.undone && !(r.duplicate && !r.expenseId && !r.placeAdded) && (
                    <button className="icon-btn" aria-label={tr('{0} 빼기', r.title)} onClick={() => undo(j.id, k)}><Undo2 size={18} /></button>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <p className="hint">{tr('영수증, 예약 화면, 탑승권, 장소 사진을 이 기기 안에서 읽습니다 (사진은 밖으로 나가지 않습니다). 날짜는 사진 속 날짜, 없으면 찍은 날짜를 따르고, 금액은 예산 탭에 기록되어 동행과 똑같이 나눕니다.')}</p>
      {!busy && (
        <div className="row" style={{ marginTop: 12 }}>
          {moved && <button className="btn btn-ghost" onClick={() => { onGo(moved.date); onClose() }}>{tr('{0}일차 보기', dayNo(moved.date))}</button>}
          <button className="btn btn-primary" onClick={onClose}>{tr('확인')}</button>
        </div>
      )}
    </Sheet>
  )
}
