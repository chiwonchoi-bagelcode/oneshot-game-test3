"""
musiclib.py - tiny score/render/mix toolkit used by compose.py.

Model
-----
* A score is a list of Track objects. Notes are placed at ABSOLUTE trailer seconds
  (the cue sheet is the source of truth), so hit times are exact by construction.
* Every track is rendered on its own with FluidSynth (dry: FluidSynth reverb/chorus
  off), split by "gate group" (which section of the trailer a note belongs to).
  Each gate group is summed, sent through a synthetic hall reverb, and then gated
  with sample-accurate envelopes. That is what makes the 14.10 s hard stop, the
  45.85-46.10 break and the 58.10 cut real (reverb tails included).
* Master bus: gentle RMS glue compressor -> loudness normalise (-14 LUFS) ->
  4x-oversampled true-peak look-ahead limiter (-1.2 dBTP ceiling). The exact same
  gain curve is applied to the stems, so stems sum to the master.
"""
from __future__ import annotations

import math
import os
import random
import subprocess
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path

import mido
import numpy as np
import soundfile as sf
from scipy import signal

SR = 48000
DUR = 97.0
NSAMP = int(round(DUR * SR))  # 4_656_000
PPQ = 960

# --------------------------------------------------------------------------- time
# Tempo map used for every MIDI file we write:
#   0.00-0.60 s : one 1/4 pickup bar at q=100 (0.6 s)  -> tick 0..960
#   0.60-14.10 s: 3/4 waltz bars 1-9 at q=120
#   14.10-16.10 : one 4/4 bar (S2 gag silence)
#   16.10-...   : 4/4 at q=120, cue-sheet bar n starts at 16.10 + (n-1)*2.0
# At q=120 one tick = 1/1920 s (0.52 ms), every cue time is an exact tick.


def sec_to_tick(t: float) -> int:
    if t < 0.6:
        return int(round(t / 0.6 * PPQ))
    return PPQ + int(round((t - 0.6) * 2 * PPQ))


def tick_to_sec(k: int) -> float:
    if k < PPQ:
        return k / PPQ * 0.6
    return 0.6 + (k - PPQ) / (2 * PPQ)


def W(bar: int, beat: float = 0.0) -> float:
    """Waltz (S1) position: 3/4, bar 1 downbeat at 0.60 s, beat = 0.5 s."""
    return 0.60 + (bar - 1) * 1.5 + beat * 0.5


def B(bar: int, beat: float = 0.0) -> float:
    """4/4 position from S3 on: bar 1 downbeat at 16.10 s, beat = 0.5 s."""
    return 16.10 + (bar - 1) * 2.0 + beat * 0.5


Q = 0.5  # one beat in seconds

_NOTE = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}


def P(s) -> int:
    """'C4'=60, 'Bb2', 'F#5' ... ints pass through."""
    if isinstance(s, (int, np.integer)):
        return int(s)
    name = s[0].upper()
    i, acc = 1, 0
    while i < len(s) and s[i] in "#b":
        acc += 1 if s[i] == "#" else -1
        i += 1
    return 12 * (int(s[i:]) + 1) + _NOTE[name] + acc


def PS(s: str):
    return [P(x) for x in s.split()]


# -------------------------------------------------------------------------- score
@dataclass
class Note:
    t: float
    dur: float
    pitch: int
    vel: int
    exact: bool = False


@dataclass
class Track:
    name: str
    program: int
    drum: bool = False
    pan: int = 64
    gain_db: float = 0.0
    send: float = 0.25          # reverb send (linear)
    stem: str = "mid"           # perc / low / mid / high
    sustain_pedal: bool = False
    volume: int = 100           # CC7
    notes: list = field(default_factory=list)
    ccs: list = field(default_factory=list)      # (t, cc, value)
    bends: list = field(default_factory=list)    # (t, value -8192..8191)

    # ---- authoring helpers
    def n(self, t, dur, pitch, vel, exact=False):
        if isinstance(pitch, (list, tuple)):
            for p in pitch:
                self.n(t, dur, p, vel, exact)
            return self
        self.notes.append(Note(float(t), float(dur), P(pitch), int(vel), exact))
        return self

    def cc(self, t, num, val):
        self.ccs.append((float(t), int(num), int(max(0, min(127, round(val))))))
        return self

    def ramp(self, num, t0, t1, v0, v1, step=0.05, curve=1.0):
        steps = max(1, int(round((t1 - t0) / step)))
        for i in range(steps + 1):
            x = i / steps
            self.cc(t0 + (t1 - t0) * x, num, v0 + (v1 - v0) * (x ** curve))
        return self

    def bend(self, t, semis, rng=2.0):
        v = int(max(-8192, min(8191, round(semis / rng * 8192))))
        self.bends.append((float(t), v))
        return self

    def bend_ramp(self, t0, t1, s0, s1, step=0.01):
        steps = max(1, int(round((t1 - t0) / step)))
        for i in range(steps + 1):
            x = i / steps
            self.bend(t0 + (t1 - t0) * x, s0 + (s1 - s0) * x)
        return self


# ---------------------------------------------------------------- humanisation
def humanize(tracks, exact_times, seed=1234, jitter_sd=0.004, jitter_max=0.008,
             vel_sd=4.0):
    """Tiny timing (+-8 ms) and velocity variation. Notes flagged exact, or that start
    within 1 ms of one of exact_times, are left untouched (hits stay sample-exact)."""
    rng = random.Random(seed)
    ex = np.array(sorted(exact_times))
    for tr in tracks:
        for nt in tr.notes:
            near = len(ex) and np.min(np.abs(ex - nt.t)) < 0.001
            if not (nt.exact or near):
                dt = max(-jitter_max, min(jitter_max, rng.gauss(0, jitter_sd)))
                nt.t = max(0.0, nt.t + dt)
            else:
                nt.exact = True
            if not tr.drum or not nt.exact:
                nt.vel = int(max(1, min(127, round(nt.vel + rng.gauss(0, vel_sd)))))


# ------------------------------------------------------------------ MIDI writing
def _tempo_meta():
    return [
        (0, mido.MetaMessage("set_tempo", tempo=600000, time=0)),
        (0, mido.MetaMessage("time_signature", numerator=1, denominator=4, time=0)),
        (PPQ, mido.MetaMessage("set_tempo", tempo=500000, time=0)),
        (PPQ, mido.MetaMessage("time_signature", numerator=3, denominator=4, time=0)),
        (sec_to_tick(14.10), mido.MetaMessage("time_signature", numerator=4, denominator=4, time=0)),
    ]


SECTION_MARKERS = [
    (0.00, "S0 pre-roll"), (0.60, "S1 waltz (3/4)"), (14.10, "S2 gag silence"),
    (16.10, "S3 sneak intro (4/4 bar 1)"), (20.10, "S4 to-do card"), (22.10, "S5 montage"),
    (46.10, "S6 'or...'"), (50.10, "S7 plan build"), (58.10, "S8 the swap"),
    (62.10, "S9 strut/tour"), (66.10, "S10 busted"), (68.10, "S11 chase"),
    (78.10, "S12 escape"), (84.10, "S13 title"), (92.10, "S14 cookie"),
]


def _track_events(tr: Track, channel: int, notes, include_setup=True):
    ev = []  # (tick, order, msg)
    if include_setup:
        if tr.drum:
            ev.append((0, 0, mido.Message("control_change", channel=channel, control=0, value=0)))
        else:
            ev.append((0, 0, mido.Message("control_change", channel=channel, control=0, value=0)))
            ev.append((0, 0, mido.Message("control_change", channel=channel, control=32, value=0)))
        ev.append((0, 1, mido.Message("program_change", channel=channel, program=tr.program)))
        for c, v in ((7, tr.volume), (10, tr.pan), (11, 127), (91, 0), (93, 0), (64, 0)):
            ev.append((0, 2, mido.Message("control_change", channel=channel, control=c, value=v)))
        # pitch-bend range = 2 semitones (RPN 0)
        for c, v in ((101, 0), (100, 0), (6, 2), (38, 0), (101, 127), (100, 127)):
            ev.append((0, 2, mido.Message("control_change", channel=channel, control=c, value=v)))
    for (t, c, v) in tr.ccs:
        ev.append((sec_to_tick(t), 3, mido.Message("control_change", channel=channel, control=c, value=v)))
    for (t, v) in tr.bends:
        ev.append((sec_to_tick(t), 3, mido.Message("pitchwheel", channel=channel, pitch=v)))
    # notes: avoid same-pitch overlaps (truncate earlier note), note_off before note_on
    bypitch = {}
    for nt in notes:
        bypitch.setdefault(nt.pitch, []).append(nt)
    for p, lst in bypitch.items():
        lst.sort(key=lambda x: x.t)
        for i, nt in enumerate(lst):
            on = sec_to_tick(nt.t)
            off = sec_to_tick(nt.t + nt.dur)
            if i + 1 < len(lst):
                off = min(off, sec_to_tick(lst[i + 1].t))
            off = max(off, on + 1)
            ev.append((on, 5, mido.Message("note_on", channel=channel, note=p, velocity=max(1, nt.vel))))
            ev.append((off, 4, mido.Message("note_off", channel=channel, note=p, velocity=0)))
    return ev


def _to_track(ev, name=None, end_tick=None):
    ev.sort(key=lambda e: (e[0], e[1]))
    mt = mido.MidiTrack()
    if name:
        mt.append(mido.MetaMessage("track_name", name=name, time=0))
    last = 0
    for tick, _, msg in ev:
        msg = msg.copy(time=tick - last)
        mt.append(msg)
        last = tick
    if end_tick is not None and end_tick > last:
        mt.append(mido.MetaMessage("end_of_track", time=end_tick - last))
    else:
        mt.append(mido.MetaMessage("end_of_track", time=0))
    return mt


def write_render_midi(tr: Track, notes, path: Path, latency=None, end_s=None):
    """Single-track type-0 file for rendering one track (channel 0, or 10 for drums).
    latency: optional {pitch: seconds} - notes are sent that much EARLIER so the
    sample's audible attack (10 % of peak) lands on the written time."""
    ch = 9 if tr.drum else 0
    if latency:
        notes = [Note(max(0.0, n.t - latency.get(n.pitch, 0.0)), n.dur, n.pitch, n.vel, n.exact)
                 for n in notes]
    ev = [(k, -1, m) for k, m in _tempo_meta()]
    ev += _track_events(tr, ch, notes)
    end = sec_to_tick((end_s or DUR) + 1.5)
    ev.append((end, 9, mido.Message("control_change", channel=ch, control=110, value=0)))
    mf = mido.MidiFile(type=0, ticks_per_beat=PPQ)
    mf.tracks.append(_to_track(ev, tr.name, end))
    mf.save(path)


def write_score_midi(tracks, path: Path):
    """Type-1 score: one MIDI track per instrument. Channels are allocated per
    (program, drum) across MIDI ports (port meta 0x21) so nothing collides."""
    mf = mido.MidiFile(type=1, ticks_per_beat=PPQ)
    cond = [(k, -1, m) for k, m in _tempo_meta()]
    for t, name in SECTION_MARKERS:
        cond.append((sec_to_tick(t), 0, mido.MetaMessage("marker", text=name, time=0)))
    mf.tracks.append(_to_track(cond, "Conductor (tempo map / markers)"))
    alloc = {}       # key -> (port, channel)
    used = {}        # port -> set(channels)
    drum_port = 0
    for tr in tracks:
        if not tr.notes:
            continue
        key = ("drum", tr.name) if tr.drum else ("mel", tr.program)
        if key not in alloc:
            if tr.drum:
                alloc[key] = (drum_port, 9)
                used.setdefault(drum_port, set()).add(9)
                drum_port += 1
            else:
                port = 0
                while True:
                    free = [c for c in range(16) if c != 9 and c not in used.setdefault(port, set())]
                    if free:
                        alloc[key] = (port, free[0])
                        used[port].add(free[0])
                        break
                    port += 1
        port, ch = alloc[key]
        ev = [(0, -2, mido.MetaMessage("midi_port", port=port, time=0))]
        ev += _track_events(tr, ch, tr.notes)
        mf.tracks.append(_to_track(ev, tr.name))
    mf.save(path)
    return alloc


# --------------------------------------------------------------------- rendering
def fluidsynth_render(sf2: Path, mid: Path, wav: Path, gain=0.5):
    cmd = ["fluidsynth", "-ni", "-q", "-R", "0", "-C", "0", "-g", str(gain),
           "-r", str(SR), "-o", "synth.polyphony=1024", "-o", "synth.cpu-cores=1",
           "-o", "audio.file.format=float", "-o", "audio.file.type=wav",
           "-F", str(wav), str(sf2), str(mid)]
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def load_fixed(wav: Path) -> np.ndarray:
    a, sr = sf.read(str(wav), dtype="float32", always_2d=True)
    assert sr == SR, sr
    if a.shape[1] == 1:
        a = np.repeat(a, 2, axis=1)
    out = np.zeros((NSAMP, 2), dtype=np.float32)
    n = min(NSAMP, a.shape[0])
    out[:n] = a[:n]
    return out


def measure_latencies(sf2, tracks, cache: Path, vel=110, cap=0.030, workers=None):
    """Calibration: render one test note per (track, pitch) actually used (drums: per
    key; melodic: per track at its median pitch) and measure the time until the
    output reaches 10 % of its peak. Returns {track_index: {pitch: seconds}}."""
    cache.mkdir(parents=True, exist_ok=True)
    workers = workers or max(2, (os.cpu_count() or 4) - 1)
    jobs = []
    for i, tr in enumerate(tracks):
        if not tr.notes:
            continue
        pitches = sorted({n.pitch for n in tr.notes})
        med = int(np.median([n.pitch for n in tr.notes]))
        probe = set(pitches) if tr.drum else {med} | {n.pitch for n in tr.notes if n.exact}
        for p in sorted(probe):
            jobs.append((i, p))
        if not tr.drum:
            jobs.append((i, -med - 1))       # marker: the default (median) for this track

    def one(job):
        i, p = job
        if p < 0:
            return job, None
        tr = tracks[i]
        probe = Track(tr.name, tr.program, drum=tr.drum)
        mid = cache / f"lat_{i:02d}_{p}.mid"
        wav = cache / f"lat_{i:02d}_{p}.wav"
        write_render_midi(probe, [Note(1.0, 0.6, p, vel)], mid, end_s=2.0)
        fluidsynth_render(sf2, mid, wav)
        a, _ = sf.read(str(wav), dtype="float32", always_2d=True)
        wav.unlink()
        mid.unlink()
        m = np.abs(a).max(axis=1)
        if m.max() <= 0:
            return job, 0.0
        k = int(np.argmax(m > 0.1 * m.max())) - SR
        return job, float(min(cap, max(0.0, k / SR)))

    with ThreadPoolExecutor(workers) as ex:
        res = dict(ex.map(one, jobs))
    out = {}
    for (i, p), lat in res.items():
        if p < 0:
            med = -p - 1
            d = out.setdefault(i, {})
            base = res[(i, med)]
            for q in range(128):
                d.setdefault(q, base)
    for (i, p), lat in res.items():
        if p >= 0:
            out.setdefault(i, {})[p] = lat
    return out


def render_jobs(sf2, jobs, cache: Path, workers=None, latencies=None):
    """jobs: list of (key, Track, notes, track_index). Returns {key: (NSAMP,2) array}."""
    cache.mkdir(parents=True, exist_ok=True)
    workers = workers or max(2, (os.cpu_count() or 4) - 1)

    def one(job):
        key, tr, notes, ti = job
        mid = cache / f"{key}.mid"
        wav = cache / f"{key}.wav"
        write_render_midi(tr, notes, mid, latency=(latencies or {}).get(ti))
        fluidsynth_render(sf2, mid, wav)
        a = load_fixed(wav)
        wav.unlink()          # float renders are ~37 MB each; keep only the .mid
        return key, a

    with ThreadPoolExecutor(workers) as ex:
        return dict(ex.map(one, jobs))


# ------------------------------------------------------------------------ reverb
def make_hall_ir(seconds=2.6, rt_low=2.3, rt_mid=1.9, rt_high=0.9, predelay=0.018, seed=7):
    """Synthetic stereo hall IR: sparse early reflections + band-dependent diffuse tail."""
    rng = np.random.default_rng(seed)
    n = int(seconds * SR)
    t = np.arange(n) / SR
    ir = np.zeros((n, 2))
    sos_lo = signal.butter(2, 400, "low", fs=SR, output="sos")
    sos_hi = signal.butter(2, 3500, "high", fs=SR, output="sos")
    for ch in range(2):
        noise = rng.standard_normal(n)
        lo = signal.sosfilt(sos_lo, noise)
        hi = signal.sosfilt(sos_hi, noise)
        mid = noise - lo - hi
        env = lambda rt: np.exp(-6.907755 * t / rt)  # -60 dB at rt
        tail = lo * env(rt_low) + mid * env(rt_mid) + 0.6 * hi * env(rt_high)
        onset = np.clip((t - predelay - 0.012) / 0.05, 0, 1) ** 1.5   # diffuse build-up
        tail *= onset
        # early reflections
        er = np.zeros(n)
        for k in range(14):
            d = predelay + rng.uniform(0.002, 0.075)
            g = rng.uniform(0.25, 0.7) * math.exp(-d * 18) * (1 if rng.random() > 0.3 else -1)
            er[int(d * SR)] += g
        er = signal.sosfilt(signal.butter(2, 6000, "low", fs=SR, output="sos"), er)
        ir[:, ch] = tail * 0.35 + er
    ir /= np.sqrt(np.sum(ir ** 2) / 2)
    return ir.astype(np.float32)


def convolve_region(x, ir, s0, s1):
    """Reverb x[s0:s1] (stereo), returning a full-length array (tail kept up to NSAMP)."""
    out = np.zeros_like(x)
    seg = x[s0:s1]
    if not np.any(seg):
        return out
    y = np.stack([signal.oaconvolve(seg[:, c], ir[:, c]) for c in range(2)], axis=1)
    e = min(NSAMP, s0 + y.shape[0])
    out[s0:e] = y[: e - s0]
    return out


# ------------------------------------------------------------------------- gates
def gate_envelope(windows):
    """windows: list of (start, end, fade_out). Gain 1 in [start,end], 2 ms ramp-in
    ending at start, raised-cosine fade to 0 over fade_out after end."""
    g = np.zeros(NSAMP, dtype=np.float32)
    t = np.arange(NSAMP) / SR
    for (a, b, fo) in windows:
        w = np.zeros(NSAMP, dtype=np.float32)
        w[(t >= a) & (t <= b)] = 1.0
        ri = (t >= a - 0.002) & (t < a)
        w[ri] = (t[ri] - (a - 0.002)) / 0.002
        if fo > 0:
            fz = (t > b) & (t < b + fo)
            w[fz] = 0.5 * (1 + np.cos(np.pi * (t[fz] - b) / fo))
        g = np.maximum(g, w)
    return g


# ------------------------------------------------------------------------ master
def db(x):
    return 20 * np.log10(np.maximum(x, 1e-12))


def undb(d):
    return 10 ** (d / 20)


def glue_compressor_gain(x, thresh_db=-20.0, ratio=2.0, attack=0.015, release=0.25, knee=6.0):
    """Stereo-linked RMS compressor; returns the gain curve (linear)."""
    p = np.mean(x.astype(np.float64) ** 2, axis=1)
    win = int(0.010 * SR)
    p = signal.lfilter(np.ones(win) / win, [1], p)
    lvl = 10 * np.log10(np.maximum(p, 1e-14))
    over = lvl - thresh_db
    gr = np.where(over <= -knee / 2, 0.0,
                  np.where(over >= knee / 2, over * (1 - 1 / ratio),
                           (1 - 1 / ratio) * (over + knee / 2) ** 2 / (2 * knee)))
    # attack/release smoothing of the gain reduction (dB), on a 1 ms grid for speed
    dec = SR // 1000
    grd = gr[::dec]
    sm = np.empty_like(grd)
    a_a = math.exp(-1 / (attack * 1000))
    a_r = math.exp(-1 / (release * 1000))
    s = 0.0
    for i, v in enumerate(grd):
        s = a_a * s + (1 - a_a) * v if v > s else a_r * s + (1 - a_r) * v
        sm[i] = s
    sm = np.interp(np.arange(len(gr)) / dec, np.arange(len(sm)), sm)
    return undb(-sm).astype(np.float32)


def true_peak(x, os_factor=4):
    y = signal.resample_poly(x, os_factor, 1, axis=0)
    return float(np.max(np.abs(y)))


def tp_limiter_gain(x, ceiling_db=-1.2, lookahead=0.004, release=0.120, os_factor=4):
    """Look-ahead brickwall on the 4x-oversampled peak envelope; returns gain curve."""
    y = signal.resample_poly(x, os_factor, 1, axis=0)
    pk = np.max(np.abs(y), axis=1).reshape(-1, os_factor).max(axis=1)[:x.shape[0]]
    if pk.shape[0] < x.shape[0]:
        pk = np.pad(pk, (0, x.shape[0] - pk.shape[0]))
    ceil = undb(ceiling_db)
    need = np.minimum(1.0, ceil / np.maximum(pk, 1e-9))
    la = int(lookahead * SR)
    # running minimum over the look-ahead window (so gain is down before the peak)
    from scipy.ndimage import minimum_filter1d
    need = minimum_filter1d(need, size=2 * la + 1, origin=0)
    # smooth: instant attack (already looked ahead), exponential release, then
    # a short moving average so the gain never steps
    dec = 48
    nd = need[: (len(need) // dec) * dec].reshape(-1, dec).min(axis=1)
    a_r = math.exp(-1 / (release * SR / dec))
    g = np.empty_like(nd)
    s = 1.0
    for i, v in enumerate(nd):
        s = v if v < s else a_r * s + (1 - a_r) * v
        g[i] = s
    g = np.repeat(g, dec)
    g = np.pad(g, (0, len(need) - len(g)), constant_values=g[-1] if len(g) else 1.0)
    k = la
    gp = np.pad(g, (k, k), mode="edge")
    g = np.convolve(gp, np.ones(k) / k, mode="same")[k:-k]
    return g.astype(np.float32)


def lufs(x):
    import pyloudnorm as pyln
    return pyln.Meter(SR).integrated_loudness(x.astype(np.float64))


# ---------------------------------------------------------------------- analysis
def rms_env(x, hop=0.05):
    h = int(hop * SR)
    m = x.shape[0] // h
    p = np.mean(x[: m * h].astype(np.float64) ** 2, axis=1).reshape(m, h).mean(axis=1)
    return db(np.sqrt(p))


def onset_strength(x, n_fft=1024, hop=96):
    """Spectral flux (log-magnitude, half-wave rectified) with 2 ms hop.
    Returns (times, flux). times are frame centres."""
    mono = x.mean(axis=1).astype(np.float64)
    f, tt, Z = signal.stft(mono, fs=SR, nperseg=n_fft, noverlap=n_fft - hop, boundary=None,
                           padded=False)
    mag = np.log1p(1000 * np.abs(Z))
    flux = np.maximum(0, np.diff(mag, axis=1)).sum(axis=0)
    times = tt[1:]
    return times, flux


def detect_onset_near(x, target, search=0.08):
    """Onset time of the event at `target`: locate the strongest spectral-flux peak
    within +-search, then refine to the first 0.5 ms frame (within -25..+20 ms of the
    peak) whose RMS rises 6 dB above the loudest pre-roll level (-80..-25 ms)."""
    times, flux = onset_strength(x)
    m = (times > target - search) & (times < target + search)
    idx = np.where(m)[0]
    i = idx[np.argmax(flux[idx])]
    t_peak = float(times[i])
    h = int(0.0005 * SR)
    a = int((t_peak - 0.08) * SR)
    b = int((t_peak + 0.02) * SR)
    seg = x[a:b].astype(np.float64)
    n = (len(seg) // h) * h
    env = np.sqrt(np.mean(seg[:n] ** 2, axis=1).reshape(-1, h).mean(axis=1))
    tt = (a + np.arange(len(env)) * h) / SR
    pre = np.percentile(env[(tt >= t_peak - 0.08) & (tt < t_peak - 0.025)], 90) + 1e-9
    top = env[tt >= t_peak - 0.025].max()
    thr = max(2.0 * pre, 0.25 * top)          # 6 dB over pre-roll AND 25 % of the attack peak
    cand = np.where((tt >= t_peak - 0.025) & (env > thr))[0]
    if len(cand) == 0:
        cand = np.where((tt >= t_peak - 0.025) & (env > 1.41 * pre))[0]
    t_on = float(tt[cand[0]]) if len(cand) else t_peak
    rise_db = float(db(env[(tt >= t_on) & (tt < t_on + 0.03)].max() / pre))
    return t_on, t_peak, rise_db
