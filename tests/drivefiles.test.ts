// 같은 여행의 Drive 파일이 여러 개일 때: 모든 기기가 같은 원본을 고르는지, 지울 사본이 맞는지
import { groupByTrip, pickCanonical, removable, type TripFile } from '../src/lib/driveFiles'

let fail = 0
const check = (label: string, ok: boolean, got?: unknown) => { if (!ok) fail++; console.log(ok ? 'PASS' : 'FAIL', label, ok ? '' : JSON.stringify(got)) }
const f = (id: string, createdTime: string, extra: Partial<TripFile> = {}): TripFile => ({ id, createdTime, ownedByMe: true, appProperties: { trjTripId: 't1' }, ...extra })

const phone = f('B', '2026-11-20T10:00:00Z'), laptop = f('A', '2026-11-18T09:00:00Z'), tablet = f('C', '2026-11-22T08:00:00Z')
check('공유 전: 가장 먼저 만든 파일', pickCanonical([phone, laptop, tablet], 'B').id === 'A')
check('어느 기기에서 봐도 같은 답 (순서·이 기기 연결과 무관)', pickCanonical([tablet, phone, laptop], 'C').id === 'A' && pickCanonical([laptop, tablet, phone]).id === 'A')
const sharedPhone = { ...phone, shared: true }
check('동행과 공유한 파일이 있으면 그것', pickCanonical([laptop, sharedPhone, tablet], 'A').id === 'B')
const owners = { ...laptop, shared: true, ownedByMe: false }, mine = f('M', '2026-11-01T00:00:00Z')
check('초대받은 여행이면 초대받은 파일 (내 사본이 더 일러도)', pickCanonical([mine, owners], 'A', 'editor').id === 'A')
check('지울 사본: 원본이 아니고 내 것이며 공유되지 않은 것만', removable([laptop, sharedPhone, tablet], sharedPhone).map((x) => x.id).join() === 'A,C'
  && removable([mine, owners], owners).map((x) => x.id).join() === 'M' && removable([owners, mine], mine).length === 0)
const g = groupByTrip([laptop, phone, { id: 'V', appProperties: { trjViewOf: 't1' } }, { id: 'X', appProperties: { trjTripId: 't2' } }])
check('여행별로 묶고 보기 전용 파일은 뺀다', g.get('t1')?.length === 2 && g.get('t2')?.length === 1 && g.size === 2)
process.exit(fail ? 1 : 0)
