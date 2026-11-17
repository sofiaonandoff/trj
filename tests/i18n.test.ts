// 화면 코드의 tr('…') 문구가 영어 사전에 모두 있는지, {0} 자리가 맞는지 확인한다
import fs from 'node:fs'
import path from 'node:path'
import { EN } from '../src/i18n.en'
import { missing } from '../src/i18n'
import '../src/data/destinations'
import '../src/data/airports'

const root = path.resolve(import.meta.dirname, '../src')
const files = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(path.join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [path.join(dir, e.name)] : []))
const unescape = (s: string) => s.replace(/\\n/g, '\n').replace(/\\(['"\\])/g, '$1')
const used = new Map<string, string>()
for (const f of files(root)) {
  if (f.endsWith('i18n.en.ts')) continue
  for (const m of fs.readFileSync(f, 'utf8').matchAll(/\btr\(\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")/g)) used.set(unescape(m[1] ?? m[2]), path.basename(f))
}
const holes = (s: string) => (s.match(/\{\d\}/g) ?? []).sort().join()
const problems = [
  ...[...used].filter(([k]) => !(k in EN)).map(([k, f]) => `사전에 없음 (${f}): ${JSON.stringify(k)}`),
  ...[...missing].map((k) => `사전에 없음 (데이터): ${k}`),
  ...Object.entries(EN).filter(([k, v]) => holes(k) !== holes(v)).map(([k]) => `{n} 자리가 다름: ${k}`),
  ...Object.entries(EN).filter(([, v]) => /[가-힣]/.test(v)).map(([k]) => `영어 문구에 한글이 있음: ${k}`),
]
const unused = Object.keys(EN).filter((k) => !used.has(k) && !missing.has(k))
console.log(problems.length ? problems.join('\n') : `모두 통과 (문구 ${used.size}개)`)
process.exit(problems.length ? 1 : 0)
void unused
