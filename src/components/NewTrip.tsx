import { tr } from '../i18n'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowLeft, ArrowUp, Mail, Minus, Plus, Search, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { EN } from '../i18n.en'
import { CATEGORY, DESTINATIONS, type Destination } from '../data/destinations'
import { aiMessage, aiPlanTrip } from '../lib/ai'
import { driveConfigured, ensureToken, inviteByEmail, joinLink, preloadGoogle, startSharing } from '../lib/drive'
import { localizeResults, searchPlaces, type GeoResult } from '../lib/geocode'
import { cityLabel, legEnds, splitDates } from '../lib/legs'
import { PACE, type Pace } from '../lib/planner'
import { addDays, dateRange, fmtRange, haptic, md, today, weekday } from '../lib/util'
import { buildTrip, planBuiltIn, useStore, type Person } from '../store'
import type { Category } from '../types'
import { go, toast } from './ui'
import { announceInvites, type Invitee } from '../lib/invite'

const INTERESTS: Category[] = ['food', 'cafe', 'sight', 'culture', 'nature', 'shop', 'night']
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** 고른 도시 하나. 같은 도시를 다시 넣을 수 있다 (방콕 → 콘깬 → 방콕) */
interface Stop { key: string; dest?: Destination; geo?: GeoResult; nights: number }
const nameOf = (s: Stop) => s.dest?.city ?? s.geo!.name
let seq = 0

export default function NewTrip() {
  const add = useStore((s) => s.add)
  const [step, setStep] = useState(0)
  const [stops, setStops] = useState<Stop[]>([])
  const [q, setQ] = useState('')
  const [results, setResults] = useState<GeoResult[]>()
  const [searchError, setSearchError] = useState('')
  const [start, setStart] = useState(addDays(today(), 14))
  const [end, setEnd] = useState(addDays(today(), 17))
  const [people, setPeople] = useState<Person[]>([{ name: tr('나') }])
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [pace, setPace] = useState<Pace>('normal')
  const [interests, setInterests] = useState<Category[]>(['food', 'sight'])
  const [recommend, setRecommend] = useState(true)
  const [drawing, setDrawing] = useState(false)

  // 목록에 없는 도시는 입력을 멈춘 뒤 검색한다
  useEffect(() => {
    if (q.trim().length < 2) { setResults(undefined); return }
    const ac = new AbortController()
    const id = setTimeout(() => {
      searchPlaces(q, undefined, ac.signal).then((all) => {
        const r = all.filter((x) => !x.airport)
        setResults(r); setSearchError('')
        localizeResults(r).then((l) => { if (!ac.signal.aborted && l !== r) setResults(l) })
      })
        .catch((e) => { if (e.name !== 'AbortError') setSearchError(tr('검색하지 못했습니다. 연결을 확인한 뒤 다시 입력하세요')) })
    }, 500)
    return () => { clearTimeout(id); ac.abort() }
  }, [q])

  // 추천 데이터가 있는 도시는 한국어·영어 이름 어느 쪽으로 찾아도 먼저 보여 준다
  const localHits = useMemo(() => {
    const query = q.trim().toLowerCase()
    if (!query) return []
    return DESTINATIONS.filter((d) => {
      const ko = Object.keys(EN).find((k) => EN[k] === d.city) ?? d.city
      return [d.city, ko, EN[ko] ?? '', d.airport].some((n) => n.toLowerCase().includes(query))
    })
  }, [q])

  // 초대할 이메일이 있으면 Google 로그인 창을 바로 띄울 수 있게 미리 준비한다
  const invites = people.filter((p) => p.email)
  useEffect(() => { if (invites.length) preloadGoogle() }, [invites.length])

  const multi = stops.length > 1
  const ranges = multi ? splitDates(start, stops.map((s) => s.nights)) : [{ start, end }]
  const tripEnd = ranges[ranges.length - 1]?.end ?? end
  const nights = dateRange(start, tripEnd).length - 1
  const label = cityLabel(stops.map(nameOf))
  const canNext = step === 0 ? stops.length > 0 : step === 1 ? tripEnd >= start : true

  const addStop = (s: Omit<Stop, 'key' | 'nights'>) => {
    setStops((xs) => [...xs, { ...s, key: `s${++seq}`, nights: 2 }])
    setQ(''); setResults(undefined); haptic()
  }
  const moveUp = (i: number) => setStops((xs) => { const c = [...xs]; [c[i - 1], c[i]] = [c[i], c[i - 1]]; return c })
  const setNights = (i: number, n: number) => setStops((xs) => xs.map((s, k) => (k === i ? { ...s, nights: n } : s)))

  const addPerson = () => {
    const n = name.trim(), e = email.trim()
    if (!n && !e) return
    if (e && !EMAIL.test(e)) return toast(tr('이메일 주소를 확인하세요'))
    const display = n || e.split('@')[0]
    if (people.some((p) => p.name === display)) return toast(tr('같은 이름이 이미 있습니다'))
    setPeople([...people, { name: display, ...(e ? { email: e } : {}) }]); setName(''); setEmail('')
  }

  const create = async () => {
    // 초대할 사람이 있으면 버튼을 누른 이 순간에 Google 로그인을 시작한다 (늦게 띄우면 팝업이 막힌다)
    const signIn = invites.length && driveConfigured ? ensureToken().then(() => true, () => false) : Promise.resolve(false)
    const legInputs = stops.map((s, i) => ({ dest: s.dest, city: nameOf(s), country: s.geo?.country, lat: s.geo?.lat, lng: s.geo?.lng, ...ranges[i] }))
    haptic(12)
    setDrawing(true)
    const began = Date.now()
    const trip = buildTrip({ legs: legInputs, pace, interests, people, recommend: false })
    const legs = trip.legs ?? [{ ...trip, id: 'one', start: trip.start, end: trip.end }]
    let note = ''
    if (recommend) {
      // 구간마다 따로 AI에게 맡기고, 실패한 구간만 기기 안의 기본 추천으로 채운다
      const results = await Promise.allSettled(legs.map((leg, k) => {
        const ends = legEnds(legs, k)
        return aiPlanTrip({ city: leg.city, country: leg.country, lat: leg.lat, lng: leg.lng, start: leg.start, end: leg.end, pace, interests, arrive: ends.arriveText, depart: ends.departText })
      }))
      const used = new Set<string>()
      const failed = new Set<number>()
      results.forEach((r, k) => {
        if (r.status === 'rejected') { failed.add(k); return }
        for (const d of r.value) {
          const day = trip.days.find((x) => x.date === d.date)
          // 같은 도시를 다시 올 때 앞 구간과 겹치는 장소는 뺀다
          if (day) day.items.push(...d.items.filter((p) => !used.has(p.name)))
          d.items.forEach((p) => used.add(p.name))
        }
      })
      if (failed.size) planBuiltIn(trip.days, legs, pace, interests, failed)
      const firstError = results.find((r): r is PromiseRejectedResult => r.status === 'rejected')
      note = !firstError ? tr('AI가 짠 초안입니다. 위치와 영업시간은 가기 전에 확인하세요')
        : failed.size === legs.length ? tr('{0}. 준비된 도시는 기본 추천으로 만들었습니다', aiMessage(firstError.reason))
        : tr('일부 도시는 AI 대신 기본 추천으로 채웠습니다')
    }
    // 선이 다 그려질 때까지는 화면을 유지한다
    await new Promise((r) => setTimeout(r, Math.max(0, 1500 - (Date.now() - began))))
    add(trip)
    go(`/trip/${trip.id}`, true)
    if (note) toast(note)

    // 이메일을 넣은 동행에게 편집 권한을 주고, 여행 화면에서 trj 링크가 담긴 초대장을 보내게 한다
    // (Google 공유 알림 메일은 여행 파일(.json)을 앞세워 보여 주므로 보내지 않는다)
    if (invites.length && (await signIn)) {
      try {
        const fileId = await startSharing(trip.id)
        const sent: Invitee[] = []
        for (const p of invites) {
          try {
            const { notified } = await inviteByEmail(fileId, p.email!, tr('{0} 일정을 함께 짜요. 아래 링크를 열고 이 메일을 받은 Google 계정으로 로그인하세요.\n{1}', trip.title, joinLink(fileId)))
            sent.push({ name: p.name, email: p.email!, notified })
          } catch { /* 한 사람이 실패해도 나머지는 계속한다 */ }
        }
        if (sent.length) announceInvites(trip.id, sent)
        if (sent.length < invites.length) toast(tr('{0}명 중 {1}명에게 편집 권한을 줬습니다. 나머지는 동행 관리에서 다시 초대하세요', invites.length, sent.length))
      } catch (e) { toast((e as Error).message) }
    } else if (invites.length) {
      toast(tr('Google에 연결하지 않아 초대하지 못했습니다. 동행 관리에서 초대할 수 있습니다'))
    }
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
              <p className="lead">{tr('여러 도시를 도는 여행이면 가는 순서대로 고르세요. 같은 도시를 다시 넣어도 됩니다.')}</p>

              {stops.length > 0 && (
                <ol className="route-list" aria-label={tr('고른 도시')}>
                  {stops.map((s, i) => (
                    <li key={s.key}>
                      <span className="route-no">{i + 1}</span>
                      <span className="grow"><b>{nameOf(s)}</b>{(s.dest?.country ?? s.geo?.country) && <small>{s.dest?.country ?? s.geo?.country}</small>}</span>
                      {i > 0 && <button className="icon-btn" aria-label={tr('{0} 앞으로', nameOf(s))} onClick={() => moveUp(i)}><ArrowUp size={18} /></button>}
                      <button className="icon-btn" aria-label={tr('{0} 빼기', nameOf(s))} onClick={() => setStops(stops.filter((x) => x.key !== s.key))}><X size={18} /></button>
                    </li>
                  ))}
                </ol>
              )}

              <label className="field" style={{ position: 'relative' }}>
                <span className="sr">{tr('도시 검색')}</span>
                <Search size={18} style={{ position: 'absolute', left: 14, top: 15, color: 'var(--mute)' }} />
                <input style={{ paddingLeft: 42 }} placeholder={stops.length ? tr('다음 도시 추가 (예: 콘깬, 치앙마이)') : tr('도시 검색 (예: 방콕, 리스본)')} value={q} onChange={(e) => setQ(e.target.value)} />
              </label>
              {searchError && <p className="hint" style={{ color: 'var(--warn)' }}>{searchError}</p>}
              {(localHits.length > 0 || results) && (
                <div className="results">
                  {localHits.map((d) => (
                    <button key={d.id} onClick={() => addStop({ dest: d })}><b>{d.city}</b><small>{d.country} · {tr('일정 초안 바로 가능')}</small></button>
                  ))}
                  {results?.map((r, i) => (
                    <button key={i} onClick={() => addStop({ geo: r })}><b>{r.name}</b><small>{[r.local, r.detail].filter(Boolean).join(' · ')}</small></button>
                  ))}
                </div>
              )}
              {results && !results.length && !localHits.length && <p className="hint">{tr('찾은 곳이 없습니다. 도시 이름을 영어로도 입력해 보세요.')}</p>}

              {!q && (
                <>
                  <p className="hint" style={{ marginTop: 18 }}>{tr('아래 도시는 동선까지 이은 일정 초안을 바로 받을 수 있습니다.')}</p>
                  <div className="dest-grid">
                    {DESTINATIONS.map((d) => {
                      const count = stops.filter((s) => s.dest?.id === d.id).length
                      return (
                        <button key={d.id} className="dest" aria-pressed={count > 0} onClick={() => addStop({ dest: d })}>
                          <span><span className="code">{count > 1 ? `×${count}` : d.airport}</span><b>{d.city}</b></span>
                          <small>{d.line}</small>
                        </button>
                      )
                    })}
                  </div>
                </>
              )}
            </>
          )}

          {step === 1 && (
            <div className="stack">
              <div>
                <h2>{tr('{0}, 언제 누구와 가나요', label)}</h2>
                <p className="lead" style={{ marginBottom: 0 }}>{tripEnd >= start ? `${nights ? tr('{0}박 {1}일', nights, nights + 1) : tr('당일치기')} · ${fmtRange(start, tripEnd)}` : tr('돌아오는 날이 떠나는 날보다 빠릅니다')}</p>
              </div>
              {multi ? (
                <>
                  <label className="field"><span>{tr('떠나는 날')}</span><input type="date" value={start} onChange={(e) => e.target.value && setStart(e.target.value)} /></label>
                  <div className="field">
                    <span>{tr('도시마다 머무는 밤')}</span>
                    <div className="list">
                      {stops.map((s, i) => {
                        const last = i === stops.length - 1
                        return (
                          <div key={s.key} className="leg-row">
                            <span className="route-no">{i + 1}</span>
                            <span className="grow">
                              <b>{nameOf(s)}</b>
                              <small>{md(ranges[i].start)} {weekday(ranges[i].start)}{ranges[i].end !== ranges[i].start ? ` – ${md(ranges[i].end)} ${weekday(ranges[i].end)}` : ''}{last ? ` · ${tr('돌아오는 날 포함')}` : ''}</small>
                            </span>
                            <span className="stepper">
                              <button aria-label={tr('{0} 하루 줄이기', nameOf(s))} disabled={s.nights <= (last ? 0 : 1)} onClick={() => setNights(i, s.nights - 1)}><Minus size={16} /></button>
                              <b>{tr('{0}박', s.nights)}</b>
                              <button aria-label={tr('{0} 하루 늘리기', nameOf(s))} disabled={s.nights >= 14} onClick={() => setNights(i, s.nights + 1)}><Plus size={16} /></button>
                            </span>
                          </div>
                        )
                      })}
                    </div>
                    <p className="hint">{tr('첫 도시는 그 도시 공항으로 도착하고, 마지막 도시의 공항으로 떠나는 일정으로 짭니다.')}</p>
                  </div>
                </>
              ) : (
                <div className="row">
                  <label className="field"><span>{tr('떠나는 날')}</span><input type="date" value={start} onChange={(e) => { setStart(e.target.value); if (e.target.value > end) setEnd(e.target.value) }} /></label>
                  <label className="field"><span>{tr('돌아오는 날')}</span><input type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} /></label>
                </div>
              )}
              <div className="field">
                <span>{tr('함께 가는 사람')}</span>
                <div className="chips">
                  {people.map((p) => (
                    <span key={p.name} className="chip" title={p.email}>
                      {p.email && <Mail size={14} aria-label={tr('초대장 보낼 예정')} />}{p.name}
                      {p.name !== tr('나') && <button aria-label={tr('{0} 빼기', p.name)} onClick={() => setPeople(people.filter((x) => x.name !== p.name))}><X size={14} /></button>}
                    </span>
                  ))}
                </div>
                <div className="person-add">
                  <input className="input" placeholder={tr('이름')} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addPerson()} />
                  <input className="input" type="email" inputMode="email" autoCapitalize="off" placeholder={tr('Google 이메일 (선택)')} value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addPerson()} />
                  <button className="btn btn-ghost" onClick={addPerson} disabled={!name.trim() && !email.trim()}>{tr('추가')}</button>
                </div>
                <p className="hint">{driveConfigured ? tr('이메일을 넣으면 여행을 만들 때 함께 편집 초대장이 바로 갑니다. 내 Google Drive에 여행이 저장됩니다.') : tr('이메일은 나중에 함께 편집을 켤 때 쓰입니다.')}</p>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="stack">
              <div>
                <h2>{tr('어떤 여행을 원하나요')}</h2>
                <p className="lead" style={{ marginBottom: 0 }}>{tr('고른 내용에 맞춰 AI가 장소를 고르고, 가까운 곳끼리 같은 날로 묶습니다.')}</p>
              </div>
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
            </div>
          )}
        </motion.div>
      </AnimatePresence>

      <div className="wizard-foot">
        {step < 2
          ? <button className="btn btn-primary btn-block" disabled={!canNext} onClick={() => setStep(step + 1)}>{tr('다음')}</button>
          : <button className="btn btn-signal btn-block" onClick={create}>{invites.length ? tr('여행 만들고 초대장 보내기') : tr('여행 만들기')}</button>}
      </div>

      {drawing && (
        <div className="drawing" role="status">
          <svg viewBox="0 0 240 120" aria-hidden="true">
            <path d="M10,100 C60,10 150,0 230,40" fill="none" stroke="#D2B698" strokeWidth="4" strokeLinecap="round" pathLength={1} className="route-line" />
            <circle cx="10" cy="100" r="7" fill="#F8F6F1" />
            <circle cx="230" cy="40" r="9" fill="#D2B698" className="route-dot" style={{ animationDelay: '1.2s', transformOrigin: '230px 40px' }} />
          </svg>
          <p>{tr('{0}까지 궤적을 그리는 중', label)}</p>
          {recommend && <small>{tr('AI가 일정을 짜고 있습니다. 20초쯤 걸릴 수 있습니다')}</small>}
        </div>
      )}
    </div>
  )
}
