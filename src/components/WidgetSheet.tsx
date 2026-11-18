import { lang, tr } from '../i18n'
import { Copy, Download } from 'lucide-react'
import { widgetScript } from '../lib/widgetScript'
import { Sheet, copy } from './ui'

/**
 * 아이폰 홈 화면 위젯 만들기 안내. 무료 앱 Scriptable에 이 여행의 보기 링크를 읽는 스크립트를 붙여 넣는다.
 * 위젯은 보기 링크 내용을 30분마다 새로 받아 오늘 일정·다음 일정·D-day를 보여 준다.
 */
export default function WidgetSheet({ open, onClose, viewId }: { open: boolean; onClose: () => void; viewId: string }) {
  const base = `${location.origin}${location.pathname.replace(/\/$/, '')}`
  const script = widgetScript(viewId, base, lang)
  return (
    <Sheet open={open} onClose={onClose} title={tr('아이폰 홈 화면 위젯')}>
      <div className="stack">
        <p className="hint" style={{ marginTop: 0 }}>{tr('홈 화면에서 오늘 일정, 다음 일정까지 남은 것, 출발 D-day를 봅니다. 여행을 고치면 위젯도 30분 안에 바뀝니다. 위젯을 누르면 일정이 열립니다.')}</p>
        <ol className="widget-steps">
          <li><b>{tr('Scriptable 앱 설치 (무료)')}</b>
            <a className="btn btn-ghost" href="https://apps.apple.com/app/scriptable/id1405459188" target="_blank" rel="noopener"><Download size={16} />{tr('App Store에서 받기')}</a></li>
          <li><b>{tr('위젯 스크립트 복사')}</b>
            <button className="btn btn-primary" onClick={() => copy(script, tr('위젯 스크립트를 복사했습니다'))}><Copy size={16} />{tr('스크립트 복사')}</button></li>
          <li><b>{tr('Scriptable에 붙여 넣기')}</b><small>{tr('Scriptable을 열고 오른쪽 위 + 를 누른 뒤 붙여 넣으세요. 맨 위 제목을 눌러 이름을 trj로 바꾸고, ▶를 눌러 한 번 실행해 봅니다.')}</small></li>
          <li><b>{tr('홈 화면에 위젯 넣기')}</b><small>{tr('홈 화면 빈 곳을 길게 누르고 왼쪽 위 편집 → 위젯 추가 → Scriptable을 고릅니다. 크기를 고르고 넣은 다음, 위젯을 길게 눌러 위젯 편집 → Script에서 trj를 고르세요.')}</small></li>
        </ol>
        <p className="hint">{tr('작은 위젯은 다음 일정 하나, 중간은 4개, 큰 위젯은 9개까지 보여 줍니다. 보기 링크를 끄면 위젯도 마지막으로 받은 일정만 보여 줍니다.')}</p>
      </div>
    </Sheet>
  )
}
