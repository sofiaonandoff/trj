import { tr } from '../i18n'
import { del, get, set } from 'idb-keyval'
import { useEffect, useState } from 'react'
import { uid } from './util'

/**
 * JPEG의 EXIF에서 찍은 날짜(DateTimeOriginal)를 읽는다. 없으면 undefined.
 * 사진을 줄이면 EXIF가 사라지므로 원본 파일에서 먼저 읽는다.
 */
export async function takenDate(file: Blob): Promise<string | undefined> {
  try {
    const v = new DataView(await file.slice(0, 256 * 1024).arrayBuffer())
    if (v.getUint16(0) !== 0xffd8) return undefined
    let o = 2
    while (o + 4 < v.byteLength) {
      const marker = v.getUint16(o), size = v.getUint16(o + 2)
      if (marker === 0xffe1 && v.getUint32(o + 4) === 0x45786966) { // "Exif"
        const t = o + 10
        const le = v.getUint16(t) === 0x4949
        const u16 = (p: number) => v.getUint16(t + p, le), u32 = (p: number) => v.getUint32(t + p, le)
        const find = (ifd: number, tag: number) => {
          const n = u16(ifd)
          for (let i = 0; i < n; i++) { const e = ifd + 2 + i * 12; if (u16(e) === tag) return e }
          return -1
        }
        const ascii = (e: number) => {
          const len = u32(e + 4), at = len > 4 ? u32(e + 8) : e + 8
          let s = ''
          for (let i = 0; i < len - 1; i++) s += String.fromCharCode(v.getUint8(t + at + i))
          return s
        }
        const ifd0 = u32(4)
        const exifPtr = find(ifd0, 0x8769)
        const original = exifPtr >= 0 ? find(u32(exifPtr + 8), 0x9003) : -1
        const any = original >= 0 ? original : find(ifd0, 0x0132) // 없으면 수정한 날짜
        const m = any >= 0 ? ascii(any).match(/^(\d{4}):(\d{2}):(\d{2})/) : null
        return m ? `${m[1]}-${m[2]}-${m[3]}` : undefined
      }
      if ((marker & 0xff00) !== 0xff00) return undefined
      o += 2 + size
    }
  } catch { /* 읽을 수 없는 파일은 날짜 없이 둔다 */ }
  return undefined
}

/** 사진을 긴 변 1600px JPEG로 줄여 이 기기의 IndexedDB에 저장한다. 키와 찍은 날짜를 돌려준다 */
export async function savePhoto(file: File): Promise<{ key: string; date?: string }> {
  const date = await takenDate(file)
  const bmp = await createImageBitmap(file)
  const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bmp.width * scale)
  canvas.height = Math.round(bmp.height * scale)
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height)
  const blob = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error(tr('사진을 변환하지 못했습니다')))), 'image/jpeg', 0.84))
  const key = `photo-${uid()}`
  await set(key, blob)
  return { key, date }
}

export const removePhoto = (key: string) => del(key)
export const getPhoto = (key: string) => get<Blob>(key)
export const putPhoto = (key: string, blob: Blob) => set(key, blob)

export const isBackedUp = (key: string) => key.startsWith('drive:')
export const driveIdOf = (key: string) => key.slice('drive:'.length)

/** Drive에 백업된 사진을 이 기기에 없을 때 받아 오는 함수. drive.ts가 채운다 (순환 참조를 피하려고 주입) */
let fetchRemote: ((fileId: string) => Promise<Blob | null>) | null = null
export const setRemotePhotoFetcher = (fn: typeof fetchRemote) => { fetchRemote = fn }

/** 사진 주소. 이 기기에 없고 Drive에 있으면 받아서 기기에 저장해 둔다. 실패하면 'missing' */
export function usePhoto(key: string): string | 'missing' | undefined {
  const [url, setUrl] = useState<string | 'missing'>()
  useEffect(() => {
    let made: string | undefined
    let alive = true
    ;(async () => {
      let b = await get<Blob>(key)
      if (!b && isBackedUp(key) && fetchRemote) {
        b = (await fetchRemote(driveIdOf(key)).catch(() => null)) ?? undefined
        if (b) await set(key, b)
      }
      if (!alive) return
      if (b) { made = URL.createObjectURL(b); setUrl(made) } else setUrl('missing')
    })()
    return () => { alive = false; if (made) URL.revokeObjectURL(made) }
  }, [key])
  return url
}
