import { handleView, memoryStore } from '../server/view'

let fails = 0
const check = (label: string, ok: boolean, got?: unknown) => { if (!ok) fails++; console.log(ok ? 'PASS' : 'FAIL', label, ok ? '' : JSON.stringify(got)) }
const store = memoryStore()
const trip = { title: '시드니', days: [{ date: '2026-12-01', items: [] }] }

const made = await handleView('POST', '', { data: trip }, null, store)
const { id, token } = made.json as { id: string; token: string }
check('만들면 짧은 id(10자)와 토큰을 준다', made.status === 200 && id.length === 10 && token.length === 32, made)
const got = await handleView('GET', id, null, null, store)
check('로그인 없이 받는다', got.status === 200 && (got.json as { data: { title: string } }).data.title === '시드니', got)
const bad = await handleView('POST', '', { id, token: 'x'.repeat(32), data: { ...trip, title: '바뀜' } }, null, store)
check('토큰이 틀리면 고칠 수 없다', bad.status === 403, bad)
await handleView('POST', '', { id, token, data: { ...trip, title: '멜버른' } }, null, store)
const after = await handleView('GET', id, null, null, store)
check('토큰이 맞으면 같은 링크의 내용이 바뀐다', (after.json as { data: { title: string } }).data.title === '멜버른', after)
check('여행이 아닌 내용은 받지 않는다', (await handleView('POST', '', { data: { hello: 1 } }, null, store)).status === 400)
check('너무 큰 내용은 받지 않는다', (await handleView('POST', '', { data: { ...trip, note: 'x'.repeat(600_000) } }, null, store)).status === 413)
check('지우기는 토큰이 있어야 한다', (await handleView('DELETE', id, null, 'nope', store)).status === 403)
await handleView('DELETE', id, null, token, store)
check('끄면 링크가 더 열리지 않는다', (await handleView('GET', id, null, null, store)).status === 404)
check('저장소가 없으면 503', (await handleView('GET', id, null, null, undefined)).status === 503)
check('이상한 id는 404', (await handleView('GET', '../x', null, null, store)).status === 404)

// 별칭: 예전에 보낸 Drive 보기 링크로도 짧은 링크의 최신 내용을 본다
const al = (await handleView('POST', '', { data: trip, alias: '1AbCdEfGhIjKlMnOp' }, null, store)).json as { id: string; token: string }
await handleView('POST', '', { id: al.id, token: al.token, data: { ...trip, title: '바뀐 제목' }, alias: '1AbCdEfGhIjKlMnOp' }, null, store)
const byAlias = await handleView('GET', 'a/1AbCdEfGhIjKlMnOp', null, null, store)
check('Drive 파일 id(별칭)로 최신 내용', byAlias.status === 200 && (byAlias.json as { data: { title: string } }).data.title === '바뀐 제목', byAlias)
check('모르는 별칭은 404', (await handleView('GET', 'a/zzzzzzzzzzzzzz', null, null, store)).status === 404)
console.log(fails ? `\n${fails}개 실패` : '\n모두 통과')
process.exit(fails ? 1 : 0)
