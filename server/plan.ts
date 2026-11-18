/**
 * AI 일정 추천의 서버 쪽 본체. Gemini API 키는 여기(서버 환경 변수)에만 있고 브라우저로 나가지 않는다.
 * Cloudflare Pages Function(functions/api/plan.ts)과 로컬 개발 서버(vite.config.ts)가 같은 코드를 쓴다.
 */
export interface PlanEnv {
  GEMINI_API_KEY?: string
  /** 기본 모델을 바꾸고 싶을 때 */
  GEMINI_MODEL?: string
  /** 테스트용: Gemini 대신 부를 주소 */
  GEMINI_API_BASE?: string
}
export interface PlanResult { status: number; json: unknown }

const CATEGORIES = ['sight', 'food', 'cafe', 'shop', 'nature', 'culture', 'night', 'stay'] as const
const PACE = { slow: '2 to 3', normal: 'about 4', full: '5 or 6' } as const
/** 앞에서부터 시도한다. 모델 이름이 바뀌어 없어졌으면 다음 것으로 넘어간다 */
const MODELS = ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3-flash-preview', 'gemini-2.5-flash', 'gemini-2.5-flash-lite']
const MAX_DAYS = 14

const PLACE = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    lat: { type: 'number' },
    lng: { type: 'number' },
    category: { type: 'string', enum: [...CATEGORIES] },
    start: { type: 'string', description: 'Start time, 24-hour HH:MM' },
    duration: { type: 'integer', description: 'Minutes spent there' },
    cost_krw: { type: 'integer', description: 'Estimated cost per person in Korean won, 0 if free' },
    note: { type: 'string', description: 'One short practical tip' },
  },
  required: ['name', 'lat', 'lng', 'category', 'start', 'duration', 'cost_krw', 'note'],
}
const TRIP_SCHEMA = {
  type: 'object',
  properties: { days: { type: 'array', items: { type: 'object', properties: { items: { type: 'array', items: PLACE } }, required: ['items'] } } },
  required: ['days'],
}
const MORE_SCHEMA = { type: 'object', properties: { items: { type: 'array', items: PLACE } }, required: ['items'] }
const NAMES_SCHEMA = { type: 'object', properties: { names: { type: 'array', items: { type: 'string' } } }, required: ['names'] }
const EXPENSE_CATS = ['food', 'stay', 'move', 'play', 'shop', 'etc'] as const
const PHOTO_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['place', 'expense', 'flight'], description: 'place: somewhere the traveler visits (restaurant, sight, shop, hotel). expense: a cost with no place to visit (taxi, SIM card, transit card). flight: a flight ticket or boarding pass' },
          name: { type: 'string', description: 'Place or item name' },
          address: { type: 'string', description: 'Street address or area if visible, else empty' },
          lat: { type: 'number', description: 'Real latitude if you know the place, else 0' },
          lng: { type: 'number', description: 'Real longitude if you know the place, else 0' },
          category: { type: 'string', enum: [...CATEGORIES] },
          date: { type: 'string', description: 'Date of the visit or payment shown in the image as YYYY-MM-DD, else empty. For a hotel booking use the check-in date' },
          time: { type: 'string', description: 'Time shown in the image as 24-hour HH:MM, else empty' },
          duration: { type: 'integer', description: 'Likely minutes spent there' },
          amount: { type: 'number', description: 'Total paid as printed, 0 if no price' },
          currency: { type: 'string', description: 'ISO 4217 code of amount, empty if no price' },
          amount_krw: { type: 'integer', description: 'amount converted to Korean won with a recent rate, 0 if no price' },
          expense_category: { type: 'string', enum: [...EXPENSE_CATS] },
          note: { type: 'string', description: 'One short useful detail (booking number, what was ordered)' },
          flight_no: { type: 'string' }, from_iata: { type: 'string' }, to_iata: { type: 'string' },
          dep_date: { type: 'string' }, dep_time: { type: 'string' }, arr_date: { type: 'string' }, arr_time: { type: 'string' },
          seat: { type: 'string' }, pnr: { type: 'string' },
        },
        required: ['kind', 'name', 'category', 'date', 'time', 'amount', 'currency', 'amount_krw', 'expense_category', 'note'],
      },
    },
  },
  required: ['items'],
}
/** 브라우저가 줄여 보낸 사진만 받는다 (base64 약 2MB 이하) */
const MAX_IMAGE = 2_800_000

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
const isDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)

function common(lang: string) {
  const language = lang === 'en' ? 'English' : 'Korean'
  return [
    'Rules:',
    '- Use only real, well-known places that exist and are open to visitors. Never invent a place.',
    '- lat and lng are the real coordinates of the place in decimal degrees, as precise as you know them.',
    `- "name" is the place name as it is usually written in ${language}. "note" is one practical tip in ${language}, under 60 characters.`,
    '- "start" is a realistic 24-hour HH:MM start time that leaves time to travel from the previous stop.',
    '- "cost_krw" is the estimated cost per person in Korean won (0 if free).',
  ].join('\n')
}

type Built = { prompt: string; schema: object; image?: { data: string; mime: string } }
function buildPrompt(b: Record<string, unknown>): Built | { error: string } {
  const lang = b.lang === 'en' ? 'en' : 'ko'
  if (b.mode === 'names') {
    const names = Array.isArray(b.names) ? b.names.map((x) => str(x, 120)).filter(Boolean).slice(0, 12) : []
    if (!names.length) return { error: 'bad_request' }
    const language = lang === 'en' ? 'English' : 'Korean'
    return {
      schema: NAMES_SCHEMA,
      prompt: [
        `Write each place name the way it is usually written in ${language}${str(b.city, 80) ? ` (the places are in or near ${str(b.city, 80)})` : ''}.`,
        lang === 'ko' ? 'Use the common Korean name or a natural Hangul transliteration. Keep brand names that Koreans write in Latin letters as they are.' : 'Use the common English name or a standard romanization.',
        `Return "names" with exactly ${names.length} strings in the same order.`,
        ...names.map((n, i) => `${i + 1}. ${n}`),
      ].join('\n'),
    }
  }
  if (b.mode === 'photo') {
    const img = b.image as { data?: unknown; mime?: unknown } | undefined
    const data = typeof img?.data === 'string' ? img.data : ''
    const mime = typeof img?.mime === 'string' && /^image\/(jpeg|png|webp)$/.test(img.mime) ? img.mime : 'image/jpeg'
    if (!data || data.length > MAX_IMAGE || !/^[A-Za-z0-9+/=]+$/.test(data.slice(0, 200))) return { error: 'bad_request' }
    const language = lang === 'en' ? 'English' : 'Korean'
    const taken = str(b.taken, 20)
    return {
      schema: PHOTO_SCHEMA,
      image: { data, mime },
      prompt: [
        `A traveler on a trip to ${[str(b.city, 80), str(b.country, 60)].filter(Boolean).join(', ') || 'somewhere'}${isDate(b.start) && isDate(b.end) ? ` from ${b.start} to ${b.end}` : ''} added this image to their itinerary.`,
        'It may be a receipt, a booking or ticket screenshot, a boarding pass, a map or listing screenshot, a menu, or a photo of a place or sign.',
        'Read it and return what should go into the itinerary and the budget. Usually one item; return several only if the image clearly lists several separate bookings or places.',
        taken ? `The photo was taken on ${taken}. Use that only if the image itself shows no date.` : '',
        '- Read dates and times only from the image (or the photo date above). A date printed without a year is in the trip year.',
        '- For a receipt from a shop or restaurant, kind is "place" and name is the shop name.',
        '- For a boarding pass or flight ticket, kind is "flight" and fill the flight fields with IATA codes and 24-hour times.',
        '- If the image shows nothing useful for a trip, return an empty "items".',
        `- Write "name" and "note" in ${language}, as the place is usually written in ${language}.`,
        'Return JSON only.',
      ].filter(Boolean).join('\n'),
    }
  }
  const city = str(b.city, 80)
  if (!city) return { error: 'bad_request' }
  const where = [city, str(b.country, 60)].filter(Boolean).join(', ')
  const interests = Array.isArray(b.interests) ? b.interests.filter((x): x is string => CATEGORIES.includes(x as never)) : []
  const arrive = str(b.arrive, 120)
  const depart = str(b.depart, 120)
  const exclude = Array.isArray(b.exclude) ? b.exclude.map((x) => str(x, 80)).filter(Boolean).slice(0, 60) : []

  if (b.mode === 'more') {
    const near = b.near as { lat?: unknown; lng?: unknown } | undefined
    const at = near && num(near.lat) !== undefined && num(near.lng) !== undefined ? ` near latitude ${num(near.lat)}, longitude ${num(near.lng)}` : ''
    return {
      schema: MORE_SCHEMA,
      prompt: [
        `Suggest 5 more places to visit in ${where}${at}, closest first, for a traveler's day plan. Keep each note very short.`,
        interests.length ? `Prefer these kinds of places: ${interests.join(', ')}.` : '',
        exclude.length ? `Do not suggest any of these, they are already in the plan: ${exclude.join('; ')}.` : '',
        common(lang),
        'Return JSON only.',
      ].filter(Boolean).join('\n'),
    }
  }

  if (!isDate(b.start) || !isDate(b.end)) return { error: 'bad_request' }
  const days = Math.round((Date.parse(b.end) - Date.parse(b.start)) / 86400000) + 1
  if (!(days >= 1)) return { error: 'bad_request' }
  if (days > MAX_DAYS) return { error: 'too_long' }
  const pace = PACE[(b.pace as keyof typeof PACE) in PACE ? (b.pace as keyof typeof PACE) : 'normal']
  return {
    schema: TRIP_SCHEMA,
    prompt: [
      `Plan a ${days}-day trip to ${where}, from ${b.start} to ${b.end}.`,
      `Pace: ${pace} places per day.`,
      interests.length ? `The traveler especially wants: ${interests.join(', ')}. Still include the essential sights.` : '',
      `Return exactly ${days} days in "days", in date order.`,
      '- Put places that are close to each other on the same day, and order each day to avoid backtracking.',
      arrive ? `- Day 1: the traveler arrives ${arrive.startsWith('from ') ? `${arrive} (ground or domestic transfer)` : `at ${arrive}`} and can start around 14:00. Begin with places close to that arrival point or on the way into the city, then move toward the center. Keep day 1 light.` : '',
      depart && days > 1 ? `- Last day: the traveler leaves from ${depart}. Use places near ${depart} or on the way there, and finish by 15:00.` : '',
      !arrive && days > 1 ? '- Day 1 starts in the morning.' : '',
      exclude.length ? `- Do not include any of these, they are already planned: ${exclude.join('; ')}.` : '',
      '- Include places to eat at sensible meal times when food is among the interests.',
      '- Do not repeat a place.',
      common(lang),
      'Return JSON only.',
    ].filter(Boolean).join('\n'),
  }
}

/** Interactions API 응답에서 모델이 쓴 글을 꺼낸다 (응답 형식 개정 전후를 모두 받는다) */
function outputText(data: Record<string, unknown>): string | undefined {
  type Part = { type?: string; text?: string }
  const steps = Array.isArray(data.steps) ? (data.steps as { type?: string; content?: Part[] }[]) : []
  for (let i = steps.length - 1; i >= 0; i--) {
    const text = steps[i].content?.find((c) => c.type === 'text' && c.text)?.text
    if (text) return text
  }
  const outputs = Array.isArray(data.outputs) ? (data.outputs as Part[]) : []
  return outputs.find((o) => o.type === 'text' && o.text)?.text ?? (typeof data.output_text === 'string' ? data.output_text : undefined)
}

export async function handlePlan(body: unknown, env: PlanEnv): Promise<PlanResult> {
  if (!env.GEMINI_API_KEY) return { status: 503, json: { error: 'not_configured' } }
  if (!body || typeof body !== 'object') return { status: 400, json: { error: 'bad_request' } }
  const built = buildPrompt(body as Record<string, unknown>)
  if ('error' in built) return { status: 400, json: { error: built.error } }

  const base = env.GEMINI_API_BASE ?? 'https://generativelanguage.googleapis.com'
  const models = env.GEMINI_MODEL ? [env.GEMINI_MODEL, ...MODELS.filter((m) => m !== env.GEMINI_MODEL)] : MODELS
  let last = { status: 502, detail: 'no response' }
  let busyCount = 0
  // 추가 추천은 빨라야 하므로 생각 단계를 거의 생략하고, 일정 전체는 조금만 생각하게 한다
  const mode = (body as Record<string, unknown>).mode
  const quick = mode === 'more' || mode === 'names' || mode === 'photo'
  const perTry = mode === 'names' ? 10_000 : quick ? 20_000 : 45_000
  const budget = mode === 'names' ? 15_000 : quick ? 34_000 : 85_000
  const began = Date.now()
  for (const model of models) {
    const remaining = budget - (Date.now() - began)
    if (remaining < 4_000) { last = { status: 504, detail: 'time budget' }; break }
    // 2.x 모델은 thinking_level을 받지 않는다
    const generation_config = model.startsWith('gemini-2') ? undefined : { thinking_level: quick && mode !== 'photo' ? 'minimal' : 'low' }
    let res: Response
    try {
      res = await fetch(`${base}/v1beta/interactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
        body: JSON.stringify({
          model, generation_config,
          input: built.image ? [{ type: 'text', text: built.prompt }, { type: 'image', data: built.image.data, mime_type: built.image.mime }] : built.prompt, response_format: { type: 'text', mime_type: 'application/json', schema: built.schema } }),
        signal: AbortSignal.timeout(Math.min(perTry, remaining)),
      })
    } catch (e) {
      // 한 모델이 너무 오래 걸리면 다음 모델로 넘어간다
      if ((e as Error).name === 'TimeoutError' || (e as Error).name === 'AbortError') { last = { status: 504, detail: `${model} timed out` }; busyCount++; continue }
      return { status: 502, json: { error: 'upstream', detail: (e as Error).message } }
    }
    if (res.ok) {
      const text = outputText((await res.json()) as Record<string, unknown>)
      try {
        const parsed = JSON.parse((text ?? '').replace(/^```(?:json)?\s*|\s*```$/g, ''))
        return { status: 200, json: { ...parsed, model } }
      } catch {
        return { status: 502, json: { error: 'bad_output' } }
      }
    }
    const detail = await res.text().then((t) => { try { return (JSON.parse(t) as { error?: { message?: string } }).error?.message ?? t } catch { return t } }).catch(() => '')
    last = { status: res.status, detail: detail.slice(0, 300) }
    // 모델이 없거나(404) 일시적으로 붐비면(503·500, high demand) 다음 모델로 넘어간다.
    // 키 문제(401·403)와 한도 초과(429)는 다른 모델로 가도 같으므로 바로 알린다
    const missing = res.status === 404 || (res.status === 400 && /model/i.test(detail))
    const busy = res.status === 503 || res.status === 500 || /high demand|overloaded|unavailable/i.test(detail)
    if (missing) continue
    if (busy) { busyCount++; await new Promise((r) => setTimeout(r, 400)); continue }
    break
  }
  const error = last.status === 401 || last.status === 403 ? 'auth' : last.status === 429 ? 'quota' : last.status === 504 ? 'timeout' : busyCount ? 'busy' : 'upstream'
  return { status: last.status === 429 ? 429 : 502, json: { error, detail: last.detail } }
}
