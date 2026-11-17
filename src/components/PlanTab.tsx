import { tr } from '../i18n'
import { Reorder, useDragControls } from 'framer-motion'
import { Check, Clock, GripVertical, MapPin, Plane, Plus, Route, Sparkles, Trash2 } from 'lucide-react'
import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { AIRPORTS, airlineOf, airport } from '../data/airports'
import { CATEGORY, destination } from '../data/destinations'
import { aiMessage, aiSuggest } from '../lib/ai'
import { flightMinutes, isComplete, parseFlightText } from '../lib/flight'
import { searchPlaces, type GeoResult } from '../lib/geocode'
import { poiToPlace, retime, shortest, suggestions } from '../lib/planner'
import { arc, distLabel, fmtDur, fromMin, haptic, km, md, toMin, travelLabel, travelMin, uid, weekday, wonShort } from '../lib/util'
import { putFlight, useStore } from '../store'
import type { Category, Flight, Place, Trip } from '../types'
import type { MapPoint } from './MapView'
import { Sheet, toast } from './ui'

const MapView = lazy(() => import('./MapView'))
const CATS = Object.keys(CATEGORY) as Category[]

export default function PlanTab({ trip }: { trip: Trip }) {
  const mutate = useStore((s) => s.mutate)
  const [idx, setIdx] = useState(0)
  const [adding, setAdding] = useState(false)
  const [editId, setEditId] = useState<string>()
  const [flight, setFlight] = useState<Flight | 'new'>()
  const di = Math.min(idx, trip.days.length - 1)
  const day = trip.days[di]

  const arrivals = trip.flights.filter((f) => f.arrDate === day.date && f.depDate !== day.date)
  const departures = trip.flights.filter((f) => f.depDate === day.date)
  const early = departures.filter((f) => f.depTime < '14:00')
  const late = departures.filter((f) => f.depTime >= '14:00')
  const rows = arrivals.length + departures.length + day.items.length

  const { points, arcs } = useMemo(() => {
    const points: MapPoint[] = day.items.map((p, i) => ({ lat: p.lat, lng: p.lng, label: String(i + 1), title: p.name }))
    const arcs: [number, number][][] = []
    for (const f of [...arrivals, ...departures]) {
      const a = airport(f.from), b = airport(f.to)
      if (!a || !b) continue
      arcs.push(arc([a.lng, a.lat], [b.lng, b.lat]))
      for (const ap of [a, b]) if (!points.some((p) => p.label === ap.code)) points.push({ lat: ap.lat, lng: ap.lng, label: ap.code, air: true, title: ap.name })
    }
    return { points, arcs }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day, trip.flights])

  const dayCost = day.items.reduce((s, p) => s + (p.cost ?? 0), 0)
  const dayDist = day.items.slice(1).reduce((s, p, i) => s + km(day.items[i], p), 0)

  return (
    <>
      <div className="days" role="tablist" aria-label={tr('날짜')}>
        {trip.days.map((d, i) => (
          <button key={d.date} role="tab" className="day-chip" aria-selected={i === di} onClick={(e) => { setIdx(i); haptic(); e.currentTarget.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' }) }}>
            <b>{i + 1}</b><small>{md(d.date)} {weekday(d.date)}</small>
          </button>
        ))}
      </div>

      <div className="plan-map">
        <Suspense fallback={null}>
          <MapView points={points} arcs={arcs} center={trip} onPick={(i) => { const p = day.items[i]; if (p) setEditId(p.id) }} />
        </Suspense>
      </div>

      <div className="day-head">
        <div>
          <h2>{tr('{0}일차', di + 1)}</h2>
          <p>
            {day.items.length ? tr('{0}곳', day.items.length) : tr('아직 장소가 없습니다')}
            {dayDist > 0 && tr(' · 이동 {0}', distLabel(dayDist))}
            {dayCost > 0 && tr(' · 1인 약 {0}', wonShort(dayCost))}
          </p>
        </div>
      </div>

      {rows === 0 ? (
        <div className="empty">
          <strong>{tr('이 날은 비어 있습니다')}</strong>
          {tr('장소를 넣으면 지도에 선이 이어집니다.')}
        </div>
      ) : (
        <Reorder.Group as="ol" axis="y" className="tl" values={day.items} onReorder={(next) => mutate(trip.id, (t) => { t.days[di].items = next as Place[] })}>
          {arrivals.map((f) => <FlightRow key={`a${f.id}`} f={f} arriving only={rows === 1} onOpen={() => setFlight(f)} />)}
          {early.map((f) => <FlightRow key={f.id} f={f} only={rows === 1} onOpen={() => setFlight(f)} />)}
          {day.items.map((p, i) => (
            <PlaceRow key={p.id} p={p} n={i + 1} next={day.items[i + 1]} only={rows === 1}
              onOpen={() => setEditId(p.id)}
              onToggle={() => { haptic(); mutate(trip.id, (t) => { const x = t.days[di].items[i]; x.done = !x.done }) }} />
          ))}
          {late.map((f) => <FlightRow key={f.id} f={f} only={rows === 1} onOpen={() => setFlight(f)} />)}
        </Reorder.Group>
      )}

      <div className="add-row">
        <button className="btn btn-primary" onClick={() => setAdding(true)}><Plus size={18} />{tr('장소 추가')}</button>
        <button className="btn btn-ghost" onClick={() => setFlight('new')}><Plane size={18} />{tr('항공편 추가')}</button>
      </div>
      {day.items.length > 1 && (
        <div className="tools">
          <button className="btn btn-quiet" onClick={() => { mutate(trip.id, (t) => { t.days[di].items = shortest(t.days[di].items); retime(t.days[di].items) }); toast(tr('가까운 순서로 다시 이었습니다')) }}><Route size={16} />{tr('가까운 순으로 정리')}</button>
          <button className="btn btn-quiet" onClick={() => { mutate(trip.id, (t) => retime(t.days[di].items)); toast(tr('이동 시간을 넣어 시각을 다시 맞췄습니다')) }}><Clock size={16} />{tr('시각 다시 맞추기')}</button>
        </div>
      )}

      <AddPlaceSheet open={adding} onClose={() => setAdding(false)} trip={trip} di={di} />
      <EditPlaceSheet trip={trip} di={di} id={editId} onClose={() => setEditId(undefined)} />
      <FlightSheet trip={trip} flight={flight} onClose={() => setFlight(undefined)} />
    </>
  )
}

function PlaceRow({ p, n, next, only, onOpen, onToggle }: { p: Place; n: number; next?: Place; only: boolean; onOpen: () => void; onToggle: () => void }) {
  const controls = useDragControls()
  const c = CATEGORY[p.category]
  return (
    <Reorder.Item value={p} as="li" className={`tl-item${only ? ' only' : ''}`} dragListener={false} dragControls={controls}
      whileDrag={{ scale: 1.02, zIndex: 5 }} onDragStart={() => haptic(10)}>
      <div className="tl-time">{p.time ?? ''}</div>
      <div className="tl-rail">
        <button className={`tl-node${p.done ? ' done' : ''}`} onClick={onToggle} aria-label={`${p.name} ${p.done ? tr('다녀옴 취소') : tr('다녀옴으로 표시')}`}>
          {p.done ? <Check size={15} strokeWidth={3} /> : n}
        </button>
      </div>
      <div className="tl-body">
        <div className={`card${p.done ? ' done' : ''}`}>
          <button className="card-main" onClick={onOpen}>
            <h3>{p.name}</h3>
            <div className="sub">
              <span className="cat" style={{ color: c.color }}>{c.label}</span>
              {p.duration ? <span>{fmtDur(p.duration)}</span> : null}
              {p.cost ? <span>{wonShort(p.cost)}</span> : null}
            </div>
            {p.note && <div className="note">{p.note}</div>}
          </button>
          <div className="grip" onPointerDown={(e) => controls.start(e)} aria-hidden="true"><GripVertical size={18} /></div>
        </div>
        {next ? <div className="hop">{travelLabel(km(p, next))} · {distLabel(km(p, next))}</div> : <div style={{ height: 10 }} />}
      </div>
    </Reorder.Item>
  )
}

function FlightRow({ f, arriving, only, onOpen }: { f: Flight; arriving?: boolean; only: boolean; onOpen: () => void }) {
  const mins = flightMinutes(f)
  return (
    <li className={`tl-item air${only ? ' only' : ''}`}>
      <div className="tl-time">{arriving ? f.arrTime : f.depTime}</div>
      <div className="tl-rail"><span className="tl-node air"><Plane size={15} /></span></div>
      <div className="tl-body">
        <button className="pass" onClick={onOpen} aria-label={tr('{0} 항공편 수정', f.flightNo)}>
          <div className="pass-route">
            <div><div className="code">{f.from}</div><div className="at">{f.depTime}</div></div>
            <div className="pass-arc">
              <svg viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true">
                <path d="M2,26 Q50,-14 98,26" fill="none" stroke="#D2B698" strokeWidth="2" strokeDasharray="1 5" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
              </svg>
              <span>{mins ? fmtDur(mins) : ''}{arriving ? tr(' · 오늘 도착') : f.arrDate !== f.depDate ? tr(' · {0} 도착', md(f.arrDate)) : ''}</span>
            </div>
            <div className="to"><div className="code">{f.to}</div><div className="at">{f.arrTime}</div></div>
          </div>
          <div className="pass-foot">
            <span><b>{airlineOf(f.flightNo)}</b> {f.flightNo}</span>
            {f.seat && <span>{tr('좌석')}{' '}<b>{f.seat}</b></span>}
            {f.pnr && <span>{tr('예약')}{' '}<b>{f.pnr}</b></span>}
          </div>
        </button>
        <div style={{ height: 14 }} />
      </div>
    </li>
  )
}

/* ── 장소 추가 ── */
function AddPlaceSheet({ open, onClose, trip, di }: { open: boolean; onClose: () => void; trip: Trip; di: number }) {
  const mutate = useStore((s) => s.mutate)
  const dest = destination(trip.destId)
  const [mode, setMode] = useState<'pick' | 'ai' | 'search'>(dest ? 'pick' : 'ai')
  const [ai, setAi] = useState<Place[]>()
  const [aiBusy, setAiBusy] = useState(false)
  const [aiError, setAiError] = useState('')
  useEffect(() => { setAi(undefined); setAiError('') }, [di, open])
  const askAi = async () => {
    setAiBusy(true); setAiError('')
    try { setAi(await aiSuggest(trip, di)) } catch (e) { setAiError(aiMessage(e)) } finally { setAiBusy(false) }
  }
  const [q, setQ] = useState('')
  const [results, setResults] = useState<GeoResult[]>()
  const [error, setError] = useState('')
  const picks = useMemo(() => (dest && open ? suggestions(dest, trip, di) : []), [dest, trip, di, open])

  useEffect(() => {
    if (q.trim().length < 2) { setResults(undefined); return }
    const ac = new AbortController()
    const id = setTimeout(() => {
      searchPlaces(q, trip, ac.signal).then((r) => { setResults(r); setError('') })
        .catch((e) => { if (e.name !== 'AbortError') setError(tr('검색하지 못했습니다. 연결을 확인한 뒤 다시 입력하세요')) })
    }, 500)
    return () => { clearTimeout(id); ac.abort() }
  }, [q, trip])

  const add = (place: Place) => {
    mutate(trip.id, (t) => {
      const items = t.days[di].items
      const last = items[items.length - 1]
      if (last?.time) place.time = fromMin(Math.round((toMin(last.time) + (last.duration ?? 60) + travelMin(km(last, place))) / 10) * 10)
      items.push(place)
    })
    haptic()
    toast(tr('{0}일차에 {1} 추가', di + 1, place.name))
  }

  return (
    <Sheet open={open} onClose={onClose} title={tr('{0}일차에 장소 추가', di + 1)}>
      <div className="seg" style={{ marginBottom: 14 }}>
        {dest && <button aria-pressed={mode === 'pick'} onClick={() => setMode('pick')}>{tr('가까운 추천')}</button>}
        <button aria-pressed={mode === 'ai'} onClick={() => setMode('ai')}>{tr('AI 추천')}</button>
        <button aria-pressed={mode === 'search'} onClick={() => setMode('search')}>{tr('직접 검색')}</button>
      </div>
      {mode === 'ai' ? (
        <>
          {ai && (
            <div className="list" style={{ marginBottom: 12 }}>
              {ai.map((p) => (
                <button key={p.id} onClick={() => { add({ ...p }); setAi(ai.filter((x) => x.id !== p.id)) }}>
                  <i className="dot" style={{ background: CATEGORY[p.category].color }} />
                  <span className="grow">
                    <b>{p.name}</b>
                    <small>{CATEGORY[p.category].label} · {fmtDur(p.duration ?? 60)}{p.note ? ` · ${p.note}` : ''}</small>
                  </span>
                  <Plus size={18} className="mute" />
                </button>
              ))}
            </div>
          )}
          {aiError && <p className="parsed miss" style={{ marginBottom: 12 }}>{aiError}</p>}
          <button className="btn btn-ghost btn-block" disabled={aiBusy} onClick={askAi}>
            <Sparkles size={18} className={aiBusy ? 'spin' : undefined} />{aiBusy ? tr('추천을 받는 중') : ai ? tr('다른 곳 더 추천받기') : tr('이 날 동선에 맞는 곳 추천받기')}
          </button>
          <p className="hint">{tr('Gemini가 고른 곳입니다. 위치와 영업시간은 가기 전에 확인하세요.')}</p>
        </>
      ) : mode === 'pick' && dest ? (
        picks.length ? (
          <div className="list">
            {picks.map((p) => (
              <button key={p.name} onClick={() => add(poiToPlace(p))}>
                <i className="dot" style={{ background: CATEGORY[p.category].color }} />
                <span className="grow">
                  <b>{p.name}</b>
                  <small>{CATEGORY[p.category].label} · {fmtDur(p.duration)}{p.dist != null ? tr(' · 이 날 동선에서 {0}', distLabel(p.dist)) : ''}</small>
                </span>
                <Plus size={18} className="mute" />
              </button>
            ))}
          </div>
        ) : <div className="empty"><strong>{tr('추천 장소를 모두 넣었습니다')}</strong>{tr('다른 곳은 직접 검색해서 추가하세요.')}</div>
      ) : (
        <>
          <label className="field"><span className="sr">{tr('장소 검색')}</span>
            <input autoFocus placeholder={tr('{0}에서 가고 싶은 곳', trip.city)} value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
          {error && <p className="hint" style={{ color: 'var(--warn)' }}>{error}</p>}
          {results && (results.length ? (
            <div className="list" style={{ marginTop: 10 }}>
              {results.map((r, i) => (
                <button key={i} onClick={() => add({ id: uid(), name: r.name, lat: r.lat, lng: r.lng, category: r.category, duration: 60 })}>
                  <MapPin size={18} className="mute" />
                  <span className="grow"><b>{r.name}</b><small>{r.detail}</small></span>
                  <Plus size={18} className="mute" />
                </button>
              ))}
            </div>
          ) : <p className="hint">{tr('찾은 곳이 없습니다. 현지 표기나 영어 이름으로도 입력해 보세요.')}</p>)}
          {!results && !error && <p className="hint">{tr('가게·명소 이름을 두 글자 이상 입력하세요. OpenStreetMap에서 찾습니다.')}</p>}
        </>
      )}
    </Sheet>
  )
}

/* ── 장소 수정 ── */
function EditPlaceSheet({ trip, di, id, onClose }: { trip: Trip; di: number; id?: string; onClose: () => void }) {
  const mutate = useStore((s) => s.mutate)
  const source = trip.days[di]?.items.find((p) => p.id === id)
  const [d, setD] = useState<Place>()
  const [moveTo, setMoveTo] = useState(di)
  useEffect(() => { if (source) { setD({ ...source }); setMoveTo(di) } }, [id]) // eslint-disable-line react-hooks/exhaustive-deps
  const set = (patch: Partial<Place>) => setD((x) => (x ? { ...x, ...patch } : x))

  const save = () => {
    if (!d || !d.name.trim()) return
    mutate(trip.id, (t) => {
      const items = t.days[di].items
      const i = items.findIndex((p) => p.id === d.id)
      if (i < 0) return
      if (moveTo === di) items[i] = d
      else { items.splice(i, 1); t.days[moveTo].items.push(d) }
    })
    if (moveTo !== di) toast(tr('{0}일차로 옮겼습니다', moveTo + 1))
    onClose()
  }
  const remove = () => {
    mutate(trip.id, (t) => { t.days[di].items = t.days[di].items.filter((p) => p.id !== id) })
    toast(tr('장소를 삭제했습니다')); onClose()
  }

  return (
    <Sheet open={Boolean(id && d)} onClose={onClose} title={tr('장소 수정')}
      foot={<><button className="btn btn-ghost" style={{ flex: 'none', color: 'var(--warn)' }} onClick={remove} aria-label={tr('장소 삭제')}><Trash2 size={18} /></button><button className="btn btn-primary" onClick={save}>{tr('변경 내용 저장')}</button></>}>
      {d && (
        <div className="stack">
          <label className="field"><span>{tr('이름')}</span><input value={d.name} onChange={(e) => set({ name: e.target.value })} /></label>
          <div className="row">
            <label className="field"><span>{tr('시작 시각')}</span><input type="time" value={d.time ?? ''} onChange={(e) => set({ time: e.target.value || undefined })} /></label>
            <label className="field"><span>{tr('머무는 시간(분)')}</span><input type="number" inputMode="numeric" min={0} step={15} value={d.duration ?? ''} onChange={(e) => set({ duration: e.target.value ? Number(e.target.value) : undefined })} /></label>
          </div>
          <div className="field"><span>{tr('종류')}</span>
            <div className="chips">{CATS.map((c) => <button key={c} className="chip" aria-pressed={d.category === c} onClick={() => set({ category: c })}>{CATEGORY[c].label}</button>)}</div>
          </div>
          <div className="row">
            <label className="field"><span>{tr('1인 예상 비용(원)')}</span><input type="number" inputMode="numeric" min={0} step={1000} value={d.cost ?? ''} onChange={(e) => set({ cost: e.target.value ? Number(e.target.value) : undefined })} /></label>
            <label className="field"><span>{tr('날짜')}</span>
              <select value={moveTo} onChange={(e) => setMoveTo(Number(e.target.value))}>
                {trip.days.map((x, i) => <option key={x.date} value={i}>{tr('{0}일차 ({1} {2})', i + 1, md(x.date), weekday(x.date))}</option>)}
              </select>
            </label>
          </div>
          <label className="field"><span>{tr('메모')}</span><textarea rows={2} value={d.note ?? ''} onChange={(e) => set({ note: e.target.value || undefined })} placeholder={tr('예약 번호, 주문할 메뉴, 챙길 것')} /></label>
        </div>
      )}
    </Sheet>
  )
}

/* ── 항공편: 예약 문구를 붙여 넣으면 자동으로 채우고, 저장하면 해당 날짜 일정에 들어간다 ── */
function FlightSheet({ trip, flight, onClose }: { trip: Trip; flight?: Flight | 'new'; onClose: () => void }) {
  const mutate = useStore((s) => s.mutate)
  const editing = flight && flight !== 'new' ? flight : undefined
  const [legs, setLegs] = useState<Partial<Flight>[]>([{}])
  const [cur, setCur] = useState(0)
  const [raw, setRaw] = useState('')
  const [found, setFound] = useState<number>()

  useEffect(() => {
    if (!flight) return
    setLegs([editing ? { ...editing } : { depDate: trip.start, arrDate: trip.start }]); setCur(0); setRaw(''); setFound(undefined)
  }, [flight]) // eslint-disable-line react-hooks/exhaustive-deps

  const leg = legs[cur] ?? {}
  const set = (patch: Partial<Flight>) => setLegs((ls) => ls.map((l, i) => (i === cur ? { ...l, ...patch } : l)))
  const ready = legs.filter(isComplete)
  const mins = isComplete(leg) ? flightMinutes(leg) : 0

  const paste = (text: string) => {
    setRaw(text)
    if (!text.trim()) { setFound(undefined); return }
    const parsed = parseFlightText(text, Number(trip.start.slice(0, 4)))
    setFound(parsed.length)
    if (parsed.length) { setLegs(parsed); setCur(0) }
  }

  const save = () => {
    mutate(trip.id, (t) => ready.forEach((f) => putFlight(t, { ...f, id: f.id ?? uid(), flightNo: f.flightNo.toUpperCase().replace(/\s/g, ''), from: f.from.toUpperCase(), to: f.to.toUpperCase() })))
    haptic(12)
    const first = ready.reduce((a, f) => (f.depDate < a ? f.depDate : a), trip.start), last = ready.reduce((a, f) => (f.arrDate > a ? f.arrDate : a), trip.end)
    toast(first < trip.start || last > trip.end ? tr('항공편에 맞춰 여행 기간을 {0}–{1}로 넓혔습니다', md(first), md(last))
      : ready.length > 1 ? tr('항공편 {0}개를 일정에 기록했습니다', ready.length) : tr('{0} 일정에 항공편을 기록했습니다', md(ready[0].depDate)))
    onClose()
  }
  const remove = () => {
    mutate(trip.id, (t) => { t.flights = t.flights.filter((f) => f.id !== editing?.id) })
    toast(tr('항공편을 삭제했습니다')); onClose()
  }

  return (
    <Sheet open={Boolean(flight)} onClose={onClose} title={editing ? tr('항공편 수정') : tr('항공편 추가')}
      foot={<>
        {editing && <button className="btn btn-ghost" style={{ flex: 'none', color: 'var(--warn)' }} onClick={remove} aria-label={tr('항공편 삭제')}><Trash2 size={18} /></button>}
        <button className="btn btn-primary" disabled={!ready.length} onClick={save}>{ready.length > 1 ? tr('{0}개 구간 일정에 기록', ready.length) : tr('일정에 기록')}</button>
      </>}>
      <div className="stack">
        {!editing && (
          <div>
            <label className="field"><span>{tr('예약 확인 메일·e티켓 문구 붙여 넣기')}</span>
              <textarea rows={3} value={raw} onChange={(e) => paste(e.target.value)} placeholder={'KE703 ICN 10:10 → NRT 12:35 2026-12-01\nKE704 NRT 17:20 → ICN 19:55 2026-12-04'} />
            </label>
            {found !== undefined && (found
              ? <p className="parsed" style={{ marginTop: 8 }}>{tr('{0}개 구간을 찾았습니다. 빠진 칸만 아래에서 채우세요.', found)}</p>
              : <p className="parsed miss" style={{ marginTop: 8 }}>{tr('항공편 번호를 찾지 못했습니다. 아래에 직접 입력하세요.')}</p>)}
          </div>
        )}
        {legs.length > 1 && (
          <div className="chips">
            {legs.map((l, i) => <button key={i} className="chip" aria-pressed={i === cur} onClick={() => setCur(i)}>{l.flightNo ?? tr('구간 {0}', i + 1)}{isComplete(l) && <Check size={14} />}</button>)}
          </div>
        )}
        <label className="field"><span>{tr('항공편 번호')}{leg.flightNo && airlineOf(leg.flightNo) ? ` · ${airlineOf(leg.flightNo)}` : ''}</span>
          <input value={leg.flightNo ?? ''} onChange={(e) => set({ flightNo: e.target.value.toUpperCase() })} placeholder="KE703" autoCapitalize="characters" />
        </label>
        <div className="row">
          <label className="field"><span>{tr('출발 공항')}{leg.from && airport(leg.from) ? ` · ${airport(leg.from)!.city}` : ''}</span>
            <input list="trj-airports" maxLength={3} value={leg.from ?? ''} onChange={(e) => set({ from: e.target.value.toUpperCase() })} placeholder="ICN" /></label>
          <label className="field"><span>{tr('도착 공항')}{leg.to && airport(leg.to) ? ` · ${airport(leg.to)!.city}` : ''}</span>
            <input list="trj-airports" maxLength={3} value={leg.to ?? ''} onChange={(e) => set({ to: e.target.value.toUpperCase() })} placeholder="NRT" /></label>
        </div>
        <datalist id="trj-airports">{AIRPORTS.map((a) => <option key={a.code} value={a.code}>{a.city} {a.name}</option>)}</datalist>
        <div className="row">
          <label className="field"><span>{tr('출발일')}</span><input type="date" value={leg.depDate ?? ''} onChange={(e) => set({ depDate: e.target.value, arrDate: !leg.arrDate || leg.arrDate < e.target.value ? e.target.value : leg.arrDate })} /></label>
          <label className="field"><span>{tr('출발 시각')}</span><input type="time" value={leg.depTime ?? ''} onChange={(e) => set({ depTime: e.target.value })} /></label>
        </div>
        <div className="row">
          <label className="field"><span>{tr('도착일')}</span><input type="date" value={leg.arrDate ?? ''} min={leg.depDate} onChange={(e) => set({ arrDate: e.target.value })} /></label>
          <label className="field"><span>{tr('도착 시각')}</span><input type="time" value={leg.arrTime ?? ''} onChange={(e) => set({ arrTime: e.target.value })} /></label>
        </div>
        {isComplete(leg) && (mins
          ? <p className="hint" style={{ marginTop: -4 }}>{tr('비행 시간 {0} (두 공항의 시차 반영). 시각은 각 공항 현지 기준입니다.', fmtDur(mins))}</p>
          : <p className="hint" style={{ marginTop: -4, color: 'var(--warn)' }}>{tr('도착이 출발보다 이릅니다. 도착일을 확인하세요.')}</p>)}
        <div className="row">
          <label className="field"><span>{tr('좌석')}</span><input value={leg.seat ?? ''} onChange={(e) => set({ seat: e.target.value.toUpperCase() || undefined })} placeholder="34A" /></label>
          <label className="field"><span>{tr('예약 번호')}</span><input value={leg.pnr ?? ''} onChange={(e) => set({ pnr: e.target.value.toUpperCase() || undefined })} placeholder={tr('6자리')} /></label>
        </div>
      </div>
    </Sheet>
  )
}
