import { tr } from '../i18n'
import { useSyncExternalStore } from 'react'
import { useStore } from '../store'
import type { DriveLink, Trip } from '../types'
import { mergeTrips, sameContent, shared } from './merge'
import { getPhoto, putPhoto, removePhoto, setRemotePhotoFetcher } from './photos'

/**
 * Google Drive 동기화. 서버 없이 브라우저가 사용자의 Drive에 직접 읽고 쓴다.
 * 권한은 drive.file: TRJ가 만든 파일과, 사용자가 직접 골라 준 파일에만 접근한다.
 */
const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined
const API_KEY = import.meta.env.VITE_GOOGLE_API_KEY as string | undefined
const SCOPE = 'https://www.googleapis.com/auth/drive.file'
const API = 'https://www.googleapis.com/drive/v3'
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3'
const FOLDER_NAME = 'TRJ'
const FOLDER_MIME = 'application/vnd.google-apps.folder'
/** 클라이언트 ID 앞의 숫자가 Google Cloud 프로젝트 번호(= Picker의 App ID) */
const APP_ID = CLIENT_ID?.split('-')[0]

export const driveConfigured = Boolean(CLIENT_ID)
/** 공유받은 여행을 열려면 Google Picker가 필요하고, Picker에는 API 키가 필요하다 */
export const sharingConfigured = Boolean(CLIENT_ID && API_KEY)

/* ── 상태 ── */
export type DriveStatus =
  | { kind: 'off' }
  | { kind: 'idle'; lastSync?: number }
  | { kind: 'syncing' }
  | { kind: 'reconnect'; pending: number } // 로그인 만료: 사용자가 버튼을 눌러야 한다
  | { kind: 'offline' }
  | { kind: 'error'; message: string }

let status: DriveStatus = { kind: 'off' }
const listeners = new Set<() => void>()
const setStatus = (s: DriveStatus) => { status = s; listeners.forEach((f) => f()) }
export const useDriveStatus = () => useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l) }, () => status)

interface Meta { connected: boolean; folderId?: string; photoFolderId?: string; lastSync?: number }
const META_KEY = 'trj-drive-v1'
const getMeta = (): Meta => { try { return JSON.parse(localStorage.getItem(META_KEY) ?? '') as Meta } catch { return { connected: false } } }
const setMeta = (patch: Partial<Meta>) => localStorage.setItem(META_KEY, JSON.stringify({ ...getMeta(), ...patch }))

const store = () => useStore.getState()
const stampOf = (t: Trip) => t.updatedAt ?? t.createdAt
const isPending = (t: Trip) => !t.drive?.syncedAt || stampOf(t) > t.drive.syncedAt
const pendingCount = () => store().trips.filter(isPending).length

/* ── 로그인 (Google Identity Services). 토큰은 보안상 메모리에만 둔다 ── */
interface TokenResponse { access_token?: string; expires_in?: number; error?: string }
interface TokenClient { requestAccessToken: (o?: { prompt?: string }) => void }
type Gis = { accounts: { oauth2: {
  initTokenClient: (c: { client_id: string; scope: string; callback: (r: TokenResponse) => void; error_callback?: () => void }) => TokenClient
  revoke: (token: string, done?: () => void) => void
} } }
const gis = () => (window as unknown as { google?: Gis }).google

let token: { value: string; expiresAt: number } | null = null
let gisPromise: Promise<void> | null = null

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = src; s.async = true
    s.onload = () => resolve()
    s.onerror = () => reject(new Error(tr('Google 화면을 불러오지 못했습니다. 연결을 확인하세요')))
    document.head.appendChild(s)
  })
}
function loadGis() {
  if (gis()?.accounts?.oauth2) return Promise.resolve()
  gisPromise ??= loadScript('https://accounts.google.com/gsi/client').catch((e) => { gisPromise = null; throw e })
  return gisPromise
}

export const tokenValid = () => Boolean(token) && token!.expiresAt - Date.now() > 60_000

/** 팝업이 열리므로 사용자가 버튼을 눌렀을 때만 부른다 */
async function requestToken(selectAccount = false): Promise<string> {
  if (!CLIENT_ID) throw new Error(tr('Google 클라이언트 ID가 설정되지 않았습니다 (.env.local의 VITE_GOOGLE_CLIENT_ID)'))
  await loadGis()
  return new Promise((resolve, reject) => {
    const client = gis()!.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID, scope: SCOPE,
      callback: (r) => {
        if (r.error || !r.access_token) return reject(new Error(tr('Google 연결을 취소했습니다')))
        token = { value: r.access_token, expiresAt: Date.now() + (r.expires_in ?? 3600) * 1000 }
        resolve(r.access_token)
      },
      error_callback: () => reject(new Error(tr('Google 연결을 취소했습니다'))),
    })
    client.requestAccessToken({ prompt: selectAccount ? 'select_account' : '' })
  })
}

/** Google 로그인 스크립트를 미리 받아 둔다. 버튼을 누른 순간 팝업을 바로 띄우기 위해서다 */
export const preloadGoogle = () => { if (CLIENT_ID) loadGis().catch(() => undefined) }

/** 로그인이 되어 있지 않으면 로그인 창을 띄운다. 사용자가 버튼을 누른 직후에 불러야 팝업이 막히지 않는다 */
export async function ensureToken() {
  if (!tokenValid()) await requestToken()
  setMeta({ connected: true })
}

class AuthError extends Error {}

async function api(url: string, init: RequestInit = {}): Promise<Response> {
  if (!tokenValid()) throw new AuthError(tr('로그인이 만료되었습니다'))
  const res = await fetch(url, { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token!.value}` } })
  if (res.status === 401) { token = null; throw new AuthError(tr('로그인이 만료되었습니다')) }
  return res
}

/* ── 연결 ── */
/** 앱을 열 때: 전에 연결해 두었다면 '다시 연결' 상태로 둔다 */
export function initDrive() {
  if (!CLIENT_ID || !getMeta().connected) return
  setStatus(tokenValid() ? { kind: 'idle', lastSync: getMeta().lastSync } : { kind: 'reconnect', pending: pendingCount() })
}

export async function connectDrive() {
  await requestToken()
  setMeta({ connected: true })
  await ensureFolder()
  setStatus({ kind: 'idle', lastSync: getMeta().lastSync })
  await syncNow({ pull: true })
}

export function disconnectDrive() {
  if (token) gis()?.accounts.oauth2.revoke(token.value)
  token = null
  setMeta({ connected: false })
  setStatus({ kind: 'off' })
}

/* ── Drive 파일 ── */
async function ensureFolder(): Promise<string> {
  const meta = getMeta()
  if (meta.folderId) {
    const r = await api(`${API}/files/${meta.folderId}?fields=id,trashed`)
    if (r.ok && !(await r.json()).trashed) return meta.folderId
  }
  const q = encodeURIComponent(`name='${FOLDER_NAME}' and mimeType='${FOLDER_MIME}' and trashed=false`)
  const found = await api(`${API}/files?q=${q}&fields=files(id)&spaces=drive`)
  let id = found.ok ? ((await found.json()).files as { id: string }[])[0]?.id : undefined
  if (!id) {
    const r = await api(`${API}/files?fields=id`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: FOLDER_NAME, mimeType: FOLDER_MIME }) })
    if (!r.ok) throw new Error(tr('Drive에 TRJ 폴더를 만들지 못했습니다'))
    id = (await r.json()).id as string
  }
  setMeta({ folderId: id })
  return id
}

type Uploaded = { id: string; version?: string }
async function upload(method: 'POST' | 'PATCH', url: string, metadata: object, body: string): Promise<Uploaded> {
  const start = await api(`${url}?uploadType=resumable&fields=id,version`, {
    method, headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': 'application/json' }, body: JSON.stringify(metadata),
  })
  if (!start.ok) throw Object.assign(new Error(tr('Drive에 올리지 못했습니다')), { status: start.status })
  const location = start.headers.get('Location')
  if (!location) throw new Error(tr('Drive에서 업로드 주소를 받지 못했습니다'))
  const put = await api(location, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body })
  if (!put.ok) throw Object.assign(new Error(tr('Drive에 올리지 못했습니다')), { status: put.status })
  return (await put.json()) as Uploaded
}

interface RemoteMeta { id: string; version?: string; modifiedTime?: string; trashed?: boolean; shared?: boolean; ownedByMe?: boolean; lastModifyingUser?: { displayName?: string; me?: boolean } }
/** 파일 정보. 없거나 접근 권한이 없으면 null */
async function remoteMeta(fileId: string): Promise<RemoteMeta | null> {
  const r = await api(`${API}/files/${fileId}?fields=id,version,modifiedTime,trashed,shared,ownedByMe,lastModifyingUser(displayName,me)`)
  if (r.status === 403 || r.status === 404) return null
  if (!r.ok) throw new Error(tr('Drive에서 파일 정보를 받지 못했습니다'))
  return r.json()
}

function parseTrip(text: string): Trip {
  const t = JSON.parse(text) as Trip
  if (!t || !t.id || !Array.isArray(t.days)) throw new Error(tr('TRJ 여행 파일이 아닙니다'))
  return t
}
async function download(fileId: string): Promise<Trip> {
  const r = await api(`${API}/files/${fileId}?alt=media`)
  if (!r.ok) throw new Error(tr('Drive에서 여행 파일을 받지 못했습니다'))
  return parseTrip(await r.text())
}

const lostAccess = (t: Trip) => store().patchDrive(t.id, { error: tr('이 여행을 고칠 권한이 없어졌습니다. 주인에게 다시 초대를 요청하세요') })

/** 이 기기의 여행을 Drive에 올린다. 파일이 없으면 TRJ 폴더에 새로 만든다 */
async function push(tripId: string, fileId?: string) {
  const t = store().trips.find((x) => x.id === tripId)
  if (!t) return
  const snapshot = stampOf(t)
  const body = JSON.stringify(shared(t))
  const name = `${t.title || tr('여행')}.trj.json`
  let res: Uploaded | undefined
  if (fileId) {
    try { res = await upload('PATCH', `${UPLOAD}/files/${fileId}`, { name }, body) } catch (e) {
      const st = (e as { status?: number }).status
      if (e instanceof AuthError || (st !== 403 && st !== 404)) throw e
    }
  }
  if (!res) {
    if (t.drive?.role === 'editor') return lostAccess(t)
    res = await upload('POST', `${UPLOAD}/files`, { name, parents: [await ensureFolder()], appProperties: { trjTripId: t.id } }, body)
  }
  store().patchDrive(tripId, { fileId: res.id, version: res.version, syncedAt: snapshot, error: undefined })
}

/** 받은 사본을 이 기기의 여행과 합쳐 저장한다 */
function mergeIntoLocal(remote: Trip, link: Partial<DriveLink>) {
  const local = store().trips.find((x) => x.id === remote.id)
  const merged = local ? mergeTrips(local, remote) : { ...remote }
  merged.drive = { ...local?.drive, ...link }
  const differsFromRemote = !sameContent(merged, remote)
  if (!differsFromRemote) merged.drive.syncedAt = stampOf(merged)
  store().put(merged)
  return { merged, differsFromRemote }
}

/** 여행 하나를 Drive와 맞춘다: Drive 쪽이 바뀌었으면 받아서 합치고, 이 기기에만 있는 변경은 올린다 */
async function syncTrip(tripId: string) {
  const t = store().trips.find((x) => x.id === tripId)
  if (!t) return
  if (!t.drive?.fileId) return push(tripId)
  const meta = await remoteMeta(t.drive.fileId)
  if (!meta || meta.trashed) return t.drive.role === 'editor' ? lostAccess(t) : push(tripId)
  let needUpload = isPending(t)
  if (meta.version !== t.drive.version) {
    const byOther = meta.lastModifyingUser && !meta.lastModifyingUser.me
    const { differsFromRemote } = mergeIntoLocal(await download(t.drive.fileId), {
      version: meta.version, error: undefined,
      ...(byOther ? { modifiedBy: meta.lastModifyingUser?.displayName, modifiedAt: meta.modifiedTime } : {}),
    })
    needUpload = differsFromRemote
  }
  if (needUpload) await push(tripId, t.drive.fileId)
}

/* ── 자동 동기화 ── */
let timer: ReturnType<typeof setTimeout> | undefined
let running = false

/** 바뀐 여행을 잠시 모았다가 올린다 */
export function scheduleSync(delay = 3000) {
  if (!CLIENT_ID || !getMeta().connected) return
  clearTimeout(timer)
  timer = setTimeout(() => { void syncNow() }, delay)
}

/** pull: 바뀐 것이 없어도 함께 편집 중인 여행은 Drive 쪽 변경을 확인한다 */
export async function syncNow(opts: { pull?: boolean } = {}) {
  if (running) return scheduleSync()
  const meta = getMeta()
  if (!meta.connected) return
  const trips = store().trips
  const pending = trips.filter(isPending)
  const watched = opts.pull ? trips.filter((t) => t.drive?.fileId && t.drive.role && !isPending(t)) : []
  if (!tokenValid()) return setStatus({ kind: 'reconnect', pending: pending.length })
  if (!navigator.onLine) return setStatus({ kind: 'offline' })
  const photosWaiting = localPhotoCount() > 0
  if (!pending.length && !watched.length && !photosWaiting) return setStatus({ kind: 'idle', lastSync: meta.lastSync })
  running = true
  if (pending.length) setStatus({ kind: 'syncing' })
  try {
    for (const t of [...pending, ...watched]) await syncTrip(t.id)
    if (photosWaiting) await backupPhotos()
    // 사진 백업으로 여행이 바뀌었으면(사진 키가 Drive 것으로 바뀜) 그것도 올린다
    for (const t of store().trips.filter(isPending)) await syncTrip(t.id)
    const now = Date.now()
    setMeta({ lastSync: now })
    setStatus({ kind: 'idle', lastSync: now })
  } catch (e) {
    if (e instanceof AuthError) setStatus({ kind: 'reconnect', pending: pendingCount() })
    else if (!navigator.onLine) setStatus({ kind: 'offline' })
    else setStatus({ kind: 'error', message: (e as Error).message })
  } finally { running = false }
}

export async function reconnectDrive() {
  await requestToken()
  setStatus({ kind: 'idle', lastSync: getMeta().lastSync })
  await syncNow({ pull: true })
}

/* ── Drive에서 되살리기 ── */
export interface Backup { id: string; name: string; modifiedTime: string; tripId?: string }

export async function listBackups(): Promise<Backup[]> {
  if (!tokenValid()) await requestToken()
  const q = encodeURIComponent(`'${await ensureFolder()}' in parents and trashed=false`)
  const r = await api(`${API}/files?q=${q}&orderBy=modifiedTime desc&pageSize=100&fields=files(id,name,modifiedTime,appProperties)`)
  if (!r.ok) throw new Error(tr('Drive 목록을 받지 못했습니다'))
  const files = (await r.json()).files as { id: string; name: string; modifiedTime: string; appProperties?: { trjTripId?: string } }[]
  return files.map((f) => ({ id: f.id, name: f.name.replace(/\.trj\.json$/, ''), modifiedTime: f.modifiedTime, tripId: f.appProperties?.trjTripId }))
}

export async function restoreBackup(fileId: string): Promise<string> {
  if (!tokenValid()) await requestToken()
  setMeta({ connected: true })
  const meta = await remoteMeta(fileId)
  // 다른 사람과 함께 쓰던 파일이면 되살린 뒤에도 계속 서로의 변경을 주고받는다
  const role = meta?.shared ? (meta.ownedByMe === false ? 'editor' : 'owner') : undefined
  const { merged } = mergeIntoLocal(await download(fileId), { fileId, version: meta?.version, ...(role ? { role } : {}) })
  scheduleSync(1000)
  return merged.id
}

/* ── 함께 편집 ── */
/** 여행을 Drive에 올리고 이 기기를 주인으로 표시한다. 초대 링크에 쓸 파일 id를 돌려준다 */
export async function startSharing(tripId: string): Promise<string> {
  if (!tokenValid()) await requestToken()
  setMeta({ connected: true })
  await syncTrip(tripId)
  const t = store().trips.find((x) => x.id === tripId)
  if (!t?.drive?.fileId) throw new Error(tr('Drive에 올리지 못했습니다'))
  if (!t.drive.role) {
    store().patchDrive(tripId, { role: 'owner' })
    for (const j of Object.values(t.journal)) for (const k of j.photos) if (k.startsWith('drive:')) await openToCompanions(k.slice(6))
  }
  setStatus({ kind: 'idle', lastSync: Date.now() })
  return t.drive.fileId
}

export interface Editor { id: string; role: string; email?: string; name?: string }

export async function listEditors(fileId: string): Promise<Editor[]> {
  const r = await api(`${API}/files/${fileId}/permissions?fields=permissions(id,type,role,emailAddress,displayName)`)
  if (!r.ok) return []
  const list = (await r.json()).permissions as { id: string; type: string; role: string; emailAddress?: string; displayName?: string }[]
  return list.filter((p) => p.type === 'user').map((p) => ({ id: p.id, role: p.role, email: p.emailAddress, name: p.displayName }))
}

/** 이메일로 편집자를 초대한다. Google이 초대 메일을 보내고, 메일에 TRJ 링크가 들어간다 */
/**
 * 내가 만든 여행 파일과 그 여행의 사진을 Drive 휴지통으로 옮긴다 (Drive에서 30일 안에 되살릴 수 있다).
 * 다른 사람이 만든 함께 편집 여행은 건드리지 않는다. 파일을 옮겼으면 true.
 */
export async function trashTrip(t: Trip): Promise<boolean> {
  const id = t.drive?.fileId
  if (!id || t.drive?.role === 'editor') return false
  await ensureToken()
  const trash = (fileId: string) => api(`${API}/files/${fileId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trashed: true }) })
  const r = await trash(id)
  if (!r.ok && r.status !== 404) throw new Error(tr('Drive 파일을 지우지 못했습니다'))
  // 사진은 여행마다 따로 올린 파일이라 함께 옮긴다 (실패해도 여행 삭제는 계속한다)
  const photos = Object.values(t.journal).flatMap((j) => j.photos).filter((k) => k.startsWith('drive:')).map((k) => k.slice(6))
  await Promise.allSettled(photos.map(trash))
  return true
}

export async function inviteByEmail(fileId: string, email: string, message: string) {
  const params = new URLSearchParams({ sendNotificationEmail: 'true', emailMessage: message, fields: 'id' })
  const r = await api(`${API}/files/${fileId}/permissions?${params}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'user', role: 'writer', emailAddress: email.trim() }),
  })
  if (!r.ok) throw new Error(tr('초대하지 못했습니다. Google 계정 이메일이 맞는지 확인하세요'))
}

export async function removeEditor(fileId: string, permissionId: string) {
  const r = await api(`${API}/files/${fileId}/permissions/${permissionId}`, { method: 'DELETE' })
  if (!r.ok && r.status !== 404) throw new Error(tr('내보내지 못했습니다'))
}

export const joinLink = (fileId: string) => `${location.origin}${location.pathname}#/join/${fileId}`

/* Google Picker: drive.file 권한에서는 공유받은 파일을 사용자가 한 번 골라 줘야 앱이 열 수 있다 */
type PickerNS = {
  DocsView: new (id?: unknown) => { setFileIds: (ids: string) => unknown; setMode: (m: unknown) => unknown; setIncludeFolders: (b: boolean) => unknown }
  PickerBuilder: new () => Record<string, (...a: unknown[]) => unknown> & { build: () => { setVisible: (b: boolean) => void; dispose?: () => void } }
  ViewId: { DOCS: unknown }; DocsViewMode: { LIST: unknown }; Feature: { NAV_HIDDEN: unknown }; Action: { PICKED: string; CANCEL: string }
}
let pickerPromise: Promise<PickerNS> | null = null
function loadPicker(): Promise<PickerNS> {
  const ns = () => (window as unknown as { google?: { picker?: PickerNS } }).google?.picker
  if (ns()) return Promise.resolve(ns()!)
  pickerPromise ??= loadScript('https://apis.google.com/js/api.js').then(() => new Promise<PickerNS>((resolve, reject) => {
    (window as unknown as { gapi: { load: (n: string, o: { callback: () => void; onerror: () => void }) => void } }).gapi.load('picker', {
      callback: () => (ns() ? resolve(ns()!) : reject(new Error(tr('Google 파일 선택 화면을 열지 못했습니다')))),
      onerror: () => reject(new Error(tr('Google 파일 선택 화면을 열지 못했습니다'))),
    })
  })).catch((e) => { pickerPromise = null; throw e })
  return pickerPromise
}

async function pickSharedFile(fileId: string): Promise<boolean> {
  const p = await loadPicker()
  return new Promise((resolve) => {
    const view = new p.DocsView(p.ViewId.DOCS)
    view.setFileIds(fileId); view.setMode(p.DocsViewMode.LIST); view.setIncludeFolders(false)
    const b = new p.PickerBuilder()
    b.addView(view); b.setOAuthToken(token!.value); b.setDeveloperKey(API_KEY); b.setAppId(APP_ID)
    b.setLocale('ko'); b.setTitle(tr('함께 편집할 여행 파일을 선택하세요')); b.setOrigin(location.origin); b.enableFeature(p.Feature.NAV_HIDDEN)
    b.setCallback((d: { action: string; docs?: { id: string }[] }) => {
      if (d.action === p.Action.PICKED) resolve(Boolean(d.docs?.some((x) => x.id === fileId)))
      else if (d.action === p.Action.CANCEL) resolve(false)
    })
    b.build().setVisible(true)
  })
}

/** 지금 연결된 Google 계정 이메일 */
export async function whoAmI(): Promise<string | undefined> {
  try { const r = await api(`${API}/about?fields=user(emailAddress)`); return r.ok ? (await r.json()).user?.emailAddress : undefined } catch { return undefined }
}

/** 초대 링크로 들어온 여행을 연다. 여행 id를 돌려주고, 사용자가 파일을 고르지 않았으면 null */
export async function openSharedTrip(fileId: string, switchAccount = false): Promise<string | null> {
  if (switchAccount) { token = null; await requestToken(true) } else if (!tokenValid()) await requestToken()
  setMeta({ connected: true })
  let meta = await remoteMeta(fileId)
  if (!meta && sharingConfigured) {
    if (!(await pickSharedFile(fileId))) return null
    meta = await remoteMeta(fileId)
  }
  if (!meta) throw new Error(tr('이 여행을 열 권한이 없습니다. 초대받은 Google 계정으로 로그인했는지 확인하세요'))
  const remote = await download(fileId)
  const mine = store().trips.find((x) => x.id === remote.id)?.drive?.role === 'owner'
  const { merged } = mergeIntoLocal(remote, {
    fileId, version: meta.version, role: mine ? 'owner' : 'editor', error: undefined,
    modifiedBy: meta.lastModifyingUser?.me ? undefined : meta.lastModifyingUser?.displayName, modifiedAt: meta.modifiedTime,
  })
  setStatus({ kind: 'idle', lastSync: getMeta().lastSync })
  scheduleSync(1000)
  return merged.id
}

/* ── 사진 백업 ── */
/** 아직 Drive에 올리지 않은 사진 수 (모든 여행) */
export function localPhotoCount(trips: Trip[] = store().trips) {
  return trips.reduce((n, t) => n + Object.values(t.journal).reduce((m, j) => m + j.photos.filter((k) => k.startsWith('photo-')).length, 0), 0)
}

async function ensurePhotoFolder(): Promise<string> {
  const meta = getMeta()
  if (meta.photoFolderId) {
    const r = await api(`${API}/files/${meta.photoFolderId}?fields=id,trashed`)
    if (r.ok && !(await r.json()).trashed) return meta.photoFolderId
  }
  const parent = await ensureFolder()
  const q = encodeURIComponent(`name='photos' and mimeType='${FOLDER_MIME}' and '${parent}' in parents and trashed=false`)
  const found = await api(`${API}/files?q=${q}&fields=files(id)`)
  let id = found.ok ? ((await found.json()).files as { id: string }[])[0]?.id : undefined
  if (!id) {
    const r = await api(`${API}/files?fields=id`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'photos', mimeType: FOLDER_MIME, parents: [parent] }) })
    if (!r.ok) throw new Error(tr('Drive에 사진 폴더를 만들지 못했습니다'))
    id = (await r.json()).id as string
  }
  setMeta({ photoFolderId: id })
  return id
}

/** 함께 편집하는 동행도 볼 수 있게, 링크가 있는 사람은 볼 수 있는 사진으로 바꾼다 (파일 id는 여행 참여자만 안다) */
async function openToCompanions(fileId: string) {
  await api(`${API}/files/${fileId}/permissions?fields=id`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'anyone', role: 'reader' }) }).catch(() => undefined)
}

async function uploadPhoto(blob: Blob, name: string): Promise<string> {
  const boundary = `trj${Math.random().toString(36).slice(2)}`
  const metadata = JSON.stringify({ name, parents: [await ensurePhotoFolder()], mimeType: 'image/jpeg' })
  const body = new Blob([`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: image/jpeg\r\n\r\n`, blob, `\r\n--${boundary}--`])
  const r = await api(`${UPLOAD}/files?uploadType=multipart&fields=id`, { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body })
  if (!r.ok) throw new Error(tr('사진을 Drive에 올리지 못했습니다'))
  return (await r.json()).id as string
}

/** 이 기기에만 있는 사진을 Drive에 올리고, 여행의 사진 키를 Drive 것으로 바꾼다. 한 번에 12장씩 */
async function backupPhotos() {
  let done = 0
  for (const t of store().trips) {
    for (const [date, j] of Object.entries(t.journal)) {
      for (const key of j.photos.filter((k) => k.startsWith('photo-'))) {
        if (done >= 12) { scheduleSync(2000); return }
        const blob = await getPhoto(key)
        if (!blob) { store().mutate(t.id, (x) => { x.journal[date].photos = x.journal[date].photos.filter((k) => k !== key) }); continue }
        const id = await uploadPhoto(blob, `${t.title} ${date}.jpg`)
        if (t.drive?.role) await openToCompanions(id)
        const remote = `drive:${id}`
        await putPhoto(remote, blob)
        store().mutate(t.id, (x) => { const e = x.journal[date]; if (e) e.photos = e.photos.map((k) => (k === key ? remote : k)) })
        await removePhoto(key)
        done++
      }
    }
  }
}

/** Drive에 백업된 사진 받기: 내 사진은 로그인으로, 동행의 사진은 링크 공개 파일이라 API 키로 받는다 */
setRemotePhotoFetcher(async (fileId) => {
  if (tokenValid()) {
    try { const r = await api(`${API}/files/${fileId}?alt=media`); if (r.ok) return await r.blob() } catch { /* 아래 방법으로 */ }
  }
  if (API_KEY) {
    const r = await fetch(`${API}/files/${fileId}?alt=media&key=${API_KEY}`)
    if (r.ok) return await r.blob()
  }
  return null
})

/* ── 시작 ── */
if (typeof window !== 'undefined') {
  // 여행이 바뀔 때마다 올릴 준비를 한다
  useStore.subscribe((s, prev) => { if (s.trips !== prev.trips && s.trips.some(isPending)) scheduleSync() })
  addEventListener('online', () => scheduleSync(1000))
  // 화면을 보고 있는 동안 30초마다, 그리고 앱으로 돌아올 때마다 다른 사람의 변경을 가져온다
  const pull = () => { if (document.visibilityState === 'visible' && tokenValid()) void syncNow({ pull: true }) }
  setInterval(pull, 30_000)
  document.addEventListener('visibilitychange', pull)
  // 브라우저가 저장 공간을 임의로 비우지 않도록 요청한다
  void navigator.storage?.persist?.()
}
