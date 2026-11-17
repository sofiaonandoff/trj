import { tr } from '../i18n'
import { del, get, set } from 'idb-keyval'
import { useEffect, useState } from 'react'
import { uid } from './util'

/** 사진을 긴 변 1280px JPEG로 줄여 이 기기의 IndexedDB에 저장하고 키를 돌려준다 */
export async function savePhoto(file: File): Promise<string> {
  const bmp = await createImageBitmap(file)
  const scale = Math.min(1, 1280 / Math.max(bmp.width, bmp.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bmp.width * scale)
  canvas.height = Math.round(bmp.height * scale)
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height)
  const blob = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error(tr('사진을 변환하지 못했습니다')))), 'image/jpeg', 0.84))
  const key = `photo-${uid()}`
  await set(key, blob)
  return key
}

export const removePhoto = (key: string) => del(key)

export function usePhoto(key: string) {
  const [url, setUrl] = useState<string>()
  useEffect(() => {
    let made: string | undefined
    get<Blob>(key).then((b) => { if (b) { made = URL.createObjectURL(b); setUrl(made) } })
    return () => { if (made) URL.revokeObjectURL(made) }
  }, [key])
  return url
}
