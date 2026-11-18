import { lang } from '../i18n'
import type { OcrLine } from './receipt'

/**
 * 기기 안 글자 인식 (Tesseract.js). 사진은 기기 밖으로 나가지 않는다.
 * 처음 한 번 인식 엔진과 언어 데이터(언어당 1~3MB)를 내려받고, 그 뒤로는 브라우저에 저장해 둔 것을 쓴다.
 */

/** 여행지 나라에 맞춰 읽을 글자를 고른다. 영어는 늘 넣는다 */
export function ocrLangs(country = ''): string[] {
  const out = ['eng']
  if (lang === 'ko' || /한국|korea/i.test(country)) out.push('kor')
  const local: [RegExp, string][] = [
    [/일본|japan/i, 'jpn'], [/태국|thai/i, 'tha'], [/대만|타이완|taiwan/i, 'chi_tra'], [/홍콩|hong\s?kong|마카오|macau/i, 'chi_tra'],
    [/중국|china/i, 'chi_sim'], [/베트남|vietnam|viet nam/i, 'vie'], [/프랑스|france/i, 'fra'], [/스페인|spain/i, 'spa'],
    [/이탈리아|italy/i, 'ita'], [/독일|germany/i, 'deu'], [/포르투갈|portugal/i, 'por'],
  ]
  const hit = local.find(([re]) => re.test(country))
  if (hit && !out.includes(hit[1])) out.push(hit[1])
  return out
}

type Worker = Awaited<ReturnType<typeof import('tesseract.js')['createWorker']>>
let cached: { key: string; worker: Promise<Worker> } | null = null

async function workerFor(langs: string[], onProgress?: (p: number) => void) {
  const key = langs.join('+')
  if (cached?.key !== key) {
    const old = cached
    cached = {
      key,
      worker: import('tesseract.js').then(({ createWorker }) =>
        createWorker(langs, 1, { logger: (m: { status: string; progress: number }) => { if (m.status.startsWith('loading')) onProgress?.(m.progress) } })),
    }
    old?.worker.then((w) => w.terminate()).catch(() => {})
  }
  try { return await cached.worker } catch (e) { cached = null; throw e }
}

/** 사진을 글자 인식에 알맞은 크기(긴 변 2000px 이하)로 맞춘다 */
async function prepare(file: Blob): Promise<HTMLCanvasElement> {
  const bmp = await createImageBitmap(file)
  const scale = Math.min(1, 2000 / Math.max(bmp.width, bmp.height))
  const c = document.createElement('canvas')
  c.width = Math.round(bmp.width * scale)
  c.height = Math.round(bmp.height * scale)
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height)
  return c
}

export async function recognizeLines(file: Blob, langs: string[], onProgress?: (p: number) => void): Promise<OcrLine[]> {
  const worker = await workerFor(langs, onProgress)
  const { data } = await worker.recognize(await prepare(file), {}, { blocks: true, text: true })
  type Line = { text: string; bbox: { y0: number; y1: number }; confidence: number }
  const lines: Line[] = (data.blocks ?? []).flatMap((b: { paragraphs: { lines: Line[] }[] }) => b.paragraphs.flatMap((p) => p.lines))
  if (!lines.length) return (data.text ?? '').split('\n').filter(Boolean).map((text: string, i: number) => ({ text, height: 1, top: i }))
  return lines
    .filter((l) => l.confidence > 35 && l.text.trim())
    .map((l) => ({ text: l.text.trim(), height: l.bbox.y1 - l.bbox.y0, top: l.bbox.y0 }))
}
