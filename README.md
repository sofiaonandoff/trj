# trj. — THEREALJOURNEY

Your world, your journey. 일정·동선·항공편·예산·준비물·기록을 한곳에 담는 모바일 우선 여행 웹앱(PWA).

## 브랜드

| 이름 | 색 | 쓰임 |
|---|---|---|
| Forest | `#1C2C29` | 바탕(머리·탑승권), 글자, 주 버튼, 밝은 화면의 동선 |
| Sage | `#E7EBE2` | 입력칸, 옅은 면 |
| Linen | `#F8F6F1` | 앱 바탕, 어두운 면 위의 글자 |
| Sand | `#D2B698` | 강조, 어두운 면 위의 동선·숫자 (밝은 바탕 글자에는 `#8F6E4B`) |

- 글꼴은 Pretendard 하나. 숫자도 같은 글꼴의 굵은 고정폭 숫자로 쓴다.
- 워드마크 `trj.`는 Pretendard Black 윤곽을 경로로 바꿔 `src/brand.ts`에 두었다. 화면(`<Logo />`), 앱 아이콘, 내보내기 이미지가 같은 경로를 쓴다.
- 아이콘: `public/icon.svg`, `favicon.svg`, `icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `apple-touch-icon.png`.
- 내보내기 템플릿: 포레스트·리넨·샌드.

## 실행

```bash
npm install
npm run dev      # 개발 서버 (같은 와이파이의 휴대폰에서도 접속 가능)
npm run build    # dist/ 에 배포용 파일 생성
npm run preview  # 빌드 결과 확인
```

Cloudflare Pages에 올릴 때: 빌드 명령 `npm run build`, 출력 폴더 `dist`.

## 기능

- **일정·동선**: 날짜별 타임라인, 끌어서 순서 변경, 장소 사이 이동 거리·시간 어림, 가까운 순 정리, 시각 자동 맞춤, 지도에 경로 표시
- **AI 일정 추천**: 어느 도시든 Gemini가 취향·속도에 맞춘 날짜별 초안을 짜고, 그 날 동선에 맞는 곳을 더 추천. AI를 못 쓸 때는 9개 도시에 한해 기기 안의 기본 추천으로 대신함
- **항공편 자동 기록**: 예약 메일·e티켓 문구를 붙여 넣으면 편명·공항·시각·날짜·좌석·예약번호를 뽑아 해당 날짜 일정에 탑승권 카드로 넣음. 시차를 반영한 비행 시간 계산, 여행 기간 자동 확장
- **동행·예산**: 통화별 지출 기록, 항목별 비율, 누가 누구에게 얼마 보내면 되는지 정산 계산
- **준비물**: 목적지에 맞춘 기본 목록, 담당자 지정, 진행률
- **기록·공유**: 날짜별 글과 사진, 블로그용 마크다운·유튜브 설명란 내보내기, 복사본 링크, 파일 저장/불러오기
- **이미지 내보내기**: 템플릿 3종(포레스트·리넨·샌드) × 비율 3종(9:16 스토리, 1:1 피드, 16:9 영상), 여행 전체 요약 또는 하루 한 장. PNG 저장·공유, 전체 일괄 저장
- **한국어·영어**: 홈 오른쪽 위 버튼으로 전환. 화면 문구, 추천 장소·공항·항공사 이름, 날짜·금액 표기까지 바뀐다
- **Drive 저장·함께 편집**: 내 Google Drive에 자동 저장, 동행 초대, 30초 주기 항목 단위 병합, Drive에서 복원
- **PWA**: 홈 화면 설치, 오프라인 실행, 다크 모드, 넓은 화면에서는 일정과 지도 2단 구성

## 데이터가 저장되는 곳

서버가 없다. 저장은 세 겹이다.

1. **이 기기**: 여행은 브라우저 localStorage, 사진은 IndexedDB. 오프라인에서도 동작한다.
2. **내 Google Drive**: 연결하면 `TRJ` 폴더에 여행마다 `제목.trj.json` 파일로 자동 저장된다(변경 3초 뒤). 기기를 바꾸거나 브라우저 데이터를 지워도 홈의 '여행 불러오기'에서 되살린다.
3. **Drive 버전 기록**: 파일의 이전 버전은 Drive 웹의 '버전 관리'에서 내려받을 수 있다.

사진은 아직 기기에만 저장된다.

## 함께 편집 (서버 없음)

공유 시트의 '함께 편집 시작' → 동행의 Google 계정 이메일로 초대 → 동행이 초대 링크(`#/join/<파일 id>`)를 열고 파일을 한 번 선택하면, 같은 Drive 파일을 양쪽이 읽고 쓴다. 화면을 보는 동안 30초마다, 앱으로 돌아올 때마다 상대의 변경을 받아 항목 단위로 합친다(`src/lib/merge.ts`).

- 서로 다른 항목을 고치면 둘 다 남는다.
- 같은 항목을 둘 다 고치면 나중에 고친 쪽이 남는다.
- 한쪽에서 지운 항목은 그 뒤에 다른 쪽이 고치지 않았다면 지워진다.

권한은 `drive.file`이라 TRJ가 만든 파일과 사용자가 직접 고른 파일에만 접근한다.

### Google 설정

Google Cloud 프로젝트 `trj-the-real-journey` (TRJ 전용, 로그인 창에 "trj."로 표시)

- 사용 중인 API: Google Drive API, Google Picker API
- OAuth 클라이언트 `trj web` (웹 애플리케이션). 승인된 JavaScript 원본: `http://localhost:5173`
- API 키 `trj picker`: Google Picker API만 허용, 웹사이트 제한 `http://localhost:5173/*`
- 로그인 화면: 앱 이름 `trj.`, 대상 외부, **테스트 중** (테스트 사용자만 로그인 가능)

`.env.local` (git에 올라가지 않음):

```
VITE_GOOGLE_CLIENT_ID=...apps.googleusercontent.com
VITE_GOOGLE_API_KEY=...
```

배포 주소가 생기면:

1. OAuth 클라이언트의 JavaScript 원본과 API 키의 웹사이트 제한에 배포 주소를 추가한다.
2. 동행 누구나 로그인하게 하려면 로그인 화면을 프로덕션으로 게시한다. 게시 전에 브랜딩에 홈페이지·개인정보처리방침 주소가 있어야 한다. 그 전까지는 '대상 → 테스트 사용자'에 동행 계정을 추가한다(최대 100명).
3. Cloudflare Pages 환경 변수에 위 두 값을 넣는다.

## AI 일정 추천 (Gemini)

새 여행을 만들 때 어느 도시든 Gemini가 날짜별 일정 초안을 짜고, 장소 추가의 'AI 추천'에서 그 날 동선에 맞는 곳을 더 받는다. AI를 쓸 수 없으면(키 없음·한도 초과·오프라인) 준비된 9개 도시는 기기 안의 기본 추천으로, 그 밖의 도시는 빈 일정으로 시작하고 이유를 알려 준다.

API 키는 브라우저로 나가지 않는다. 브라우저는 `/api/plan`만 부르고, 키는 서버 쪽에서만 읽는다.

- 로컬: `.env.local`에 `GEMINI_API_KEY=...` (`VITE_`를 붙이지 않는다. 붙이면 번들에 들어가 공개된다). `npm run dev`와 `npm run preview`가 `/api/plan`을 대신 처리한다(`vite.config.ts`).
- 배포(Cloudflare Pages): 설정 → 환경 변수에 `GEMINI_API_KEY`를 **비밀(Secret)** 로 추가한다. `functions/api/plan.ts`가 자동으로 서버 함수가 된다.
- 모델은 `gemini-3.8-flash`부터 차례로 시도한다. 바꾸려면 `GEMINI_MODEL` 환경 변수.

모델이 준 좌표·영업 정보는 틀릴 수 있다. 앱은 형식과 범위만 확인하고(목적지에서 250km 넘게 벗어난 좌표는 버림) 사실 여부는 확인하지 않는다.

## 언어 (i18n)

화면 코드는 한국어 문구를 그대로 열쇠로 쓴다: `tr('장소 추가')`, 값이 들어가면 `tr('{0}일차', n)`. 영어는 `src/i18n.en.ts`에 `'한국어': 'English'`로 적는다(어순이 다르면 `{0}` 자리를 옮겨 적는다). 사전에 없는 문구는 한국어로 나온다.

처음 열 때 브라우저 언어가 한국어면 한국어, 아니면 영어로 시작하고, 버튼으로 바꾸면 선택이 저장된다. 언어를 바꾸면 화면을 새로 연다.

이미 만든 여행의 장소 이름·준비물은 만든 당시 언어로 남는다(사용자 내용이라 번역하지 않는다).

## 테스트

```bash
npx tsx tests/merge.test.ts   # 병합 규칙 8개 시나리오
npx tsx tests/i18n.test.ts    # 영어 사전에 빠진 문구가 없는지
```

## 외부 서비스

- 지도 타일: OpenFreeMap (API 키 없음)
- 장소 검색: OpenStreetMap Nominatim (API 키 없음, 초당 1회 이하 사용 정책)

## 구조

```
server/plan.ts          AI 추천 본체 (Gemini 호출). 서버에서만 실행
functions/api/plan.ts   Cloudflare Pages Function: POST /api/plan
src/
  data/        도시별 추천 장소, 공항·항공사 표
  i18n.ts      언어 선택과 tr(), i18n.en.ts 영어 사전
  lib/         planner(일정 추천), flight(항공편 파서·시차), merge(항목 단위 병합), drive(Drive 동기화·함께 편집),
               poster(이미지 내보내기), share(링크·글 내보내기), geocode, photos
  components/  Home, NewTrip, TripPage, PlanTab, BudgetTab, PrepTab, JournalTab, MapView, DriveUI, ExportSheet, ui
  store.ts     zustand + localStorage
  styles.css   디자인 토큰과 전체 스타일
```
