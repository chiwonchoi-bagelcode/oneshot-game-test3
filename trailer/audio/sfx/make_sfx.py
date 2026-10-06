#!/usr/bin/env python3
"""Procedural trailer SFX pack for "완벽한 불청객" (The Perfect Uninvited Guest).

Every sound is synthesized from scratch (oscillators, filtered noise, synthetic
impulse-response reverb). No samples are used, so the output is 100% original.

Usage (from repo root):
    trailer/.venv-sfx/bin/python trailer/audio/sfx/make_sfx.py

Writes 48 kHz / 24-bit stereo WAVs next to this script, validates them
objectively (duration, sample/true peak, DC, leading silence, onset/peak times)
and regenerates README.md with the measured results. Fully deterministic: every
sound draws from its own RNG seeded by SEED + the file name.
"""
from __future__ import annotations

import zlib
from pathlib import Path

import numpy as np
import soundfile as sf
from scipy import signal

SR = 48_000
SEED = 20261006
OUT = Path(__file__).resolve().parent
PEAK_TARGET_DBTP = -1.2  # true-peak target, leaves margin under the -1 dBFS spec


# ----------------------------------------------------------------------------
# basic helpers
# ----------------------------------------------------------------------------
def rng_for(name: str) -> np.random.Generator:
    return np.random.default_rng(SEED ^ zlib.crc32(name.encode()))


def ns(dur: float) -> int:
    return int(round(dur * SR))


def taxis(dur: float) -> np.ndarray:
    return np.arange(ns(dur)) / SR


def colored(rng, n: int, slope_db_oct: float = 0.0) -> np.ndarray:
    """Gaussian noise with spectral tilt (0 = white, -3 = pink, -6 = brown)."""
    spec = np.fft.rfft(rng.standard_normal(n))
    f = np.fft.rfftfreq(n, 1 / SR)
    f[0] = f[1]
    spec *= (f / 1000.0) ** (slope_db_oct / 6.0206)
    spec[0] = 0
    y = np.fft.irfft(spec, n)
    return y / (np.std(y) + 1e-12)


def stereo_noise(rng, n, slope=0.0, corr=0.5):
    """Two noise channels with a given inter-channel correlation (width)."""
    c = colored(rng, n, slope)
    a = colored(rng, n, slope)
    b = colored(rng, n, slope)
    k1, k2 = np.sqrt(corr), np.sqrt(1 - corr)
    return np.stack([k1 * c + k2 * a, k1 * c + k2 * b], axis=1)


def _sos(kind, f, order=2):
    nyq = SR / 2
    if kind == "band":
        lo, hi = f
        return signal.butter(order, [lo / nyq, min(hi / nyq, 0.999)], "bandpass", output="sos")
    return signal.butter(order, min(f / nyq, 0.999), kind, output="sos")


def lp(x, f, order=2):
    return signal.sosfilt(_sos("lowpass", f, order), x, axis=0)


def hp(x, f, order=2):
    return signal.sosfilt(_sos("highpass", f, order), x, axis=0)


def bp(x, lo, hi, order=2):
    return signal.sosfilt(_sos("band", (lo, hi), order), x, axis=0)


def resonator(x, f0, q):
    b, a = signal.iirpeak(f0 / (SR / 2), q)
    return signal.lfilter(b, a, x, axis=0)


def phase_of(freq):
    """Integrate an instantaneous-frequency array into phase (radians)."""
    return 2 * np.pi * np.cumsum(freq) / SR


def ar(t, attack, decay):
    """Smooth attack (1-exp) times exponential decay; 0 for t<0."""
    tt = np.maximum(t, 0)
    e = (1 - np.exp(-tt / max(attack, 1e-5))) * np.exp(-tt / decay)
    return np.where(t >= 0, e, 0.0)


def interp_log(t, times, values):
    return np.exp(np.interp(t, times, np.log(values)))


def smooth(x, ms):
    k = max(1, int(SR * ms / 1000))
    w = np.hanning(k + 2)[1:-1]
    w /= w.sum()
    return np.convolve(x, w, mode="same")


def tv_filter(x, gain_fn, nper=1024):
    """Time-varying spectral filter via STFT: gain_fn(t[1,T], f[F,1]) -> mask."""
    x = np.asarray(x)
    if x.ndim == 2:
        return np.stack([tv_filter(x[:, c], gain_fn, nper) for c in range(x.shape[1])], 1)
    nov = nper * 3 // 4
    f, t, Z = signal.stft(x, fs=SR, nperseg=nper, noverlap=nov)
    mask = gain_fn(t[None, :], f[:, None])
    _, y = signal.istft(Z * mask, fs=SR, nperseg=nper, noverlap=nov)
    y = y[: len(x)]
    if len(y) < len(x):
        y = np.pad(y, (0, len(x) - len(y)))
    return y


def band_mask(fc_fn, bw_fn):
    """Gaussian band in log-frequency centred on fc_fn(t) with width bw_fn(t) octaves."""

    def g(t, f):
        ff = np.maximum(f, 1.0)
        return np.exp(-0.5 * (np.log2(ff / fc_fn(t)) / bw_fn(t)) ** 2)

    return g


def pan(x, p):
    """Equal-power pan; p scalar or array in [-1, 1]. Mono in, stereo out."""
    p = np.asarray(p, float)
    th = (p + 1) * np.pi / 4
    return np.stack([x * np.cos(th), x * np.sin(th)], axis=1) * np.sqrt(2)


def st(x):
    """Ensure stereo (n, 2)."""
    x = np.asarray(x, float)
    return np.stack([x, x], axis=1) if x.ndim == 1 else x


def place(buf, x, t0):
    """Add x into buf starting at time t0 (seconds), clipped to buffer."""
    i = ns(t0)
    x = st(x) if buf.ndim == 2 else x
    end = min(len(buf), i + len(x))
    if end > i:
        buf[i:end] += x[: end - i]
    return buf


def saturate(x, drive):
    pk = np.max(np.abs(x)) + 1e-12
    return np.tanh(drive * x / pk) / np.tanh(drive) * pk


def normalize(x, peak=1.0):
    return x * (peak / (np.max(np.abs(x)) + 1e-12))


# ----------------------------------------------------------------------------
# synthetic impulse-response reverb
# ----------------------------------------------------------------------------
def make_ir(rng, rt60, predelay=0.01, damp=0.5, er=8, dur=None):
    """Decorrelated stereo IR: early reflections + band-wise exponential tail.

    damp: 0 = bright (highs decay like lows), 1 = very dark (highs die fast).
    """
    dur = dur or rt60 * 1.1
    n = ns(dur)
    t = np.arange(n) / SR
    bands = [(20, 300, 1.0), (300, 1500, 1.0 - 0.25 * damp),
             (1500, 5000, 1.0 - 0.55 * damp), (5000, 20000, 1.0 - 0.8 * damp)]
    out = np.zeros((n, 2))
    for ch in range(2):
        tail = np.zeros(n)
        nz = rng.standard_normal(n)
        for lo, hi, k in bands:
            rt = rt60 * k
            tail += bp(nz, lo, hi, 2) * np.exp(-6.9078 * t / rt)
        # soft onset of the diffuse tail (build-up of density)
        tail *= 1 - np.exp(-t / 0.012)
        ir = np.zeros(n)
        d0 = ns(predelay)
        ir[d0:] = tail[: n - d0]
        for _ in range(er):  # sparse early reflections, different per channel
            d = d0 + ns(rng.uniform(0.002, 0.045))
            if d < n:
                ir[d] += rng.uniform(-1, 1) * 6 * np.exp(-(d - d0) / SR / 0.04)
        out[:, ch] = ir
    out /= np.sqrt(np.sum(out ** 2) / 2) + 1e-12
    return out


def reverb(x, ir, wet, keep_len=True):
    """Mix dry with convolution reverb. Mono or stereo input; stereo out."""
    x = st(x)
    y = np.stack([signal.fftconvolve(x[:, c], ir[:, c]) for c in range(2)], 1)
    y *= np.sqrt(np.mean(x ** 2) / (np.mean(y[: len(x)] ** 2) + 1e-20))  # loudness-match
    dry = np.pad(x, ((0, len(y) - len(x)), (0, 0)))
    out = (1 - wet) * dry + wet * y
    return out[: len(x)] if keep_len else out


# ----------------------------------------------------------------------------
# finishing
# ----------------------------------------------------------------------------
def true_peak(x):
    return np.max(np.abs(signal.resample_poly(st(x), 4, 1, axis=0)))


def finalize(x, *, length=None, trim=True, fade_in_ms=1.0, fade_out_ms=10.0, lead_ms=1.0):
    x = st(np.array(x, float))
    x = x - x.mean(axis=0)
    x = hp(x, 18.0, 2)  # remove DC / sub-sonic drift
    if trim:
        thr = np.max(np.abs(x)) * 10 ** (-54 / 20)
        idx = int(np.argmax(np.any(np.abs(x) > thr, axis=1)))
        x = x[max(0, idx - ns(lead_ms / 1000)):]
    if length is not None:
        n = ns(length)
        x = x[:n] if len(x) >= n else np.pad(x, ((0, n - len(x)), (0, 0)))
    nin, nout = max(1, ns(fade_in_ms / 1000)), max(1, ns(fade_out_ms / 1000))
    x[:nin] *= (0.5 - 0.5 * np.cos(np.linspace(0, np.pi, nin)))[:, None]
    x[-nout:] *= (0.5 + 0.5 * np.cos(np.linspace(0, np.pi, nout)))[:, None]
    x[-1] = 0.0
    # remove residual DC with a Hann-shaped correction so the faded edges stay at zero
    w = np.hanning(len(x) + 2)[1:-1]
    x -= np.outer(w / w.mean(), x.mean(axis=0))
    tp = true_peak(x)
    x *= 10 ** (PEAK_TARGET_DBTP / 20) / tp
    return x


# ----------------------------------------------------------------------------
# sounds
# ----------------------------------------------------------------------------
def asym_gauss(t, tp, s_before, s_after):
    s = np.where(t < tp, s_before, s_after)
    return np.exp(-0.5 * ((t - tp) / s) ** 2)


def whoosh_short():
    rng = rng_for("whoosh_short")
    dur, tp = 0.45, 0.30
    t = taxis(dur)
    env = asym_gauss(t, tp, 0.085, 0.045)
    n = len(t)
    fc = lambda tt: interp_log(tt, [0, tp, dur], [650, 3600, 1500])
    bw = lambda tt: 0.9 + 0.5 * np.interp(tt, t, env)
    body = tv_filter(stereo_noise(rng, n, -3, 0.55), band_mask(fc, bw)) * env[:, None]
    air = hp(stereo_noise(rng, n, 0, 0.3), 6500, 2) * (env ** 1.6)[:, None] * 0.35
    whistle = tv_filter(colored(rng, n, -3), band_mask(lambda tt: 1.6 * fc(tt), lambda tt: 0.12 + 0 * tt))
    whistle = st(whistle * env ** 2 * 0.25)
    mono = body.mean(1)
    side = (body[:, 0] - body[:, 1]) * 0.5
    p = 0.55 * np.tanh((t - tp) / 0.05)
    moving = pan(mono, p) + np.stack([side, -side], 1)
    x = moving + air + whistle
    x = reverb(x, make_ir(rng, 0.5, 0.006, 0.4), 0.12)
    x = lp(x, 14000, 2)
    return finalize(x, length=dur, trim=False, fade_in_ms=5, fade_out_ms=40)


def whoosh_long():
    rng = rng_for("whoosh_long")
    dur, tp = 1.2, 0.9
    t = taxis(dur)
    n = len(t)
    env = asym_gauss(t, tp, 0.26, 0.11)
    envf = lambda tt: np.interp(tt, t, env)
    fc = lambda tt: interp_log(tt, [0, tp, dur], [260, 2600, 900])
    bw = lambda tt: 1.0 + 0.7 * envf(tt)
    flutter_rate = 16 + 14 * env
    flutter = 1 + 0.14 * env * np.sin(phase_of(flutter_rate))
    mid = tv_filter(stereo_noise(rng, n, -3, 0.5), band_mask(fc, bw)) * (env * flutter)[:, None]
    low = lp(stereo_noise(rng, n, -6, 0.7), 320, 2) * (env ** 1.3)[:, None] * 0.9
    air = hp(stereo_noise(rng, n, 0, 0.25), 7000, 2) * (env ** 2)[:, None] * 0.2
    rum_f = interp_log(t, [0, tp, dur], [48, 82, 44])
    rumble = np.sin(phase_of(rum_f)) * env ** 1.5 * 0.35
    rumble = st(np.tanh(2.0 * rumble) * 0.6)
    p = 0.75 * np.tanh((t - tp) / 0.12)
    mono = (mid + low).mean(1)
    side = ((mid + low)[:, 0] - (mid + low)[:, 1]) * 0.5
    x = pan(mono, p) + np.stack([side, -side], 1) + air + rumble
    x = reverb(x, make_ir(rng, 1.2, 0.012, 0.45), 0.18)
    x = lp(x, 13000, 2)
    return finalize(x, length=dur, trim=False, fade_in_ms=10, fade_out_ms=60)


def _cymbal(rng, dur, decay=0.55):
    """Forward crash-ish cymbal: band-limited metallic squares + inharmonic partials + noise."""
    t = taxis(dur)
    n = len(t)
    x = np.zeros(n)
    base = np.array([205.3, 304.4, 369.6, 522.7, 540.0, 800.0]) * 2.0
    for f in base:  # band-limited square via odd harmonics
        k = 1
        while f * k < 19000:
            x += np.sin(2 * np.pi * f * k * t + rng.uniform(0, 2 * np.pi)) / k
            k += 2
    x = hp(x, 3500, 2) / 8
    parts = np.zeros(n)
    for _ in range(140):
        f = np.exp(rng.uniform(np.log(2500), np.log(17000)))
        d = decay * rng.uniform(0.4, 1.2) * (4000 / f) ** 0.35
        parts += np.sin(2 * np.pi * f * t + rng.uniform(0, 6.3)) * np.exp(-t / d) * rng.uniform(0.3, 1)
    parts /= 14
    nz = colored(rng, n, -1)
    nz_hi = hp(nz, 6000, 2) * np.exp(-t / (decay * 0.6))
    nz_mid = bp(nz, 2000, 6000, 2) * np.exp(-t / (decay * 0.9)) * 0.6
    env = ar(t, 0.0008, decay)
    return (x * env + parts + nz_hi * 0.9 + nz_mid) * 0.5


def whoosh_reverse():
    rng = rng_for("whoosh_reverse")
    dur = 1.5
    n = ns(dur)
    t = taxis(dur)
    cyms = []
    for ch in range(2):  # independent cymbals per side = natural width
        c = _cymbal(rng, dur + 0.6, decay=0.6)
        cyms.append(c)
    cym = np.stack(cyms, 1)
    cym = reverb(cym, make_ir(rng, 2.2, 0.015, 0.3), 0.4)
    rev = cym[:n][::-1].copy()
    shape = (t / dur) ** 1.4
    rev *= shape[:, None]
    # airy noise swell that accelerates into the hit
    sw = taxis(dur) / dur
    fc = lambda tt: interp_log(tt, [0, dur], [700, 9000])
    swell = tv_filter(stereo_noise(rng, n, -3, 0.35), band_mask(fc, lambda tt: 1.3 + 0 * tt))
    swell *= (sw ** 3.0)[:, None] * 0.6
    # subtle low "suck" rising into the cut
    suck = np.sin(phase_of(interp_log(t, [0, dur], [45, 110]))) * sw ** 4 * 0.25
    x = rev / (np.max(np.abs(rev)) + 1e-9) + swell + st(suck)
    x = lp(saturate(x, 1.3), 16000, 2)
    return finalize(x, length=dur, trim=False, fade_in_ms=40, fade_out_ms=1.5)


def impact_big():
    rng = rng_for("impact_big")
    dur = 3.8
    t = taxis(dur)
    n = len(t)
    sub_f = 31 + (115 - 31) * np.exp(-t / 0.20)
    sub = np.sin(phase_of(sub_f)) * ar(t, 0.002, 1.15)
    sub = saturate(sub, 1.6)
    kick_f = 48 + 190 * np.exp(-t / 0.022)
    kick = np.sin(phase_of(kick_f)) * ar(t, 0.0008, 0.13) * 0.9
    click = bp(rng.standard_normal(n), 1500, 7000, 2) * ar(t, 0.0002, 0.005) * 0.6
    crack = hp(stereo_noise(rng, n, -1, 0.3), 2500, 2) * ar(t, 0.0005, 0.07)[:, None] * 0.45
    body = lp(stereo_noise(rng, n, -6, 0.5), 650, 2) * ar(t, 0.001, 0.32)[:, None] * 0.9
    rumble = lp(stereo_noise(rng, n, -6, 0.3), 120, 2) * ar(t, 0.06, 1.3)[:, None] * 0.55
    ring = np.zeros(n)
    for _ in range(18):
        f = np.exp(rng.uniform(np.log(300), np.log(2200)))
        ring += np.sin(2 * np.pi * f * t + rng.uniform(0, 6.3)) * ar(t, 0.003, rng.uniform(0.5, 1.4))
    ring = st(ring / 18 * 0.12)
    upper = crack + body + st(click) + ring + st(kick * 0.35)
    upper = lp(reverb(upper, make_ir(rng, 3.3, 0.018, 0.55), 0.38), 11000, 2)
    x = st(sub * 1.0) + st(kick * 0.65) + upper + rumble
    x = saturate(x, 1.35)
    return finalize(x, length=dur, trim=True, fade_in_ms=0.5, fade_out_ms=400)


def impact_soft():
    rng = rng_for("impact_soft")
    dur = 1.2
    t = taxis(dur)
    n = len(t)
    th_f = 50 + 75 * np.exp(-t / 0.045)
    thump = np.sin(phase_of(th_f)) * ar(t, 0.004, 0.26)
    felt = lp(stereo_noise(rng, n, -3, 0.6), 520, 2) * ar(t, 0.002, 0.045)[:, None] * 0.5
    tone = (np.sin(2 * np.pi * 98 * t) + 0.25 * np.sin(2 * np.pi * 196 * t)) * ar(t, 0.006, 0.38) * 0.14
    x = st(saturate(thump, 1.4)) + felt + st(tone)
    x = reverb(x, make_ir(rng, 0.9, 0.008, 0.8), 0.22)
    x = lp(x, 4000, 2)
    return finalize(x, length=dur, trim=True, fade_in_ms=0.8, fade_out_ms=250)


def riser_4s():
    rng = rng_for("riser_4s")
    T = 4.0
    t = taxis(T)
    n = len(t)
    u = t / T
    lvl = 10 ** ((-38 + 38 * u ** 1.5) / 20)
    # noise sweep
    fc = lambda tt: 300 * (9500 / 300) ** ((tt / T) ** 1.25)
    bw = lambda tt: 1.5 - 0.5 * (tt / T)
    nz = tv_filter(stereo_noise(rng, n, -3, 0.35), band_mask(fc, bw)) * 0.8
    air = hp(stereo_noise(rng, n, 0, 0.2), 7000, 2) * (u ** 3)[:, None] * 0.35
    # shepard-ish tonal cluster: octave-spaced voices gliding up under a gaussian
    tonal = np.zeros((n, 2))
    nv, span, f_lo = 6, 6.0, 55.0
    rate = 0.65  # octaves / second
    center = 3.0 + 1.0 * u  # spectral centre also drifts upward for a real rise
    for k in range(nv):
        pos = (k * span / nv + rate * t) % span
        f = f_lo * 2 ** pos
        w = np.exp(-0.5 * ((pos - center) / 1.15) ** 2)
        for ch, det in enumerate((-6, 6)):
            ph = phase_of(f * 2 ** (det / 1200))
            v = np.sin(ph) + 0.3 * np.sin(2 * ph) + 0.12 * np.sin(3 * ph)
            tonal[:, ch] += v * w
    trem_rate = 3 + 13 * u ** 1.3
    trem = 1 - (0.15 + 0.4 * u) * (0.5 + 0.5 * np.sin(phase_of(trem_rate)))
    tonal *= (trem * 0.32)[:, None]
    sub = np.sin(phase_of(38 + 45 * u ** 1.5)) * u ** 2 * 0.45
    x = nz + air + tonal + st(sub)
    x *= lvl[:, None]
    x = reverb(x, make_ir(rng, 1.8, 0.02, 0.35), 0.25)
    # final push: last 250 ms swell
    x *= (1 + 0.35 * np.clip((t - (T - 0.25)) / 0.25, 0, 1) ** 2)[:, None]
    x = saturate(x, 1.4)
    return finalize(x, length=T, trim=False, fade_in_ms=30, fade_out_ms=2.0)


def stop_hit():
    rng = rng_for("stop_hit")
    T = 0.35
    t = taxis(T)
    # source material: a bright party "stab" + kick + snap, rendered in source time
    src_dur = 0.4
    ts = taxis(src_dur)
    chord = [130.81, 261.63, 329.63, 392.0, 523.25, 659.25, 783.99]
    srcs = []
    for det in (-4, 4):
        s = np.zeros(len(ts))
        for f in chord:
            for h in range(1, 9):
                s += np.sin(2 * np.pi * f * h * 2 ** (det / 1200) * ts) / h ** 1.2
        s = s / len(chord) * ar(ts, 0.002, 0.6)
        s += np.sin(phase_of(55 + 120 * np.exp(-ts / 0.02))) * ar(ts, 0.0006, 0.12) * 1.4
        s += bp(rng.standard_normal(len(ts)), 1200, 8000, 2) * ar(ts, 0.0005, 0.03) * 0.9
        srcs.append(s)
    src = np.stack(srcs, 1)
    # tape-stop: playback rate falls from 1 to 0
    rate = np.clip(1 - t / T, 0, 1) ** 1.25
    pos = np.cumsum(rate)  # source sample index
    y = np.stack([np.interp(pos, np.arange(len(ts)), src[:, c]) for c in range(2)], 1)
    y *= (rate ** 0.45)[:, None]  # motor losing torque -> level sags with speed
    y = tv_filter(y, lambda tt, f: 1 / (1 + (f / (300 + 9000 * np.interp(tt, t, rate) ** 1.5)) ** 4), 512)
    y = saturate(y, 1.6)
    y = reverb(y, make_ir(rng, 0.35, 0.004, 0.5), 0.08)
    return finalize(y, length=T, trim=True, fade_in_ms=0.5, fade_out_ms=25)


def _pencil_render(rng, dur, strokes, tick_gain=0.25, pan_path=(-0.2, 0.2), bright=1.0):
    """strokes: list of (t0, length, speed_factor, loop_hz, accel)."""
    t = taxis(dur)
    n = len(t)
    speed = np.zeros(n)
    gate = np.zeros(n)
    ticks = np.zeros(n)
    for t0, L, sf_, loop_hz, accel in strokes:
        i0, i1 = ns(t0), min(n, ns(t0 + L))
        if i1 <= i0:
            continue
        uu = (np.arange(i1 - i0) / SR) / L
        hump = np.sin(np.pi * np.clip(uu, 0, 1)) ** 0.6 if accel is None else np.clip(uu, 0, 1) ** accel
        loops = 0.35 + 0.65 * np.abs(np.sin(np.pi * loop_hz * uu * L + rng.uniform(0, np.pi)))
        sp = sf_ * hump * (loops if loop_hz > 0 else 1)
        a = np.clip(np.arange(i1 - i0) / ns(0.004), 0, 1)
        r = np.clip((i1 - i0 - np.arange(i1 - i0)) / ns(0.010), 0, 1)
        speed[i0:i1] = np.maximum(speed[i0:i1], sp)
        gate[i0:i1] = np.maximum(gate[i0:i1], a * r)
        ticks[i0] += sf_
    speed = smooth(speed, 3) * gate
    nz = rng.standard_normal(n)
    low_band = bp(nz, 700, 2500, 2)
    high_band = bp(nz, 2800, 10000, 2) * bright
    # graphite grain: sparse crackles whose density follows the speed
    dens = 2500 * speed
    crack = (rng.random(n) < dens / SR) * rng.uniform(0.3, 1.0, n) * rng.choice([-1, 1], n)
    crack = bp(crack.astype(float), 2000, 7500, 2) * 6
    body = bp(nz[::-1].copy(), 150, 500, 2) * 0.18
    x = low_band * speed ** 0.8 + high_band * 0.8 * speed ** 1.5 + crack * speed + body * speed
    tk = bp(np.convolve(ticks, np.exp(-np.arange(ns(0.004)) / ns(0.0012)))[:n], 1800, 5000, 2) * 25 * tick_gain
    x = x + tk
    p = np.interp(t, [0, dur], pan_path)
    x = pan(x, p)
    x = 0.85 * x + 0.15 * np.stack([x[:, 1], x[:, 0]], 1)  # keep it close and centred
    x = x + hp(stereo_noise(rng, n, 0, 0.0), 3000, 2) * (speed * 0.02)[:, None]
    return lp(reverb(x, make_ir(rng, 0.35, 0.003, 0.5), 0.07), 11000, 2)


def pencil_scribble():
    rng = rng_for("pencil_scribble")
    dur = 1.45
    strokes = []
    t0 = 0.0
    while t0 < 1.30:
        L = rng.uniform(0.07, 0.21)
        if t0 + L > 1.38:
            L = 1.38 - t0
        strokes.append((t0, L, rng.uniform(0.55, 1.25), rng.uniform(6, 13), None))
        gap = rng.uniform(0.015, 0.06) if rng.random() > 0.2 else rng.uniform(0.08, 0.13)
        t0 += L + gap
    x = _pencil_render(rng, dur, strokes)
    return finalize(x, length=1.4, trim=True, fade_in_ms=1.0, fade_out_ms=30)


def pencil_strike():
    rng = rng_for("pencil_strike")
    dur = 0.40
    x = _pencil_render(rng, dur, [(0.0, 0.25, 1.35, 0, 0.35)], tick_gain=0.6,
                       pan_path=(-0.45, 0.45), bright=1.4)
    t = taxis(dur)
    zip_ = tv_filter(colored(rng, len(t), -2),
                     band_mask(lambda tt: interp_log(tt, [0, 0.25], [2600, 4200]), lambda tt: 0.25 + 0 * tt))
    zip_ *= ar(t, 0.03, 1.0) * (t < 0.25) * 0.25
    x = x + pan(smooth(zip_, 0.5), np.interp(t, [0, dur], [-0.45, 0.45]))
    return finalize(x, length=0.35, trim=True, fade_in_ms=0.5, fade_out_ms=40)


def paper_flip():
    rng = rng_for("paper_flip")
    dur = 0.42
    t = taxis(dur)
    n = len(t)
    snap = bp(rng.standard_normal(n), 900, 9000, 2) * ar(t, 0.0002, 0.004) * 1.2
    snap += resonator(np.where(np.arange(n) == 0, 1.0, 0.0), 2300, 8) * 4
    fc = lambda tt: interp_log(tt, [0, dur], [4200, 1800])
    slide = tv_filter(stereo_noise(rng, n, -2, 0.45), band_mask(fc, lambda tt: 1.2 + 0 * tt), 512)
    flut = 1 - (0.55 * np.exp(-t / 0.12)) * (0.5 + 0.5 * np.sin(phase_of(48 - 26 * t / dur)))
    slide *= (ar(t, 0.004, 0.085) * flut)[:, None] * 0.75
    tap = bp(rng.standard_normal(n), 1500, 7000, 2) * ar(t - 0.055, 0.0004, 0.006) * 0.35
    whump = lp(stereo_noise(rng, n, -6, 0.6), 260, 2) * ar(t, 0.008, 0.06)[:, None] * 0.45
    p = np.interp(t, [0, 0.2], [-0.25, 0.3])
    x = st(snap) + pan(slide.mean(1), p) + 0.4 * (slide - slide.mean(1, keepdims=True)) + st(tap) + whump
    x = reverb(x, make_ir(rng, 0.4, 0.004, 0.4), 0.1)
    return finalize(x, length=0.4, trim=True, fade_in_ms=0.3, fade_out_ms=40)


def _bell(t, f, amp, ratios, amps, decays, rng, stereo_det=3.0):
    out = np.zeros((len(t), 2))
    for ch, det in enumerate((-stereo_det, stereo_det)):
        for r, a, d in zip(ratios, amps, decays):
            ff = f * r * 2 ** (det / 1200)
            if ff > 19500:
                continue
            out[:, ch] += a * np.sin(2 * np.pi * ff * t + 0.0) * ar(t, 0.0008, d)
    return out * amp


def sparkle():
    rng = rng_for("sparkle")
    dur = 1.35
    t = taxis(dur)
    n = len(t)
    scale = [1318.5, 1480.0, 1760.0, 1975.5, 2217.5, 2637.0, 2960.0, 3520.0, 3951.1, 4434.9]
    x = np.zeros((n, 2))
    idx, tt0 = 0, 0.0
    for i in range(13):
        f = scale[idx] * 2 ** (rng.uniform(-4, 4) / 1200)
        amp = (0.55 + 0.45 * rng.random()) * (1.0 if i < 8 else 0.85 ** (i - 7))
        note = _bell(t - tt0, f, amp, [1, 2.76, 5.40, 8.93], [1, 0.38, 0.16, 0.06],
                     [0.45, 0.2, 0.09, 0.04], rng, 1.5)
        note += st(hp(rng.standard_normal(n), 6000, 2) * ar(t - tt0, 0.0002, 0.003) * 0.15 * amp)
        p = rng.uniform(-0.7, 0.7)
        x += note * np.array([np.cos((p + 1) * np.pi / 4), np.sin((p + 1) * np.pi / 4)]) * np.sqrt(2)
        idx = int(np.clip(idx + rng.choice([1, 1, 2, 2, -1]), 0, len(scale) - 1))
        tt0 += rng.uniform(0.032, 0.07) * (1 - 0.3 * i / 13)
    grains = np.zeros(n)
    for _ in range(260):
        c = rng.uniform(0.0, 0.9)
        grains += np.exp(-0.5 * ((t - c) / rng.uniform(0.001, 0.004)) ** 2) * rng.uniform(0.2, 1)
    glitter = hp(stereo_noise(rng, n, 0, 0.1), 7500, 2) * (grains * ar(t, 0.05, 0.35))[:, None] * 0.25
    x = x + glitter
    x = reverb(x, make_ir(rng, 1.7, 0.012, 0.1), 0.35)
    x = hp(x, 600, 2)
    return finalize(x, length=1.2, trim=True, fade_in_ms=0.3, fade_out_ms=250)


def _click(rng, t, modes, noise_bw, noise_amp):
    y = np.zeros(len(t))
    for f, d, a in modes:
        f *= 1 + rng.uniform(-0.03, 0.03)
        y += a * np.sin(2 * np.pi * f * t) * ar(t, 0.00015, d)
    y += bp(rng.standard_normal(len(t)), *noise_bw, 2) * ar(t, 0.00008, 0.0012) * noise_amp
    return y


def tick_tock():
    rng = rng_for("tick_tock")
    dur = 4.0
    n = ns(dur)
    x = np.zeros((n, 2))
    te = taxis(0.2)
    tick_modes = [(2950, 0.009, 1.0), (4350, 0.006, 0.6), (6150, 0.004, 0.35), (1150, 0.018, 0.35)]
    tock_modes = [(1550, 0.014, 1.0), (2400, 0.009, 0.55), (3650, 0.006, 0.3), (880, 0.03, 0.45)]
    for k in range(16):
        is_tick = k % 2 == 0
        y = _click(rng, te, tick_modes if is_tick else tock_modes, (2000, 10000), 0.5)
        y *= 10 ** (rng.uniform(-1.0, 1.0) / 20) * (1.0 if is_tick else 0.95)
        x = place(x, pan(y, -0.12 if is_tick else 0.12), k * 0.25)
    x = reverb(x, make_ir(rng, 0.25, 0.002, 0.6), 0.12)
    return finalize(x, length=dur, trim=False, fade_in_ms=0.1, fade_out_ms=20)


def heartbeat():
    rng = rng_for("heartbeat")
    dur = 4.0
    n = ns(dur)
    x = np.zeros(n)
    te = taxis(0.6)
    for b in range(4):
        for off, f_lo, f_hi, dec, amp in ((0.0, 38, 70, 0.095, 1.0), (0.30, 44, 76, 0.075, 0.68)):
            j = 10 ** (rng.uniform(-0.6, 0.6) / 20)
            fr = f_lo + (f_hi - f_lo) * np.exp(-te / 0.035)
            y = np.sin(phase_of(fr)) * ar(te, 0.006, dec) * amp * j
            y += lp(rng.standard_normal(len(te)), 110, 2) * ar(te, 0.004, 0.04) * 0.35 * amp
            x = place(x, y, b * 1.0 + off)
    x = saturate(x, 2.2)
    x = lp(x, 380, 2)
    x = reverb(x, make_ir(rng, 0.6, 0.006, 0.9), 0.1)
    return finalize(x, length=dur, trim=False, fade_in_ms=0.1, fade_out_ms=40)


def squeak():
    rng = rng_for("squeak")
    dur = 0.32
    t = taxis(dur)
    n = len(t)
    f0 = interp_log(t, [0, 0.035, 0.15, 0.24, 0.32], [780, 1120, 1260, 1020, 880])
    f0 = smooth(np.pad(f0, ns(0.01), mode="edge"), 12)[ns(0.01):ns(0.01) + n]
    jitter = smooth(rng.standard_normal(n), 4)
    jitter /= np.std(jitter) + 1e-9
    f0 *= 1 + 0.013 * np.sin(phase_of(np.full(n, 27.0))) + 0.006 * jitter
    ph = phase_of(f0)
    src = np.zeros(n)
    for h in range(1, 40):
        taper = np.clip((16000 - f0 * h) / 3000, 0, 1)  # smooth band-limit, no switching clicks
        src += taper * np.sin(h * ph) / h ** (1.0 if h % 2 else 1.35)
    breath = bp(rng.standard_normal(n), 2000, 8000, 2) * (0.5 + 0.5 * np.sin(ph)) ** 2
    src = src + 0.35 * breath
    f1 = resonator(src, 1750, 5)
    f2 = resonator(src, 3500, 6)
    y = 0.2 * lp(src, 6000, 2) + f1 + 0.75 * f2
    env = np.clip(t / 0.012, 0, 1) ** 2 * np.clip((dur - 0.01 - t) / 0.05, 0, 1) * (0.85 + 0.15 * np.sin(np.pi * t / dur))
    air = bp(rng.standard_normal(n), 300, 900, 2) * env * 0.06
    y = (y * env + air)
    y = saturate(y, 1.3)
    x = reverb(st(y), make_ir(rng, 0.3, 0.003, 0.5), 0.08)
    return finalize(x, length=0.3, trim=True, fade_in_ms=1.0, fade_out_ms=12)


def ding_success():
    rng = rng_for("ding_success")
    dur = 0.95
    t = taxis(dur)
    n = len(t)
    ratios = [1, 2, 3, 4.07, 2.76, 5.6]
    amps = [1, 0.35, 0.12, 0.08, 0.10, 0.04]
    decays = [0.6, 0.32, 0.18, 0.1, 0.07, 0.05]
    x = np.zeros((n, 2))
    for t0, f, a in ((0.0, 1318.5, 0.8), (0.085, 1975.5, 1.0)):
        x += _bell(t - t0, f, a, ratios, amps, decays, rng, 0.8)
        x += st(np.sin(2 * np.pi * f / 2 * (t - t0)) * ar(t - t0, 0.002, 0.25) * 0.18 * a)
        x += st(hp(rng.standard_normal(n), 4000, 2) * ar(t - t0, 0.0002, 0.003) * 0.12 * a)
    x = reverb(x, make_ir(rng, 1.0, 0.01, 0.2), 0.25)
    return finalize(x, length=0.8, trim=True, fade_in_ms=0.3, fade_out_ms=180)


def typewriter_tick():
    rng = rng_for("typewriter_tick")
    t = taxis(0.06)
    y = _click(rng, t, [(2450, 0.0035, 1.0), (3950, 0.0025, 0.55), (6300, 0.0016, 0.3)], (3000, 12000), 0.6)
    y += np.sin(2 * np.pi * 720 * t) * ar(t, 0.0002, 0.005) * 0.3
    x = reverb(st(y), make_ir(rng, 0.08, 0.001, 0.5), 0.05)
    return finalize(x, length=0.05, trim=True, fade_in_ms=0.1, fade_out_ms=10)


def camera_flash():
    rng = rng_for("camera_flash")
    dur = 0.28
    t = taxis(dur)
    n = len(t)
    pop = bp(rng.standard_normal(n), 1000, 12000, 2) * ar(t, 0.0002, 0.004) * 1.0
    pop += _click(rng, t, [(1900, 0.010, 0.8), (4400, 0.006, 0.4)], (3000, 12000), 0.4)
    flash = hp(stereo_noise(rng, n, 0, 0.3), 5000, 2) * ar(t, 0.002, 0.06)[:, None] * 0.35
    zing = np.sin(phase_of(interp_log(t, [0, 0.12], [7200, 3400]))) * ar(t, 0.003, 0.05) * 0.12
    thup = np.sin(phase_of(80 + 80 * np.exp(-t / 0.01))) * ar(t, 0.0008, 0.02) * 0.35
    x = st(pop + thup) + flash + pan(zing, 0.2)
    x = reverb(x, make_ir(rng, 0.5, 0.004, 0.3), 0.12)
    return finalize(x, length=0.25, trim=True, fade_in_ms=0.2, fade_out_ms=40)


# name -> (generator, description, which time matters for editors)
SOUNDS = {
    "whoosh_short": (whoosh_short, "airy swish for a quick cut", "loudest"),
    "whoosh_long": (whoosh_long, "big swoosh, rising then passing", "loudest"),
    "whoosh_reverse": (whoosh_reverse, "reverse-cymbal swell, hard stop at 1.500 s", "end"),
    "impact_big": (impact_big, "title slam: sub drop + transient + long tail", "onset"),
    "impact_soft": (impact_soft, "warm thump for text cards", "onset"),
    "riser_4s": (riser_4s, "tension riser, loudest at the 4.000 s cut", "end"),
    "stop_hit": (stop_hit, "comedic tape-stop 'everything stops' hit", "onset"),
    "pencil_scribble": (pencil_scribble, "handwriting on paper", "start"),
    "pencil_strike": (pencil_strike, "quick decisive pencil line (cross-off)", "onset"),
    "paper_flip": (paper_flip, "paper card flick/slide", "onset"),
    "sparkle": (sparkle, "golden glint shimmer", "onset"),
    "tick_tock": (tick_tock, "clock ticks, 120 bpm eighths (0.25 s grid)", "grid"),
    "heartbeat": (heartbeat, "sub heartbeat lub-dub every 1.0 s", "grid"),
    "squeak": (squeak, "rubber duck squeak", "onset"),
    "ding_success": (ding_success, "'plan worked' chime", "onset"),
    "typewriter_tick": (typewriter_tick, "tiny UI tick for text characters", "onset"),
    "camera_flash": (camera_flash, "bright flash/pop accent", "onset"),
}


# ----------------------------------------------------------------------------
# validation
# ----------------------------------------------------------------------------
def onset_novelty(mono, win=256, hop=48):
    """Log-magnitude spectral flux. Returns (flux, centre sample of each frame)."""
    pad = np.pad(mono, (win, win))
    nfr = 1 + (len(pad) - win) // hop
    idx = np.arange(win)[None, :] + hop * np.arange(nfr)[:, None]
    frames = pad[idx] * np.hanning(win)[None, :]
    mag = np.log1p(1e4 * np.abs(np.fft.rfft(frames, axis=1)))
    flux = np.maximum(0, np.diff(mag, axis=0, prepend=mag[:1])).sum(1)
    centres = hop * np.arange(nfr) + win // 2 - win
    return flux, centres


def refine_onset(env, i_guess, sr=SR):
    """Move to the first sample (±15 ms) where the envelope reaches -12 dB of the local max."""
    a, b = max(0, i_guess - ns(0.015)), min(len(env), i_guess + ns(0.03))
    seg = env[a:b]
    if len(seg) == 0:
        return i_guess
    thr = seg.max() * 10 ** (-12 / 20)
    return a + int(np.argmax(seg >= thr))


def analyse(path: Path, kind: str):
    x, sr = sf.read(path, always_2d=True)
    info = sf.info(path)
    mono = x.mean(1)
    absmax = np.max(np.abs(x))
    env = np.convolve(np.abs(mono), np.ones(ns(0.001)) / ns(0.001), mode="same")
    flux, centres = onset_novelty(mono)
    hop = centres[1] - centres[0]
    thr = (0.15 if kind == "grid" else 0.3) * flux.max()
    peaks, _ = signal.find_peaks(flux, height=thr, distance=max(1, ns(0.12) // hop))
    first = int(peaks[0]) if len(peaks) else int(np.argmax(flux))
    onset = refine_onset(env, max(0, int(centres[first]))) / sr
    win = ns(0.010)
    rms = np.sqrt(np.convolve(mono ** 2, np.ones(win) / win, mode="same"))
    loudest = np.argmax(rms) / sr
    lead = np.argmax(np.any(np.abs(x) > 10 ** (-60 / 20), axis=1)) / sr
    start = np.argmax(env > env.max() * 10 ** (-30 / 20)) / sr  # first sound within 30 dB of max
    res = dict(
        name=path.stem, kind=kind, sr=sr, subtype=info.subtype, ch=x.shape[1],
        dur=len(x) / sr, peak_db=20 * np.log10(absmax), tp_db=20 * np.log10(true_peak(x)),
        dc=float(np.max(np.abs(x.mean(0)))), lead_ms=lead * 1000, start=start, onset=onset, loudest=loudest,
        edge=float(max(np.abs(x[0]).max(), np.abs(x[-1]).max())),
    )
    if kind == "grid":
        ons = [refine_onset(env, max(0, int(centres[p]))) / sr for p in peaks]
        res["onsets"] = ons
    return res


def check(r):
    ok = r["peak_db"] <= -1.0 and r["tp_db"] <= -1.0 and r["dc"] < 1e-4 and r["edge"] < 1e-3
    ok &= r["sr"] == SR and r["subtype"] == "PCM_24" and r["ch"] == 2
    if r["kind"] not in ("loudest", "end", "grid"):
        ok &= r["lead_ms"] <= 5.0
    return ok


def write_readme(results):
    lines = [
        "# Trailer SFX pack — 완벽한 불청객",
        "",
        "Original, procedurally synthesized non-diegetic trailer SFX (no samples).",
        "48 kHz / 24-bit / stereo WAV, true-peak normalized to -1.2 dBTP, DC-free, faded edges.",
        "",
        "Regenerate (deterministic, fixed seed):",
        "",
        "```sh",
        "uv venv --python 3.12 trailer/.venv-sfx && uv pip install --python trailer/.venv-sfx/bin/python numpy scipy soundfile",
        "trailer/.venv-sfx/bin/python trailer/audio/sfx/make_sfx.py",
        "```",
        "",
        "## Files (measured by make_sfx.py)",
        "",
        "`onset` = first transient by log spectral-flux onset detection (refined to -12 dB of local max);",
        "`loudest` = centre of the loudest 10 ms RMS window. The **key** column is the time to sync on.",
        "",
        "| file | description | duration | key sync point | onset | loudest | peak dBFS | true peak dBTP | lead silence | ok |",
        "|---|---|---|---|---|---|---|---|---|---|",
    ]
    for r in results:
        k = r["kind"]
        if k == "loudest":
            key = f"peak at {r['loudest']:.3f} s"
        elif k == "end":
            key = f"hard cut at {r['dur']:.3f} s (loudest {r['loudest']:.3f} s)"
        elif k == "grid":
            ons = r["onsets"]
            key = f"{len(ons)} hits, first {ons[0]:.3f} s: " + ", ".join(f"{o:.3f}" for o in ons)
        elif k == "start":
            key = f"starts at {r['start']:.3f} s (stroke rhythm through ~1.38 s)"
        else:
            key = f"transient at {r['onset']:.3f} s"
        lines.append(
            f"| `{r['name']}.wav` | {SOUNDS[r['name']][1]} | {r['dur']:.3f} s | {key} | {r['onset']:.3f} s"
            f" | {r['loudest']:.3f} s | {r['peak_db']:.2f} | {r['tp_db']:.2f} | {r['lead_ms']:.1f} ms"
            f" | {'yes' if check(r) else 'NO'} |"
        )
    lines += [
        "",
        "Notes: whooshes, `whoosh_reverse`, `riser_4s`, `tick_tock` and `heartbeat` keep their exact",
        "timing grid (no leading-silence trim), so their leading silence is intentional/zero. All other files",
        "start within 5 ms. `heartbeat` lubs begin at the exact second (sample 0, 1 s, ...); the ~2 ms",
        "measured offset is the soft 6 ms attack reaching -12 dB of its peak. Levels are peak-normalized",
        "for a library; set relative levels in the edit.",
        "",
    ]
    (OUT / "README.md").write_text("\n".join(lines), encoding="utf-8")


def main():
    results = []
    for name, (fn, _desc, kind) in SOUNDS.items():
        x = fn()
        path = OUT / f"{name}.wav"
        sf.write(path, x.astype(np.float64), SR, subtype="PCM_24")
        r = analyse(path, kind)
        results.append(r)
        extra = ""
        if "onsets" in r:
            extra = " onsets=" + ",".join(f"{o:.3f}" for o in r["onsets"])
        print(f"{name:16s} dur={r['dur']:.3f} peak={r['peak_db']:6.2f} tp={r['tp_db']:6.2f} "
              f"dc={r['dc']:.1e} lead={r['lead_ms']:5.1f}ms onset={r['onset']:.3f} "
              f"loud={r['loudest']:.3f} edge={r['edge']:.1e} {'OK' if check(r) else 'FAIL'}{extra}")
    write_readme(results)


if __name__ == "__main__":
    main()
