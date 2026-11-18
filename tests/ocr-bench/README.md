# 사진 읽기 벤치마크

'사진으로 추가'의 글자 인식·해석이 얼마나 맞는지 재는 시험 세트다. 영수증(영어·한국어·일본어), 앱 캡처(그랩, 숙소 예약, 항공권, 입장권),
흐리고 기울고 바랜 사진, 아주 작은 캡처, 다크 모드 화면 18장과 정답(가게 이름·날짜·금액·통화·예약번호·항공편)을 만든다.

```
pip install pillow playwright && playwright install chromium
python3 tests/ocr-bench/make.py          # out/에 사진과 정답 생성
npm run dev                              # 다른 창에서
python3 tests/ocr-bench/run.py 이름 -v   # 앱의 실제 인식 코드로 채점
```

기록 (2026-11-18): 처음 버전 58/74 (78%) → 전처리·언어별 두 번 읽기·JOMO 해석 규칙 적용 후 71/74 (96%)

실제 화면 캡처(out/real_*.png, 저장소에는 올리지 않음): 티웨이·대한항공·에어뉴질랜드 항공권, 에어비앤비·아고다 숙소 예약. 개인 정보가 있어 tests/receipt.test.ts에 읽힌 글자만 옮겨 시험한다.
