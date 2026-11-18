import { handlePlan, type PlanEnv } from './plan'

/**
 * 짧은 글 번역 (/api/translate). 함께 쓰는 여행의 장소 이름·메모·지출·준비물을 한국어 ↔ 영어로.
 * Cloudflare Workers AI의 번역 모델(m2m100)을 먼저 쓰고 (1초 안팎, 무료 사용량이 넉넉함),
 * 바인딩이 없거나 실패한 글만 Gemini로 옮긴다.
 */
export interface TranslateEnv extends PlanEnv {
  /** Pages 프로젝트 설정 → Bindings의 Workers AI (변수 이름 AI) */
  AI?: { run: (model: string, input: object) => Promise<unknown> }
}
export interface TranslateResult { status: number; json: unknown }

const MODEL = '@cf/meta/m2m100-1.2b'
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

export async function handleTranslate(body: unknown, env: TranslateEnv): Promise<TranslateResult> {
  const b = (body ?? {}) as Record<string, unknown>
  const target = b.target === 'ko' ? 'ko' : b.target === 'en' ? 'en' : null
  const texts = Array.isArray(b.texts) ? b.texts.map((x) => str(x, 300)).filter(Boolean).slice(0, 40) : []
  if (!target || !texts.length) return { status: 400, json: { error: 'bad_request' } }

  const out: (string | null)[] = texts.map(() => null)
  let engine = 'gemini'
  if (env.AI) {
    engine = 'workers-ai'
    // 한 번에 8개씩 나눠 보낸다
    for (let i = 0; i < texts.length; i += 8) {
      await Promise.all(texts.slice(i, i + 8).map(async (text, j) => {
        const source = /[가-힣]/.test(text) ? 'ko' : 'en'
        if (source === target) { out[i + j] = text; return }
        try {
          const r = (await env.AI!.run(MODEL, { text, source_lang: source, target_lang: target })) as { translated_text?: string }
          const t = r?.translated_text?.trim()
          // 잘못된 입력이면 'ERROR: …'를 돌려준다
          if (t && !/^ERROR/.test(t)) out[i + j] = t
        } catch { /* 아래에서 Gemini로 */ }
      }))
    }
  }
  // Workers AI가 없거나 옮기지 못한 글은 Gemini로
  const rest = texts.map((t, i) => (out[i] == null ? i : -1)).filter((i) => i >= 0)
  if (rest.length) {
    const r = await handlePlan({ mode: 'texts', texts: rest.map((i) => texts[i]), lang: target }, env)
    const got = r.status === 200 ? (r.json as { texts?: unknown[] }).texts : undefined
    if (Array.isArray(got) && got.length === rest.length) rest.forEach((i, k) => { if (typeof got[k] === 'string' && (got[k] as string).trim()) out[i] = (got[k] as string).trim() })
    else if (!env.AI) return { status: r.status === 200 ? 502 : r.status, json: r.json }
    if (rest.length && env.AI) engine = 'workers-ai+gemini'
  }
  return { status: 200, json: { texts: out.map((t, i) => t ?? texts[i]), engine } }
}
