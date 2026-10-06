#!/usr/bin/env python3
"""
compose.py - original score for the 97 s trailer of
"완벽한 불청객 (The Perfect Uninvited Guest)".

Reproduces score.mid, score.wav (48 kHz / stereo / exactly 97.000 s) and stems/
from scratch. Timing follows trailer/docs/CUESHEET.md to the sample.

Install (macOS / Homebrew):
    brew install fluidsynth ffmpeg
    /opt/homebrew/bin/python3 -m venv trailer/.venv-music
    trailer/.venv-music/bin/pip install numpy scipy soundfile mido pyloudnorm
    # soundfont (MIT): fetched automatically on first run into
    #   trailer/audio/music/soundfont/MuseScore_General.sf2   (git-ignored)

Run:
    trailer/.venv-music/bin/python trailer/audio/music/compose.py
    (writes score.mid, score.wav, stems/*.wav, analysis.json; renders cached in cache/)

Musical plan (details in README.md):
    One main theme, "the Guest's waltz" (F major): chromatic pickup C-C#, then D,
    a leap of a sixth up to Bb, a falling A-G-E, home to F.
      S1   elegant 3/4 waltz on piano (F), golden reveal on bVI (Db) -> V(b9) -> F/A
      S3-5 the same motif sneaking in D dorian (A-A#-B-G...) on muted trumpet /
           clarinet over a brushed caper groove with a walking pizzicato bass
      S6   celesta "rubber duck" motif (chromatic squeak + quack)
      S11  theme in D minor, brass over 16th strings and toms
      S12  theme in major (Bb -> F), full orchestra, into the 84.10 title hit
"""
from __future__ import annotations

import json
import subprocess
import sys
import urllib.request
from pathlib import Path

import numpy as np
import soundfile as sf

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from musiclib import (B, NSAMP, P, PS, Q, SR, W, Track, convolve_region,  # noqa: E402
                      db, detect_onset_near, gate_envelope, glue_compressor_gain,
                      humanize, lufs, make_hall_ir, measure_latencies, render_jobs, rms_env, true_peak,
                      tp_limiter_gain, undb, write_score_midi)

SF2 = HERE / "soundfont" / "MuseScore_General.sf2"
SF2_URL = "https://ftp.osuosl.org/pub/musescore/soundfont/MuseScore_General/MuseScore_General.sf2"
CACHE = HERE / "cache"

# Cue-sheet hit points (must be exact) and other structural downbeats kept un-humanised
HITS = [22.10, 26.10, 30.10, 34.10, 38.10, 42.10, 44.10, 60.60, 66.10, 84.10]
EXACT = HITS + [0.60, 12.60, 14.25, 16.10, 46.10, 50.10, 58.10, 62.10, 68.10, 70.10,
                72.10, 74.10, 76.10, 78.10, 80.10, 82.10, 90.10, 91.10, 96.20]

# Gate groups: which section a note belongs to (by its start time) and how that
# section's audio (incl. reverb) is gated. windows = (start, end, fade_out_after_end)
GATE_GROUPS = {
    "s1":    dict(span=[(0.0, 14.10)],                 windows=[(0.0, 14.10, 0.08)]),
    "comic": dict(span=[(14.10, 16.10), (92.10, 97.0)], windows=[(14.10, 16.05, 0.05), (96.0, 96.92, 0.08)]),
    "mainA": dict(span=[(16.10, 46.10)],               windows=[(16.10, 45.85, 0.02)]),
    "s7":    dict(span=[(50.10, 58.10)],               windows=[(50.10, 58.10, 0.12)]),
    "mainB": dict(span=[(46.10, 50.10), (58.10, 92.10)], windows=[(46.10, 91.20, 0.90)]),
}


def group_of(t: float) -> str:
    for g, d in GATE_GROUPS.items():
        for a, b in d["span"]:
            if a <= t < b:
                return g
    raise ValueError(t)


# =========================================================================== tracks
TR: list[Track] = []


def T(*a, **k) -> Track:
    t = Track(*a, **k)
    TR.append(t)
    return t


pno = T("Piano", 0, pan=54, send=0.30, stem="mid", sustain_pedal=True, gain_db=2)
strP = T("Strings legato", 48, pan=62, send=0.42, stem="mid", gain_db=-1)
strL = T("Low strings", 48, pan=74, send=0.35, stem="low", gain_db=-2)
strS = T("Strings spiccato", 48, pan=56, send=0.26, stem="mid", gain_db=-3)
strH = T("Violin harmonics", 49, pan=48, send=0.60, stem="high", gain_db=-4)
trem = T("Strings tremolo", 44, pan=66, send=0.42, stem="mid", gain_db=-2)
cb = T("Contrabasses", 43, pan=76, send=0.30, stem="low", gain_db=-3)
pizz = T("Pizzicato strings", 45, pan=60, send=0.26, stem="low", gain_db=1)
harp = T("Harp", 46, pan=36, send=0.45, stem="mid", gain_db=-5)
cel = T("Celesta", 8, pan=82, send=0.45, stem="high", gain_db=0)
glk = T("Glockenspiel", 9, pan=86, send=0.40, stem="high", gain_db=-7)
vib = T("Vibraphone", 11, pan=40, send=0.36, stem="mid", gain_db=-4)
flu = T("Flute", 73, pan=52, send=0.40, stem="high", gain_db=-7)
cla = T("Clarinet", 71, pan=46, send=0.32, stem="mid", gain_db=0)
bsn = T("Bassoon", 70, pan=70, send=0.30, stem="low", gain_db=0)
mtp = T("Muted trumpet", 59, pan=78, send=0.30, stem="mid", gain_db=1)
tpt = T("Trumpets", 56, pan=74, send=0.36, stem="mid", gain_db=-1)
hrn = T("Horns", 60, pan=34, send=0.45, stem="mid", gain_db=-4)
trb = T("Trombones", 57, pan=86, send=0.38, stem="low", gain_db=-8)
tuba = T("Tuba", 58, pan=72, send=0.34, stem="low", gain_db=-5)
timp = T("Timpani", 47, pan=58, send=0.40, stem="perc", gain_db=-2)
brush = T("Brush kit", 40, drum=True, pan=64, send=0.22, stem="perc", gain_db=-3)
kit = T("Room kit", 8, drum=True, pan=64, send=0.26, stem="perc", gain_db=-8)
orch = T("Orchestral percussion", 48, drum=True, pan=64, send=0.42, stem="perc", gain_db=-3)

# GM drum keys
KICK, SIDE, SNARE, SLAP2, SWIRL = 36, 37, 38, 39, 40
TOM_F1, HH_C, TOM_F2, HH_P, TOM_L, HH_O, TOM_M, TOM_HM, CRASH, TOM_H, RIDE = 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51
BELL, CRASH2, RIDE2, WB_HI, WB_LO = 53, 57, 59, 76, 77
O_BD, O_SN, O_CYM1, O_CYM2 = 36, 38, 57, 59      # Orchestra Kit: concert BD / snare / crashes


def chord_pitches(spec):
    return PS(spec) if isinstance(spec, str) else [P(x) for x in spec]


def pedal(track, t_on, t_off):
    track.cc(t_on, 64, 127)
    track.cc(t_off, 64, 0)


def gliss(track, t0, t1, scale_pcs, lo, hi, v0, v1, dur=0.5, exact_first=False, until=None):
    """Harp-style glissando through a scale between MIDI lo..hi (notes damped at `until`)."""
    notes = [p for p in range(P(lo), P(hi) + 1) if p % 12 in scale_pcs]
    n = len(notes)
    for i, p in enumerate(notes):
        x = i / max(1, n - 1)
        t = t0 + (t1 - t0) * x
        d = dur if until is None else min(dur, until - t)
        track.n(t, d, p, round(v0 + (v1 - v0) * x), exact=(exact_first and i == 0))


def roll(track, key, t0, t1, rate, v0, v1, dur=0.06, curve=1.0):
    k = 0
    n = int(round((t1 - t0) / rate))
    for k in range(n):
        x = k / max(1, n - 1)
        track.n(t0 + k * rate, dur, key, round(v0 + (v1 - v0) * x ** curve))


def pcs(names):
    return {P(n + "4") % 12 for n in names.split()}


# ======================================================================= S1 waltz
def s1_waltz():
    # F major, 3/4, q=120, bars 1-9 (0.60-14.10)
    harm = {  # bar: (bass, pizz chord, pad)
        1: ("F2", "A3 C4 F4", "F3 A3 C4"),
        2: ("G2", "Bb3 D4 F4", "G3 Bb3 D4 F4"),
        3: ("C2", "G3 C4 E4", "G3 C4 E4"),
        4: ("F2", "A3 C4 F4", "F3 A3 C4"),
        5: ("Bb1", "A3 D4 F4", "Bb2 F3 A3 D4"),
    }
    for bar, (bass, ch, pad) in harm.items():
        pizz.n(W(bar, 0), 0.45, bass, 80 if bar != 1 else 74)
        pizz.n(W(bar, 1), 0.25, PS(ch), 58)
        pizz.n(W(bar, 2), 0.25, PS(ch), 52)
        strP.n(W(bar, 0), 1.48, PS(pad), 56)
        pno.n(W(bar, 0), 1.4, [P(bass) + 12], 46)                      # LH bass
        harp.n(W(bar, 0), 1.4, P(bass) + 12, 50)
    pizz.n(W(3, 2) + 0.002, 0.25, "Bb3", 50)          # C6 -> C7 on beat 3 (pull to F)
    # bar 6: Gm7 (beats 1-2) -> C7 (beat 3)
    pizz.n(W(6, 0), 0.45, "G2", 80)
    pizz.n(W(6, 1), 0.25, PS("Bb3 D4 F4"), 58)
    pizz.n(W(6, 2), 0.25, "C3", 66)
    pizz.n(W(6, 2), 0.25, PS("Bb3 E4"), 54)
    strP.n(W(6, 0), 0.98, PS("G3 Bb3 D4 F4"), 58)
    strP.n(W(6, 2), 0.48, PS("G3 Bb3 C4 E4"), 60)
    pno.n(W(6, 0), 0.9, "G3", 46)
    pno.n(W(6, 2), 0.45, "C3", 48)
    # harp fills under the long melody notes (8ths, beats 1-2.5)
    fills = {2: "G3 Bb3 D4 F4 G4 Bb4", 4: "F3 A3 C4 F4 A4 C5", 5: "Bb3 D4 F4 A4 D5 F5"}
    for bar, notes in fills.items():
        for i, p in enumerate(PS(notes)):
            harp.n(W(bar, 0.0 + i * 0.5), min(0.9, W(bar + 1, 0) - W(bar, i * 0.5) - 0.02), p, 44 + 3 * i)
    # opening harp flourish (bar 1)
    for i, p in enumerate(PS("F3 A3 C4 F4 A4 C5")):
        harp.n(W(1, 0) + i * 0.08, 1.4 - i * 0.08, p, 48 + 3 * i, exact=(i == 0))
    # strings breathing: expression swells per 2-bar phrase
    strP.cc(0.0, 11, 70)
    for b0 in (1, 3, 5):
        strP.ramp(11, W(b0, 0), W(b0, 2.5), 66, 86)
        strP.ramp(11, W(b0 + 1, 0), W(b0 + 1, 2.8), 86, 70)

    # piano melody (the main theme)
    mel = [  # bar, beat, dur(beats), pitch, vel
        (1, 2.0, 0.5, "C5", 62), (1, 2.5, 0.5, "C#5", 66),
        (2, 0, 1, "D5", 78), (2, 1, 2, "Bb5", 82),
        (3, 0, 1.5, "A5", 76), (3, 1.5, 0.5, "G5", 66), (3, 2, 1, "E5", 70),
        (4, 0, 2, "F5", 74), (4, 2, 0.5, "C5", 60), (4, 2.5, 0.5, "C#5", 64),
        (5, 0, 1, "D5", 78), (5, 1, 2, "A5", 84),
        (6, 0, 1.5, "G5", 78), (6, 1.5, 0.5, "A5", 72), (6, 2, 0.5, "Bb5", 76), (6, 2.5, 0.5, "B5", 80),
        (7, 0, 3, "C6", 88),
        (8, 0, 1, "Bb5", 86), (8, 1, 1, "Db6", 92), (8, 2, 1, "E6", 98),
    ]
    for bar, beat, d, p, v in mel:
        pno.n(W(bar, beat), d * Q * 0.97, p, v)
    # inner sixths/thirds under sustained notes
    for bar, beat, d, p, v in [(2, 1, 2, "D5", 62), (3, 0, 1.5, "C5", 58), (4, 0, 2, "A4", 58),
                               (5, 1, 2, "D5", 64), (6, 0, 1.5, "Bb4", 60), (7, 0, 3, "F5", 66)]:
        pno.n(W(bar, beat), d * Q * 0.97, p, v)
    # violins double the melody for bars 5-6 (lift into the reveal)
    for bar, beat, d, p, v in mel[10:20]:
        strP.n(W(bar, beat), d * Q * 0.98, P(p) - 12, v - 18)
    for bar in range(1, 9):
        pedal(pno, W(bar, 0) + 0.04, W(bar + 1, 0) - 0.03)

    # ---- bar 7 (9.60): the golden duck - Dbmaj7 (bVI), harp gliss, tremolo, sparkle
    db_scale = pcs("Db Eb F Gb Ab Bb C")
    gliss(harp, W(7, 0), W(7, 1.6), db_scale, "Ab2", "F6", 46, 78, dur=0.9, exact_first=True, until=W(8, 0) - 0.03)
    trem.cc(0.0, 11, 40)
    trem.n(W(7, 0), 1.48, PS("Db3 F3 Ab3 C4"), 70)
    trem.ramp(11, W(7, 0), W(7, 2.9), 40, 82)
    cb.n(W(7, 0), 1.48, "Db2", 70)
    pno.n(W(7, 0), 1.4, PS("Db2 Db3"), 62)
    pizz.n(W(7, 0), 0.4, "Db2", 74)
    for i, p in enumerate(PS("F6 Ab5 C7 Db6 Ab6 F5")):
        cel.n(W(7, 0.5 + i * 0.5) - 0.25, 0.4, p, 52 + 4 * i)
    glk.n(W(7, 0), 1.0, "C7", 70)
    # ---- bar 8 (11.10): C7(b9) dominant, crescendo
    c7b9 = pcs("C Db E F G A Bb")
    gliss(harp, W(8, 0), W(8, 2.4), c7b9, "C3", "E6", 56, 96, dur=0.8, until=W(9, 0) - 0.03)
    trem.n(W(8, 0), 1.47, PS("E3 G3 Bb3 Db4"), 92)
    trem.ramp(11, W(8, 0), W(8, 2.8), 82, 110, curve=1.5)
    cb.n(W(8, 0), 1.47, "C2", 86)
    pno.n(W(8, 0), 1.4, PS("C2 C3"), 72)
    strP.n(W(8, 0), 1.47, PS("Bb3 E4 G4"), 70)
    strP.ramp(11, W(8, 0), W(8, 2.8), 70, 106)
    hrn.cc(0.0, 11, 60)
    hrn.n(W(8, 0), 1.47, PS("E4 Bb4"), 86)
    hrn.ramp(11, W(8, 0), W(8, 2.8), 60, 104, curve=1.4)
    trb.cc(0.0, 11, 60)
    trb.n(W(8, 0), 1.47, PS("C3 G3"), 84)
    trb.ramp(11, W(8, 0), W(8, 2.8), 60, 100, curve=1.4)
    for i, p in enumerate(PS("E6 G6 Bb6 Db7 E7 G6")):
        cel.n(W(8, 0.25 + i * 0.5), 0.35, p, 62 + 4 * i)
    for i, p in enumerate(PS("Bb6 Db7 E7")):
        glk.n(W(8, i), 0.5, p, 74 + 6 * i)
    flu.n(W(8, 0), 0.48, "Bb5", 70)
    flu.n(W(8, 1), 0.48, "Db6", 76)
    flu.n(W(8, 2), 0.48, "E6", 84)
    roll(timp, "C2", W(8, 0), W(8, 2.7), 0.0625, 36, 92, dur=0.08, curve=1.6)
    roll(kit, RIDE2, W(8, 0), W(8, 2.7), 0.0625, 18, 76, dur=0.2, curve=1.8)   # sus. cymbal swell
    # ---- bar 9 (12.60): the golden chord F/A, ff, hard stop at 14.10
    t9, d9 = W(9, 0), 14.10 - W(9, 0)
    for tr in (strP, trem, hrn, trb):
        tr.cc(t9 - 0.01, 11, 127)
    strP.n(t9, d9, PS("A2 F3 C4 F4 A4 C5 F5 A5"), 102, exact=True)
    trem.n(t9, d9, PS("F4 A4 C5"), 96, exact=True)
    cb.n(t9, d9, "A1", 102, exact=True)
    hrn.n(t9, d9, PS("F4 A4 C5"), 102, exact=True)
    tpt.n(t9, d9, PS("A4 C5 F5"), 98, exact=True)
    trb.n(t9, d9, PS("A2 F3 C4"), 96, exact=True)
    tuba.n(t9, d9, "A1", 100, exact=True)
    timp.n(t9, d9, "F2", 124, exact=True)
    pno.n(t9, d9, PS("A1 A2 F5 A5 C6 F6"), 104, exact=True)
    pedal(pno, t9 + 0.03, 14.09)
    glk.n(t9, d9, PS("F6 A6 C7 F7"), 104, exact=True)
    cel.n(t9, d9, PS("F6 A6"), 96, exact=True)
    flu.n(t9, d9, "F6", 96, exact=True)
    for i, p in enumerate(PS("A2 F3 C4 F4 A4 C5 F5 A5")):
        harp.n(t9 + i * 0.03, d9 - i * 0.03, p, 92, exact=(i == 0))
    orch.n(t9, d9, O_CYM1, 112, exact=True)
    kit.n(t9, d9, CRASH, 100, exact=True)
    orch.n(t9, d9, O_BD, 112, exact=True)


# =================================================================== S2 + S14 gags
def gags():
    # 14.25: low pizzicato "thunk" + a deflating bassoon "bwomp"
    pizz.n(14.25, 0.35, "F2", 100, exact=True)
    bsn.bend(14.20, 0)
    bsn.n(14.25, 0.34, "F2", 94, exact=True)
    bsn.bend_ramp(14.33, 14.58, 0, -1.6)
    bsn.bend(14.80, 0)
    # 96.20: the last laugh - lowest bassoon note, drooping
    bsn.bend(96.10, 0)
    bsn.n(96.20, 0.46, "Bb1", 104, exact=True)
    bsn.bend_ramp(96.30, 96.66, 0, -1.8)


# ============================================================ S3-S4 sneak (bars 1-3)
def s3_s4_sneak():
    osti = [(0, "D2", 84), (1.0, "F2", 66), (1.5, "F#2", 64), (2.0, "G2", 72), (3.0, "A2", 68), (3.5, "A1", 62)]
    for bar in (1, 2):
        for beat, p, v in osti:
            pizz.n(B(bar, beat), 0.22, p, v)
    for beat, p, v in osti[:3]:
        pizz.n(B(3, beat), 0.22, p, v)
    # S4 pickup: pizzicato run 21.10 -> 22.10
    for i, p in enumerate(PS("D3 E3 F3 G3 A3 Bb3 C4 C#4")):
        pizz.n(B(3, 2.0 + i * 0.25), 0.12, p, 62 + 4 * i)
    # snaps (rim/side-stick) on 2 & 4, pp hats, soft kick
    for bar in (1, 2, 3):
        for beat in (1, 3):
            brush.n(B(bar, beat), 0.1, SIDE, 74)
        brush.n(B(bar, 0), 0.2, KICK, 56)
        for k in range(8 if bar < 3 else 4):
            brush.n(B(bar, k * 0.5), 0.1, HH_C, 34 if k % 2 == 0 else 26)
    roll(orch, O_SN, B(3, 2.0), 21.99, 0.0625, 26, 96, dur=0.05, curve=1.4)
    # creeping chromatic motif: bassoon, then low clarinet
    for beat, p, d in [(1.0, "A2", 0.18), (1.5, "Bb2", 0.18), (2.0, "B2", 0.18), (3.0, "C3", 0.42)]:
        bsn.n(B(1, beat), d, p, 60)
    bsn.n(B(2, 0), 0.18, "C#3", 62)
    bsn.n(B(2, 0.5), 0.40, "D3", 64)
    for beat, p, d in [(1.5, "F4", 0.18), (2.0, "E4", 0.18), (2.5, "Eb4", 0.18), (3.0, "D4", 0.40), (3.5, "A3", 0.18)]:
        cla.n(B(2, beat), d, p, 58)
    for beat, (pb, pc) in [(0, ("D3", "D4")), (1.0, ("A2", "A3")), (1.5, ("Bb2", "Bb3"))]:
        bsn.n(B(3, beat), 0.18, pb, 64)
        cla.n(B(3, beat), 0.18, pc, 60)


# ============================================================ S5 montage (4-15)
MONTAGE_HARM = {   # bar -> [(beat_from, chord name)]
    4: [(0, "Dm6")], 5: [(0, "G7"), (2, "A7")], 6: [(0, "Dm6")], 7: [(0, "G7"), (2, "A7")],
    8: [(0, "Gm6")], 9: [(0, "C7"), (2, "D7")], 10: [(0, "Dm6")], 11: [(0, "G7"), (2, "A7")],
    12: [(0, "Gm6")], 13: [(0, "C7"), (2, "D7")], 14: [(0, "Gm6")], 15: [(0, "A7#9")],
}
VOICING = {   # mid-register voicings (vibes / strings)
    "Dm6": "B3 D4 F4 A4", "G7": "F3 B3 D4", "A7": "G3 C#4 E4", "Gm6": "Bb3 D4 E4 G4",
    "C7": "Bb3 E4 G4", "D7": "F#3 A3 C4 D4", "A7#9": "G3 C#4 F4 C5",
}
HIT_CHORD = {"Dm6": ("D", "D3 A3 D4 F4"), "Gm6": ("G", "G2 D3 G3 Bb3"), "A7#9": ("A", "A2 E3 G3 C#4")}
WALK = {
    4: "D2 F2 A2 B2", 5: "G2 B2 A2 C#2", 6: "D2 A2 B2 C3", 7: "G2 B2 A2 F#2",
    8: "G2 Bb2 D3 E3", 9: "C3 E3 D3 A2", 10: "D2 F2 A2 B2", 11: "G2 B2 A2 C#2",
    12: "G2 Bb2 D3 E3", 13: "C3 E3 D3 F#2", 14: "G2 D2 E2 G#2",
}
HIT_BARS = {4: 22.10, 6: 26.10, 8: 30.10, 10: 34.10, 12: 38.10, 14: 42.10, 15: 44.10}


def chord_at(bar, beat):
    name = MONTAGE_HARM[bar][0][1]
    for b0, nm in MONTAGE_HARM[bar]:
        if beat >= b0:
            name = nm
    return name


def montage_hit(bar):
    t = HIT_BARS[bar]
    name = chord_at(bar, 0)
    root, ch = HIT_CHORD[name]
    big = t >= 34.10
    brush.n(t, 0.3, KICK, 124, exact=True)
    pizz.n(t, 0.35, PS(ch), 118, exact=True)
    pizz.n(t, 0.35, root + "2", 122, exact=True)
    pno.n(t, 0.32, [root + "1", root + "2"], 108, exact=True)
    vib.n(t, 0.5, PS(VOICING[name]), 80, exact=True)
    if big:
        timp.n(t, 0.8, root + ("2" if root != "A" else "2"), 104, exact=True)
        brush.n(t, 1.6, CRASH, 96 if t < 42 else 110, exact=True)
        trb.n(t, 0.35, [P(root + "2"), P(root + "2") + 7], 104, exact=True)
        strS.n(t, 0.25, PS(ch), 110, exact=True)
    if t >= 42.10:
        orch.n(t, 1.0, O_BD, 110, exact=True)


def s5_montage():
    # ---- groove
    for bar in range(4, 16):
        t0 = B(bar)
        dense = bar >= 10
        hit = bar in HIT_BARS
        if hit:
            montage_hit(bar)
        # walking pizzicato bass
        if bar in WALK:
            for i, p in enumerate(PS(WALK[bar])):
                if i == 0 and hit:
                    continue
                pizz.n(B(bar, i), 0.32, p, 84 if i == 0 else 72)
        # brushes
        if not hit:
            brush.n(t0, 0.3, KICK, 78)
        last = 3.0 if bar == 15 else 4.0
        if bar < 15:
            brush.n(B(bar, 2.5), 0.2, KICK, 60)
        for beat in (1, 3):
            if beat < last:
                brush.n(B(bar, beat), 0.15, SNARE, 72 + (6 if dense else 0))
                brush.n(B(bar, beat), 0.15, HH_P, 52)
        for beat in (0, 2):
            if beat < last:
                brush.n(B(bar, beat), 0.9, SWIRL, 40)
        for k in range(8):
            beat = k * 0.5
            if beat >= last or (beat == 0 and hit):
                continue
            v = (70 if k % 2 == 0 else 48) + (8 if dense else 0)
            if beat == 3.5 and (bar + 1) in HIT_BARS:
                v -= 14
            brush.n(B(bar, beat), 0.3, RIDE, v)
        if dense and bar < 15:
            for beat in (1.75, 3.75):
                brush.n(B(bar, beat), 0.08, SNARE, 34)
        if bar % 2 == 1 and bar < 15:
            brush.n(B(bar, 3.5), 0.1, SIDE, 54)
        # vibes off-beat stabs
        for beat in (1.5, 3.5):
            if beat < last:
                vib.n(B(bar, beat), 0.22, PS(VOICING[chord_at(bar, beat)]), 58)
        # strings join from bar 10 (34.10)
        if 10 <= bar <= 11:
            for beat in (0.5, 1.5, 2.5, 3.5):
                strS.n(B(bar, beat), 0.16, PS(VOICING[chord_at(bar, beat)]), 64)
        elif 12 <= bar <= 13:
            for k in range(1, 8):
                beat = k * 0.5
                strS.n(B(bar, beat), 0.16, PS(VOICING[chord_at(bar, beat)]), 70 if k % 2 else 60)
        elif bar in (14, 15):
            pat = {"Gm6": "G3 D4 G4 D4", "A7#9": "A3 E4 G4 E4"}[chord_at(bar, 0)]
            ps = PS(pat)
            for k in range(1, 16 if bar == 14 else 12):
                strS.n(B(bar, k * 0.25), 0.1, ps[k % 4], 74 if k % 4 == 0 else 62)
    # bar 15 (44.10, A7#9): driving octave bass, tutti stab on beat 3, then the break
    for i, p in enumerate(PS("A1 A2 A1 G2 E2")):
        pizz.n(B(15, 0.5 + i * 0.5), 0.2, p, 80)
    ts = B(15, 3.0)   # 45.60
    for tr, ch, v in [(pizz, "A2 E3 G3 C#4", 112), (strS, "A2 E3 G3 C#4 C5", 108),
                      (vib, "G3 C#4 F4 C5", 82), (hrn, "C#4 G4 C5", 100), (trb, "A2 G3", 104)]:
        tr.n(ts, 0.18, PS(ch), v)
    mtp.n(ts, 0.18, "C#5", 104)
    brush.n(ts, 0.15, KICK, 112)
    brush.n(ts, 0.15, SNARE, 96)
    brush.n(ts, 0.2, CRASH2, 100)
    pno.n(ts, 0.18, PS("A1 A2"), 100)

    # ---- theme quotes (D dorian: A-A#-B-G / F-E-C#-D)
    def quote_a(tr, bar, vel, octave_shift=0, landing=True):
        seq = [(bar, 3.0, 0.5, "A4"), (bar, 3.5, 0.5, "A#4"),
               (bar + 1, 0.0, 0.5, "B4"), (bar + 1, 0.5, 1.5, "G5"), (bar + 1, 2.0, 0.5, "F5"),
               (bar + 1, 2.5, 0.5, "E5"), (bar + 1, 3.0, 0.9, "C#5")]
        if landing:
            seq.append((bar + 2, 0.0, 0.8, "D5"))
        accents = [-6, -4, 0, 8, -2, -4, 2, 6]
        for (b, beat, d, p), a in zip(seq, accents):
            tr.n(B(b, beat), d * Q * 0.92, P(p) + octave_shift, vel + a)

    def quote_g(tr, bar, vel, octave_shift=0, land="D5"):
        seq = [(bar, 3.0, 0.5, "D5"), (bar, 3.5, 0.5, "D#5"),
               (bar + 1, 0.0, 0.5, "E5"), (bar + 1, 0.5, 1.5, "C6"), (bar + 1, 2.0, 0.5, "Bb5"),
               (bar + 1, 2.5, 0.5, "A5"), (bar + 1, 3.0, 0.9, "F#5"), (bar + 2, 0.0, 0.8, land)]
        accents = [-6, -4, 0, 8, -2, -4, 2, 6]
        for (b, beat, d, p), a in zip(seq, accents):
            tr.n(B(b, beat), d * Q * 0.92, P(p) + octave_shift, vel + a)

    quote_a(mtp, 4, 82)                                    # unit 1: muted trumpet
    # unit 2: clarinet, sneakier rhythm
    for b, beat, d, p in [(6, 3.0, 0.5, "A4"), (6, 3.5, 0.5, "A#4"), (7, 0.0, 1.0, "B4"),
                          (7, 1.0, 0.5, "G5"), (7, 1.5, 0.5, "F5"), (7, 2.0, 1.0, "E5"),
                          (7, 3.0, 0.9, "C#5"), (8, 0.0, 0.8, "D5")]:
        cla.n(B(b, beat), d * Q * 0.9, p, 80)
    quote_g(mtp, 8, 84)                                    # unit 3: in G, vibes double
    quote_g(vib, 8, 64)
    quote_a(mtp, 10, 90)                                   # unit 4: + horns 8vb
    quote_a(hrn, 10, 80, -12)
    hrn.cc(0.0, 11, 100)
    quote_g(mtp, 12, 94, land="G5")                        # unit 5: + clarinet 8va, horns 8vb
    quote_g(cla, 12, 78, 12, land="G5")
    quote_g(hrn, 12, 86, -12, land="G5")
    # unit 6 (bars 14-15): densest
    for tr, sh, v in [(mtp, 0, 98), (hrn, -12, 90), (cla, 12, 80)]:
        for b, beat, d, p in [(14, 2.0, 0.5, "D5"), (14, 2.5, 0.5, "D#5"), (14, 3.0, 0.5, "E5"),
                              (14, 3.5, 0.4, "C6"), (15, 0.0, 0.8, "E5"), (15, 1.0, 0.5, "A4"),
                              (15, 1.5, 0.5, "A#4"), (15, 2.0, 0.5, "B4"), (15, 2.5, 0.5, "G5")]:
            tr.n(B(b, beat), d * Q * 0.9, P(p) + sh, v)
    for bar in (12, 13, 14):
        for beat in (2.5,):
            ch = chord_at(bar, beat)
            root = {"Gm6": "G2", "C7": "C3", "D7": "D2", "A7#9": "A2"}[ch]
            trb.n(B(bar, beat), 0.25, [P(root), P(root) + 7], 84)


# ============================================================ S6 "아니면..." (16-17)
def s6_duck():
    for bar in (16, 17):
        pizz.n(B(bar, 0), 0.4, "D2", 74, exact=(bar == 16))
        pizz.n(B(bar, 2), 0.4, "A1", 64)
        for k in range(8):
            brush.n(B(bar, k * 0.5), 0.1, WB_HI if k % 2 == 0 else WB_LO, 60 if k % 2 == 0 else 48,
                    exact=(bar == 16 and k == 0))
    cb.cc(B(16) - 0.02, 11, 70)
    cb.n(B(16), 3.95, "D2", 50, exact=True)
    # the rubber-duck motif (celesta): bounce, chromatic squeak, quack
    duck = [(16, 2.0, 0.25, "A5", 74), (16, 2.25, 0.25, "C6", 76), (16, 2.5, 0.5, "A5", 72),
            (16, 3.0, 0.5, "F5", 70),
            (17, 0.0, 0.25, "Bb5", 74), (17, 0.25, 0.25, "A5", 70), (17, 0.5, 0.5, "G5", 72),
            (17, 1.0, 0.125, "C#6", 64), (17, 1.125, 0.375, "D6", 88),
            (17, 2.0, 0.5, "A5", 76), (17, 2.5, 0.5, "D6", 90)]
    for b, beat, d, p, v in duck:
        cel.n(B(b, beat), d * Q * 0.95, p, v)
    glk.n(B(17, 1.125), 0.3, "D6", 58)
    glk.n(B(17, 2.5), 0.3, "D6", 62)
    bsn.n(B(17, 2.5), 0.18, "D3", 56)


# ============================================================ S7 the plan (18-21)
def s7_build():
    pats = {18: "D3 A3 D4 A3", 19: "D3 Bb3 D4 Bb3", 20: "D3 Bb3 Eb4 Bb3", 21: "C#3 G3 E4 G3"}
    base = {18: 52, 19: 64, 20: 78, 21: 92}
    for bar, pat in pats.items():
        ps = PS(pat)
        for k in range(16):
            x = k / 15
            v = base[bar] + (10 if k % 4 == 0 else 0) + (round(14 * x) if bar == 21 else 0)
            strS.n(B(bar, k * 0.25), 0.11, ps[k % 4], v, exact=(k == 0 and bar == 18))
        strS.n(B(bar, 0), 0.11, ps[0] - 12, base[bar] + 6)
    # chromatic rising line in the violins
    line = ["A4", "Bb4", "B4", "C5", "C#5", "D5", "Eb5", "E5"]
    strP.cc(B(18) - 0.02, 11, 56)
    for i, p in enumerate(line):
        t = B(18 + i // 2, (i % 2) * 2)
        strP.n(t, 0.98, p, 64 + 5 * i)
        if i >= 4:
            strP.n(t, 0.98, P(p) + 12, 56 + 5 * i)
    strP.ramp(11, B(18), 58.06, 56, 127, step=0.1, curve=1.3)
    # timpani pulse
    for bar, v in ((18, 60), (19, 70), (20, 82)):
        for beat in range(4):
            timp.n(B(bar, beat), 0.4, "D2", v + (8 if beat == 0 else 0))
    for k in range(8):
        timp.n(B(21, k * 0.5), 0.3, "A2", 90 + 3 * k)
    # low strings / basses / brass weight
    cb.cc(B(18) - 0.02, 11, 80)
    cb.n(B(18), 5.95, "D2", 70)
    cb.n(B(21), 1.95, "A1", 92)
    pizz.n(B(18, 0), 0.3, "D2", 70)
    pizz.n(B(19, 0), 0.3, "D2", 78)
    trb.cc(B(20) - 0.02, 11, 70)
    trb.n(B(20), 1.95, PS("Bb2 Eb3"), 76)
    trb.n(B(21), 1.95, PS("A2 E3 G3"), 96)
    trb.ramp(11, B(20), 58.05, 70, 127, curve=1.2)
    tuba.n(B(20), 1.95, "D2", 74)
    tuba.n(B(21), 1.95, "A1", 94)
    hrn.cc(B(21) - 0.02, 11, 80)
    hrn.n(B(21), 1.95, PS("C#4 E4 G4"), 96)
    hrn.ramp(11, B(21), 58.05, 80, 127)
    tpt.cc(B(21, 2) - 0.02, 11, 70)
    tpt.n(B(21, 2), 0.95, PS("A4 Bb4"), 92)
    tpt.ramp(11, B(21, 2), 58.05, 70, 127)
    for bar, v in ((18, 64), (19, 74), (20, 86), (21, 100)):
        orch.n(B(bar), 0.6, O_BD, v)
    roll(orch, O_SN, B(21), 58.05, 0.0625, 36, 112, dur=0.05, curve=1.3)


# ============================================================ S8 the swap (22-23)
def s8_swap():
    strH.cc(58.08, 11, 74)
    strH.n(58.10, 2.45, PS("E6 A6"), 52, exact=True)
    strH.ramp(11, 58.10, 60.5, 74, 92)
    for t in (58.10, 59.10, 60.10):
        timp.n(t, 0.5, "D2", 86 if t < 60 else 80, exact=(t == 58.10))
        timp.n(t + 0.23, 0.4, "D2", 52)
    # 60.60 success sting: "ta-DAN!" (pizz + glock + small brass), F major
    s, d2 = 60.60, 60.85
    pizz.n(s, 0.25, PS("C3 G3 E4"), 112, exact=True)
    glk.n(s, 0.3, PS("E6 C7"), 108, exact=True)
    tpt.cc(s - 0.02, 11, 112)
    tpt.n(s, 0.13, PS("G4 C5 E5"), 104, exact=True)
    hrn.cc(s - 0.02, 11, 110)
    hrn.n(s, 0.13, PS("C4 E4"), 98, exact=True)
    brush.n(s, 0.1, SIDE, 96, exact=True)
    pizz.n(d2, 0.35, PS("F2 C3 A3 F4"), 120)
    glk.n(d2, 0.6, PS("F6 A6 F7"), 112)
    tpt.n(d2, 0.42, PS("A4 C5 F5"), 112)
    hrn.n(d2, 0.42, PS("F3 C4 F4"), 106)
    timp.n(d2, 0.5, "F2", 96)
    vib.n(d2, 0.8, PS("A4 C5 F5"), 70)
    # 61.60-62.10: sly pickup (the theme's chromatic C-C#)
    cla.n(61.60, 0.22, "C5", 72)
    cla.n(61.85, 0.22, "C#5", 76)
    bsn.n(61.60, 0.22, "C3", 66)
    bsn.n(61.85, 0.22, "C#3", 70)


# ============================================================ S9 strut + tour (24-25)
def s9_strut():
    for beat, p, d, v in [(0, "F2", 0.7, 92), (1.5, "C2", 0.22, 74), (2.0, "F2", 0.22, 78),
                          (2.5, "A2", 0.22, 76), (3.0, "C3", 0.22, 78), (3.5, "Eb3", 0.22, 80)]:
        pizz.n(B(24, beat), d, p, v, exact=(beat == 0))
        if beat >= 1.5:
            bsn.n(B(24, beat), 0.2, p, 64)
    for beat in (1, 3):
        brush.n(B(24, beat), 0.1, SIDE, 84)
        brush.n(B(24, beat), 0.15, SNARE, 60)
    brush.n(B(24, 0), 0.2, KICK, 80, exact=True)
    brush.n(B(24, 2.5), 0.2, KICK, 64)
    for k in range(8):
        brush.n(B(24, k * 0.5), 0.3, RIDE, 60 if k % 2 == 0 else 44)
    for beat in (1.5, 3.5):
        vib.n(B(24, beat), 0.22, PS("Eb4 A4 C5"), 62)
    # clarinet: the theme with a swagger (F major / bluesy)
    for beat, p, d, v in [(0, "D5", 1.0, 88), (1.0, "Bb5", 0.5, 94), (1.5, "A5", 0.5, 80),
                          (2.0, "G5", 0.5, 80), (2.5, "E5", 1.0, 84), (3.5, "F5", 0.5, 82)]:
        cla.n(B(24, beat), d * Q * 0.9, p, v, exact=(beat == 0))
    bsn.n(B(24, 0), 0.4, "D3", 70, exact=True)
    # bar 25 (64.10): lighter, into suspense; bassoon creeps F-Gb-G-Ab -> (A = stab root)
    pizz.n(B(25, 0), 0.4, "F2", 70)
    cla.n(B(25, 0), 0.3, "F5", 66)
    for i, p in enumerate(PS("F2 Gb2 G2 Ab2")):
        bsn.n(B(25, i), 0.3, p, 60 + 4 * i)
    trem.cc(B(25) - 0.02, 11, 40)
    trem.n(B(25, 0.5), 1.6, PS("B3 F4"), 62)
    trem.ramp(11, B(25, 0.5), 65.95, 40, 80)
    vib.n(B(25, 1.0), 0.8, "B4", 46)
    vib.n(B(25, 2.0), 0.8, "F4", 44)
    brush.n(B(25, 0), 0.1, HH_P, 40)
    brush.n(B(25, 2), 0.1, HH_P, 36)


# ============================================================ S10 busted (26)
def s10_stab():
    s = 66.10
    for tr in (tpt, hrn, trb, tuba):
        tr.cc(s - 0.02, 11, 127)
    tpt.n(s, 0.34, PS("C#5 G5 Bb5"), 124, exact=True)
    hrn.n(s, 0.40, PS("E4 G4 C#5"), 122, exact=True)
    trb.n(s, 0.40, PS("A2 E3 G3"), 122, exact=True)
    tuba.n(s, 0.45, "A1", 124, exact=True)
    timp.n(s, 1.2, "A2", 127, exact=True)
    orch.n(s, 2.0, O_CYM1, 120, exact=True)
    kit.n(s, 2.0, CRASH, 110, exact=True)
    orch.n(s, 2.0, O_CYM2, 110, exact=True)
    orch.n(s, 1.0, O_BD, 127, exact=True)
    strS.n(s, 0.25, PS("A2 E3 C#4 G4 Bb4"), 120, exact=True)
    pno.n(s, 0.6, PS("A0 A1 A2"), 120, exact=True)
    pizz.n(s, 0.3, PS("A1 A2"), 120, exact=True)
    # then only low tremolo (alarm is SFX)
    trem.cc(66.30, 11, 64)
    trem.n(66.35, 1.70, PS("A2 Bb2"), 76)
    trem.ramp(11, 66.35, 68.0, 64, 100)
    cb.cc(66.30, 11, 80)
    cb.n(66.35, 1.70, "A1", 76)
    roll(timp, "A2", B(26, 3.0), 67.99, 0.0625, 34, 84, dur=0.08, curve=1.5)


# ============================================================ S11 chase (27-31)
CHASE_HARM = {27: [(0, "Dm"), (1, "G7")], 28: [(0, "A7")], 29: [(0, "Dm")], 30: [(0, "C7")],
              31: [(0, "C7"), (2, "F7")]}
CHASE_PAT = {"Dm": "D4 A4 F4 A4", "G7": "B3 F4 D4 F4", "A7": "C#4 G4 E4 G4",
             "C7": "E4 Bb4 G4 Bb4", "F7": "Eb4 A4 C5 A4"}
CHASE_ROOT = {"Dm": "D", "G7": "D", "A7": "A", "C7": "C", "F7": "F"}   # G7 over D pedal


def chase_chord(bar, beat):
    nm = CHASE_HARM[bar][0][1]
    for b0, c in CHASE_HARM[bar]:
        if beat >= b0:
            nm = c
    return nm


def s11_chase():
    for bar in range(27, 32):
        t0 = B(bar)
        # downbeat cut accents
        orch.n(t0, 1.5, O_CYM1 if bar % 2 else O_CYM2, 108, exact=True)
        orch.n(t0, 0.6, O_BD, 116, exact=True)
        r = CHASE_ROOT[chase_chord(bar, 0)]
        pno.n(t0, 0.4, [r + "1", r + "2"], 100, exact=True)
        timp.n(t0, 0.5, r + "2", 110, exact=True)
        tuba.n(t0, 0.45, {"D": "D2", "A": "A1", "C": "C2", "F": "F1"}[r], 100, exact=True)
        # 16th strings
        for k in range(16):
            beat = k * 0.25
            ps = PS(CHASE_PAT[chase_chord(bar, beat)])
            strS.n(B(bar, beat), 0.1, ps[k % 4], 86 if k % 4 == 0 else 72, exact=(k == 0))
        # driving low strings 8ths
        for k in range(8):
            beat = k * 0.5
            rr = CHASE_ROOT[chase_chord(bar, beat)]
            strL.n(B(bar, beat), 0.2, [rr + "2", rr + "3"], 92 if k % 2 == 0 else 80, exact=(k == 0))
        # trombone punches
        tc = {"Dm": "D3 A3", "G7": "D3 B3", "A7": "A2 E3", "C7": "C3 G3", "F7": "F2 Eb3"}
        trb.n(t0, 0.4, PS(tc[chase_chord(bar, 0)]), 104, exact=True)
        trb.n(B(bar, 2.5), 0.3, PS(tc[chase_chord(bar, 2.5)]), 94)
        # drums: kick/snare/toms drive
        for beat in (0.75, 1.5, 2.0, 2.75, 3.5):
            if bar == 31 and beat >= 2.0:
                continue
            kit.n(B(bar, beat), 0.2, KICK, 98)
        kit.n(t0, 0.2, KICK, 118, exact=True)
        for beat in (1, 3):
            if not (bar == 31 and beat == 3):
                kit.n(B(bar, beat), 0.2, SNARE, 106)
        for k in range(8):
            if bar == 31 and k >= 4:
                continue
            kit.n(B(bar, k * 0.5), 0.1, HH_C, 64 if k % 2 == 0 else 50)
        if bar in (27, 29):
            for i, tom in enumerate((TOM_H, TOM_HM, TOM_L, TOM_F2)):
                kit.n(B(bar, 3.0 + i * 0.25), 0.2, tom, 96 + 4 * i)
        elif bar in (28, 30):
            for beat in (2.0, 2.5, 3.0, 3.5):
                kit.n(B(bar, beat), 0.2, TOM_F1, 92)
    hrn.cc(68.08, 11, 120)
    tpt.cc(68.08, 11, 118)
    # brass: the theme in D minor
    theme = [(27, 0.0, 0.5, "A4"), (27, 0.5, 0.5, "A#4"), (27, 1.0, 1.0, "B4"), (27, 2.0, 2.0, "G5"),
             (28, 0.0, 1.0, "F5"), (28, 1.0, 1.0, "E5"), (28, 2.0, 1.0, "C#5"), (28, 3.0, 1.0, "A4"),
             (29, 0.0, 2.0, "D5"), (29, 3.0, 0.5, "D5"), (29, 3.5, 0.5, "D#5"),
             (30, 0.0, 1.0, "E5"), (30, 1.0, 3.0, "C6")]
    for b, beat, d, p in theme:
        v = 108 if d >= 1 else 100
        tpt.n(B(b, beat), d * Q * 0.94, p, v)
        hrn.n(B(b, beat), d * Q * 0.94, P(p) - 12, v - 4)
    # bar 31: descending run Bb A G F | Eb D C C# -> D (78.10)
    for i, p in enumerate(PS("Bb5 A5 G5 F5 Eb5 D5 C5 C#5")):
        tpt.n(B(31, i * 0.5), 0.22, p, 100 + 3 * i)
        hrn.n(B(31, i * 0.5), 0.22, P(p) - 12, 96 + 3 * i)
        strP.n(B(31, i * 0.5), 0.22, P(p) + 12, 84 + 3 * i)
    strP.cc(76.08, 11, 110)
    # countermelody in the violins (bars 29-30)
    for b, beat, d, p in [(29, 2.0, 1.0, "F5"), (29, 3.0, 1.0, "E5"), (30, 1.0, 1.0, "G5"),
                          (30, 2.0, 1.0, "Bb5"), (30, 3.0, 1.0, "A5")]:
        strP.n(B(b, beat), d * Q * 0.95, p, 86)
    strP.cc(B(29, 2) - 0.02, 11, 100)
    # build into 78.10: snare + timpani rolls, cymbal swell
    roll(kit, SNARE, B(31, 2.0), 77.95, 0.0625, 50, 100, dur=0.05, curve=1.2)
    for k in range(4):
        timp.n(B(31, k * 0.5), 0.3, "C2", 96)
    roll(timp, "F2", B(31, 2.0), 77.95, 0.0625, 64, 100, dur=0.08)
    roll(kit, RIDE2, B(31, 2.0), 77.95, 0.0625, 28, 80, dur=0.2, curve=1.6)


# ============================================================ S12 escape (32-34)
def s12_escape():
    for tr in (tpt, hrn, trb, tuba, strP, strL, strS):
        tr.cc(78.08, 11, 118)
    mel = [(32, 0.0, 1.0, "D5"), (32, 1.0, 3.0, "Bb5"),
           (33, 0.0, 1.5, "A5"), (33, 1.5, 0.5, "G5"), (33, 2.0, 2.0, "E5"),
           (34, 0.0, 1.0, "D5"), (34, 1.0, 1.0, "A5"), (34, 2.0, 0.5, "G5"), (34, 2.5, 0.5, "A5"),
           (34, 3.0, 0.5, "Bb5"), (34, 3.5, 0.5, "B5")]
    for b, beat, d, p in mel:
        dd = d * Q * (0.95 if not (b == 34 and beat == 3.5) else 0.75)
        v = 112 if d >= 1 else 104
        tpt.n(B(b, beat), dd, p, v)
        strP.n(B(b, beat), dd, P(p), v - 8)
        strP.n(B(b, beat), dd, P(p) + 12, v - 12)
        flu.n(B(b, beat), dd, P(p) + 12, v - 16)
        if d >= 1:
            glk.n(B(b, beat), 0.6, P(p) + 12, 84)
    strP.ramp(11, 82.10, 83.9, 112, 122)
    # harmony: Bb | Gm7 C7 | Bbmaj7 C7sus C7 | (F at 84.10)
    hr = [(32, 0, 4, "D4 F4 Bb4", "Bb2 F3", "Bb1"),
          (33, 0, 2, "D4 F4 G4", "G2 D3", "G1"), (33, 2, 2, "E4 G4 Bb4", "C3 G3", "C2"),
          (34, 0, 2, "D4 F4 A4", "Bb2 F3", "Bb1"), (34, 2, 1, "F4 G4 C5", "C3 G3", "C2"),
          (34, 3, 1, "E4 G4 Bb4", "C3 Bb3", "C2")]
    for b, beat, d, hn, tb, tu in hr:
        t = B(b, beat)
        dd = d * Q - (0.10 if b == 34 and beat == 3 else 0.04)
        hrn.n(t, dd, PS(hn), 94, exact=(beat == 0))
        trb.n(t, dd, PS(tb), 100, exact=(beat == 0))
        tuba.n(t, dd, tu, 100, exact=(beat == 0))
        strS_notes = PS(hn)
        for k in range(int(d * 4)):
            strS.n(t + k * 0.125, 0.09, strS_notes[k % len(strS_notes)], 84 if k % 4 == 0 else 70)
        for k in range(int(d * 2)):
            strL.n(t + k * 0.25, 0.2, [P(tu) + 12, P(tu) + 24], 92 if k % 2 == 0 else 80)
    hrn.ramp(11, 82.10, 83.9, 108, 118)
    trb.ramp(11, 82.10, 83.9, 104, 116)
    # percussion
    for b in (32, 33, 34):
        orch.n(B(b), 0.8, O_BD, 110, exact=True)
        timp.n(B(b), 0.6, {32: "Bb2", 33: "G2", 34: "Bb2"}[b], 110, exact=True)
        for beat in (1, 2, 3):
            if not (b == 34 and beat >= 2):
                orch.n(B(b, beat), 0.2, O_SN, 70 if beat != 2 else 84)
    orch.n(78.10, 2.5, O_CYM1, 116, exact=True)
    kit.n(78.10, 2.5, CRASH, 106, exact=True)
    orch.n(78.10, 2.5, O_CYM2, 104, exact=True)
    orch.n(82.10, 2.0, O_CYM1, 100, exact=True)
    roll(orch, O_SN, B(34, 2.0), 83.93, 0.0625, 46, 98, dur=0.05, curve=1.3)
    roll(timp, "C2", B(34, 2.0), 83.93, 0.0625, 56, 100, dur=0.08, curve=1.3)
    roll(kit, RIDE2, B(34, 1.0), 83.93, 0.0625, 22, 80, dur=0.2, curve=1.8)
    gliss(harp, 78.10, 78.85, pcs("Bb C D Eb F G A"), "Bb2", "Bb6", 70, 104, dur=0.6, exact_first=True)
    gliss(harp, B(34, 2), 83.95, pcs("C D E F G A Bb"), "C3", "C7", 60, 108, dur=0.5, until=84.06)
    for b in (32, 33, 34):
        pno.n(B(b), 0.5, {32: PS("Bb1 Bb2"), 33: PS("G1 G2"), 34: PS("Bb1 Bb2")}[b], 104, exact=True)


# ============================================================ S13 title (35-38)
def s13_title():
    s = 84.10
    for tr in (tpt, hrn, trb, tuba, strP, strL, cb, trem):
        tr.cc(s - 0.02, 11, 127)
    tpt.n(s, 1.8, PS("F5 A5 C6"), 114, exact=True)
    hrn.n(s, 2.6, PS("C4 F4 A4 C5"), 108, exact=True)
    trb.n(s, 2.6, PS("F2 C3 F3 A3"), 106, exact=True)
    tuba.n(s, 2.6, "F1", 108, exact=True)
    timp.n(s, 3.0, "F2", 127, exact=True)
    timp.n(s, 3.0, "C3", 112, exact=True)
    orch.n(s, 4.0, O_CYM1, 124, exact=True)
    orch.n(s, 4.0, O_CYM2, 116, exact=True)
    orch.n(s, 2.0, O_BD, 127, exact=True)
    kit.n(s, 3.0, CRASH, 110, exact=True)
    pno.n(s, 3.9, PS("F1 F2 F3 A3 C4 F4 A4 C5 F5"), 110, exact=True)
    pedal(pno, s + 0.03, 88.04)
    glk.n(s, 2.0, PS("F6 A6 C7 F7"), 116, exact=True)
    cel.n(s, 2.0, PS("C6 F6"), 100, exact=True)
    flu.n(s, 2.2, PS("F6 A6"), 104, exact=True)
    strS.n(s, 0.3, PS("F3 C4 A4 F5"), 120, exact=True)
    pizz.n(s, 0.4, PS("F2 F3"), 124, exact=True)
    for i, p in enumerate(PS("F2 C3 A3 F4 A4 C5 F5 A5")):
        harp.n(s + i * 0.025, 3.0, p, 100, exact=(i == 0))
    # sustained chord + plagal glow (Bb/F) under the narration, natural decay
    strP.n(s, 88.10 - s, PS("F3 C4 A4 C5 F5 A5 C6"), 104, exact=True)
    strP.n(88.10, 1.0, PS("F3 D4 Bb4 D5 F5"), 96, exact=True)
    strP.n(89.10, 0.85, PS("F3 C4 A4 C5 F5"), 92)
    strL.n(s, 89.95 - s, PS("F2 C3"), 108, exact=True)
    cb.n(s, 89.95 - s, "F1", 108, exact=True)
    hrn.n(87.0, 1.08, PS("A3 C4 F4"), 70)
    hrn.n(88.10, 1.0, PS("Bb3 D4 F4"), 66, exact=True)
    hrn.n(89.10, 0.8, PS("A3 C4 F4"), 62)
    for tr in (strP, strL, cb):
        tr.ramp(11, s + 0.3, 85.2, 127, 96)
        tr.ramp(11, 85.2, 89.95, 96, 34, step=0.1)
    for tr in (tpt, trb, tuba):
        tr.ramp(11, s + 0.25, s + 1.8, 127, 50)
    hrn.ramp(11, s + 0.25, 86.6, 127, 80)
    hrn.ramp(11, 86.6, 89.9, 80, 40, step=0.1)
    # 90.10: playful tag "ta-da-da - DAN" (celesta + pizz): the theme's C-C#-D, home to F
    for t, pc, pp, v in [(90.10, "C6", "C4", 80), (90.35, "C#6", "C#4", 82), (90.60, "D6", "D4", 86)]:
        cel.n(t, 0.2, pc, v, exact=(t == 90.10))
        pizz.n(t, 0.2, pp, v - 4, exact=(t == 90.10))
    cel.n(91.10, 0.7, PS("A5 F6"), 96, exact=True)
    pizz.n(91.10, 0.5, PS("F2 C3 A3 F4"), 100, exact=True)
    glk.n(91.10, 0.6, "F6", 76, exact=True)


# ========================================================================= build
def compose():
    s1_waltz()
    gags()
    s3_s4_sneak()
    s5_montage()
    s6_duck()
    s7_build()
    s8_swap()
    s9_strut()
    s10_stab()
    s11_chase()
    s12_escape()
    s13_title()
    humanize(TR, EXACT, seed=20261006)


def ensure_soundfont():
    if SF2.exists() and SF2.stat().st_size > 200_000_000:
        return
    SF2.parent.mkdir(parents=True, exist_ok=True)
    print("downloading", SF2_URL)
    urllib.request.urlretrieve(SF2_URL, SF2)


STATS: dict = {}
LATENCY_REPORT: dict = {}
PRE_OPEN = 0.035   # gates open this much early: latency-compensated attacks start before the grid


def mix_and_master(renders, jobs_meta):
    ir = make_hall_ir()
    stems = {s: np.zeros((NSAMP, 2), np.float32) for s in ("perc", "low", "mid", "high")}
    for g, gd in GATE_GROUPS.items():
        env = gate_envelope([(a0 - PRE_OPEN if a0 > 0 else a0, b0, f0)
                             for a0, b0, f0 in gd["windows"]])[:, None]
        a = int(max(0, min(w[0] for w in gd["windows"]) - PRE_OPEN - 0.01) * SR)
        e = int(min(97.0, max(w[1] + w[2] for w in gd["windows"]) + 0.01) * SR)
        for stem in stems:
            dry = np.zeros((NSAMP, 2), np.float32)
            send = np.zeros((NSAMP, 2), np.float32)
            for key, (tr, grp) in jobs_meta.items():
                if grp != g or tr.stem != stem:
                    continue
                x = renders[key] * undb(tr.gain_db)
                dry += x
                send += x * tr.send
            if not np.any(dry):
                continue
            wet = convolve_region(send, ir, a, e) * 0.55
            stems[stem] += (dry + wet) * env
    mix = sum(stems.values())
    # master: glue comp -> loudness -> true-peak limiter (gain curves shared by stems)
    g1 = glue_compressor_gain(mix, thresh_db=-22.0, ratio=1.8)
    mix1 = mix * g1[:, None]
    L = lufs(mix1)
    gain = undb(-14.0 - L)
    g2 = None
    for _ in range(4):
        m2 = mix1 * gain
        g2 = tp_limiter_gain(m2, ceiling_db=-1.3)
        out = m2 * g2[:, None]
        L2 = lufs(out)
        if abs(L2 + 14.0) < 0.1:
            break
        gain *= undb(-14.0 - L2)
    total = (g1 * gain * g2)[:, None]
    STATS.update(comp_max_gr_db=round(float(-db(g1.min())), 2), makeup_db=round(float(db(gain)), 2),
                 limiter_max_gr_db=round(float(-db(g2.min())), 2),
                 limiter_gr_over_1db_s=round(float(np.sum(g2 < undb(-1)) / SR), 2),
                 limiter_gr_events_over_3db=sorted({round(i / SR, 1) for i in np.where(g2 < undb(-3))[0][::480]}))
    # 5 ms safety fade at the very end (97.00 cut)
    fade = np.ones((NSAMP, 1), np.float32)
    nf = int(0.005 * SR)
    fade[-nf:, 0] = np.linspace(1, 0, nf)
    out = (mix * total * fade).astype(np.float32)
    stems_out = {k: (v * total * fade).astype(np.float32) for k, v in stems.items()}
    return out, stems_out


def analyse(out):
    rep = {}
    rep["duration_s"] = out.shape[0] / SR
    rep["samples"] = out.shape[0]
    rep["lufs_integrated"] = round(lufs(out), 2)
    rep["sample_peak_dbfs"] = round(float(db(np.max(np.abs(out)))), 2)
    rep["true_peak_dbtp_4x"] = round(float(db(true_peak(out))), 2)
    env = rms_env(out, 0.01)          # 10 ms RMS frames
    tt = np.arange(len(env)) * 0.01

    def max_db(a, b):
        m = (tt >= a - 1e-6) & (tt + 0.01 <= b + 1e-6)
        return round(float(env[m].max()), 1) if m.any() else None

    rep["rms10ms_max_dBFS"] = {
        "S0 0.00-0.55": max_db(0.0, 0.55),
        "after hard stop 14.19-14.23": max_db(14.19, 14.23),
        "S2 gag 14.25-14.80": max_db(14.25, 14.80),
        "S2 rest 14.90-16.05": max_db(14.90, 16.05),
        "break 45.90-46.05": max_db(45.90, 46.05),
        "S14 92.15-96.15": max_db(92.15, 96.15),
        "S14 bassoon 96.20-96.70": max_db(96.20, 96.70),
        "S1 waltz 2-9s": max_db(2.0, 9.0),
        "S13 title 84.1-85": max_db(84.1, 85.0),
    }
    sections = [(0.6, 9.6, "S1 waltz"), (9.6, 12.6, "S1 reveal"), (12.6, 14.1, "S1 golden chord"),
                (16.1, 22.1, "S3-S4"), (22.1, 34.1, "S5a"), (34.1, 45.85, "S5b"), (46.1, 50.1, "S6"),
                (50.1, 58.1, "S7"), (58.1, 60.6, "S8"), (60.6, 66.1, "S8 sting / S9"),
                (66.1, 68.1, "S10"), (68.1, 78.1, "S11"), (78.1, 84.1, "S12"), (84.1, 92.1, "S13")]
    rep["section_rms_dBFS"] = {}
    for a, b, nm in sections:
        x = out[int(a * SR):int(b * SR)]
        rep["section_rms_dBFS"][nm] = round(float(db(np.sqrt(np.mean(x.astype(np.float64) ** 2)))), 1)
    rep["hits"] = []
    for h in HITS + [12.60, 78.10]:
        t_env, t_peak, prom = detect_onset_near(out, h)
        rep["hits"].append({"target": h, "onset": round(t_env, 4), "err_ms": round((t_env - h) * 1000, 1),
                            "flux_peak": round(t_peak, 4), "rise_dB": round(prom, 1)})
    return rep


def main():
    ensure_soundfont()
    compose()
    write_score_midi(TR, HERE / "score.mid")
    # split each track by gate group and render
    jobs, meta = [], {}
    for i, tr in enumerate(TR):
        bygroup = {}
        for nt in tr.notes:
            bygroup.setdefault(group_of(nt.t), []).append(nt)
        for g, notes in bygroup.items():
            key = f"{i:02d}_{tr.name.replace(' ', '_')}_{g}"
            jobs.append((key, tr, notes, i))
            meta[key] = (tr, g)
    print("calibrating sample attack latencies ...")
    lat = measure_latencies(SF2, TR, CACHE)
    for i, d in lat.items():
        used = sorted({n.pitch for n in TR[i].notes})
        vals = {p: round(d[p] * 1000, 1) for p in used}
        LATENCY_REPORT[TR[i].name] = (vals if TR[i].drum else
                                      {"range_ms": [min(vals.values()), max(vals.values())]})
    print(f"rendering {len(jobs)} track/section parts with FluidSynth ...")
    renders = render_jobs(SF2, jobs, CACHE, latencies=lat)
    out, stems = mix_and_master(renders, meta)
    assert out.shape == (NSAMP, 2)
    sf.write(HERE / "score.wav", out, SR, subtype="PCM_24")
    (HERE / "stems").mkdir(exist_ok=True)
    for k, v in stems.items():
        sf.write(HERE / "stems" / f"stem_{k}.wav", v, SR, subtype="PCM_24")
    rep = analyse(out)
    # stuck-note check on the written score.mid
    import mido
    mf = mido.MidiFile(HERE / "score.mid")
    open_notes = 0
    for trk in mf.tracks:
        on = {}
        for m in trk:
            if m.type == "note_on" and m.velocity > 0:
                on[(m.channel, m.note)] = on.get((m.channel, m.note), 0) + 1
            elif m.type in ("note_off",) or (m.type == "note_on" and m.velocity == 0):
                on[(m.channel, m.note)] = on.get((m.channel, m.note), 0) - 1
        open_notes += sum(v for v in on.values() if v > 0)
    rep["midi_open_notes"] = open_notes
    rep["master"] = STATS
    rep["latency_compensation_ms"] = LATENCY_REPORT
    rep["midi_length_s"] = round(mf.length, 3)
    rep["note_count"] = sum(len(t.notes) for t in TR)
    # ffmpeg cross-check of loudness / true peak
    try:
        r = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", str(HERE / "score.wav"),
                            "-af", "ebur128=peak=true", "-f", "null", "-"],
                           capture_output=True, text=True)
        tail = r.stderr[r.stderr.rfind("Summary:"):]
        rep["ffmpeg_ebur128_summary"] = " ".join(tail.split())
    except Exception as ex:  # pragma: no cover
        rep["ffmpeg_ebur128_summary"] = f"n/a ({ex})"
    (HERE / "analysis.json").write_text(json.dumps(rep, indent=2, ensure_ascii=False))
    print(json.dumps(rep, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
