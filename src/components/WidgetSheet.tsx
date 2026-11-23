import { lang, tr } from '../i18n'
import { Copy, Download } from 'lucide-react'
import { useState } from 'react'
import { widgetScript } from '../lib/widgetScript'
import { Sheet, copy } from './ui'

/**
 * 아이폰 홈 화면 위젯 만들기 안내. 무료 앱 Scriptable에 이 여행의 보기 링크를 읽는 스크립트를 붙여 넣는다.
 * 위젯은 보기 링크 내용을 30분마다 새로 받아 오늘 일정·다음 일정·D-day를 보여 준다.
 * 안드로이드는 위젯 앱 KWGT의 웹 데이터 수식($wg)으로 앱 서버의 위젯용 주소(/api/widget/<id>)를 읽는다.
 */
export default function WidgetSheet({ open, onClose, viewId }: { open: boolean; onClose: () => void; viewId: string }) {
  const base = `${location.origin}${location.pathname.replace(/\/$/, '')}`
  const script = widgetScript(viewId, base, lang)
  const [os, setOs] = useState<'ios' | 'android'>(() => (/android/i.test(navigator.userAgent) ? 'android' : 'ios'))
  // 안드로이드 KWGT용: 위젯용 주소와 수식
  const tz = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Seoul' } catch { return 'Asia/Seoul' } })()
  const api = `${location.origin}/api/widget/${viewId}?lang=${lang}&tz=${encodeURIComponent(tz)}`
  const f = (path: string) => `$wg("${api}", json, "${path}")$`
  const open1 = `${base}/#/v/${viewId}`
  return (
    <Sheet open={open} onClose={onClose} title={tr('홈 화면 위젯')}>
      <div className="stack">
        <div className="seg" role="tablist" aria-label={tr('휴대폰 종류')}>
          <button role="tab" aria-selected={os === 'ios'} aria-pressed={os === 'ios'} onClick={() => setOs('ios')}>{tr('아이폰')}</button>
          <button role="tab" aria-selected={os === 'android'} aria-pressed={os === 'android'} onClick={() => setOs('android')}>{tr('안드로이드')}</button>
        </div>
        {os === 'android' ? <>
        <p className="hint" style={{ marginTop: 0 }}>{tr('위젯 앱 KWGT가 이 여행의 오늘 일정, 다음 일정, D-day를 받아 홈 화면에 보여 줍니다. 여행을 고치면 KWGT가 새로 받을 때(보통 30분 안팎) 바뀝니다.')}</p>
        <ol className="widget-steps">
          <li><b>{tr('KWGT 앱 설치')}</b>
            <a className="btn btn-ghost" href="https://play.google.com/store/apps/details?id=org.kustom.widget" target="_blank" rel="noopener"><Download size={16} />{tr('Play 스토어에서 받기')}</a></li>
          <li><b>{tr('홈 화면에 KWGT 위젯 넣기')}</b><small>{tr('홈 화면 빈 곳을 길게 누르고 위젯 → KWGT에서 4×2 크기를 끌어다 놓습니다. 놓은 위젯을 누르면 KWGT 편집기가 열립니다. 빈 위젯으로 시작하세요.')}</small></li>
          <li><b>{tr('일정 글 넣기')}</b>
            <small>{tr('편집기에서 + → 텍스트(Text)를 추가하고, 텍스트 항목의 글 칸에 아래 수식을 붙여 넣습니다. 오늘 일정이 여러 줄로 나옵니다.')}</small>
            <button className="btn btn-primary" onClick={() => copy(f('.text'), tr('위젯 수식을 복사했습니다'))}><Copy size={16} />{tr('일정 전체 수식 복사')}</button></li>
          <li><b>{tr('누르면 일정 열기 (선택)')}</b>
            <small>{tr('텍스트 항목의 터치(Touch) → 동작: 링크 열기(Open link)에 아래 주소를 넣으면, 위젯을 누를 때 보기 링크가 열립니다.')}</small>
            <button className="btn btn-ghost" onClick={() => copy(open1, tr('주소를 복사했습니다'))}><Copy size={16} />{tr('보기 링크 주소 복사')}</button></li>
          <li><b>{tr('저장')}</b><small>{tr('오른쪽 위 저장(💾)을 누르면 홈 화면 위젯에 나타납니다.')}</small></li>
        </ol>
        <details className="widget-more">
          <summary>{tr('글자를 나눠 직접 꾸미기')}</summary>
          <p className="hint">{tr('텍스트 항목을 여러 개 만들고 각각 아래 수식을 넣으면 여행 이름, D-day, 다음 일정을 따로 꾸밀 수 있습니다.')}</p>
          {([['.title', tr('여행 이름')], ['.badge', tr('D-day 또는 몇일차')], ['.date', tr('날짜')], ['.next', tr('다음 일정')], ['.line1', tr('오늘 일정 1번째 줄 (.line2 … .line9)')]] as const).map(([k, label]) => (
            <button key={k} className="btn btn-quiet btn-block widget-formula" onClick={() => copy(f(k), tr('위젯 수식을 복사했습니다'))}><Copy size={15} /><span className="grow">{label}</span><code>{k}</code></button>
          ))}
        </details>
        <p className="hint">{tr('KWGT의 일부 기능(만든 위젯 불러오기 등)은 유료(Pro)일 수 있습니다. 보기 링크를 끄면 위젯에 "보기 링크가 꺼졌거나 잘못되었습니다"가 나옵니다.')}</p>
        </> : <>
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
        </>}
      </div>
    </Sheet>
  )
}
