#!/usr/bin/env python3
"""Final audio mix for the trailer.

Stems (48 kHz):
  audio/music/score.wav      original score (timed to docs/CUESHEET.md)
  build/game.wav             the game's own synthesized SFX / voices / ambience, recorded on trailer
                             time by the renderer (tools/render.mjs --audio)
  audio/tts/nXX.wav          narration (start times from audio/tts/lines.json)
  audio/sfx/*.wav            trailer-only accents (cue list below)

Music and game sound duck under the narration. The master gets a soft clipper + peak limiter here;
loudness normalisation (-14 LUFS, -1 dBTP) is done by ffmpeg in tools/build.sh.

Usage: python tools/mix.py [--game build/game.wav] [--out build/mix.wav]
"""
import argparse
import json
import os

import numpy as np
import soundfile as sf
from scipy.signal import resample_poly

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SR = 48000
DUR = 97.0
N = int(SR * DUR)

# Trailer accents: (file, time in s, gain dB, pan -1..1). Times line up with the picture/sim events
# measured by tools/probe.ts (e.g. the rubber duck is picked up at 47.03 s).
SFX_CUES = [
    ("sparkle.wav", 9.87, -16, 0.0),
    ("sparkle.wav", 11.20, -15, 0.2),
    ("sparkle.wav", 12.60, -12, -0.1),
    ("stop_hit.wav", 14.10, -14, 0.0),
    ("paper_flip.wav", 20.10, -10, 0.0),
    ("pencil_scribble.wav", 20.22, -14, 0.0),
    ("pencil_strike.wav", 21.05, -9, 0.0),
    # montage list: a pencil tick for every completed line
    ("pencil_strike.wav", 22.63, -15, -0.6),
    ("pencil_strike.wav", 27.18, -15, -0.6),
    ("pencil_strike.wav", 31.28, -15, -0.6),
    ("pencil_strike.wav", 36.53, -15, -0.6),
    ("pencil_strike.wav", 39.83, -15, -0.6),
    ("pencil_strike.wav", 43.55, -15, -0.6),
    ("pencil_strike.wav", 44.43, -15, -0.6),
    ("whoosh_short.wav", 45.86, -15, 0.0),
    ("squeak.wav", 47.03, -9, 0.15),
    ("pencil_scribble.wav", 46.55, -20, 0.4),
    ("pencil_scribble.wav", 48.55, -20, 0.4),
    ("sparkle.wav", 53.37, -12, 0.1),
    ("pencil_strike.wav", 53.45, -15, -0.6),
    ("heartbeat.wav", 58.10, -11, 0.0),
    ("sparkle.wav", 60.60, -11, 0.0),
    ("pencil_strike.wav", 60.68, -15, -0.6),
    ("whoosh_short.wav", 65.82, -12, 0.0),
    ("impact_soft.wav", 66.10, -10, 0.0),
    ("whoosh_long.wav", 81.20, -16, 0.0),
    ("whoosh_reverse.wav", 82.60, -10, 0.0),
    ("impact_big.wav", 84.10, -6, 0.0),
    ("pencil_scribble.wav", 89.05, -20, 0.5),
    ("squeak.wav", 96.45, -8, 0.0),
]

MUSIC_DB = -1.0
GAME_DB = 0.0
# Per-section trims for the game stem: (start, end, dB).
GAME_AUTOMATION = [(16.1, 20.1, -3), (46.1, 50.1, -3), (50.1, 58.1, -2), (58.1, 60.6, -6), (84.1, 92.1, -3), (92.1, 97.0, 4)]
VOICE_DB = 0.0
DUCK_MUSIC_DB = -7.0
DUCK_GAME_DB = -4.0


def load(path):
    x, sr = sf.read(path, always_2d=True, dtype="float64")
    if sr != SR:
        g = np.gcd(sr, SR)
        x = resample_poly(x, SR // g, sr // g, axis=0)
    if x.shape[1] == 1:
        x = np.repeat(x, 2, axis=1)
    return x[:, :2]


def db(v):
    return 10 ** (v / 20)


def place(bus, x, t, gain_db=0.0, pan=0.0):
    i = int(round(t * SR))
    if i >= len(bus):
        return
    x = x * db(gain_db)
    if pan:
        l = np.cos((pan + 1) * np.pi / 4) * np.sqrt(2)
        r = np.sin((pan + 1) * np.pi / 4) * np.sqrt(2)
        x = x * np.array([l, r])
    n = min(len(x), len(bus) - i)
    bus[i : i + n] += x[:n]


def envelope(x, attack=0.03, release=0.35):
    mono = np.abs(x).max(axis=1)
    a = np.exp(-1 / (attack * SR))
    r = np.exp(-1 / (release * SR))
    env = np.zeros_like(mono)
    e = 0.0
    # vectorised enough for 97 s
    for i in range(0, len(mono), 64):
        blk = mono[i : i + 64].max()
        e = a * e + (1 - a) * blk if blk > e else r**64 * e + (1 - r**64) * blk
        env[i : i + 64] = e
    return env


def limiter(x, ceiling_db=-1.0, lookahead=0.005, release=0.08):
    ceil = db(ceiling_db)
    peak = np.abs(x).max(axis=1)
    la = int(lookahead * SR)
    # running max over the lookahead window
    from scipy.ndimage import maximum_filter1d

    pk = maximum_filter1d(peak, size=2 * la + 1)
    gain = np.minimum(1.0, ceil / np.maximum(pk, 1e-9))
    # smooth release
    rel = np.exp(-1 / (release * SR))
    g = np.empty_like(gain)
    cur = 1.0
    for i in range(len(gain)):
        cur = gain[i] if gain[i] < cur else rel * cur + (1 - rel) * gain[i]
        g[i] = cur
    out = np.roll(x, -la, axis=0) * g[:, None]
    return np.roll(out, la, axis=0)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--game", default=os.path.join(ROOT, "build", "game.wav"))
    ap.add_argument("--out", default=os.path.join(ROOT, "build", "mix.wav"))
    ap.add_argument("--stems", default=os.path.join(ROOT, "build", "stems"))
    a = ap.parse_args()

    music = np.zeros((N, 2))
    game = np.zeros((N, 2))
    voice = np.zeros((N, 2))
    fx = np.zeros((N, 2))

    place(music, load(os.path.join(ROOT, "audio", "music", "score.wav")), 0.0, MUSIC_DB)
    if os.path.exists(a.game):
        place(game, load(a.game), 0.0, GAME_DB)
    else:
        print("warning: no game audio at", a.game)

    lines = json.load(open(os.path.join(ROOT, "audio", "tts", "lines.json")))
    for ln in lines:
        place(voice, load(os.path.join(ROOT, "audio", "tts", ln["file"])), ln["start_seconds"], VOICE_DB)

    for f, t, g, p in SFX_CUES:
        place(fx, load(os.path.join(ROOT, "audio", "sfx", f)), t, g, p)

    # Section trims (0.25 s ramps).
    gain = np.ones(N)
    for t0, t1, g in GAME_AUTOMATION:
        i0, i1 = int(t0 * SR), int(t1 * SR)
        gain[i0:i1] *= db(g)
    from scipy.ndimage import uniform_filter1d
    gain = uniform_filter1d(gain, int(0.25 * SR))
    game *= gain[:, None]

    # Ducking under narration.
    env = envelope(voice)
    k = np.clip(env / (env.max() * 0.25 + 1e-9), 0, 1)
    music *= (1 + (db(DUCK_MUSIC_DB) - 1) * k)[:, None]
    game *= (1 + (db(DUCK_GAME_DB) - 1) * k)[:, None]

    os.makedirs(a.stems, exist_ok=True)
    for name, bus in (("music", music), ("game", game), ("voice", voice), ("fx", fx)):
        sf.write(os.path.join(a.stems, name + ".wav"), bus.astype(np.float32), SR, subtype="FLOAT")

    mix = music + game + voice + fx
    # gentle soft clip then limiter
    mix = np.tanh(mix * 0.9) / 0.9
    mix = limiter(mix, -1.0)
    sf.write(a.out, mix.astype(np.float32), SR, subtype="FLOAT")
    print("wrote", a.out, "peak", 20 * np.log10(np.abs(mix).max() + 1e-12), "dBFS")


if __name__ == "__main__":
    main()
