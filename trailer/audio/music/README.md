# 트레일러 오리지널 스코어

- `score.wav` — 48 kHz 스테레오, 정확히 97.000초, -14.1 LUFS / -1.3 dBTP
- `score.mid` — 전체 MIDI (2,188 노트, 열린 노트 없음)
- `stems/` — low / mid / high / perc 스템
- `compose.py` (+ `musiclib.py`) — 작곡·렌더·후처리·검증을 처음부터 재현
- `analysis.json` — 측정 결과 (구간별 레벨, 히트 타이밍, 무음 구간)

## 재생성
```sh
brew install fluidsynth ffmpeg
python3 -m venv trailer/.venv-music
trailer/.venv-music/bin/pip install numpy scipy soundfile mido pyloudnorm
trailer/.venv-music/bin/python trailer/audio/music/compose.py
```
사운드폰트는 첫 실행 때 자동으로 받습니다(git 제외).

## 사운드폰트
MuseScore_General.sf2 v0.2 (S. Christian Collins, FluidR3 기반) — **MIT 라이선스**  
https://ftp.osuosl.org/pub/musescore/soundfont/MuseScore_General/MuseScore_General.sf2

## 구성 (docs/CUESHEET.md 그리드)
하나의 메인 테마("불청객의 왈츠", F장조: C–C# 반음 픽업 → D → 6도 도약 Bb → A–G–E → F)를 섹션마다 변주합니다.

| 구간 | 내용 |
|---|---|
| 0.60–14.10 | 3/4 왈츠(피아노·현·피치카토·하프). 9.6s부터 황금 오리 공개: bVI(Db) → V(b9) → 12.60s F/A "황금" 화음, 14.10s 칼같이 정지 |
| 14.10–16.10 | 개그 정적, 14.25s 피치카토 "퉁" + 바순 |
| 16.10–22.10 | D 도리안으로 몰래 들어오는 테마(클라리넷/바순, 핑거 스냅) |
| 22.10–46.10 | 브러시 드럼 하이스트 그루브 + 뮤트 트럼펫. 컷 다운비트마다 액센트 |
| 46.10–50.10 | 첼레스타 "고무 오리" 모티프 + 우드블록 시계 |
| 50.10–58.10 | 16분 현 오스티나토 + 팀파니 빌드업 |
| 58.10–62.10 | 하모닉스 + 심장박동, 60.60s 성공 스팅 |
| 66.10 | 오케스트라 스탭(발각) |
| 68.10–78.10 | D단조 추격 (브라스 테마, 탐, 16분 현) |
| 78.10–84.10 | 장조 승리 테마 → 84.10s 타이틀 히트 |
| 92.10–97.00 | 무음, 96.20s 바순 한 음 |

## 측정된 히트 (목표 → 실측)
22.10→22.102 · 26.10→26.101 · 30.10→30.100 · 34.10→34.102 · 38.10→38.100 · 42.10→42.100 · 44.10→44.105 · 60.60→60.601 · 66.10→66.100 · 84.10→84.103
