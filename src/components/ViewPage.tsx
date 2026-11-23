import { tr } from '../i18n'
import { tx, useTranslations } from '../lib/translate'
import { Download, Eye, ListChecks, MapPin, RefreshCw, Route, Wallet } from 'lucide-react'
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { CATEGORY } from '../data/destinations'
import { dayLine, groupRoutes, nextStops, routeSegments } from '../lib/dayline'
import { ALL, groupOf, useGroupView } from '../lib/groups'
import { GroupTabs, GroupTag } from './GroupPicker'
import { fetchView } from '../lib/drive'
import { legOf } from '../lib/legs'
import { decodeView } from '../lib/share'
import { fetchShortView } from '../lib/viewLink'
import { prefetchTrip, useTripTranslations } from '../lib/translate'
import BudgetTab from './BudgetTab'
import PrepTab from './PrepTab'
import { arc, fmtDur, fmtRange, md, uid, weekday } from '../lib/util'
import { useStore } from '../store'
import type { Trip } from '../types'
import type { MapPoint } from './MapView'
import { FlightRow, Hop, StayRow } from './PlanTab'
import { Avatars, LangButton, Logo, go, toast } from './ui'

const MapView = lazy(() => import('./MapView'))
const maps = (q: string, ll?: { lat: number; lng: number }) =>
  open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(ll ? `${q} ${ll.lat},${ll.lng}` : q)}`, '_blank', 'noopener')

/**
 * 로그인 없이 보는 여행: #/v/<짧은 id> (앱 서버), #/view/<Drive 보기 파일 id>, #/view/s/<주소에 담은 일정>.
 * 일정·예산·준비물을 볼 수 있고 고칠 수는 없다. 짧은 링크와 Drive 링크는 1분마다 새로 받는다.
 */
type ViewTab = 'plan' | 'budget' | 'prep'
export default function ViewPage({ source }: { source: string }) {
  const snapshot = source.startsWith('s/')
  const [trip, setTrip] = useState<Trip | null | undefined>(() => (snapshot ? decodeView(source.slice(2)) : undefined))
  const [loadedAt, setLoadedAt] = useState(0)
  const [error, setError] = useState('')
  const [idx, setIdx] = useState(0)
  const [tab, setTab] = useState<ViewTab>('plan')
  const add = useStore((s) => s.add)
  useTranslations()
  useTripTranslations(trip)
  useEffect(() => { prefetchTrip(trip) }, [trip])

  const load = useCallback(async () => {
    if (snapshot) return
    try {
      // Drive 보기 링크도 먼저 앱 서버의 최신 내용(별칭)을 본다. 없으면 Drive 파일
      const t = source.startsWith('k/') ? (await fetchShortView(source.slice(2)))?.trip ?? null
        : (await fetchShortView(source, true).catch(() => null))?.trip ?? await fetchView(source)
      setTrip(t); setLoadedAt(Date.now()); setError('')
    } catch (e) { setError((e as Error).message) }
  }, [snapshot, source])

  useEffect(() => {
    if (snapshot) return
    void load()
    const id = setInterval(() => { if (document.visibilityState === 'visible') void load() }, 30_000)
    const onShow = () => { if (document.visibilityState === 'visible') void load() }
    document.addEventListener('visibilitychange', onShow)
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onShow) }
  }, [load, snapshot])

  // 여행 중이면 오늘 날짜를 먼저 보여 준다
  useEffect(() => {
    if (!trip) return
    const i = trip.days.findIndex((d) => d.date === new Date().toISOString().slice(0, 10))
    if (i > 0) setIdx(i)
  }, [trip?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  if (trip === undefined) return <Frame><div className="empty" style={{ paddingTop: 80 }}>{error || tr('일정을 불러오는 중…')}</div></Frame>
  if (trip === null) {
    return (
      <Frame>
        <div className="empty" style={{ paddingTop: 80 }}>
          <strong>{tr('볼 수 없는 링크입니다')}</strong>
          {snapshot ? tr('링크가 잘렸거나 손상되었습니다. 보낸 사람에게 다시 받아 주세요') : tr('여행 주인이 보기 링크를 껐거나 링크가 잘못되었습니다.')}
        </div>
      </Frame>
    )
  }

  const keep = () => {
    const copy: Trip = { ...trip, id: uid(), createdAt: Date.now(), drive: undefined, title: trip.title }
    add(copy); toast(tr('내 여행으로 담았습니다. 이제 고칠 수 있습니다')); go(`/trip/${copy.id}`)
  }

  return (
    <Frame head={<>
        <div className="meta" style={{ paddingTop: 4 }}>
          <div>
            <h1 className="view-title">{tx(trip.title)}</h1>
            <p>{fmtRange(trip.start, trip.end)}</p>
          </div>
          <Avatars members={trip.members} />
        </div>
        <p className="view-note"><Eye size={14} />{snapshot ? tr('보낸 사람이 보낼 때의 일정입니다') : tr('보기 전용 · 고친 내용은 1분마다 새로 받아 옵니다')}
          {!snapshot && <button className="view-refresh" onClick={() => void load()} aria-label={tr('새로 고침')}><RefreshCw size={13} />{loadedAt ? clock(loadedAt) : ''}</button>}
        </p>
      </>}>
      <nav className="view-tabs" role="tablist" aria-label={tr('여행 메뉴')}>
        {([['plan', tr('일정'), Route], ['budget', tr('예산'), Wallet], ['prep', tr('준비'), ListChecks]] as const).map(([id, label, Icon]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => { setTab(id); scrollTo(0, 0) }}><Icon size={17} />{label}</button>
        ))}
      </nav>
      <main className="trip-main">
        {tab === 'plan' && <Day trip={trip} idx={idx} setIdx={setIdx} />}
        {tab === 'budget' && <BudgetTab trip={trip} readOnly />}
        {tab === 'prep' && <PrepTab trip={trip} readOnly />}
      </main>
      <div className="view-foot">
        <button className="btn btn-ghost" onClick={keep}><Download size={18} />{tr('내 여행으로 담기')}</button>
        <button className="btn btn-quiet" onClick={() => go('/')}>{tr('trj에서 내 여행 짜기')}</button>
      </div>
    </Frame>
  )
}

const clock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

function Frame({ head, children }: { head?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="shell wide view-page">
      <header className="trip-head view-head">
        <div className="view-brand"><Logo height={22} /><LangButton /></div>
        {head}
      </header>
      {children}
    </div>
  )
}

function Day({ trip, idx, setIdx }: { trip: Trip; idx: number; setIdx: (i: number) => void }) {
  useTranslations()
  const di = Math.min(idx, trip.days.length - 1)
  const day = trip.days[di]
  // 보기 링크에서도 그룹 탭을 고를 수 있다 (이 기기에서만 기억)
  const [view, setView] = useGroupView(trip)
  const gv = trip.groups?.length ? view : undefined
  const inAll = gv === ALL
  const colorOf = (x: { group?: string }) => groupOf(trip, inAll ? x.group : gv === ALL ? undefined : gv)?.color
  const tagOf = (x: { group?: string }) => (inAll ? groupOf(trip, x.group) : undefined)
  const line = useMemo(() => dayLine(trip, day.date, gv), [trip, day.date, gv])
  const nexts = useMemo(() => nextStops(line), [line])
  const only = line.filter((e) => e.kind !== 'stay-missing').length === 1
  const leg = legOf(trip, day.date)
  const { points, arcs, route, routes } = useMemo(() => {
    const points: MapPoint[] = []
    const arcs: [number, number][][] = []
    const seen = new Set<string>()
    for (const e of line) {
      if (e.kind === 'place') points.push({ lat: e.place.lat, lng: e.place.lng, label: String(e.no + 1), title: e.place.name, color: colorOf(e.place) })
      else if ((e.kind === 'stay-start' || e.kind === 'stay-end') && !seen.has(e.stay.id)) { seen.add(e.stay.id); points.push({ lat: e.stay.lat, lng: e.stay.lng, label: '', stay: true, title: e.stay.name }) }
      else if (e.kind === 'flight') {
        const { from: a, to: b } = e
        if (a && b) arcs.push(arc([a.lng, a.lat], [b.lng, b.lat]))
        for (const ap of [a, b]) if (ap && !seen.has(ap.code)) { seen.add(ap.code); points.push({ lat: ap.lat, lng: ap.lng, label: ap.code, air: true, title: ap.name }) }
      }
    }
    return { points, arcs, route: routeSegments(line), routes: groupRoutes(trip, day.date, gv, line) }
  }, [line]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <div className="days" role="tablist" aria-label={tr('날짜')}>
        {trip.days.map((d, i) => (
          <button key={d.date} role="tab" className="day-chip" aria-selected={i === di} onClick={(e) => { setIdx(i); e.currentTarget.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' }) }}>
            <b>{i + 1}</b><small>{md(d.date)} {weekday(d.date)}</small>
          </button>
        ))}
      </div>
      <GroupTabs trip={trip} view={view} onChange={setView} />
      <div className="plan-map">
        <Suspense fallback={null}><MapView points={points} arcs={arcs} route={route} routes={routes} center={leg} /></Suspense>
      </div>
      <div className="day-head"><div><h2>{tr('{0}일차', di + 1)}</h2><p>{(() => { const n = line.filter((e) => e.kind === 'place').length; return n ? tr('{0}곳', n) : tr('정해진 장소가 없습니다') })()}</p></div></div>
      {line.length === 0 ? <div className="empty slim">{tr('자유 일정')}</div> : (
        <ol className="tl">
          {line.map((e, i) => {
            const next = nexts[i]
            switch (e.kind) {
              case 'stay-start': case 'stay-end':
                return <StayRow key={`${e.kind}${e.stay.id}`} e={e} date={day.date} next={next} only={only} tag={tagOf(e.stay)} onOpen={() => maps(e.stay.address || e.stay.name, e.stay)} />
              case 'flight':
                return <FlightRow key={`${e.arriving ? 'a' : 'd'}${e.flight.id}`} e={e} next={next} only={only} tag={tagOf(e.flight)} onOpen={() => undefined} />
              case 'place': {
                const p = e.place, c = CATEGORY[p.category]
                return (
                  <li key={p.id} className={`tl-item${only ? ' only' : ''}`}>
                    <div className="tl-time">{p.time ?? ''}</div>
                    <div className="tl-rail"><span className="tl-node" style={colorOf(p) ? { background: colorOf(p) } : undefined}>{e.no + 1}</span></div>
                    <div className="tl-body">
                      <div className="card">
                        <button className="card-main" onClick={() => maps(p.address || p.name, p.address ? undefined : p)} aria-label={tr('{0} 지도에서 보기', p.name)}>
                          <h3>{tx(p.name)}</h3>
                          <div className="sub"><GroupTag g={tagOf(p)} /><span className="cat" style={{ color: c.color }}>{c.label}</span>{p.duration ? <span>{fmtDur(p.duration)}</span> : null}<span className="map-hint"><MapPin size={12} />{tr('지도')}</span></div>
                          {p.note && <div className="note">{tx(p.note)}</div>}
                        </button>
                      </div>
                      <Hop from={p} to={next} />
                    </div>
                  </li>
                )
              }
              default: return null
            }
          })}
        </ol>
      )}
    </>
  )
}
