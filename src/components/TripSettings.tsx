import { tr } from '../i18n'
import { AlertTriangle, Download, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { trashTrip } from '../lib/drive'
import { fitLegs } from '../lib/legs'
import { removePhoto } from '../lib/photos'
import { download } from '../lib/util'
import { syncDays, useStore } from '../store'
import type { Trip } from '../types'
import { Sheet, go, toast } from './ui'

/**
 * 여행 관리: 기간 바꾸기와 여행 전체 삭제.
 * 삭제는 일정·예산·준비물·기록·사진(이 기기)까지 모두 지운다.
 * 내가 만든 여행이 Drive에 있으면 그 파일과 사진도 Drive 휴지통으로 옮길 수 있다 (30일 안에 Drive에서 되살릴 수 있다).
 * 다른 사람이 만든 함께 편집 여행은 이 기기에서만 지운다 (만든 사람의 여행은 그대로).
 */
export default function TripSettings({ trip, open, onClose, onDeleted }: { trip: Trip; open: boolean; onClose: () => void; onDeleted?: () => void }) {
  const mutate = useStore((s) => s.mutate)
  const remove = useStore((s) => s.remove)
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const inDrive = Boolean(trip.drive?.fileId)
  const mine = inDrive && trip.drive?.role !== 'editor'
  const sharedWithOthers = trip.drive?.role === 'owner'
  const [alsoDrive, setAlsoDrive] = useState(mine)
  useEffect(() => { if (open) { setConfirm(false); setAlsoDrive(mine) } }, [open, mine])

  const setDates = (start: string, end: string) => {
    if (end < start) return toast(tr('돌아오는 날이 떠나는 날보다 빠릅니다'))
    mutate(trip.id, (t) => { const prev = t.start; t.start = start; t.end = end; syncDays(t); fitLegs(t, prev) })
  }

  const counts = {
    places: trip.days.reduce((s, d) => s + d.items.length, 0),
    expenses: trip.expenses.length,
    photos: Object.values(trip.journal).reduce((s, j) => s + j.photos.length, 0),
  }

  const doDelete = async () => {
    setBusy(true)
    let driveDone = false
    try {
      if (alsoDrive && mine) driveDone = await trashTrip(trip)
    } catch {
      toast(tr('Drive 파일은 지우지 못했습니다. Google Drive에서 직접 지우세요'))
    }
    // 이 기기의 사진도 지운다 (Drive에 백업된 사진의 이 기기 사본 포함)
    for (const j of Object.values(trip.journal)) for (const k of j.photos) { try { await removePhoto(k) } catch { /* 이미 없는 사진 */ } }
    remove(trip.id)
    setBusy(false)
    onClose()
    onDeleted?.()
    toast(driveDone ? tr('여행을 삭제했습니다. Drive 파일은 휴지통으로 옮겼습니다') : tr('여행을 삭제했습니다'))
    go('/', true)
  }

  return (
    <Sheet open={open} onClose={onClose} title={tr('여행 관리')}>
      <div className="stack">
        <div className="row">
          <label className="field"><span>{tr('떠나는 날')}</span><input type="date" value={trip.start} onChange={(e) => setDates(e.target.value, e.target.value > trip.end ? e.target.value : trip.end)} /></label>
          <label className="field"><span>{tr('돌아오는 날')}</span><input type="date" value={trip.end} min={trip.start} onChange={(e) => setDates(trip.start, e.target.value)} /></label>
        </div>
        <p className="hint" style={{ marginTop: -6 }}>{tr('기간을 줄이면 빠지는 날의 일정은 마지막 날로 옮겨집니다.')}</p>

        {!confirm ? (
          <button className="btn btn-ghost danger-btn" onClick={() => setConfirm(true)}><Trash2 size={18} />{tr('이 여행 전체 삭제')}</button>
        ) : (
          <div className="danger-box">
            <p className="danger-head"><AlertTriangle size={18} />{tr('‘{0}’ 여행을 삭제할까요?', trip.title)}</p>
            <p className="hint" style={{ marginTop: 0 }}>
              {tr('일정 {0}곳, 지출 {1}건, 사진 {2}장, 준비물과 기록이 모두 지워집니다.', counts.places, counts.expenses, counts.photos)}
            </p>
            {mine && (
              <label className="check-line">
                <input type="checkbox" checked={alsoDrive} onChange={(e) => setAlsoDrive(e.target.checked)} />
                <span>
                  {tr('Google Drive의 여행 파일과 사진도 휴지통으로 옮기기')}
                  <small>{sharedWithOthers ? tr('함께 편집하던 동행도 더 이상 이 여행을 볼 수 없습니다. Drive 휴지통에서 30일 안에 되살릴 수 있습니다.') : tr('Drive 휴지통에서 30일 안에 되살릴 수 있습니다. 끄면 Drive에 남아 홈의 불러오기로 다시 열 수 있습니다.')}</small>
                </span>
              </label>
            )}
            {inDrive && !mine && <p className="hint" style={{ marginTop: 0 }}>{tr('다른 사람이 만든 함께 편집 여행이라 이 기기에서만 지웁니다. 만든 사람의 여행은 그대로 남습니다.')}</p>}
            {!inDrive && (
              <button className="btn btn-quiet" onClick={() => { download(`${trip.title}.trj.json`, JSON.stringify(trip, null, 2), 'application/json'); toast(tr('파일로 저장했습니다')) }}>
                <Download size={16} />{tr('지우기 전에 파일로 저장')}
              </button>
            )}
            <div className="row">
              <button className="btn btn-ghost" onClick={() => setConfirm(false)} disabled={busy}>{tr('취소')}</button>
              <button className="btn danger-solid" onClick={doDelete} disabled={busy}>{busy ? tr('지우는 중') : tr('삭제')}</button>
            </div>
          </div>
        )}
      </div>
    </Sheet>
  )
}
