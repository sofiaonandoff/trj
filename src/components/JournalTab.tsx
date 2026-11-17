import { tr } from '../i18n'
import { Camera, X } from 'lucide-react'
import { removePhoto, savePhoto, usePhoto } from '../lib/photos'
import { md, weekday } from '../lib/util'
import { useStore } from '../store'
import type { Trip } from '../types'
import { toast } from './ui'

function Photo({ k, onRemove }: { k: string; onRemove: () => void }) {
  const url = usePhoto(k)
  return (
    <div className="photo">
      {url && <img src={url} alt="" loading="lazy" />}
      <button onClick={onRemove} aria-label={tr('사진 삭제')}><X size={14} /></button>
    </div>
  )
}

export default function JournalTab({ trip }: { trip: Trip }) {
  const mutate = useStore((s) => s.mutate)

  const addPhotos = async (date: string, files: FileList | null) => {
    if (!files?.length) return
    try {
      const keys = await Promise.all([...files].slice(0, 12).map(savePhoto))
      mutate(trip.id, (t) => { (t.journal[date] ??= { text: '', photos: [] }).photos.push(...keys) })
    } catch { toast(tr('사진을 저장하지 못했습니다. 다른 형식의 사진으로 다시 시도하세요')) }
  }

  return (
    <>
      {trip.days.map((d, i) => {
        const j = trip.journal[d.date] ?? { text: '', photos: [] }
        const stops = d.items.map((p) => p.name).join(' → ')
        return (
          <section className="panel journal" key={d.date}>
            <div className="between" style={{ marginBottom: 8 }}>
              <h2 style={{ margin: 0 }}>{tr('{0}일차', i + 1)}</h2>
              <span className="mute" style={{ fontSize: 13 }}>{md(d.date)} {weekday(d.date)}</span>
            </div>
            {stops && <p className="mute" style={{ fontSize: 13, marginBottom: 10 }}>{stops}</p>}
            <textarea value={j.text} placeholder={tr('오늘 어땠나요. 적어 둔 글은 블로그용 내보내기에 그대로 들어갑니다.')}
              aria-label={tr('{0}일차 기록', i + 1)}
              onChange={(e) => mutate(trip.id, (t) => { (t.journal[d.date] ??= { text: '', photos: [] }).text = e.target.value })} />
            <div className="photos">
              {j.photos.map((k) => (
                <Photo key={k} k={k} onRemove={() => { removePhoto(k); mutate(trip.id, (t) => { t.journal[d.date].photos = t.journal[d.date].photos.filter((x) => x !== k) }) }} />
              ))}
              <label className="photo-add" aria-label={tr('{0}일차 사진 추가', i + 1)}>
                <Camera size={22} />
                <input type="file" accept="image/*" multiple hidden onChange={(e) => { addPhotos(d.date, e.target.files); e.target.value = '' }} />
              </label>
            </div>
          </section>
        )
      })}
      <p className="hint" style={{ padding: '4px 24px 0' }}>{tr('사진은 이 기기에만 저장됩니다. 링크 공유와 파일 저장에는 글만 담깁니다.')}</p>
    </>
  )
}
