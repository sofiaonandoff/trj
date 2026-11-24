import { useSyncExternalStore } from 'react'
import { registerSW } from 'virtual:pwa-register'

/**
 * 새 버전 받기. 홈 화면에 추가한 앱은 닫지 않고 오래 켜 두는 일이 많아, 배포해도 예전 화면에 머문다.
 * - 15분마다, 그리고 앱으로 돌아올 때마다 새 버전이 있는지 확인한다.
 * - 새 버전이 준비되면: 앱이 뒤에 있었으면 돌아오는 순간 새로고침하고,
 *   보고 있는 중이면 아래에 '새 버전' 띠를 띄워 사용자가 누를 때 바꾼다 (쓰던 내용이 사라지지 않게).
 * 여행 데이터는 기기(localStorage)와 Drive에 저장돼 있어 새로고침해도 그대로다.
 */
let ready = false
let whenHidden = false
const subs = new Set<() => void>()
const set = (v: boolean) => { ready = v; subs.forEach((l) => l()) }
export const useUpdateReady = () => useSyncExternalStore((l) => { subs.add(l); return () => subs.delete(l) }, () => ready)
export const applyUpdate = () => location.reload()

export function startUpdates() {
  if (!('serviceWorker' in navigator) || import.meta.env.DEV) return
  registerSW({
    immediate: true,
    // 새 버전이 켜졌다 (autoUpdate: 새 서비스 워커가 이미 자리를 잡았다)
    onNeedReload() {
      if (document.visibilityState === 'hidden') whenHidden = true
      else set(true)
    },
    onRegisteredSW(_url, reg) {
      if (!reg) return
      const check = () => { if (navigator.onLine !== false) reg.update().catch(() => undefined) }
      setInterval(check, 15 * 60_000)
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') { if (ready) whenHidden = true; return }
        // 뒤에 있는 동안 새 버전이 준비됐으면 돌아오는 순간 바꾼다
        if (whenHidden) { applyUpdate(); return }
        check()
      })
    },
  })
}
