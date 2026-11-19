import { handlePlan, type PlanEnv } from './plan'

/**
 * 짧은 글 번역 (/api/translate). 함께 쓰는 여행의 장소 이름·메모·지출·준비물을 한국어 ↔ 영어로.
 * Cloudflare Workers AI(Gemma 3)를 먼저 쓰고,
 * 바인딩이 없거나 실패한 글만 Gemini로 옮긴다.
 */
export interface TranslateEnv extends PlanEnv {
  /** Pages 프로젝트 설정 → Bindings의 Workers AI (변수 이름 AI) */
  AI?: { run: (model: string, input: object) => Promise<unknown> }
}
export interface TranslateResult { status: number; json: unknown }

/*
 * 번역 모델: Gemma 3 12B (140개 넘는 언어, 한국어 품질이 좋다).
 * 처음 쓴 m2m100은 한국어를 엉뚱하게 옮겨('물개 관람 카약 투어' → 'Toughened Laminated Safety Glass') 쓰지 않는다.
 */
const MODEL = '@cf/google/gemma-3-12b-it'
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

async function withLlm(ai: NonNullable<TranslateEnv['AI']>, texts: string[], target: 'en' | 'ko'): Promise<(string | null)[]> {
  const language = target === 'en' ? 'English' : 'Korean'
  const prompt = [
    `Translate each item of the JSON array into natural ${language}. The items come from a shared travel itinerary: place names, tour titles, notes, expense names and packing items.`,
    target === 'ko' ? 'For place names use the common Korean name or a natural Hangul transliteration.' : 'For place names use the common English name or a standard romanization.',
    'Keep numbers, dates, times, prices, booking codes, flight numbers, URLs and emoji exactly as they are. If an item is already in that language, return it unchanged.',
    `Answer with only a JSON array of exactly ${texts.length} strings, in the same order. No explanation.`,
    JSON.stringify(texts),
  ].join('\n')
  const r = (await ai.run(MODEL, { messages: [{ role: 'user', content: prompt }], max_tokens: 2048, temperature: 0.1 })) as { response?: unknown }
  const raw = typeof r?.response === 'string' ? r.response : JSON.stringify(r?.response ?? '')
  const m = raw.match(/\[[\s\S]*\]/)
  if (!m) return texts.map(() => null)
  const arr = JSON.parse(m[0]) as unknown[]
  if (!Array.isArray(arr) || arr.length !== texts.length) return texts.map(() => null)
  return arr.map((x) => (typeof x === 'string' && x.trim() ? x.trim() : null))
}

export async function handleTranslate(body: unknown, env: TranslateEnv): Promise<TranslateResult> {
  const b = (body ?? {}) as Record<string, unknown>
  const target = b.target === 'ko' ? 'ko' : b.target === 'en' ? 'en' : null
  const texts = Array.isArray(b.texts) ? b.texts.map((x) => str(x, 300)).filter(Boolean).slice(0, 40) : []
  if (!target || !texts.length) return { status: 400, json: { error: 'bad_request' } }

  const out: (string | null)[] = texts.map(() => null)
  let engine = 'gemini'
  if (env.AI) {
    engine = 'workers-ai'
    // 이미 그 언어인 글은 그대로 두고, 나머지를 20개씩 묶어 한 번에 묻는다
    const ask = texts.map((t, i) => ((/[가-힣]/.test(t) ? 'ko' : 'en') === target ? (out[i] = t, -1) : i)).filter((i) => i >= 0)
    for (let i = 0; i < ask.length; i += 20) {
      const part = ask.slice(i, i + 20)
      try {
        const got = await withLlm(env.AI, part.map((k) => texts[k]), target)
        part.forEach((k, j) => { if (got[j]) out[k] = got[j] })
      } catch { /* 아래에서 Gemini로 */ }
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
