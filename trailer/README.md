# 《완벽한 불청객》 트레일러

**완성본:** `out/perfect-uninvited-guest-trailer.mp4` — 1920×1080, 30fps, H.264 + AAC 320k, 97초, -14 LUFS

원본 게임 코드·자산·규칙은 한 줄도 건드리지 않았습니다. 이 폴더의 모든 것은 `../src`의 게임 모듈을 **읽기 전용으로 import**해서 실제 시뮬레이션을 돌리고, 카메라·타이포그래피·사운드만 트레일러용으로 따로 얹습니다.

## 무엇을 보여주나
"같은 목표, 여러 방법". 우아한 파티 → 초대장 없는 불청객 → 7가지 공략 몽타주 → 하나의 완벽한 계획(가짜 오리 바꿔치기) → 예상 못 한 발각(회장의 투어) → 소동 속 탈출 → 타이틀 → 쿠키(지각한 손님).
컷 구성과 이유는 `docs/SCENARIO.md`, 타이밍 기준표는 `docs/CUESHEET.md`에 있습니다.

## 어떻게 만들었나
| 단계 | 방식 | 파일 |
|---|---|---|
| 연출 | 샷마다 시드 고정된 `World`를 새로 만들고, 화면 밖에서 원하는 순간까지 빨리 감은 뒤(`setup`), 화면 안에서는 실제 플레이어 입력(이동 벡터·웅크리기·E 상호작용)으로 플레이어를 움직임(`script`) | `src/shots.ts`, `src/bot.ts` |
| 화면 | 게임의 `LevelView`/`CharacterModel`/`ItemView`/`FxView`를 그대로 쓰고 카메라만 시네마틱으로 교체. 틸트시프트·블룸·그레이드 후처리 | `src/TrailerView.ts`, `src/cam.ts`, `src/post.ts` |
| 말풍선·아이콘 | 게임 CSS(`src/style.css`) 그대로, 1080p에 맞게 확대 + 화면 밖으로 나가지 않게 고정 | `src/overlay.ts` |
| 타이포 | 게임의 손글씨 할 일 목록(Gaegu)·타이틀 로고 스타일 | `src/titles.ts`, `src/trailer.css` |
| 렌더 | 헤드리스 Chrome에서 프레임 단위(1/30초, 시뮬레이션은 1/60초 2스텝)로 결정적 렌더 → ffmpeg 파이프 | `tools/render.mjs` |
| 게임 사운드 | 게임의 Web Audio 합성기(`src/audio/Audio.ts`)를 **트레일러 시간으로 도는 OfflineAudioContext**에 녹음 — 발소리·휘파람·차단기·무전·말소리가 프레임과 정확히 일치 | `src/offlineAudio.ts` |
| 음악 | 오리지널 오케스트라 스코어(파이썬 → MIDI → FluidSynth, MuseScore_General MIT 사운드폰트) | `audio/music/` |
| 내레이션 | Supertone Supertonic 3 (OpenRAIL-M), 음성 M2, Whisper로 발음 검증 | `audio/tts/` |
| 트레일러 효과음 | 전부 numpy로 절차적 합성(샘플 없음) | `audio/sfx/` |
| 믹스 | 음악·게임음·내레이션·효과음, 내레이션 덕킹, 리미터 → ffmpeg 2-pass loudnorm | `tools/mix.py` |

## 다시 만들기
```sh
cd trailer
./tools/build.sh            # 영상+게임음 렌더(약 10분) → 믹스 → 라우드니스 → out/*.mp4
```
필요: 저장소의 `node_modules`(vite, three, playwright-core), Google Chrome, ffmpeg, Python 3(numpy·scipy·soundfile — 없으면 `.venv-mix`를 자동 생성).
음악·내레이션·효과음은 이미 렌더된 WAV를 씁니다. 처음부터 다시 만들려면 각 폴더의 README 참고.

### 작업용 도구
- `npx vite --config vite.config.ts` 후 `node tools/render.mjs --stills build/stills --step 15` — 0.5초 간격 스틸
- `node tools/sheet.mjs build/stills build/sheets` — 컨택트 시트
- `npx vite-node tools/probe.ts <샷ID> [정규식]` — 브라우저 없이 샷을 엔진과 똑같이 돌려 어떤 대사·이벤트가 몇 초에 일어나는지 출력 (컷 타이밍을 맞출 때 사용)
- `tools/research/` — 각 공략이 실제 시뮬레이션에서 되는지 확인했던 실험 스크립트

## 정직성 메모 — 실제 게임과 트레일러 연출의 경계
- 화면 속 모든 행동·반응·대사는 실제 게임 시뮬레이션이 만든 것입니다. 대사는 게임 콘텐츠(`src/sim/level/content.ts` 등)에 있는 문장이 해당 상황에서 실제로 나온 것이며, 글자를 지어낸 말풍선은 없습니다.
- 트레일러 편의를 위한 조작(모두 화면 밖): 샷 시작 전 플레이어 위치 이동(텔레포트), 공략에 필요한 소지품 지급(예: 수면제·라이터·가짜 오리), 같은 세계 안에서의 시간 건너뛰기(컷), 슬로모션.
- 트레일러 전용 표현: 시네마틱 카메라·후처리, 크게 그린 불꽃(위치·타이밍은 게임의 불꽃 이벤트 그대로), 같은 순간 겹친 두 대사를 순서대로 보여주기, 손글씨 자막과 할 일 카드(게임의 할 일 목록 문구 사용, 일부 몽타주 라벨은 트레일러용 문구), 결말 배너는 게임의 탈출 배너 디자인.
- 게임 플레이 UI(미니맵·조작 안내·상호작용 마커·플레이어 링)는 숨겼습니다.
- 내레이션은 AI 합성 음성이며 영상 엔드카드와 파일 메타데이터에 표기했습니다(모델 라이선스 요구사항).

## 크레딧 / 라이선스
- 음악: 오리지널 작곡(이 저장소), 사운드폰트 MuseScore_General v0.2 — MIT
- 내레이션: Supertone Supertonic 3 (BigScience OpenRAIL-M), 출력물 권리 주장 없음, AI 생성 표기 필요
- 효과음: 게임 자체 합성음 + 이 폴더에서 절차적으로 합성한 효과음
- 폰트: Gaegu, Jua, Gowun Batang (Google Fonts, SIL OFL) — 렌더 시 Google Fonts에서 로드
