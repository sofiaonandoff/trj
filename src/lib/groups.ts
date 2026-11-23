import { create } from 'zustand'
import type { Group, Trip } from '../types'
import { uid } from './util'

/**
 * 여행 안의 그룹 (따로 움직이는 동행 묶음).
 * 장소·숙소·항공편·지출에 group이 붙으면 그 그룹의 일정이고, 없으면 모두의 일정이다.
 * 일정 탭에서 지금 보고 있는 그룹(전체 또는 그룹 하나)은 여행마다 이 기기에서 기억한다.
 */
export const GROUP_COLORS = ['#C2410C', '#0F766E', '#7C3AED', '#B45309', '#BE185D', '#1D4ED8']

/** 'all' 또는 그룹 id */
export type GroupView = string
export const ALL = 'all'

const useViews = create<{ views: Record<string, GroupView>; set: (tripId: string, v: GroupView) => void }>((set) => ({
  views: {},
  set: (tripId, v) => set((s) => ({ views: { ...s.views, [tripId]: v } })),
}))

/** 지금 보고 있는 그룹 (없어진 그룹이면 전체) */
export function useGroupView(trip: Pick<Trip, 'id' | 'groups'> | null | undefined): [GroupView, (v: GroupView) => void] {
  const v = useViews((s) => (trip ? s.views[trip.id] : undefined)) ?? ALL
  const set = useViews((s) => s.set)
  const ok = v === ALL || Boolean(trip?.groups?.some((g) => g.id === v))
  return [ok ? v : ALL, (x) => trip && set(trip.id, x)]
}
export const currentGroup = (tripId: string): string | undefined => {
  const v = useViews.getState().views[tripId]
  return v && v !== ALL ? v : undefined
}

/** 그 그룹 화면에 보일 항목인가 (모두의 일정은 어느 그룹에서나 보인다) */
export const visibleIn = (view: GroupView | undefined, x: { group?: string }) => !view || view === ALL || !x.group || x.group === view
export const groupOf = (trip: Pick<Trip, 'groups'>, id?: string): Group | undefined => (id ? trip.groups?.find((g) => g.id === id) : undefined)

export function newGroup(trip: Trip, name: string, members: string[]): Group {
  const used = new Set((trip.groups ?? []).map((g) => g.color))
  const color = GROUP_COLORS.find((c) => !used.has(c)) ?? GROUP_COLORS[(trip.groups?.length ?? 0) % GROUP_COLORS.length]
  return { id: uid(), name: name.trim(), color, members }
}

/** 그룹을 지운다: 그 그룹의 장소·숙소·항공편·지출은 모두의 일정으로 돌린다 */
export function removeGroup(t: Trip, id: string) {
  t.groups = (t.groups ?? []).filter((g) => g.id !== id)
  const clear = <T extends { group?: string }>(x: T) => { if (x.group === id) delete x.group }
  t.days.forEach((d) => d.items.forEach(clear))
  t.flights.forEach(clear)
  ;(t.stays ?? []).forEach(clear)
  t.expenses.forEach(clear)
}

/** 동행을 빼면 그룹에서도 뺀다 */
export function dropMemberFromGroups(t: Trip, memberId: string) {
  for (const g of t.groups ?? []) g.members = g.members.filter((m) => m !== memberId)
}
