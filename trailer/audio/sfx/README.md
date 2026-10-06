# Trailer SFX pack — 완벽한 불청객

Original, procedurally synthesized non-diegetic trailer SFX (no samples).
48 kHz / 24-bit / stereo WAV, true-peak normalized to -1.2 dBTP, DC-free, faded edges.

Regenerate (deterministic, fixed seed):

```sh
uv venv --python 3.12 trailer/.venv-sfx && uv pip install --python trailer/.venv-sfx/bin/python numpy scipy soundfile
trailer/.venv-sfx/bin/python trailer/audio/sfx/make_sfx.py
```

## Files (measured by make_sfx.py)

`onset` = first transient by log spectral-flux onset detection (refined to -12 dB of local max);
`loudest` = centre of the loudest 10 ms RMS window. The **key** column is the time to sync on.

| file | description | duration | key sync point | onset | loudest | peak dBFS | true peak dBTP | lead silence | ok |
|---|---|---|---|---|---|---|---|---|---|
| `whoosh_short.wav` | airy swish for a quick cut | 0.450 s | peak at 0.302 s | 0.038 s | 0.302 s | -1.21 | -1.20 | 9.1 ms | yes |
| `whoosh_long.wav` | big swoosh, rising then passing | 1.200 s | peak at 0.897 s | 0.002 s | 0.897 s | -1.30 | -1.20 | 0.9 ms | yes |
| `whoosh_reverse.wav` | reverse-cymbal swell, hard stop at 1.500 s | 1.500 s | hard cut at 1.500 s (loudest 1.492 s) | 0.050 s | 1.492 s | -1.90 | -1.20 | 105.6 ms | yes |
| `impact_big.wav` | title slam: sub drop + transient + long tail | 3.800 s | transient at 0.001 s | 0.001 s | 0.015 s | -1.25 | -1.20 | 0.1 ms | yes |
| `impact_soft.wav` | warm thump for text cards | 1.200 s | transient at 0.001 s | 0.001 s | 0.045 s | -1.21 | -1.20 | 0.2 ms | yes |
| `riser_4s.wav` | tension riser, loudest at the 4.000 s cut | 4.000 s | hard cut at 4.000 s (loudest 3.993 s) | 0.011 s | 3.993 s | -3.31 | -1.20 | 11.0 ms | yes |
| `stop_hit.wav` | comedic tape-stop 'everything stops' hit | 0.350 s | transient at 0.000 s | 0.000 s | 0.013 s | -1.21 | -1.20 | 0.1 ms | yes |
| `pencil_scribble.wav` | handwriting on paper | 1.400 s | starts at 0.000 s (stroke rhythm through ~1.38 s) | 0.000 s | 1.039 s | -1.21 | -1.20 | 0.0 ms | yes |
| `pencil_strike.wav` | quick decisive pencil line (cross-off) | 0.350 s | transient at 0.000 s | 0.000 s | 0.208 s | -1.21 | -1.20 | 0.0 ms | yes |
| `paper_flip.wav` | paper card flick/slide | 0.400 s | transient at 0.000 s | 0.000 s | 0.005 s | -2.15 | -1.20 | 0.0 ms | yes |
| `sparkle.wav` | golden glint shimmer | 1.200 s | transient at 0.000 s | 0.000 s | 0.527 s | -1.21 | -1.20 | 0.1 ms | yes |
| `tick_tock.wav` | clock ticks, 120 bpm eighths (0.25 s grid) | 4.000 s | 16 hits, first 0.000 s: 0.000, 0.250, 0.500, 0.750, 1.000, 1.250, 1.500, 1.750, 2.000, 2.250, 2.500, 2.750, 3.000, 3.250, 3.500, 3.750 | 0.000 s | 1.755 s | -1.26 | -1.20 | 0.0 ms | yes |
| `heartbeat.wav` | sub heartbeat lub-dub every 1.0 s | 4.000 s | 8 hits, first 0.002 s: 0.002, 0.303, 1.002, 1.303, 2.002, 2.303, 3.002, 3.303 | 0.002 s | 1.014 s | -1.21 | -1.20 | 0.1 ms | yes |
| `squeak.wav` | rubber duck squeak | 0.300 s | transient at 0.006 s | 0.006 s | 0.117 s | -1.26 | -1.20 | 0.2 ms | yes |
| `ding_success.wav` | 'plan worked' chime | 0.800 s | transient at 0.000 s | 0.000 s | 0.093 s | -1.23 | -1.20 | 0.1 ms | yes |
| `typewriter_tick.wav` | tiny UI tick for text characters | 0.050 s | transient at 0.000 s | 0.000 s | 0.005 s | -1.21 | -1.20 | 0.0 ms | yes |
| `camera_flash.wav` | bright flash/pop accent | 0.250 s | transient at 0.000 s | 0.000 s | 0.005 s | -1.89 | -1.20 | 0.0 ms | yes |

Notes: whooshes, `whoosh_reverse`, `riser_4s`, `tick_tock` and `heartbeat` keep their exact
timing grid (no leading-silence trim), so their leading silence is intentional/zero. All other files
start within 5 ms. `heartbeat` lubs begin at the exact second (sample 0, 1 s, ...); the ~2 ms
measured offset is the soft 6 ms attack reaching -12 dB of its peak. Levels are peak-normalized
for a library; set relative levels in the edit.
