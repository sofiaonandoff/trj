import { tr } from '../i18n'
import CurrencySelect from './CurrencySelect'
import { BedDouble, Copy, MapPin, Search, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { DEFAULT_IN, DEFAULT_OUT } from '../lib/dayline'
import { searchPlaces, type GeoResult } from '../lib/geocode'
import { legOf } from '../lib/legs'
import { addDays, dateRange, km, md, uid, weekday } from '../lib/util'
import { putStay, removeStay, useStore } from '../store'
import type { Stay, Trip } from '../types'
import { copy, Sheet, toast } from './ui'

/** 새 숙소를 열 때 넘기는 값 (체크인 날짜만 정해서 연다) */
export type StayDraft = Stay | { checkIn: string; name?: string; lat?: number; lng?: number }

const nights = (a: string, b: string) => Math.max(0, dateRange(a, b).length - 1)
const label = (d: string) => `${md(d)} ${weekday(d)}`

/** 숙소 넣기·고치기. 이름으로 찾으면 위치가 잡히고, 숙박비는 예산의 숙박 지출로 남는다 */
export default function StaySheet({ trip, stay, onClose }: { trip: Trip; stay?: StayDraft; onClose: () => void }) {
  const mutate = useStore((s) => s.mutate)
  const editing = stay && 'id' in stay ? stay : undefined
  const [d, setD] = useState<Stay>()
  const [cost, setCost] = useState('')
  const [currency, setCurrency] = useState('KRW')
  const [q, setQ] = useState('')
  /** 위치가 검색 결과로 정해졌는가. 아니면 저장할 때 주소(없으면 이름)로 위치를 찾는다 */
  const [pinned, setPinned] = useState(false)
  const [saving, setSaving] = useState(false)
  const [results, setResults] = useState<GeoResult[]>()

  useEffect(() => {
    if (!stay) return
    if ('id' in stay) {
      setD({ ...stay })
      const e = stay.expenseId ? trip.expenses.find((x) => x.id === stay.expenseId) : undefined
      setCost(e ? String(e.amount) : ''); setCurrency(e?.currency ?? 'KRW')
    } else {
      // 체크아웃 기본값: 다음 숙소 체크인 날, 없으면 그 도시를 떠나는 날(여행 마지막 날)
      const leg = legOf(trip, stay.checkIn)
      const legEnd = trip.legs?.find((l) => stay.checkIn >= l.start && stay.checkIn <= l.end)?.end
      const next = (trip.stays ?? []).map((s) => s.checkIn).filter((x) => x > stay.checkIn).sort()[0]
      const out = [next, legEnd, trip.end].filter(Boolean).filter((x) => x! > stay.checkIn).sort()[0] ?? addDays(stay.checkIn, 1)
      setD({ id: uid(), name: stay.name ?? '', lat: stay.lat ?? leg.lat, lng: stay.lng ?? leg.lng, checkIn: stay.checkIn, checkOut: out, inTime: DEFAULT_IN, outTime: DEFAULT_OUT })
      setCost(''); setCurrency('KRW')
    }
    setQ(''); setResults(undefined); setPinned('id' in stay || stay.lat !== undefined); setSaving(false)
  }, [stay]) // eslint-disable-line react-hooks/exhaustive-deps

  // 숙소 이름 찾기 (머무는 도시 근처 우선)
  useEffect(() => {
    if (!d || q.trim().length < 2) { setResults(undefined); return }
    const ac = new AbortController()
    const near = legOf(trip, d.checkIn)
    const id = setTimeout(() => { searchPlaces(q, near, ac.signal).then((r) => setResults(r.filter((x) => !x.airport).slice(0, 6))).catch(() => {}) }, 450)
    return () => { clearTimeout(id); ac.abort() }
  }, [q]) // eslint-disable-line react-hooks/exhaustive-deps

  const set = (patch: Partial<Stay>) => setD((x) => (x ? { ...x, ...patch } : x))
  const days = trip.days.map((x) => x.date)
  const outOptions = d ? dateRange(addDays(d.checkIn, 1), addDays(trip.end > d.checkIn ? trip.end : d.checkIn, 1)) : []

  /**
   * 에어비앤비처럼 이름으로는 찾을 수 없는 숙소: 주소를 넣으면 저장할 때 그 주소로 지도 위치를 찾는다.
   * 주소로도 못 찾으면 머무는 도시 가운데에 두고 알린다.
   */
  const locate = async (x: Stay): Promise<{ stay: Stay; found: boolean }> => {
    if (pinned) return { stay: x, found: true }
    const near = legOf(trip, x.checkIn)
    for (const query of [x.address?.trim(), x.name.trim()].filter(Boolean) as string[]) {
      const hit = (await searchPlaces(query, near).catch(() => [])).find((r) => !r.airport && km(near, r) <= 150)
      if (hit) return { stay: { ...x, lat: hit.lat, lng: hit.lng }, found: true }
    }
    return { stay: x, found: false }
  }

  const save = async () => {
    if (!d || saving) return
    if (!d.name.trim()) { toast(tr('숙소 이름을 입력하세요')); return }
    if (d.checkOut <= d.checkIn) { toast(tr('체크아웃은 체크인 다음 날 이후여야 합니다')); return }
    setSaving(true)
    const { stay: located, found } = await locate({ ...d, address: d.address?.trim() || undefined })
    setSaving(false)
    const overlap = (trip.stays ?? []).find((s) => s.id !== d.id && s.checkIn < d.checkOut && d.checkIn < s.checkOut)
    const amount = Number(cost.replace(/[^\d.]/g, ''))
    mutate(trip.id, (t) => putStay(t, { ...located, name: located.name.trim() }, { amount: amount > 0 ? amount : 0, currency }))
    toast(!found ? tr('지도에서 위치를 찾지 못해 도시 가운데에 두었습니다. 주소를 더 자세히 넣어 보세요') : overlap ? tr('{0} 숙박 기간과 겹칩니다. 날짜를 확인하세요', overlap.name) : editing ? tr('숙소를 고쳤습니다') : tr('{0} 숙소를 넣었습니다 ({1}박)', d.name.trim(), nights(d.checkIn, d.checkOut)))
    onClose()
  }
  const remove = () => {
    if (!editing) return
    mutate(trip.id, (t) => removeStay(t, editing.id))
    toast(tr('숙소를 지웠습니다')); onClose()
  }

  return (
    <Sheet open={Boolean(stay && d)} onClose={onClose} title={editing ? tr('숙소 수정') : tr('숙소 추가')}
      foot={<>
        {editing && <button className="btn btn-ghost" style={{ flex: 'none', color: 'var(--warn)' }} onClick={remove} aria-label={tr('숙소 삭제')}><Trash2 size={18} /></button>}
        <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? tr('위치 찾는 중') : editing ? tr('변경 내용 저장') : tr('숙소 넣기')}</button>
      </>}>
      {d && (
        <div className="stack">
          <div className="stay-summary">
            <BedDouble size={20} />
            <span className="grow">
              <b>{tr('{0}박', nights(d.checkIn, d.checkOut))}</b>
              <small>{tr('{0} {1} 체크인 → {2} {3} 체크아웃', label(d.checkIn), d.inTime ?? DEFAULT_IN, label(d.checkOut), d.outTime ?? DEFAULT_OUT)}</small>
            </span>
          </div>

          <label className="field"><span>{tr('숙소 이름')}</span>
            <input value={d.name} placeholder={tr('예: 아바니 리버사이드 방콕')} onChange={(e) => { set({ name: e.target.value }); setQ(e.target.value) }} />
          </label>
          {results && results.length > 0 && (
            <div className="list stay-results">
              {results.map((r, i) => (
                <button key={i} onClick={() => { set({ name: r.name, lat: r.lat, lng: r.lng, address: d.address || r.detail }); setPinned(true); setResults(undefined); setQ('') }}>
                  <MapPin size={16} />
                  <span className="grow"><b>{r.name}</b><small>{r.detail}</small></span>
                </button>
              ))}
            </div>
          )}
          {q.trim().length >= 2 && !results && <p className="hint" style={{ marginTop: -6 }}><Search size={13} /> {tr('찾는 중')}</p>}

          <label className="field"><span>{tr('주소 (선택)')}</span>
            <div className="input-btn">
              <input value={d.address ?? ''} placeholder={tr('에어비앤비처럼 이름으로 안 나오면 주소를 넣으세요')} autoComplete="street-address"
                onChange={(e) => { set({ address: e.target.value || undefined }); setPinned(false) }} />
              {d.address && <button className="icon-btn" onClick={() => copy(d.address!, tr('주소를 복사했습니다'))} aria-label={tr('주소 복사')}><Copy size={16} /></button>}
            </div>
          </label>
          <p className="hint" style={{ marginTop: -6 }}>{pinned ? tr('지도 위치가 정해졌습니다. 주소를 고치면 저장할 때 그 주소로 다시 찾습니다.') : tr('저장할 때 주소(없으면 이름)로 지도 위치를 찾습니다. 택시 기사에게 보여 줄 때 주소 복사를 쓰세요.')}</p>

          <div className="row">
            <label className="field"><span>{tr('체크인')}</span>
              <select value={d.checkIn} onChange={(e) => { const ci = e.target.value; set({ checkIn: ci, checkOut: d.checkOut > ci ? d.checkOut : addDays(ci, 1) }) }}>
                {days.map((x) => <option key={x} value={x}>{label(x)}</option>)}
              </select>
            </label>
            <label className="field"><span>{tr('시각')}</span><input type="time" value={d.inTime ?? DEFAULT_IN} onChange={(e) => set({ inTime: e.target.value || undefined })} /></label>
          </div>
          <div className="row">
            <label className="field"><span>{tr('체크아웃')}</span>
              <select value={d.checkOut} onChange={(e) => set({ checkOut: e.target.value })}>
                {outOptions.map((x) => <option key={x} value={x}>{label(x)}{x > trip.end ? tr(' (여행 뒤)') : ''}</option>)}
              </select>
            </label>
            <label className="field"><span>{tr('시각')}</span><input type="time" value={d.outTime ?? DEFAULT_OUT} onChange={(e) => set({ outTime: e.target.value || undefined })} /></label>
          </div>

          <div className="row">
            <label className="field"><span>{tr('숙박비 (예산에 기록)')}</span>
              <input inputMode="decimal" value={cost} placeholder="0" onChange={(e) => setCost(e.target.value)} />
            </label>
            <CurrencySelect trip={trip} value={currency} onChange={setCurrency} />
          </div>
          <label className="field"><span>{tr('예약번호')}</span>
            <div className="input-btn">
              <input value={d.code ?? ''} onChange={(e) => set({ code: e.target.value || undefined })} autoCapitalize="characters" />
              {d.code && <button className="icon-btn" onClick={() => copy(d.code!, tr('예약번호를 복사했습니다'))} aria-label={tr('예약번호 복사')}><Copy size={16} /></button>}
            </div>
          </label>
          <label className="field"><span>{tr('메모')}</span><textarea rows={2} value={d.note ?? ''} onChange={(e) => set({ note: e.target.value || undefined })} placeholder={tr('조식 포함, 얼리 체크인 요청, 짐 맡기기')} /></label>
          {editing && (
            <a className="btn btn-quiet" href={`https://www.google.com/maps/search/?api=1&query=${pinned || !d.address ? `${d.lat},${d.lng}` : encodeURIComponent(d.address)}`} target="_blank" rel="noreferrer">
              <MapPin size={16} />{tr('지도 앱에서 열기')}
            </a>
          )}
        </div>
      )}
    </Sheet>
  )
}
