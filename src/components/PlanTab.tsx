import { tr } from '../i18n'
import { ALL, currentGroup, groupOf, useGroupView, visibleIn } from '../lib/groups'
import GroupPicker, { GroupTabs, GroupTag } from './GroupPicker'
import { tx, useTranslations } from '../lib/translate'
import { Reorder, useDragControls } from 'framer-motion'
import { BedDouble, Camera, Check, Clock, ExternalLink, GripVertical, MapPin, Plane, Plus, Route, Search, Sparkles, Trash2 } from 'lucide-react'
import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { CORE_AIRPORTS, airlineOf, airport } from '../data/airports'
import { CATEGORY, destination } from '../data/destinations'
import { aiMessage, aiSuggest } from '../lib/ai'
import { legOf } from '../lib/legs'
import { flightMinutes, isComplete, parseFlightText } from '../lib/flight'
import { localizeResults, searchPlaces, type GeoResult } from '../lib/geocode'
import { poiToPlace, retime, shortest, suggestions } from '../lib/planner'
import { arc, dateRange, distLabel, fmtDur, fromMin, haptic, km, md, toMin, travelLabel, travelMin, uid, weekday, won, wonShort } from '../lib/util'
import { putFlight, removePlace, syncPlaceCost, useStore } from '../store'
import CurrencySelect from './CurrencySelect'
import { baseOf, krwToBase, money, moneyShort, toWon, unit } from '../data/currencies'
import type { Category, Flight, Group, Place, Trip } from '../types'
import type { MapPoint } from './MapView'
import PhotoImport from './PhotoImport'
import StaySheet, { type StayDraft } from './StaySheet'
import { DEFAULT_IN, DEFAULT_OUT, dayLine, groupRoutes, hopFrom, nextStops, nightStay, routeSegments, type Entry, type LL } from '../lib/dayline'
import { Sheet, toast } from './ui'

const MapView = lazy(() => import('./MapView'))
const CATS = Object.keys(CATEGORY) as Category[]

const day0date = (t: Trip, i: number) => t.days[Math.min(i, t.days.length - 1)]?.date ?? t.start

export default function PlanTab({ trip }: { trip: Trip }) {
  useTranslations()
  const mutate = useStore((s) => s.mutate)
  const [idx, setIdx] = useState(0)
  /** 장소 추가 시트: 닫힘(false) 또는 처음 보여 줄 탭 */
  const [adding, setAdding] = useState<false | AddMode>(false)
  const leg = legOf(trip, day0date(trip, idx))
  const [editId, setEditId] = useState<string>()
  const [flight, setFlight] = useState<Flight | 'new'>()
  const [photos, setPhotos] = useState<File[] | null>(null)
  const [stay, setStay] = useState<StayDraft>()
  const di = Math.min(idx, trip.days.length - 1)
  const day = trip.days[di]

  // 그룹: 전체 / 그룹 하나. 그룹이 없는 여행은 지금처럼 하나의 일정
  const groups = trip.groups ?? []
  const [view, setView] = useGroupView(trip)
  const gv = groups.length ? view : undefined
  const inAll = gv === ALL
  const tagOf = (x: { group?: string }) => (inAll ? groupOf(trip, x.group) : undefined)
  const viewColor = gv && gv !== ALL ? groupOf(trip, gv)?.color : undefined
  /** 이 화면에 보이는 장소와 day.items 안의 자리 */
  const slots = day.items.map((p, i) => [p, i] as const).filter(([p]) => visibleIn(gv, p))
  const items = slots.map(([p]) => p)
  /** 보이는 장소만 바꾼 뒤 원래 자리에 다시 끼운다 (다른 그룹 장소는 그대로) */
  const putBack = (t: Trip, next: Place[]) => { const all = t.days[di].items; const idx = slots.map(([, i]) => i); idx.forEach((at, k) => { all[at] = next[k] }) }

  // 숙소 → 장소 → (시각에 맞춘) 항공편·공항 → 숙소 순서의 하루
  const line = useMemo(() => dayLine(trip, day.date, gv), [trip, day.date, gv])
  const nexts = useMemo(() => nextStops(line), [line])
  const shown = line.filter((e) => e.kind !== 'stay-missing').length
  const only = shown === 1

  const { points, arcs, route, routes, picks } = useMemo(() => {
    const points: MapPoint[] = []
    const picks: (() => void)[] = []
    const arcs: [number, number][][] = []
    const seen = new Set<string>()
    for (const e of line) {
      if (e.kind === 'place') { points.push({ lat: e.place.lat, lng: e.place.lng, label: String(e.no + 1), title: e.place.name, color: inAll ? groupOf(trip, e.place.group)?.color : viewColor }); picks.push(() => setEditId(e.place.id)) }
      else if ((e.kind === 'stay-start' || e.kind === 'stay-end') && !seen.has(e.stay.id)) {
        seen.add(e.stay.id)
        points.push({ lat: e.stay.lat, lng: e.stay.lng, label: '', stay: true, title: e.stay.name }); picks.push(() => setStay(e.stay))
      } else if (e.kind === 'flight') {
        const { from: a, to: b } = e
        if (a && b) arcs.push(arc([a.lng, a.lat], [b.lng, b.lat]))
        for (const ap of [a, b]) if (ap && !seen.has(ap.code)) { seen.add(ap.code); points.push({ lat: ap.lat, lng: ap.lng, label: ap.code, air: true, title: ap.name }); picks.push(() => setFlight(e.flight)) }
      }
    }
    const routes = groupRoutes(trip, day.date, gv, line)
    return { points, arcs, route: routeSegments(line), routes, picks }
  }, [line]) // eslint-disable-line react-hooks/exhaustive-deps

  /** 예약 비용으로 기록한 지출: '89 NZD' */
  const paidOf = (p: Place) => { const x = p.expenseId ? trip.expenses.find((e) => e.id === p.expenseId) : undefined; return x ? `${x.amount.toLocaleString('ko-KR')} ${unit(x.currency)}` : undefined }
  const dayCost = items.reduce((s, p) => s + (p.expenseId ? 0 : p.cost ?? 0), 0)
  const dayPaid = items.reduce((s, p) => { const x = p.expenseId ? trip.expenses.find((e) => e.id === p.expenseId) : undefined; return s + (x ? toWon(trip, x.amount, x.currency) : 0) }, 0)
  const dayDist = items.slice(1).reduce((s, p, i) => s + km(items[i], p), 0)

  return (
    <>
      <div className="days" role="tablist" aria-label={tr('날짜')}>
        {trip.days.map((d, i) => (
          <button key={d.date} role="tab" className="day-chip" aria-selected={i === di} onClick={(e) => { setIdx(i); haptic(); e.currentTarget.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' }) }}>
            <b>{i + 1}</b><small>{md(d.date)} {weekday(d.date)}</small>
          </button>
        ))}
      </div>

      <GroupTabs trip={trip} view={view} onChange={(v) => { haptic(); setView(v) }} />

      <div className="plan-map">
        <Suspense fallback={null}>
          <MapView points={points} arcs={arcs} route={route} routes={routes} center={leg} onPick={(i) => picks[i]?.()} />
        </Suspense>
      </div>

      <div className="day-head">
        <div>
          <h2>{tr('{0}일차', di + 1)}</h2>
          <p>
            {items.length ? tr('{0}곳', items.length) : tr('아직 장소가 없습니다')}
            {dayDist > 0 && tr(' · 이동 {0}', distLabel(dayDist))}
            {dayPaid > 0 && tr(' · 예약 비용 {0}', moneyShort(krwToBase(trip, dayPaid), baseOf(trip)))}
            {dayCost > 0 && tr(' · 1인 약 {0}', moneyShort(krwToBase(trip, dayCost), baseOf(trip)))}
          </p>
        </div>
      </div>

      {line.length === 0 ? (
        <div className="empty">
          <strong>{tr('{0}에서 보낼 하루가 비어 있습니다', tx(leg.city))}</strong>
          {tr('trj assistant가 이 날 머무는 곳 가까이에서 갈 만한 곳을 골라 드립니다.')}
          <div style={{ marginTop: 16 }}>
            <button className="btn btn-primary" onClick={() => setAdding('ai-auto')}><Sparkles size={18} />{tr('trj assistant에게 추천받기')}</button>
          </div>
        </div>
      ) : (
        <Reorder.Group as="ol" axis="y" className="tl" values={items} onReorder={(next) => mutate(trip.id, (t) => putBack(t, next as Place[]))}>
          {line.map((e, i) => {
            const next = nexts[i]
            switch (e.kind) {
              case 'stay-start': case 'stay-end':
                return <StayRow key={`${e.kind}${e.stay.id}`} e={e} date={day.date} next={next} only={only} tag={tagOf(e.stay)} onOpen={() => setStay(e.stay)} />
              case 'flight':
                return <FlightRow key={`${e.arriving ? 'a' : 'd'}${e.flight.id}`} e={e} next={next} only={only} tag={tagOf(e.flight)} onOpen={() => setFlight(e.flight)} />
              case 'place':
                return (
                  <PlaceRow key={e.place.id} p={e.place} n={e.no + 1} tag={tagOf(e.place)} color={inAll ? groupOf(trip, e.place.group)?.color : viewColor} next={next} only={only} paid={paidOf(e.place)} est={e.place.cost ? moneyShort(krwToBase(trip, e.place.cost), baseOf(trip)) : undefined}
                    onOpen={() => setEditId(e.place.id)}
                    onToggle={() => { haptic(); mutate(trip.id, (t) => { const x = t.days[di].items[e.index]; x.done = !x.done }) }} />
                )
              default:
                return (
                  <li key="stay-missing" className="tl-item stay-missing">
                    <div className="tl-time" />
                    <div className="tl-rail"><span className="tl-node stay ghost"><BedDouble size={15} /></span></div>
                    <div className="tl-body">
                      <button className="stay-add" onClick={() => setStay({ checkIn: day.date })}>
                        <b><Plus size={16} />{tr('오늘 밤 묵을 숙소 정하기')}</b>
                        <small>{tr('넣으면 체크인·체크아웃과 숙소로 돌아오는 길이 일정 위아래에 붙습니다')}</small>
                      </button>
                    </div>
                  </li>
                )
            }
          })}
        </Reorder.Group>
      )}
      {line.length > 0 && items.length === 0 && (
        <div className="empty slim">
          {tr('오늘의 여정이 아직 없습니다')}
          <div style={{ marginTop: 10 }}>
            <button className="btn btn-ghost" onClick={() => setAdding('ai-auto')}><Sparkles size={16} />{tr('trj assistant에게 추천받기')}</button>
          </div>
        </div>
      )}

      <div className="add-row">
        <button className="btn btn-primary" onClick={() => setAdding('search')}><Plus size={18} />{tr('장소 추가')}</button>
        <label className="btn btn-ghost">
          <Camera size={18} />{tr('사진으로 추가')}
          <input type="file" accept="image/*,application/pdf" multiple hidden onChange={(e) => { const f = [...(e.target.files ?? [])]; e.target.value = ''; if (f.length) setPhotos(f) }} />
        </label>
        <button className="btn btn-ghost sq" onClick={() => setStay(nightStay(trip, day.date, gv === ALL ? undefined : gv) ?? { checkIn: day.date < trip.end ? day.date : trip.days[Math.max(0, di - 1)].date })} aria-label={tr('숙소')}><BedDouble size={18} /><span className="wide-only">{tr('숙소')}</span></button>
        <button className="btn btn-ghost sq" onClick={() => setFlight('new')} aria-label={tr('항공편 추가')}><Plane size={18} /><span className="wide-only">{tr('항공편')}</span></button>
      </div>
      {items.length > 1 && (
        <div className="tools">
          <button className="btn btn-quiet" onClick={() => { mutate(trip.id, (t) => { const mine = slots.map(([, i]) => t.days[di].items[i]); const next = shortest(mine); retime(next); putBack(t, next) }); toast(tr('가까운 순서로 다시 이었습니다')) }}><Route size={16} />{tr('가까운 순으로 정리')}</button>
          <button className="btn btn-quiet" onClick={() => { mutate(trip.id, (t) => retime(slots.map(([, i]) => t.days[di].items[i]))); toast(tr('이동 시간을 넣어 시각을 다시 맞췄습니다')) }}><Clock size={16} />{tr('시각 다시 맞추기')}</button>
        </div>
      )}

      <AddPlaceSheet open={adding !== false} initial={adding || 'search'} onClose={() => setAdding(false)} trip={trip} di={di} />
      <EditPlaceSheet trip={trip} di={di} id={editId} onClose={() => setEditId(undefined)}
        onMakeStay={(p) => { setEditId(undefined); setStay({ checkIn: day.date < trip.end ? day.date : trip.days[Math.max(0, di - 1)].date, name: p.name, lat: p.lat, lng: p.lng }) }} />
      <FlightSheet trip={trip} flight={flight} onClose={() => setFlight(undefined)} />
      <StaySheet trip={trip} stay={stay} onClose={() => setStay(undefined)} />
      <PhotoImport trip={trip} files={photos} current={day.date} onClose={() => setPhotos(null)}
        onGo={(date) => { const i = trip.days.findIndex((d) => d.date === date); if (i >= 0) setIdx(i) }} />
    </>
  )
}

function PlaceRow({ p, n, next, only, onOpen, onToggle, paid, est, tag, color }: { p: Place; n: number; next?: LL; only: boolean; onOpen: () => void; onToggle: () => void; paid?: string; est?: string; tag?: Group; color?: string }) {
  const controls = useDragControls()
  const c = CATEGORY[p.category]
  return (
    <Reorder.Item value={p} as="li" className={`tl-item${only ? ' only' : ''}`} dragListener={false} dragControls={controls}
      whileDrag={{ scale: 1.02, zIndex: 5 }} onDragStart={() => haptic(10)}>
      <div className="tl-time">{p.time ?? ''}</div>
      <div className="tl-rail">
        <button className={`tl-node${p.done ? ' done' : ''}`} style={color && !p.done ? { background: color } : undefined} onClick={onToggle} aria-label={`${p.name} ${p.done ? tr('다녀옴 취소') : tr('다녀옴으로 표시')}`}>
          {p.done ? <Check size={15} strokeWidth={3} /> : n}
        </button>
      </div>
      <div className="tl-body">
        <div className={`card${p.done ? ' done' : ''}`}>
          <button className="card-main" onClick={onOpen}>
            <h3>{tx(p.name)}</h3>
            <div className="sub">
              <GroupTag g={tag} />
              <span className="cat" style={{ color: c.color }}>{c.label}</span>
              {p.duration ? <span>{fmtDur(p.duration)}</span> : null}
              {paid ? <span className="paid">{paid}</span> : est ? <span>{tr('1인 약 {0}', est)}</span> : null}
            </div>
            {p.note && <div className="note">{tx(p.note)}</div>}
          </button>
          <div className="grip" onPointerDown={(e) => controls.start(e)} aria-hidden="true"><GripVertical size={18} /></div>
        </div>
        <Hop from={p} to={next} />
      </div>
    </Reorder.Item>
  )
}

export function Hop({ from, to }: { from?: LL; to?: LL }) {
  return from && to ? <div className="hop">{travelLabel(km(from, to))} · {distLabel(km(from, to))}</div> : <div style={{ height: 10 }} />
}

/** 항공편: 그 날 시각에 맞춰 장소 사이에 들어가고, 공항이 동선의 한 지점이 된다 */
export function FlightRow({ e, next, only, onOpen, tag }: { e: Extract<Entry, { kind: 'flight' }>; next?: LL; only: boolean; onOpen: () => void; tag?: Group }) {
  const f = e.flight
  const arriving = e.arriving
  const mins = flightMinutes(f)
  const ap = arriving ? e.to : e.from
  return (
    <li className={`tl-item air${only ? ' only' : ''}`}>
      <div className="tl-time">{e.time}</div>
      <div className="tl-rail"><span className="tl-node air"><Plane size={15} /></span></div>
      <div className="tl-body">
        <p className="air-where"><GroupTag g={tag} />{tag ? ' ' : ''}{arriving ? tr('{0} 도착', ap?.name ?? f.to) : tr('{0}에서 출발', ap?.name ?? f.from)}</p>
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
        <Hop from={hopFrom(e)} to={next} />
      </div>
    </li>
  )
}

/** 숙소: 그 날 아침에 나서는 곳(위)과 밤에 돌아오는 곳(아래) */
export function StayRow({ e, date, next, only, onOpen, tag }: { e: Extract<Entry, { kind: 'stay-start' | 'stay-end' }>; date: string; next?: LL; only: boolean; onOpen: () => void; tag?: Group }) {
  const s = e.stay
  const start = e.kind === 'stay-start'
  const total = dateRange(s.checkIn, s.checkOut).length - 1
  /** 이 숙소에서 맞는 몇 번째 아침인가 */
  const morning = dateRange(s.checkIn, date).length - 1
  const title = start ? (e.checkout ? tr('체크아웃') : tr('숙소에서 출발')) : e.checkin ? tr('체크인 · {0}박', total) : tr('숙소로 돌아오기')
  const sub = start
    ? e.checkout ? tr('{0}까지 방을 비우세요. 짐은 프런트에 맡길 수 있는지 물어보세요', s.outTime ?? DEFAULT_OUT) : tr('{0}박 중 {1}번째 아침 · {2} 체크아웃', total, morning, md(s.checkOut))
    : e.checkin ? tr('{0}부터 · {1} 체크아웃', s.inTime ?? DEFAULT_IN, md(s.checkOut)) : tr('{0} 체크아웃', md(s.checkOut))
  return (
    <li className={`tl-item stay ${start ? 'top' : 'bottom'}${only ? ' only' : ''}`}>
      {/* 시각은 줄 왼쪽이 아니라 카드 안에 쓴다: 위아래에 고정되는 칸이라 장소 시각 순서와 섞이지 않게 */}
      <div className="tl-time" />
      <div className="tl-rail"><span className="tl-node stay"><BedDouble size={15} /></span></div>
      <div className="tl-body">
        <button className="stay-card" onClick={onOpen} aria-label={tr('{0} 숙소 수정', s.name)}>
          <span className="stay-kind">{title}{tag && <> <GroupTag g={tag} /></>}</span>
          <b>{tx(s.name)}</b>
          <small>{sub}{s.code ? ` · ${tr('예약')} ${s.code}` : ''}</small>
        </button>
        {start ? <Hop from={s} to={next} /> : <div style={{ height: 14 }} />}
      </div>
    </li>
  )
}

/* ── 장소 추가 ── */
type AddMode = 'search' | 'ai' | 'ai-auto' | 'pick'

function AddPlaceSheet({ open, initial, onClose, trip, di }: { open: boolean; initial: AddMode; onClose: () => void; trip: Trip; di: number }) {
  const mutate = useStore((s) => s.mutate)
  // 여러 도시를 도는 여행이면 그 날 머무는 도시를 기준으로 찾고 추천한다
  const leg = legOf(trip, trip.days[di]?.date ?? trip.start)
  const dest = destination(leg.destId)
  const [mode, setMode] = useState<'pick' | 'ai' | 'search'>('search')
  const [ai, setAi] = useState<Place[]>()
  const [aiBusy, setAiBusy] = useState(false)
  const [aiError, setAiError] = useState('')
  const askAi = async () => {
    setAiBusy(true); setAiError('')
    try { setAi(await aiSuggest(trip, di)) } catch (e) { setAiError(aiMessage(e)) } finally { setAiBusy(false) }
  }
  useEffect(() => {
    if (!open) return
    setAi(undefined); setAiError('')
    setMode(initial === 'ai-auto' ? 'ai' : initial)
    if (initial === 'ai-auto') void askAi()
  }, [di, open]) // eslint-disable-line react-hooks/exhaustive-deps
  const [q, setQ] = useState('')
  const [results, setResults] = useState<GeoResult[]>()
  const [error, setError] = useState('')
  const picks = useMemo(() => (dest && open ? suggestions(dest, trip, di) : []), [dest, trip, di, open])

  useEffect(() => {
    if (q.trim().length < 2) { setResults(undefined); return }
    const ac = new AbortController()
    const id = setTimeout(() => {
      searchPlaces(q, leg, ac.signal).then((r) => {
        setResults(r); setError('')
        // 지도에 한국어(영어) 이름이 없는 곳은 화면 언어 이름을 받아 바꿔 보여 준다
        localizeResults(r, leg.city).then((l) => { if (!ac.signal.aborted && l !== r) setResults(l) })
      })
        .catch((e) => { if (e.name !== 'AbortError') setError(tr('검색하지 못했습니다. 연결을 확인한 뒤 다시 입력하세요')) })
    }, 500)
    return () => { clearTimeout(id); ac.abort() }
  }, [q, leg.lat, leg.lng])

  const add = (place: Place) => {
    mutate(trip.id, (t) => {
      const items = t.days[di].items
      const last = items[items.length - 1]
      if (last?.time) place.time = fromMin(Math.round((toMin(last.time) + (last.duration ?? 60) + travelMin(km(last, place))) / 10) * 10)
      // 그룹 화면에서 넣으면 그 그룹의 일정
      const g = currentGroup(trip.id)
      if (g && !place.group) place.group = g
      items.push(place)
    })
    haptic()
    toast(tr('{0}일차에 {1} 추가', di + 1, place.name))
  }

  return (
    <Sheet open={open} onClose={onClose} title={tr('{0}일차에 장소 추가', di + 1)}>
      <div className="seg" style={{ marginBottom: 14 }}>
        <button aria-pressed={mode === 'search'} onClick={() => setMode('search')}>{tr('직접 검색')}</button>
        <button aria-pressed={mode === 'ai'} onClick={() => { setMode('ai'); if (!ai && !aiBusy) void askAi() }}>trj assistant</button>
        {dest && <button aria-pressed={mode === 'pick'} onClick={() => setMode('pick')}>{tr('가까운 추천')}</button>}
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
          {aiBusy && !ai && (
            <div className="list ai-wait" aria-busy="true" style={{ marginBottom: 12 }}>
              {[0, 1, 2].map((i) => <div key={i}><i className="dot" /><span className="grow"><b className="bar" /><small className="bar short" /></span></div>)}
            </div>
          )}
          <button className="btn btn-ghost btn-block" disabled={aiBusy} onClick={askAi}>
            <Sparkles size={18} className={aiBusy ? 'spin' : undefined} />{aiBusy ? tr('추천을 받는 중') : ai ? tr('다른 곳 더 추천받기') : tr('이 날 동선에 맞는 곳 추천받기')}
          </button>
          <p className="hint">{tr('trj assistant(Gemini)가 고른 곳입니다. 위치와 영업시간은 가기 전에 확인하세요.')}</p>
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
            <input autoFocus placeholder={tr('{0}에서 가고 싶은 곳', leg.city)} value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
          {error && <p className="hint" style={{ color: 'var(--warn)' }}>{error}</p>}
          {results && (results.length ? (
            <div className="list" style={{ marginTop: 10 }}>
              {results.map((r, i) => (
                <button key={i} onClick={() => add({ id: uid(), name: r.name, lat: r.lat, lng: r.lng, category: r.category, duration: 60 })}>
                  <MapPin size={18} className="mute" />
                  <span className="grow"><b>{r.name}</b><small>{[r.local, r.detail].filter(Boolean).join(' · ')}</small></span>
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
function EditPlaceSheet({ trip, di, id, onClose, onMakeStay }: { trip: Trip; di: number; id?: string; onClose: () => void; onMakeStay: (p: Place) => void }) {
  const mutate = useStore((s) => s.mutate)
  const source = trip.days[di]?.items.find((p) => p.id === id)
  const [d, setD] = useState<Place>()
  const [moveTo, setMoveTo] = useState(di)
  // 위치: 이름·주소로 찾아 고르거나, 주소를 고치면 저장할 때 그 주소로 다시 찾는다
  const [q, setQ] = useState('')
  const [results, setResults] = useState<GeoResult[]>()
  const [moved, setMoved] = useState<'none' | 'picked' | 'address'>('none')
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    if (q.trim().length < 2) { setResults(undefined); return }
    const ac = new AbortController()
    const near = legOf(trip, trip.days[moveTo]?.date ?? trip.start)
    const t = setTimeout(() => { searchPlaces(q, near, ac.signal).then((x) => setResults(x.filter((y) => !y.airport).slice(0, 6))).catch(() => {}) }, 450)
    return () => { clearTimeout(t); ac.abort() }
  }, [q]) // eslint-disable-line react-hooks/exhaustive-deps
  // 전체 예약 비용: 예산의 지출과 묶인다
  const [cost, setCost] = useState('')
  const [currency, setCurrency] = useState(trip.currency)
  useEffect(() => {
    if (!source) return
    setD({ ...source }); setMoveTo(di); setQ(''); setResults(undefined); setMoved('none'); setSaving(false)
    const e = source.expenseId ? trip.expenses.find((x) => x.id === source.expenseId) : undefined
    setCost(e ? String(e.amount) : ''); setCurrency(e?.currency ?? trip.currency)
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps
  const set = (patch: Partial<Place>) => setD((x) => (x ? { ...x, ...patch } : x))

  const save = async () => {
    if (!d || !d.name.trim() || saving) return
    let place = d
    // 주소만 고쳤으면 그 주소로 지도 위치를 다시 찾는다
    if (moved === 'address' && d.address?.trim()) {
      setSaving(true)
      const near = legOf(trip, trip.days[moveTo]?.date ?? trip.start)
      const a = d.address.trim()
      let hit: GeoResult | undefined
      for (const query of [...new Set([a, a.replace(/^\s*\d+[\w/-]*\s+/, '')])]) {
        const hits = (await searchPlaces(query, near).catch(() => [])).filter((x) => !x.airport)
        hit = /,/.test(query) ? hits[0] : hits.find((x) => km(near, x) <= 150)
        if (hit) break
      }
      setSaving(false)
      if (hit) place = { ...d, lat: hit.lat, lng: hit.lng }
      else toast(tr('주소로 지도 위치를 찾지 못해 위치는 그대로 두었습니다. 위치 검색에서 골라 보세요'))
    }
    const dd = place
    mutate(trip.id, (t) => {
      const items = t.days[di].items
      const i = items.findIndex((p) => p.id === d.id)
      if (i < 0) return
      const p = { ...dd, name: dd.name.trim(), address: dd.address?.trim() || undefined }
      const amount = Number(cost.replace(/[^\d.]/g, ''))
      const had = Boolean(p.expenseId)
      syncPlaceCost(t, p, t.days[moveTo].date, { amount: amount > 0 ? amount : 0, currency })
      if (moveTo === di) items[i] = p
      else { items.splice(i, 1); t.days[moveTo].items.push(p) }
      if (!had && p.expenseId) toast(tr('예약 비용을 예산에 기록했습니다'))
    })
    if (moveTo !== di) toast(tr('{0}일차로 옮겼습니다', moveTo + 1))
    onClose()
  }
  const remove = () => {
    mutate(trip.id, (t) => { if (id) removePlace(t, id) })
    toast(source?.expenseId ? tr('장소와 예약 비용 지출을 삭제했습니다') : tr('장소를 삭제했습니다')); onClose()
  }

  return (
    <Sheet open={Boolean(id && d)} onClose={onClose} title={tr('장소 수정')}
      foot={<><button className="btn btn-ghost" style={{ flex: 'none', color: 'var(--warn)' }} onClick={remove} aria-label={tr('장소 삭제')}><Trash2 size={18} /></button><button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? tr('위치 찾는 중') : tr('변경 내용 저장')}</button></>}>
      {d && (
        <div className="stack">
          <label className="field"><span>{tr('이름')}</span><input value={d.name} onChange={(e) => set({ name: e.target.value })} /></label>
          <GroupPicker trip={trip} value={d.group} onChange={(g) => set({ group: g })} />

          <div className="field"><span>{tr('위치')}</span>
            <div className="input-btn">
              <input value={q} placeholder={tr('장소 이름이나 주소로 위치 찾기')} onChange={(e) => setQ(e.target.value)} />
              <a className="icon-btn" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${d.lat},${d.lng}`)}`} target="_blank" rel="noopener" aria-label={tr('지금 위치를 지도에서 보기')}><ExternalLink size={16} /></a>
            </div>
          </div>
          {results && results.length > 0 && (
            <div className="list stay-results" style={{ marginTop: -6 }}>
              {results.map((x, i) => (
                <button key={i} onClick={() => { set({ lat: x.lat, lng: x.lng, address: x.detail ? `${x.name}, ${x.detail}` : x.name, ...(x.category === 'relax' ? { category: 'relax' as const } : {}) }); setMoved('picked'); setResults(undefined); setQ(''); toast(tr('위치를 {0}(으)로 옮깁니다. 저장하면 반영됩니다', x.name)) }}>
                  <MapPin size={16} />
                  <span className="grow"><b>{x.name}</b><small>{x.detail}</small></span>
                </button>
              ))}
            </div>
          )}
          {q.trim().length >= 2 && !results && <p className="hint" style={{ marginTop: -6 }}><Search size={13} /> {tr('찾는 중')}</p>}
          {results && !results.length && <p className="hint" style={{ marginTop: -6 }}>{tr('찾지 못했습니다. 영어 이름이나 주소로 찾아 보세요')}</p>}
          <label className="field"><span>{tr('주소')}</span>
            <input value={d.address ?? ''} placeholder={tr('예: 18 Beach Road, Kaikōura')} autoComplete="street-address" onChange={(e) => { set({ address: e.target.value || undefined }); setMoved('address') }} /></label>
          <p className="hint" style={{ marginTop: -6 }}>{moved === 'picked' ? tr('고른 곳으로 위치가 바뀝니다.') : moved === 'address' ? tr('저장할 때 이 주소로 지도 위치를 다시 찾습니다.') : tr('위 검색에서 고르거나, 주소를 고치면 지도 위치가 바뀝니다.')}</p>
          <div className="row">
            <label className="field"><span>{tr('시작 시각')}</span><input type="time" value={d.time ?? ''} onChange={(e) => set({ time: e.target.value || undefined })} /></label>
            <label className="field"><span>{tr('머무는 시간(분)')}</span><input type="number" inputMode="numeric" min={0} step={15} value={d.duration ?? ''} onChange={(e) => set({ duration: e.target.value ? Number(e.target.value) : undefined })} /></label>
          </div>
          <div className="field"><span>{tr('종류')}</span>
            <div className="chips">{CATS.map((c) => <button key={c} className="chip" aria-pressed={d.category === c} onClick={() => set({ category: c })}>{CATEGORY[c].label}</button>)}</div>
          </div>
          {d.category === 'stay' && (
            <button className="stay-add" onClick={() => { mutate(trip.id, (t) => { t.days[di].items = t.days[di].items.filter((p) => p.id !== d.id) }); onMakeStay(d) }}>
              <b><BedDouble size={16} />{tr('숙소로 등록하기')}</b>
              <small>{tr('체크인·체크아웃 날짜를 정하면 묵는 날마다 일정 위아래에 붙습니다')}</small>
            </button>
          )}
          <div className="row">
            <label className="field"><span>{tr('전체 예약 비용 (예산에 기록)')}</span>
              <input inputMode="decimal" value={cost} placeholder="0" onChange={(e) => setCost(e.target.value)} /></label>
            <CurrencySelect trip={trip} value={currency} onChange={setCurrency} />
          </div>
          <p className="hint" style={{ marginTop: -8 }}>
            {Number(cost) > 0 && currency !== baseOf(trip) ? tr('약 {0}. ', money(krwToBase(trip, toWon(trip, Number(cost), currency)), baseOf(trip))) : ''}
            {tr('투어·입장권·예약처럼 낸 돈 전체를 적으면 예산 탭의 지출로 들어갑니다. 결제한 사람과 나눌 사람은 예산 탭에서 고칠 수 있습니다.')}
            {d.cost && !cost ? ` ${tr('추천 때 넣은 1인 예상 비용: {0}', moneyShort(krwToBase(trip, d.cost), baseOf(trip)))}` : ''}
          </p>
          <div className="row">
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
    const g = currentGroup(trip.id)
    setLegs([editing ? { ...editing } : { depDate: trip.start, arrDate: trip.start, ...(g ? { group: g } : {}) }]); setCur(0); setRaw(''); setFound(undefined)
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
    if (parsed.length) { const g = legs[0]?.group; setLegs(parsed.map((f) => (g ? { ...f, group: g } : f))); setCur(0) }
  }

  const save = () => {
    let moved = 0, nextDay = 0
    mutate(trip.id, (t) => ready.forEach((f) => {
      const r = putFlight(t, { ...f, id: f.id ?? uid(), flightNo: f.flightNo.toUpperCase().replace(/\s/g, ''), from: f.from.toUpperCase(), to: f.to.toUpperCase() })
      moved += r.moved; nextDay += r.nextDay
    }))
    haptic(12)
    const first = ready.reduce((a, f) => (f.depDate < a ? f.depDate : a), trip.start), last = ready.reduce((a, f) => (f.arrDate > a ? f.arrDate : a), trip.end)
    const msg = first < trip.start || last > trip.end ? tr('항공편에 맞춰 여행 기간을 {0}–{1}로 넓혔습니다', md(first), md(last))
      : ready.length > 1 ? tr('항공편 {0}개를 일정에 기록했습니다', ready.length) : tr('{0} 일정에 항공편을 기록했습니다', md(ready[0].depDate))
    // 도착 전 시각에 잡혀 있던 장소를 옮겼으면 함께 알린다
    toast(moved ? `${msg}. ${nextDay ? tr('도착 전 일정 {0}곳을 도착 뒤로 옮기고, 늦은 {1}곳은 다음 날로 넘겼습니다', moved, nextDay) : tr('도착 전 일정 {0}곳을 도착 뒤로 옮겼습니다', moved)}` : msg)
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
        <GroupPicker trip={trip} value={leg.group} onChange={(g) => setLegs((ls) => ls.map((l) => ({ ...l, group: g })))} />
        <label className="field"><span>{tr('항공편 번호')}{leg.flightNo && airlineOf(leg.flightNo) ? ` · ${airlineOf(leg.flightNo)}` : ''}</span>
          <input value={leg.flightNo ?? ''} onChange={(e) => set({ flightNo: e.target.value.toUpperCase() })} placeholder="KE703" autoCapitalize="characters" />
        </label>
        <div className="row">
          <label className="field"><span>{tr('출발 공항')}{leg.from && airport(leg.from) ? ` · ${airport(leg.from)!.city}` : ''}</span>
            <input list="trj-airports" maxLength={3} value={leg.from ?? ''} onChange={(e) => set({ from: e.target.value.toUpperCase() })} placeholder="ICN" /></label>
          <label className="field"><span>{tr('도착 공항')}{leg.to && airport(leg.to) ? ` · ${airport(leg.to)!.city}` : ''}</span>
            <input list="trj-airports" maxLength={3} value={leg.to ?? ''} onChange={(e) => set({ to: e.target.value.toUpperCase() })} placeholder="NRT" /></label>
        </div>
        <datalist id="trj-airports">{CORE_AIRPORTS.map((a) => <option key={a.code} value={a.code}>{a.city} {a.name}</option>)}</datalist>
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
