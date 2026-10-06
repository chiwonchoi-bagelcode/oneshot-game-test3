#!/usr/bin/env bash
# Rebuild the trailer MP4 from source:
#   frames + the game's own audio (headless Chrome, frame by frame) → mix → loudness → mux.
# Requirements: Node (repo's node_modules), Google Chrome, ffmpeg, Python 3 with numpy/scipy/soundfile.
# Music, narration and trailer SFX are pre-rendered by audio/{music,tts,sfx}/ (see their READMEs).
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p build out

PY=${PY:-}
if [ -z "$PY" ]; then
  if [ ! -x .venv-mix/bin/python ]; then
    python3 -m venv .venv-mix && .venv-mix/bin/pip install -q -r tools/requirements.txt
  fi
  PY=.venv-mix/bin/python
fi

# 1) Dev server for the renderer page (imports the game's modules from ../src, read-only).
npx vite --config vite.config.ts > build/vite.log 2>&1 &
VITE=$!
trap 'kill $VITE 2>/dev/null || true' EXIT
for i in $(seq 1 50); do curl -s -o /dev/null http://localhost:5310/ && break; sleep 0.2; done

# 2) Picture (lossless-ish intermediate) + the game's synthesized SFX recorded on trailer time.
node tools/render.mjs --video build/video.mp4 --audio build/game.wav --preset slow --crf 12

# 3–5) Mix, loudness, mux.
tools/finalize.sh "$PY"
