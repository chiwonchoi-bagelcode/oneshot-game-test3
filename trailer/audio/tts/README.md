# Trailer narration (Korean TTS)

Final files: `n01.wav` … `n12.wav` (48 kHz, 24-bit PCM, mono), one voice throughout.
Per-line metadata (text, duration, ASR transcript, seed/settings, loudness) is in `lines.json`.
Alternate voices for comparison: `alt/M5/`, `alt/M3/` (same processing, each with its own `lines.json`).

## Model

- **Supertone Supertonic 3** (open-weight ONNX TTS, ~99M params, CPU, 31 languages incl. Korean)
  - Weights: https://huggingface.co/Supertone/supertonic-3
    at revision `724fb5abbf5502583fb520898d45929e62f02c0b` ("Initial Supertonic 3 release", 2026-05-06).
    This is the revision pinned by the SDK. Later commits on `main`, up to `3cadd1ee`, only change the README and audio samples. The weights are the same.
  - Python SDK: https://pypi.org/project/supertonic/ `supertonic==1.3.1` (MIT)
  - Code: https://github.com/supertone-inc/supertonic (sample code MIT)
  - Voice descriptions: https://github.com/supertone-oss-archive/supertonic-py/blob/main/docs/voices.md
- **License: BigScience OpenRAIL-M** (https://huggingface.co/Supertone/supertonic-3/blob/main/LICENSE).
  - §6: "Licensor claims no rights in the Output You generate". Commercial and promotional use of the audio is allowed, subject to the use restrictions in Attachment A.
  - **Attachment A (e)** forbids disseminating generated content "without expressly and intelligibly disclaiming that the information and/or content is machine generated". **The trailer's credits or video description must say the narration is AI/TTS-generated** (e.g. "Narration: AI voice (Supertone Supertonic 3)").
  - (g) forbids impersonating real people. The preset voices are not tied to any real person.

## Voice

**Chosen: `M2`.** Supertone describes it as a "deep, robust male voice; calm, composed, and serious … documentaries". It is the closest preset to the brief: a low, warm, deadpan heist-documentary narrator, with a median F0 of about 90 Hz. Its seed-1 render of every line was transcribed perfectly by ASR, and it was the only one of the 5 male presets that had no ASR error in the first exploration pass.

Alternates rendered:
- `M5`, "warm, soft-spoken storytelling", about 84 Hz, the lowest. It sounds softer and sleepier. "재우거나" tends to be heard as "채우거나", and it needed seed 4 to pass.
- `M3`, "polished, authoritative", about 99 Hz. It is crisper and more presenter-like. "꾀어내거나" was heard as "뾰어내거나" until seed 3.

M1 (about 142 Hz, upbeat) and M4 (soft, youthful) were rejected as too bright.

## Processing (see `make_tts.py`)

1. Synthesis: `lang="ko"`, `total_steps=32`, fixed `np.random.seed` per line so output is reproducible. Seeds are tried in order (1…12), and the first render that passes ASR (CER 0 on Hangul) and the length limit is kept.
2. Speed: n03–n07 at 1.00, n08–n09 at 1.05, n02 at 0.95, n01/n10 at 0.92, n12 at 0.90, n11 at 0.88 (more deliberate on the title lines).
3. Ellipses: the model only leaves a very short gap at "...", so n01 and n10 are synthesized as two phrases joined with digital silence of **0.50 s** ("초대장은... | 없다.") and **0.45 s** ("아니면... | 아무도 모르게."). n12 keeps the model's own sentence break of about 0.2 s.
4. Head and tail are trimmed to 30 ms of silence, with a 3 ms fade-in and 15 ms fade-out. Audio is resampled from 44.1k to 48k with soxr VHQ.
5. Loudness: pre-gain to -23 LUFS, then an ffmpeg `acompressor` (4:1, -28 dBFS, 3/70 ms, RMS), then make-up gain to **-16 LUFS integrated**, then a look-ahead true-peak limiter to **≤ -1.5 dBTP**. The result is checked with ffmpeg `ebur128`. ffmpeg `loudnorm` was tried first, but on clips shorter than 3 s it always falls back to its dynamic mode and landed 1–3 LU off target.
6. ASR check: `mlx-whisper` 0.4.3 with `mlx-community/whisper-large-v3-turbo`, Korean, temperature 0.

## Result (M2)

| id | dur (s) | limit (s) | ASR transcript | LUFS | dBTP |
|---|---|---|---|---|---|
| n01 | 1.70 | ~2 | 초대장은 없다. | -16.0 | -1.8 |
| n02 | 2.61 | ~3.4 | 괜찮아. 황금 오리만 가져가면 되니까. | -16.0 | -1.8 |
| n03 | 0.73 | 1.3 | 섞여들거나 | -16.0 | -2.5 |
| n04 | 0.71 | 1.3 | 꾀어내거나 | -16.0 | -2.6 |
| n05 | 0.75 | 1.3 | 불을 끄거나 | -16.0 | -1.7 |
| n06 | 0.60 | 1.3 | 재우거나 | -16.0 | -2.1 |
| n07 | 0.95 | 1.3 | 급하게 만들거나 | -16.0 | -1.8 |
| n08 | 0.87 | 1.2 | 슬쩍하거나 | -15.7 | -1.8 |
| n09 | 0.93 | 1.2 | 판을 키우거나 | -16.0 | -1.8 |
| n10 | 1.72 | ~3 | 아니면 아무도 모르게 | -16.0 | -1.8 |
| n11 | 1.08 | ~2.4 | 완벽한 불청객 | -15.9 | -2.1 |
| n12 | 1.70 | ~3 | 길은 여럿, 오리는 하나. | -16.0 | -1.8 |

Durations include the 30 ms head and tail pads. No raw model output clipped; the highest raw peak was 0.79.

## Rerun

```bash
# from the repo root
uv venv --python 3.12 trailer/.venv-tts
uv pip install --python trailer/.venv-tts/bin/python \
    supertonic==1.3.1 mlx-whisper==0.4.3 pyloudnorm==0.2.0 soxr numpy soundfile librosa
trailer/.venv-tts/bin/python trailer/audio/tts/make_tts.py            # M2 + alts (~5 min on M4)
trailer/.venv-tts/bin/python trailer/audio/tts/make_tts.py --only main
```

The first run downloads the Supertonic weights (~385 MB) into `trailer/.venv-tts/models`, which is git-ignored, and the Whisper weights (~1.6 GB) into `~/.cache/huggingface`.
To change a line's text, speed, pause or limit, edit the `LINES` table at the top of `make_tts.py`. To switch voices, change `MAIN_VOICE` / `ALT_VOICES`.
