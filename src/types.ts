export type Category = 'sight' | 'food' | 'cafe' | 'shop' | 'nature' | 'culture' | 'night' | 'stay'

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
  cost?: number // 원 (1인 예상)
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

export interface Member {
  /** 마지막으로 고친 시각(ms). 기기 간 병합에 쓴다 */
  u?: number
  id: string
  name: string
  color: string
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
  photos: string[] // IndexedDB 키
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
  members: Member[]
  expenses: Expense[]
  checklist: CheckItem[]
  journal: Record<string, JournalEntry>
  currency: string
  rate: number // 현지 통화 1단위 = 원
  budget: number // 원
  createdAt: number
  /** 여행 내용이 마지막으로 바뀐 시각 */
  updatedAt?: number
  /** 제목·기간·예산 같은 여행 기본 정보를 고친 시각 */
  metaU?: number
  /** 지운 항목 id → 지운 시각. 다른 기기에서 되살아나지 않게 한다 */
  deleted?: Record<string, number>
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
}
