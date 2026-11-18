/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Google Cloud OAuth 클라이언트 ID (Drive 저장·함께 편집) */
  readonly VITE_GOOGLE_CLIENT_ID?: string
  /** Google API 키 (공유받은 파일을 여는 Picker용) */
  readonly VITE_GOOGLE_API_KEY?: string
}

/** 빌드한 커밋 (앞 7자리) */
declare const __APP_VERSION__: string
