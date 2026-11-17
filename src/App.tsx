import { tr } from './i18n'
import { useEffect } from 'react'
import { JoinPage } from './components/DriveUI'
import Home from './components/Home'
import NewTrip from './components/NewTrip'
import TripPage from './components/TripPage'
import { Toast, go, toast, useRoute } from './components/ui'
import { initDrive } from './lib/drive'
import { decodeTrip } from './lib/share'
import { useStore } from './store'

export default function App() {
  const route = useRoute()
  const add = useStore((s) => s.add)

  useEffect(() => { initDrive() }, [])

  // 복사본 링크(#/import/…)로 들어오면 여행을 이 기기에 담고 바로 연다
  useEffect(() => {
    if (!route.startsWith('/import/')) return
    const trip = decodeTrip(route.slice('/import/'.length))
    if (trip) { add(trip); toast(tr('공유받은 여행을 담았습니다')); go(`/trip/${trip.id}`, true) }
    else { toast(tr('링크가 잘렸거나 손상되었습니다. 보낸 사람에게 다시 받아 주세요')); go('/', true) }
  }, [route, add])

  let page = <Home />
  if (route === '/new') page = <NewTrip />
  else if (route.startsWith('/trip/')) page = <TripPage key={route} id={route.slice('/trip/'.length)} />
  else if (route.startsWith('/join/')) page = <JoinPage fileId={route.slice('/join/'.length)} />
  else if (route.startsWith('/import/')) page = <div className="shell" />

  return <>{page}<Toast /></>
}
