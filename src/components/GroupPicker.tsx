import { tr } from '../i18n'
import type { Group, Trip } from '../types'

/** '누구 일정인지' 고르기: 모두 / 그룹들. 그룹이 없는 여행에서는 보이지 않는다 */
export default function GroupPicker({ trip, value, onChange, label = tr('누구 일정') }: { trip: Trip; value?: string; onChange: (g: string | undefined) => void; label?: string }) {
  const groups = trip.groups ?? []
  if (!groups.length) return null
  return (
    <div className="field"><span>{label}</span>
      <div className="chips">
        <button type="button" className="chip" aria-pressed={!value} onClick={() => onChange(undefined)}>{tr('모두')}</button>
        {groups.map((g) => (
          <button type="button" key={g.id} className="chip" aria-pressed={value === g.id} onClick={() => onChange(g.id)}>
            <i className="dot" style={{ background: g.color }} />{g.name}
          </button>
        ))}
      </div>
    </div>
  )
}

/** 일정 탭 위의 전체 / 그룹 탭. 그룹이 없으면 보이지 않는다 */
export function GroupTabs({ trip, view, onChange }: { trip: Trip; view: string; onChange: (v: string) => void }) {
  const groups = trip.groups ?? []
  if (!groups.length) return null
  return (
    <div className="chips group-tabs" role="tablist" aria-label={tr('그룹')}>
      <button role="tab" className="chip" aria-selected={view === 'all'} aria-pressed={view === 'all'} onClick={() => onChange('all')}>{tr('전체')}</button>
      {groups.map((g) => (
        <button role="tab" key={g.id} className="chip" aria-selected={view === g.id} aria-pressed={view === g.id} onClick={() => onChange(g.id)}>
          <i className="dot" style={{ background: g.color }} />{g.name}
        </button>
      ))}
    </div>
  )
}

/** 전체 화면에서 그 일정이 어느 그룹 것인지 */
export function GroupTag({ g }: { g?: Group }) {
  if (!g) return null
  return <span className="gtag" style={{ color: g.color }}><i className="dot" style={{ background: g.color }} />{g.name}</span>
}
