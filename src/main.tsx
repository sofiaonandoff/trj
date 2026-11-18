import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { loadWorldAirports } from './data/airports'
import { lang } from './i18n'
import './styles.css'

document.documentElement.lang = lang

// 세계 공항 목록을 먼저 불러온다 (항공편 화면에 공항 이름이 바로 보이게). 늦어지면 기다리지 않고 그린다
const render = () => createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
Promise.race([loadWorldAirports(), new Promise((r) => setTimeout(r, 800))]).finally(render)
