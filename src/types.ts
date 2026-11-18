export type Category = 'sight' | 'food' | 'cafe' | 'shop' | 'nature' | 'culture' | 'night' | 'stay' | 'move'

export interface Place {
  /** 마지막으로 고친 시각(ms). 기기 간 병합에 쓴다 */
  u?: number
  id: string
  name: string
  lat: number
  lng: number
  category: Category
  time?: string // HH:MM
  duration?: number // 분
  cost?: number // 원 (1인 예상, AI 추천이 넣는 어림값. 예산에는 들어가지 않는다)
  /** 이 장소의 예약 비용으로 예산에 기록한 지출 (장소와 함께 고쳐지고 지워진다) */
  expenseId?: string
  note?: string
  done?: boolean
}

export interface Day {
  /** 마지막으로 고친 시각(ms). 기기 간 병합에 쓴다 */
  u?: number
  date: string // YYYY-MM-DD
  items: Place[]
}

export interface Flight {
  /** 마지막으로 고친 시각(ms). 기기 간 병합에 쓴다 */
  u?: number
  id: string
  flightNo: string
  from: string // IATA
  to: string
  depDate: string
  depTime: string
  arrDate: string
  arrTime: string
  seat?: string
  pnr?: string
}

/** 숙소. 체크인 날 밤부터 체크아웃 날 아침까지 그 날 일정의 시작·끝이 된다 */
export interface Stay {
  /** 마지막으로 고친 시각(ms). 기기 간 병합에 쓴다 */
  u?: number
  id: string
  name: string
  lat: number
  lng: number
  /** 체크인 날짜와 시각 (기본 15:00) */
  checkIn: string
  inTime?: string
  /** 체크아웃 날짜와 시각 (기본 11:00) */
  checkOut: string
  outTime?: string
  address?: string
  /** 예약번호 */
  code?: string
  note?: string
  /** 숙박비를 예산에 남겼으면 그 지출 id */
  expenseId?: string
}

export interface Member {
  /** 마지막으로 고친 시각(ms). 기기 간 병합에 쓴다 */
  u?: number
  id: string
  name: string
  color: string
  /** 함께 편집 초대를 보낸 Google 계정 이메일 (선택) */
  email?: string
}

/** 여러 도시를 도는 여행의 한 구간. 예: 방콕 → 콘깬 → 방콕 */
export interface Leg {
  id: string
  city: string
  country?: string
  lat: number
  lng: number
  /** 추천 데이터가 있는 도시면 그 id */
  destId?: string
  /** 이 구간의 첫날과 마지막 날 (여행 마지막 구간은 돌아오는 날까지) */
  start: string
  end: string
}

export type ExpenseCategory = 'food' | 'stay' | 'move' | 'play' | 'shop' | 'etc'

export interface Expense {
  /** 마지막으로 고친 시각(ms). 기기 간 병합에 쓴다 */
  u?: number
  id: string
  title: string
  amount: number
  currency: string // 'KRW' 또는 현지 통화
  category: ExpenseCategory
  payer: string // member id
  split: string[] // member ids
  date: string
}

export interface CheckItem {
  /** 마지막으로 고친 시각(ms). 기기 간 병합에 쓴다 */
  u?: number
  id: string
  text: string
  group: string
  done: boolean
  assignee?: string
}

export interface JournalEntry {
  /** 마지막으로 고친 시각(ms). 기기 간 병합에 쓴다 */
  u?: number
  text: string
  /** 'photo-…'는 이 기기에만 있는 사진, 'drive:<파일 id>'는 Drive에 백업된 사진 */
  photos: string[]
}

export interface Trip {
  id: string
  title: string
  city: string
  country: string
  destId?: string
  lat: number
  lng: number
  start: string
  end: string
  days: Day[]
  flights: Flight[]
  /** 숙소 (예전에 만든 여행에는 없을 수 있다) */
  stays?: Stay[]
  members: Member[]
  expenses: Expense[]
  checklist: CheckItem[]
  journal: Record<string, JournalEntry>
  currency: string
  rate: number // 현지 통화 1단위 = 원
  /** 여행지 통화가 아닌 다른 통화로 쓴 지출의 환율 (1단위 = 원). 없으면 기본 어림 환율 */
  rates?: Record<string, number>
  budget: number // 원
  createdAt: number
  /** 여행 내용이 마지막으로 바뀐 시각 */
  updatedAt?: number
  /** 제목·기간·예산 같은 여행 기본 정보를 고친 시각 */
  metaU?: number
  /** 지운 항목 id → 지운 시각. 다른 기기에서 되살아나지 않게 한다 */
  deleted?: Record<string, number>
  /** 두 도시 이상을 도는 여행의 구간들. 한 도시 여행이면 없다 */
  legs?: Leg[]
  /** 이 기기에만 두는 Drive 동기화 상태 (파일에는 넣지 않는다) */
  drive?: DriveLink
}

export interface DriveLink {
  fileId?: string
  version?: string
  /** 이 시각의 내용까지 Drive에 올라가 있다 */
  syncedAt?: number
  /** 함께 편집 중일 때만 있다 */
  role?: 'owner' | 'editor'
  modifiedBy?: string
  modifiedAt?: string
  error?: string
  /** 로그인 없이 보는 링크를 켰을 때: 일정만 담은 공개 파일과, 마지막으로 올린 내용 */
  view?: { fileId: string; sent?: string }
}
