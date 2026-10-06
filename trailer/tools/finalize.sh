#!/usr/bin/env bash
# Steps after rendering: mix → loudness (two-pass EBU R128, -14 LUFS / -1 dBTP) → mux the MP4.
# Usage: tools/finalize.sh [python]   (python needs numpy, scipy, soundfile)
set -euo pipefail
cd "$(dirname "$0")/.."
PY=${1:-${PY:-python3}}
mkdir -p out

# 3) Mix music + game sound + narration + trailer accents.
"$PY" tools/mix.py --game build/game.wav --out build/mix.wav

# 4) Loudness: two-pass EBU R128 to -14 LUFS integrated, -1 dBTP.
STATS=$(ffmpeg -hide_banner -nostats -i build/mix.wav -af loudnorm=I=-14:TP=-1.0:LRA=11:print_format=json -f null - 2>&1 | sed -n '/^{/,/^}/p')
mi=$(echo "$STATS" | "$PY" -c 'import json,sys;d=json.load(sys.stdin);print(d["input_i"],d["input_tp"],d["input_lra"],d["input_thresh"],d["target_offset"])')
read -r II ITP ILRA ITH OFF <<<"$mi"
ffmpeg -y -hide_banner -loglevel error -i build/mix.wav \
  -af "loudnorm=I=-14:TP=-1.0:LRA=11:measured_I=$II:measured_TP=$ITP:measured_LRA=$ILRA:measured_thresh=$ITH:offset=$OFF:linear=true,aresample=48000" \
  -ar 48000 -c:a pcm_s24le build/mix_norm.wav

# 5) Final delivery: H.264 High, yuv420p, AAC 320k, faststart.
ffmpeg -y -hide_banner -loglevel error -i build/video.mp4 -i build/mix_norm.wav \
  -map 0:v:0 -map 1:a:0 -c:v libx264 -preset slow -crf 16 -pix_fmt yuv420p -profile:v high -tune animation \
  -c:a aac -b:a 320k -movflags +faststart -shortest \
  -metadata title="완벽한 불청객 — 트레일러" -metadata comment="Narration: AI voice (Supertone Supertonic 3, voice M2)" \
  out/perfect-uninvited-guest-trailer.mp4
echo "done → out/perfect-uninvited-guest-trailer.mp4"
