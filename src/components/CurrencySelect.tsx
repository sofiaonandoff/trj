import { tr } from '../i18n'
import { CURRENCIES } from '../data/currencies'
import type { Trip } from '../types'

/** 통화 고르기 (여행지 통화·원화·이 여행에서 쓴 통화를 위에) */
export default function CurrencySelect({ trip, value, onChange, label = tr('통화') }: { trip: Trip; value: string; onChange: (c: string) => void; label?: string }) {
  const first = [...new Set([trip.currency, 'KRW', ...trip.expenses.map((e) => e.currency), value])].filter(Boolean)
  const name = (c: string) => CURRENCIES.find((x) => x.code === c)?.name
  return (
    <label className="field cur-field"><span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {first.map((c) => <option key={c} value={c}>{c}{name(c) ? ` · ${name(c)}` : ''}</option>)}
        <option disabled>──────</option>
        {CURRENCIES.filter((c) => !first.includes(c.code)).map((c) => <option key={c.code} value={c.code}>{c.code} · {c.name}</option>)}
      </select>
    </label>
  )
}
