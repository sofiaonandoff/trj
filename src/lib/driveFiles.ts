/**
 * 같은 여행(trjTripId가 같은)의 Drive 파일이 여러 개일 때 어느 것을 '원본'으로 쓸지 정한다.
 * 모든 기기와 동행이 같은 답을 내야 하므로 기기마다 다른 정보(이 기기가 마지막으로 쓴 파일 등)에 기대지 않는다.
 *
 * 1. 초대받아 함께 고치는 여행이면 초대받은 파일 (다른 사람 것이라 내가 정할 수 없다)
 * 2. 다른 사람과 공유된 파일 (동행이 이미 보고 있는 파일)
 * 3. 가장 먼저 만든 파일
 */
export interface TripFile {
  id: string
  version?: string
  createdTime?: string
  modifiedTime?: string
  shared?: boolean
  ownedByMe?: boolean
  appProperties?: Record<string, string>
}

export function pickCanonical(files: TripFile[], linked?: string, role?: string): TripFile {
  if (role === 'editor') { const f = files.find((x) => x.id === linked); if (f) return f }
  return [...files].sort((a, b) =>
    Number(Boolean(b.shared)) - Number(Boolean(a.shared))
    || (a.createdTime ?? '9999').localeCompare(b.createdTime ?? '9999')
    || a.id.localeCompare(b.id))[0]
}

/** 원본이 아닌 파일 중 지워도 되는 것: 내가 만들었고 아무와도 공유하지 않은 사본 */
export const removable = (files: TripFile[], canonical: TripFile) => files.filter((f) => f.id !== canonical.id && f.ownedByMe !== false && !f.shared)

/** 여행 id별로 묶기 (보기 전용 파일 .trj-view.json은 trjViewOf라 빠진다) */
export function groupByTrip(files: TripFile[]): Map<string, TripFile[]> {
  const out = new Map<string, TripFile[]>()
  for (const f of files) {
    const id = f.appProperties?.trjTripId
    if (!id) continue
    out.set(id, [...(out.get(id) ?? []), f])
  }
  return out
}

/* 이 기기에서 지운 여행: Drive에 파일이 남아 있어도 다시 가져오지 않는다 */
const DISMISSED = 'trj-dismissed-v1'
export const dismissed = (): string[] => { try { return JSON.parse(localStorage.getItem(DISMISSED) ?? '[]') as string[] } catch { return [] } }
export const dismissTrip = (id: string) => { try { localStorage.setItem(DISMISSED, JSON.stringify([...new Set([...dismissed(), id])].slice(-200))) } catch { /* 저장 공간 없음 */ } }
