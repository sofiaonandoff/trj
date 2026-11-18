import { tr } from '../i18n'
import { Camera, Cloud, CloudOff, Clapperboard, Copy, ImageDown, ImageOff, Images, X } from 'lucide-react'
import { useState } from 'react'
import { connectDrive, driveConfigured, useDriveStatus } from '../lib/drive'
import { isBackedUp, removePhoto, savePhoto, usePhoto } from '../lib/photos'
import { toMarkdown, toYouTube } from '../lib/share'
import { md, weekday } from '../lib/util'
import { useStore } from '../store'
import type { Trip } from '../types'
import ExportSheet from './ExportSheet'
import { copy, toast } from './ui'

function Photo({ k, onRemove }: { k: string; onRemove: () => void }) {
  const url = usePhoto(k)
  return (
    <div className="photo">
      {url && url !== 'missing' && <img src={url} alt="" loading="lazy" />}
      {url === 'missing' && <span className="photo-missing" title={tr('이 사진을 불러오지 못했습니다')}><ImageOff size={20} /></span>}
      {isBackedUp(k) && url !== 'missing' && <span className="photo-cloud" aria-label={tr('Drive에 백업됨')}><Cloud size={12} /></span>}
      <button onClick={onRemove} aria-label={tr('사진 삭제')}><X size={14} /></button>
    </div>
  )
}

export default function JournalTab({ trip }: { trip: Trip }) {
  const mutate = useStore((s) => s.mutate)
  const drive = useDriveStatus()
  const [busy, setBusy] = useState(false)
  const [exporting, setExporting] = useState(false)

  const store = async (files: File[]) => {
    const saved = []
    for (const f of files.slice(0, 40)) {
      try { saved.push(await savePhoto(f)) } catch { /* 열 수 없는 형식은 건너뛴다 */ }
    }
    if (saved.length < Math.min(files.length, 40)) toast(tr('일부 사진은 열 수 없는 형식이라 건너뛰었습니다'))
    return saved
  }

  const addPhotos = async (date: string, files: FileList | null) => {
    if (!files?.length) return
    const saved = await store([...files])
    // 다른 날 찍은 사진을 이 날에 넣었으면 찍은 날로 옮겨 넣는다
    const dates = trip.days.map((d) => d.date)
    const target = (s: { date?: string }) => (s.date && dates.includes(s.date) ? s.date : date)
    mutate(trip.id, (t) => { for (const s of saved) (t.journal[target(s)] ??= { text: '', photos: [] }).photos.push(s.key) })
    const moved = [...new Set(saved.map(target).filter((d) => d !== date))]
    if (moved.length) toast(tr('{0}장은 찍은 날짜에 맞춰 {1}에 넣었습니다', saved.filter((s) => target(s) !== date).length, moved.map((d) => tr('{0}일차', dates.indexOf(d) + 1)).join(', ')))
  }

  /** 여러 장을 한 번에: 찍은 날짜를 읽어 그 날의 기록에 넣는다 */
  const addByDate = async (files: FileList | null) => {
    if (!files?.length) return
    setBusy(true)
    try {
      const saved = await store([...files])
      const dates = trip.days.map((d) => d.date)
      let outside = 0, unknown = 0
      const place = (d?: string) => {
        if (!d) { unknown++; return dates.includes(new Date().toISOString().slice(0, 10)) ? new Date().toISOString().slice(0, 10) : dates[0] }
        if (dates.includes(d)) return d
        outside++
        return d < dates[0] ? dates[0] : dates[dates.length - 1]
      }
      mutate(trip.id, (t) => { for (const s of saved) (t.journal[place(s.date)] ??= { text: '', photos: [] }).photos.push(s.key) })
      const notes = [tr('사진 {0}장을 찍은 날짜에 맞춰 넣었습니다', saved.length - outside - unknown)]
      if (outside) notes.push(tr('{0}장은 여행 기간 밖이라 가까운 날에 넣었습니다', outside))
      if (unknown) notes.push(tr('{0}장은 찍은 날짜가 없어 첫날이나 오늘에 넣었습니다', unknown))
      toast(notes.join('. '))
    } finally { setBusy(false) }
  }

  const all = Object.values(trip.journal).flatMap((j) => j.photos)
  const backed = all.filter(isBackedUp).length
  const waiting = all.length - backed
  const connected = drive.kind !== 'off'
  const shared = Boolean(trip.drive?.role)

  return (
    <>
      <section className="panel">
        <h2>{tr('여행 기록 내보내기')}</h2>
        <div className="list export-list">
          <button onClick={() => setExporting(true)}><ImageDown size={20} /><span className="grow"><b>{tr('이미지로 내보내기')}</b><small>{tr('템플릿 3가지, 스토리·피드·영상용 비율')}</small></span></button>
          <button onClick={() => copy(toMarkdown(trip), tr('블로그용 글을 복사했습니다'))}><Copy size={20} /><span className="grow"><b>{tr('블로그용 글 복사')}</b><small>{tr('날짜별 코스와 아래에 적은 기록을 마크다운으로')}</small></span></button>
          <button onClick={() => copy(toYouTube(trip), tr('영상 설명란용 글을 복사했습니다'))}><Clapperboard size={20} /><span className="grow"><b>{tr('유튜브 설명란용 복사')}</b><small>{tr('DAY별 코스 요약과 해시태그')}</small></span></button>
        </div>
      </section>
      <ExportSheet trip={trip} open={exporting} onClose={() => setExporting(false)} />

      <section className="panel photo-bar">
        <div className="between">
          <div>
            <h2 style={{ margin: 0 }}>{tr('여행 사진')}</h2>
            <p className="mute" style={{ fontSize: 13, marginTop: 2 }}>
              {!driveConfigured ? tr('사진 {0}장', all.length)
                : !connected ? tr('사진 {0}장 · 아직 이 기기에만 있습니다', all.length)
                : waiting ? tr('{0}장 Drive에 백업됨 · {1}장 올리는 중', backed, waiting)
                : tr('{0}장 모두 Drive에 백업됨', backed)}
            </p>
          </div>
          <label className={`btn btn-quiet${busy ? ' is-busy' : ''}`}>
            <Images size={16} />{busy ? tr('정리하는 중') : tr('한꺼번에 올리기')}
            <input type="file" accept="image/*" multiple hidden disabled={busy} onChange={(e) => { addByDate(e.target.files); e.target.value = '' }} />
          </label>
        </div>
        <p className="hint">{tr('여러 장을 고르면 찍은 날짜를 읽어 그 날의 기록에 나눠 넣습니다.')}</p>
        {driveConfigured && !connected && (
          <div className="photo-cta">
            <CloudOff size={18} />
            <span className="grow">{tr('Drive에 연결하면 사진이 내 Google Drive에 백업되어, 폰을 바꾸거나 브라우저 데이터를 지워도 남습니다.')}</span>
            <button className="btn btn-primary" onClick={() => connectDrive().catch((e) => toast((e as Error).message))}>{tr('Drive에 연결')}</button>
          </div>
        )}
        {connected && shared && <p className="hint">{tr('함께 편집하는 여행이라 동행도 이 사진들을 볼 수 있습니다. 동행이 올린 사진도 여기에 모입니다.')}</p>}
      </section>

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
    </>
  )
}
