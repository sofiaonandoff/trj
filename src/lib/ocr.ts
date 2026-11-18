import { lang } from '../i18n'
import type { OcrLine } from './receipt'

/**
 * 기기 안 글자 인식 (Tesseract.js). 사진은 기기 밖으로 나가지 않는다.
 * 처음 한 번 인식 엔진과 언어 데이터(언어당 1~3MB)를 내려받고, 그 뒤로는 브라우저에 저장해 둔 것을 쓴다.
 *
 * 인식률을 올리는 장치
 * - 전처리: 작은 캡처는 키우고, 흑백으로 바꿔 대비를 늘리고, 다크 모드 화면은 뒤집는다
 * - 언어: 영어+한국어로 한 번, 여행지 글자(태국어·일본어 등)로 한 번 읽어 확신도가 높은 쪽을 쓴다
 *   (한국 앱 캡처를 태국어 모델로 읽으면 한글이 깨지고, 그 반대도 마찬가지라서)
 * - 한글·한자·가나가 한 글자씩 띄어져 읽힌 줄은 붙인다 (JOMO에서 가져온 보정)
 */

/** 여행지 나라의 글자 (영어·한국어 말고 더 읽어야 하는 것) */
export function localLang(country = ''): string | undefined {
  const local: [RegExp, string][] = [
    [/일본|japan/i, 'jpn'], [/태국|thai/i, 'tha'], [/대만|타이완|taiwan/i, 'chi_tra'], [/홍콩|hong\s?kong|마카오|macau/i, 'chi_tra'],
    [/중국|china/i, 'chi_sim'], [/베트남|vietnam|viet nam/i, 'vie'], [/프랑스|france/i, 'fra'], [/스페인|spain/i, 'spa'],
    [/이탈리아|italy/i, 'ita'], [/독일|germany/i, 'deu'], [/포르투갈|portugal/i, 'por'],
  ]
  return local.find(([re]) => re.test(country))?.[1]
}

/** 읽을 언어 조합들. 첫 번째는 늘 영어(+한국어) */
export function ocrPasses(country = ''): string[][] {
  // 화면 언어와 상관없이 한국어도 읽는다: 한국 앱(에어비앤비 한국어 화면, 항공사 앱) 캡처가 많다
  void lang; void country
  const base = ['eng', 'kor']
  const local = localLang(country)
  return local ? [base, ['eng', local]] : [base]
}
/** 예전 이름 (한 번에 읽을 언어 목록) */
export const ocrLangs = (country = '') => [...new Set(ocrPasses(country).flat())]

type Worker = Awaited<ReturnType<typeof import('tesseract.js')['createWorker']>>
const workers = new Map<string, Promise<Worker>>()

function workerFor(langs: string[], onProgress?: (p: number) => void) {
  const key = langs.join('+')
  let w = workers.get(key)
  if (!w) {
    w = import('tesseract.js').then(async ({ createWorker }) => {
      const worker = await createWorker(langs, 1, { logger: (m: { status: string; progress: number }) => { if (m.status.startsWith('loading')) onProgress?.(m.progress) } })
      // 한·중·일 글자 사이 띄어쓰기를 지어내지 않게 한다
      await worker.setParameters({ preserve_interword_spaces: '1' } as never)
      return worker
    })
    w.catch(() => workers.delete(key))
    workers.set(key, w)
    // 언어 조합이 많아지면 오래된 것부터 정리한다
    if (workers.size > 3) { const [k, old] = workers.entries().next().value!; workers.delete(k); old.then((x) => x.terminate()).catch(() => {}) }
  }
  return w
}

/**
 * 사진이 얼마나 기울었는지(도) 어림한다. 작게 줄인 흑백 사진을 -10~10도로 돌려 보며
 * 글자 줄이 가로로 가장 또렷이 나뉘는(줄별 어두운 점 수의 분산이 가장 큰) 각도를 고른다.
 */
export function skewAngle(src: HTMLCanvasElement): number {
  const S = 360
  const k = Math.min(1, S / Math.max(src.width, src.height))
  const w = Math.max(1, Math.round(src.width * k)), h = Math.max(1, Math.round(src.height * k))
  const small = document.createElement('canvas')
  small.width = w; small.height = h
  const sg = small.getContext('2d', { willReadFrequently: true })!
  sg.drawImage(src, 0, 0, w, h)
  const d = sg.getImageData(0, 0, w, h).data
  // 어두운 점(글자)만 모은다
  let mean = 0
  for (let i = 0; i < w * h; i++) mean += d[i * 4]
  mean /= w * h
  const pts: [number, number][] = []
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (d[(y * w + x) * 4] < mean * 0.72) pts.push([x - w / 2, y - h / 2])
  if (pts.length < 50 || pts.length > w * h * 0.4) return 0
  let best = 0, bestVar = -1
  for (let a = -10; a <= 10; a += 0.5) {
    const r = (a * Math.PI) / 180, sin = Math.sin(r), cos = Math.cos(r)
    const rows = new Float64Array(h * 2)
    for (const [x, y] of pts) { const yy = Math.round(x * sin + y * cos + h); if (yy >= 0 && yy < rows.length) rows[yy]++ }
    let m = 0
    for (const v of rows) m += v
    m /= rows.length
    let v2 = 0
    for (const v of rows) v2 += (v - m) * (v - m)
    if (v2 > bestVar * 1.02) { bestVar = v2; best = a }
  }
  return best
}

/**
 * 글자 인식에 알맞게 사진을 다듬는다.
 * 긴 변을 1600~2400px로 맞추고(작은 캡처는 키운다), 흑백·대비 늘리기, 어두운 화면은 밝게 뒤집는다.
 */
export async function prepare(file: Blob, enhance = true): Promise<HTMLCanvasElement> {
  const bmp = await createImageBitmap(file)
  const long = Math.max(bmp.width, bmp.height)
  const scale = long < 1600 ? Math.min(3, 1600 / long) : Math.min(1, 2400 / long)
  const c = document.createElement('canvas')
  c.width = Math.round(bmp.width * scale)
  c.height = Math.round(bmp.height * scale)
  const g = c.getContext('2d', { willReadFrequently: true })!
  g.imageSmoothingQuality = 'high'
  g.drawImage(bmp, 0, 0, c.width, c.height)
  if (!enhance) return c
  // 기울어진 사진은 똑바로 세운다 (1도 이상일 때)
  const angle = skewAngle(c)
  if (Math.abs(angle) >= 1) {
    const r = (-angle * Math.PI) / 180
    const copy = document.createElement('canvas')
    copy.width = c.width; copy.height = c.height
    copy.getContext('2d')!.drawImage(c, 0, 0)
    g.save()
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height)
    g.translate(c.width / 2, c.height / 2); g.rotate(r); g.drawImage(copy, -c.width / 2, -c.height / 2)
    g.restore()
  }
  const img = g.getImageData(0, 0, c.width, c.height)
  const px = img.data
  const n = px.length / 4
  const hist = new Uint32Array(256)
  const lum = new Uint8ClampedArray(n)
  for (let i = 0; i < n; i++) {
    const v = (px[i * 4] * 299 + px[i * 4 + 1] * 587 + px[i * 4 + 2] * 114) / 1000
    lum[i] = v; hist[lum[i]]++
  }
  // 1%·99% 밝기를 0·255로 늘린다 (바랜 감열지 영수증)
  const pick = (q: number) => { let acc = 0; for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= n * q) return v } return 255 }
  const lo = pick(0.01), hi = pick(0.99)
  const span = Math.max(32, hi - lo)
  // 가운데 부분이 어두우면 다크 모드 화면으로 보고 뒤집는다.
  // (사진 전체가 아니라 가운데만 본다: 어두운 탁자 위의 흰 영수증을 뒤집지 않게)
  let sum = 0, cnt = 0
  const W = c.width, H = c.height
  for (let y = Math.floor(H * 0.25); y < H * 0.75; y += 4) for (let x = Math.floor(W * 0.25); x < W * 0.75; x += 4) { sum += lum[y * W + x]; cnt++ }
  const invert = cnt > 0 && sum / cnt < 100
  for (let i = 0; i < n; i++) {
    let v = ((lum[i] - lo) * 255) / span
    if (invert) v = 255 - v
    px[i * 4] = px[i * 4 + 1] = px[i * 4 + 2] = v
  }
  g.putImageData(img, 0, 0)
  return c
}

const CJK = '\\p{Script=Hangul}\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}ー'
/** "명 동 교 자", "一 蘭 渋谷 店"처럼 한 글자씩 띄어 읽힌 줄을 붙인다 */
export function despaceCJK(line: string): string {
  // 한자·가나 사이는 원래 띄어 쓰지 않는다
  let out = line.replace(new RegExp(`(?<=[\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}ー])\\s+(?=[\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}ー])`, 'gu'), '')
  // 일본어 날짜·숫자 단위: "2026 年 12 月 3 日"
  out = out.replace(/(\d)\s+(?=[年月日円時分])/g, '$1').replace(/([年月日])\s+(?=\d)/g, '$1')
  // 한글은 띄어쓰기가 있으니, 한 글자 토막이 두 개 이상 이어진 곳만 붙인다
  // "명 동 교 자 본점" → "명동교자 본점", "명 동 교자 본점" → "명동교자 본점", "총 결제금액"은 그대로
  const toks = out.split(' ')
  const one = (t: string) => /^\p{Script=Hangul}$/u.test(t)
  const merged: string[] = []
  for (let i = 0; i < toks.length; i++) {
    if (one(toks[i]) && one(toks[i + 1] ?? '')) {
      let run = ''
      while (i < toks.length && one(toks[i])) run += toks[i++]
      // 두세 글자만 떨어졌으면 바로 뒤의 한글 낱말에 붙은 것으로 본다
      if (run.length <= 3 && /^\p{Script=Hangul}{1,3}$/u.test(toks[i] ?? '')) run += toks[i++]
      merged.push(run); i--
    } else merged.push(toks[i])
  }
  out = merged.join(' ')
  return out.replace(new RegExp(`(?<=[${CJK}])\\s+(?=[.,)])`, 'gu'), '')
}

export interface OcrResult { lines: OcrLine[]; confidence: number; langs: string[]; /** 원본 대비 읽은 그림의 배율 (줄 위치를 원본 좌표로 바꿀 때) */ scale?: number }

async function readOnce(canvas: HTMLCanvasElement, langs: string[], onProgress?: (p: number) => void, psm = '6'): Promise<OcrResult> {
  const worker = await workerFor(langs, onProgress)
  // 6: 한 덩어리 글(Tesseract.js 기본값, 영수증 금액 칸을 잘 읽는다), 11: 흩어진 글자.
  // 워커를 같이 쓰므로 매번 정해 준다 (3으로 두면 오른쪽 금액 칸이 통째로 빠진다)
  await worker.setParameters({ tessedit_pageseg_mode: psm } as never)
  const { data } = await worker.recognize(canvas, {}, { blocks: true, text: true })
  type Line = { text: string; bbox: { y0: number; y1: number }; confidence: number }
  const raw: Line[] = (data.blocks ?? []).flatMap((b: { paragraphs: { lines: Line[] }[] }) => b.paragraphs.flatMap((p) => p.lines))
  // 확신도가 낮은 줄도 일단 남긴다 (흐린 제목 줄). 엉터리 줄은 해석 단계에서 걸러진다
  const kept = raw.filter((l) => l.confidence > 20 && l.text.trim())
  const lines = kept.map((l) => ({ text: despaceCJK(l.text.trim()), height: l.bbox.y1 - l.bbox.y0, top: l.bbox.y0 }))
  // 글자 수로 가중한 평균 확신도
  const chars = kept.reduce((s, l) => s + l.text.length, 0)
  const confidence = chars ? kept.reduce((s, l) => s + l.confidence * l.text.length, 0) / chars : 0
  if (!lines.length && data.text) return { lines: data.text.split('\n').filter(Boolean).map((text: string, i: number) => ({ text: despaceCJK(text), height: 1, top: i })), confidence: data.confidence ?? 0, langs }
  return { lines, confidence, langs }
}

/** 언어 조합마다 읽어 보고 가장 믿을 만한 결과를 고른다 */
/** 흩어진 글자 방식으로 한 번 더 읽는다 (해석 결과가 빈약할 때 photoImport가 부른다) */
export async function recognizeSparse(file: Blob, langs: string[]): Promise<OcrLine[]> {
  return (await readOnce(await prepare(file), langs, undefined, '11')).lines
}

export async function recognize(file: Blob, passes: string[][], onProgress?: (p: number) => void): Promise<OcrResult> {
  const canvas = await prepare(file)
  const bmpW = (await createImageBitmap(file)).width
  // 확신도가 비슷하면 더 많은 글자를 읽은 쪽
  const score = (x: OcrResult) => x.confidence + Math.min(12, x.lines.length * 1.5)
  let best: OcrResult | undefined
  for (const langs of passes) {
    const r = await readOnce(canvas, langs, onProgress)
    if (!best || score(r) > score(best)) best = r
    // 충분히 잘 읽었으면 더 하지 않는다
    if (best.confidence >= 88 && best.lines.length >= 3) return { ...best, scale: canvas.width / bmpW }
  }
  // 다듬은 사진으로 잘 안 읽히면 원본 그대로도 읽어 본다 (흐린 사진은 대비를 늘리면 오히려 나빠질 때가 있다)
  if (best!.confidence < 80) {
    const raw = await prepare(file, false)
    const r = await readOnce(raw, best!.langs, onProgress)
    if (score(r) > score(best!)) best = r
  }
  return { ...best!, scale: canvas.width / bmpW }
}

/**
 * 사진의 가로 띠 한 부분만 크게 키워 다시 읽는다 (원본 좌표 top~bottom).
 * 숙소 앱의 체크인·체크아웃 칸처럼 사진·아이콘에 둘러싸여 잘 안 읽히는 작은 부분을 다시 볼 때 쓴다.
 */
export async function recognizeBand(file: Blob, top: number, bottom: number, langs: string[]): Promise<OcrLine[]> {
  const bmp = await createImageBitmap(file)
  const y0 = Math.max(0, Math.floor(top)), y1 = Math.min(bmp.height, Math.ceil(bottom))
  if (y1 - y0 < 8) return []
  const k = Math.min(3, Math.max(1, 1600 / bmp.width))
  const c = document.createElement('canvas')
  c.width = Math.round(bmp.width * k); c.height = Math.round((y1 - y0) * k)
  const g = c.getContext('2d')!
  g.imageSmoothingQuality = 'high'
  g.drawImage(bmp, 0, y0, bmp.width, y1 - y0, 0, 0, c.width, c.height)
  return (await readOnce(c, langs)).lines
}

export async function recognizeLines(file: Blob, langs: string[] | string[][], onProgress?: (p: number) => void): Promise<OcrLine[]> {
  const passes = Array.isArray(langs[0]) ? (langs as string[][]) : [langs as string[]]
  return (await recognize(file, passes, onProgress)).lines
}

/**
 * 사진 속 간판·로고처럼 어두운 바탕 위의 밝은 글자를 찾아 읽는다 (예: 호텔 사진의 'QUEST' 간판).
 * 1) 주변보다 훨씬 밝은 점만 남기고 2) 글자 크기의 덩어리를 찾아 3) 가로로 나란한 덩어리를 낱말로 묶은 뒤
 * 4) 낱말마다 잘라 키워 한 줄 글자로 읽는다. 보통 글자(밝은 바탕의 어두운 글자)는 이미 읽었으니 다루지 않는다.
 */
export async function signWords(file: Blob): Promise<string[]> {
  const bmp = await createImageBitmap(file)
  const k = Math.min(1, 1400 / bmp.width)
  const W = Math.round(bmp.width * k), H = Math.round(bmp.height * k)
  const c = document.createElement('canvas')
  c.width = W; c.height = H
  const g = c.getContext('2d', { willReadFrequently: true })!
  g.drawImage(bmp, 0, 0, W, H)
  const px = g.getImageData(0, 0, W, H).data
  const lum = new Float32Array(W * H)
  for (let i = 0; i < W * H; i++) lum[i] = (px[i * 4] * 299 + px[i * 4 + 1] * 587 + px[i * 4 + 2] * 114) / 1000
  // 주변 평균 (적분 영상)
  const S = new Float64Array((W + 1) * (H + 1))
  for (let y = 0; y < H; y++) { let row = 0; for (let x = 0; x < W; x++) { row += lum[y * W + x]; S[(y + 1) * (W + 1) + x + 1] = S[y * (W + 1) + x + 1] + row } }
  const r = 9
  const mean = (x: number, y: number) => {
    const x0 = Math.max(0, x - r), y0 = Math.max(0, y - r), x1 = Math.min(W, x + r + 1), y1 = Math.min(H, y + r + 1)
    return (S[y1 * (W + 1) + x1] - S[y0 * (W + 1) + x1] - S[y1 * (W + 1) + x0] + S[y0 * (W + 1) + x0]) / ((x1 - x0) * (y1 - y0))
  }
  const mask = new Uint8Array(W * H)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const v = lum[y * W + x]; if (v > 185) { const m = mean(x, y); if (m < 165 && v - m > 55) mask[y * W + x] = 1 } }

  // 덩어리 찾기
  type Box = { x0: number; y0: number; x1: number; y1: number; n: number }
  const seen = new Uint8Array(W * H), boxes: Box[] = [], stack: number[] = []
  for (let i = 0; i < W * H; i++) {
    if (!mask[i] || seen[i]) continue
    const b: Box = { x0: W, y0: H, x1: 0, y1: 0, n: 0 }
    stack.push(i); seen[i] = 1
    while (stack.length) {
      const j = stack.pop()!, x = j % W, y = (j - x) / W
      b.n++; if (x < b.x0) b.x0 = x; if (x > b.x1) b.x1 = x; if (y < b.y0) b.y0 = y; if (y > b.y1) b.y1 = y
      for (const q of [j - 1, j + 1, j - W, j + W]) if (q >= 0 && q < W * H && mask[q] && !seen[q] && Math.abs((q % W) - x) <= 1) { seen[q] = 1; stack.push(q) }
    }
    const h = b.y1 - b.y0 + 1, w = b.x1 - b.x0 + 1, fill = b.n / (w * h)
    if (h >= 7 && h <= 70 && w >= 2 && w <= h * 1.4 && fill > 0.15 && fill < 0.92) boxes.push(b)
  }
  // 나란한 글자 덩어리를 낱말로 묶는다
  boxes.sort((a, b) => a.x0 - b.x0)
  const parent = boxes.map((_, i) => i)
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])))
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j], ha = a.y1 - a.y0 + 1, hb = b.y1 - b.y0 + 1
    if (b.x0 - a.x1 > Math.max(ha, hb) * 1.1) break
    const cy = Math.abs((a.y0 + a.y1) / 2 - (b.y0 + b.y1) / 2)
    if (cy < Math.min(ha, hb) * 0.45 && Math.max(ha, hb) / Math.min(ha, hb) < 1.6) parent[find(j)] = find(i)
  }
  const groups = new Map<number, Box[]>()
  boxes.forEach((b, i) => { const p = find(i); groups.set(p, [...(groups.get(p) ?? []), b]) })
  const words = [...groups.values()].filter((gs) => gs.length >= 3).slice(0, 10)

  const out: string[] = []
  for (const gs of words) {
    const x0 = Math.min(...gs.map((b) => b.x0)), x1 = Math.max(...gs.map((b) => b.x1)), y0 = Math.min(...gs.map((b) => b.y0)), y1 = Math.max(...gs.map((b) => b.y1))
    const pad = (y1 - y0) * 0.5
    const sx = Math.max(0, x0 - pad) / k, sy = Math.max(0, y0 - pad) / k, sw = Math.min(W, x1 + pad) / k - sx, sh = Math.min(H, y1 + pad) / k - sy
    const z = Math.max(1, 70 / sh)
    const cc = document.createElement('canvas')
    cc.width = Math.round(sw * z); cc.height = Math.round(sh * z)
    const gg = cc.getContext('2d', { willReadFrequently: true })!
    gg.drawImage(bmp, sx, sy, sw, sh, 0, 0, cc.width, cc.height)
    // 밝은 글자만 검게, 나머지는 희게
    const d = gg.getImageData(0, 0, cc.width, cc.height)
    for (let i = 0; i < d.data.length; i += 4) { const v = (d.data[i] * 299 + d.data[i + 1] * 587 + d.data[i + 2] * 114) / 1000; d.data[i] = d.data[i + 1] = d.data[i + 2] = v > 195 ? 0 : 255 }
    gg.putImageData(d, 0, 0)
    const read = await readOnce(cc, ['eng'], undefined, '7').catch(() => null)
    const t = read?.lines.map((l) => l.text).join(' ').replace(/[^A-Za-z0-9&' -]/g, '').trim()
    if (t && /[A-Za-z]{3,}/.test(t)) out.push(t)
  }
  return out
}
