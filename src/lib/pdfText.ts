import type { OcrLine } from './receipt'

/**
 * 예약 확인서 PDF에서 글자 줄을 뽑는다 (JOMO parse.ts의 pdfToText를 줄 단위·글자 크기까지 받게 고침).
 * pdf.js는 필요할 때만 불러오고, 파일은 기기 밖으로 나가지 않는다.
 */
export async function pdfLines(file: Blob): Promise<OcrLine[]> {
  const pdfjs = await import('pdfjs-dist')
  const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise
  const out: OcrLine[] = []
  let offset = 0
  for (let i = 1; i <= Math.min(doc.numPages, 5); i++) {
    const page = await doc.getPage(i)
    const height = page.getViewport({ scale: 1 }).height
    const content = await page.getTextContent()
    let text = '', size = 0, top = 0
    const flush = () => { if (text.trim()) out.push({ text: text.replace(/\s+/g, ' ').trim(), height: size, top: offset + top }); text = ''; size = 0 }
    for (const item of content.items) {
      if (!('str' in item)) continue
      const h = Math.abs(item.transform[3]) || Math.abs(item.height)
      if (!text) top = height - item.transform[5]
      text += item.str + (item.hasEOL ? '' : ' ')
      size = Math.max(size, h)
      if (item.hasEOL) flush()
    }
    flush()
    offset += height
  }
  return out
}
