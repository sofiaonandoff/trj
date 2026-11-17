import { tr } from '../i18n'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowLeft, Search, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { CATEGORY, DESTINATIONS, type Destination } from '../data/destinations'
import { aiMessage, aiPlanTrip } from '../lib/ai'
import { searchPlaces, type GeoResult } from '../lib/geocode'
import { PACE, type Pace } from '../lib/planner'
import { addDays, dateRange, haptic, today } from '../lib/util'
import { buildTrip, useStore } from '../store'
import type { Category } from '../types'
import { go, toast } from './ui'

const INTERESTS: Category[] = ['food', 'cafe', 'sight', 'culture', 'nature', 'shop', 'night']

export default function NewTrip() {
  const add = useStore((s) => s.add)
  const [step, setStep] = useState(0)
  const [dest, setDest] = useState<Destination>()
  const [custom, setCustom] = useState<GeoResult>()
  const [q, setQ] = useState('')
  const [results, setResults] = useState<GeoResult[]>()
  const [searchError, setSearchError] = useState('')
  const [start, setStart] = useState(addDays(today(), 14))
  const [end, setEnd] = useState(addDays(today(), 17))
  const [people, setPeople] = useState<string[]>([tr('나')])
  const [name, setName] = useState('')
  const [pace, setPace] = useState<Pace>('normal')
  const [interests, setInterests] = useState<Category[]>(['food', 'sight'])
  const [recommend, setRecommend] = useState(true)
  const [drawing, setDrawing] = useState(false)

  // 목록에 없는 도시는 입력을 멈춘 뒤 검색한다
  useEffect(() => {
    if (q.trim().length < 2) { setResults(undefined); return }
    const ac = new AbortController()
    const id = setTimeout(() => {
      searchPlaces(q, undefined, ac.signal).then((r) => { setResults(r); setSearchError('') })
        .catch((e) => { if (e.name !== 'AbortError') setSearchError(tr('검색하지 못했습니다. 연결을 확인한 뒤 다시 입력하세요')) })
    }, 500)
    return () => { clearTimeout(id); ac.abort() }
  }, [q])

  const city = dest?.city ?? custom?.name
  const nights = dateRange(start, end).length - 1
  const canNext = step === 0 ? Boolean(city) : step === 1 ? end >= start : true

  const addPerson = () => { const n = name.trim(); if (n && !people.includes(n)) setPeople([...people, n]); setName('') }

  const create = async () => {
    const base = { dest, city: city!, country: custom?.country, lat: custom?.lat, lng: custom?.lng, start, end, pace, interests, people }
    haptic(12)
    setDrawing(true)
    const began = Date.now()
    let trip = buildTrip({ ...base, recommend: false })
    let note = ''
    if (recommend) {
      try {
        // 먼저 AI에게 맡기고, 안 되면 기기 안의 기본 추천(준비된 도시만)으로 만든다
        trip.days = await aiPlanTrip({ city: trip.city, country: trip.country, lat: trip.lat, lng: trip.lng, start, end, pace, interests })
        note = tr('AI가 짠 초안입니다. 위치와 영업시간은 가기 전에 확인하세요')
      } catch (e) {
        if (dest) { trip = buildTrip({ ...base, recommend: true }); note = tr('{0}. 기본 추천으로 만들었습니다', aiMessage(e)) }
        else note = tr('{0}. 빈 일정으로 시작합니다', aiMessage(e))
      }
    }
    // 선이 다 그려질 때까지는 화면을 유지한다
    await new Promise((r) => setTimeout(r, Math.max(0, 1500 - (Date.now() - began))))
    add(trip)
    go(`/trip/${trip.id}`, true)
    if (note) toast(note)
  }

  return (
    <div className="shell">
      <div className="topbar">
        <button className="icon-btn" aria-label={tr('뒤로')} onClick={() => (step ? setStep(step - 1) : history.back())}><ArrowLeft size={22} /></button>
        <h1>{tr('새 여행')}</h1>
      </div>
      <div className="steps" aria-hidden="true">{[0, 1, 2].map((i) => <i key={i} className={i <= step ? 'on' : ''} />)}</div>

      <AnimatePresence mode="wait">
        <motion.div key={step} className="wizard" initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }} transition={{ duration: 0.2 }}>
          {step === 0 && (
            <>
              <h2>{tr('어디로 떠나나요')}</h2>
              <p className="lead">{tr('아래 도시는 동선까지 이은 일정 초안을 바로 받을 수 있습니다.')}</p>
              <label className="field" style={{ position: 'relative' }}>
                <span className="sr">{tr('다른 도시 검색')}</span>
                <Search size={18} style={{ position: 'absolute', left: 14, top: 15, color: 'var(--mute)' }} />
                <input style={{ paddingLeft: 42 }} placeholder={tr('다른 도시 검색 (예: 삿포로, 리스본)')} value={q} onChange={(e) => { setQ(e.target.value); setDest(undefined); setCustom(undefined) }} />
              </label>
              {custom && <p className="hint">{custom.name} · {custom.detail}</p>}
              {searchError && <p className="hint" style={{ color: 'var(--warn)' }}>{searchError}</p>}
              {results && !custom && (
                results.length ? (
                  <div className="results">
                    {results.map((r, i) => (
                      <button key={i} onClick={() => { setCustom(r); setResults(undefined) }}><b>{r.name}</b><small>{r.detail}</small></button>
                    ))}
                  </div>
                ) : <p className="hint">{tr('찾은 곳이 없습니다. 도시 이름을 영어로도 입력해 보세요.')}</p>
              )}
              {!q && (
                <div className="dest-grid">
                  {DESTINATIONS.map((d) => (
                    <button key={d.id} className="dest" aria-pressed={dest?.id === d.id} onClick={() => { setDest(d); haptic() }}>
                      <span><span className="code">{d.airport}</span><b>{d.city}</b></span>
                      <small>{d.line}</small>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}

          {step === 1 && (
            <div className="stack">
              <div>
                <h2>{tr('{0}, 언제 누구와 가나요', city)}</h2>
                <p className="lead" style={{ marginBottom: 0 }}>{end >= start ? (nights ? tr('{0}박 {1}일', nights, nights + 1) : tr('당일치기')) : tr('돌아오는 날이 떠나는 날보다 빠릅니다')}</p>
              </div>
              <div className="row">
                <label className="field"><span>{tr('떠나는 날')}</span><input type="date" value={start} onChange={(e) => { setStart(e.target.value); if (e.target.value > end) setEnd(e.target.value) }} /></label>
                <label className="field"><span>{tr('돌아오는 날')}</span><input type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} /></label>
              </div>
              <div className="field">
                <span>{tr('함께 가는 사람')}</span>
                <div className="chips">
                  {people.map((p) => (
                    <span key={p} className="chip">{p}{p !== tr('나') && <button aria-label={tr('{0} 빼기', p)} onClick={() => setPeople(people.filter((x) => x !== p))}><X size={14} /></button>}</span>
                  ))}
                </div>
                <div className="inline-add">
                  <input className="input" placeholder={tr('이름 추가')} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addPerson()} />
                  <button className="btn btn-ghost" onClick={addPerson} disabled={!name.trim()}>{tr('추가')}</button>
                </div>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="stack">
              <div>
                <h2>{tr('어떤 여행을 원하나요')}</h2>
                <p className="lead" style={{ marginBottom: 0 }}>{tr('고른 내용에 맞춰 AI가 장소를 고르고, 가까운 곳끼리 같은 날로 묶습니다.')}</p>
              </div>
              {(
                <>
                  <div className="toggle">
                    <div><b>{tr('일정 초안 받기')}</b><small>{tr('끄면 빈 일정으로 시작합니다')}</small></div>
                    <button className="switch" role="switch" aria-checked={recommend} aria-label={tr('일정 초안 받기')} onClick={() => setRecommend(!recommend)} />
                  </div>
                  {recommend && (
                    <>
                      <div className="field">
                        <span>{tr('하루의 속도')}</span>
                        <div className="seg">
                          {(Object.keys(PACE) as Pace[]).map((p) => <button key={p} aria-pressed={pace === p} onClick={() => setPace(p)}>{PACE[p].label}</button>)}
                        </div>
                        <p className="hint">{PACE[pace].hint}</p>
                      </div>
                      <div className="field">
                        <span>{tr('더 넣고 싶은 것')}</span>
                        <div className="chips">
                          {INTERESTS.map((c) => (
                            <button key={c} className="chip" aria-pressed={interests.includes(c)} onClick={() => setInterests(interests.includes(c) ? interests.filter((x) => x !== c) : [...interests, c])}>{CATEGORY[c].label}</button>
                          ))}
                        </div>
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
          )}
        </motion.div>
      </AnimatePresence>

      <div className="wizard-foot">
        {step < 2
          ? <button className="btn btn-primary btn-block" disabled={!canNext} onClick={() => setStep(step + 1)}>{tr('다음')}</button>
          : <button className="btn btn-signal btn-block" onClick={create}>{tr('여행 만들기')}</button>}
      </div>

      {drawing && (
        <div className="drawing" role="status">
          <svg viewBox="0 0 240 120" aria-hidden="true">
            <path d="M10,100 C60,10 150,0 230,40" fill="none" stroke="#D2B698" strokeWidth="4" strokeLinecap="round" pathLength={1} className="route-line" />
            <circle cx="10" cy="100" r="7" fill="#F8F6F1" />
            <circle cx="230" cy="40" r="9" fill="#D2B698" className="route-dot" style={{ animationDelay: '1.2s', transformOrigin: '230px 40px' }} />
          </svg>
          <p>{tr('{0}까지 궤적을 그리는 중', city)}</p>
          {recommend && <small>{tr('AI가 일정을 짜고 있습니다. 20초쯤 걸릴 수 있습니다')}</small>}
        </div>
      )}
    </div>
  )
}
