#!/usr/bin/env python3
"""Korean narration VO for the trailer (n01-n12 in trailer/docs/CUESHEET.md).

Model : Supertone "Supertonic 3" (ONNX, CPU, OpenRAIL-M) via the `supertonic` PyPI SDK.
ASR   : mlx-whisper + mlx-community/whisper-large-v3-turbo (Apple Silicon) for verification.
Post  : "..." = phrases synthesized separately + explicit silence; trim to 30 ms head/tail;
        resample 44.1k -> 48k (soxr VHQ); 4:1 compressor + make-up gain to -16 LUFS integrated
        + look-ahead true-peak limiter (<= -1.5 dBTP), verified with ffmpeg ebur128;
        written as 48 kHz 24-bit mono PCM WAV.

Install (from repo root; venv is git-ignored via trailer/.gitignore):
    uv venv --python 3.12 trailer/.venv-tts            # (pip install uv  if uv is missing)
    uv pip install --python trailer/.venv-tts/bin/python \
        supertonic==1.3.1 mlx-whisper==0.4.3 pyloudnorm==0.2.0 soxr numpy soundfile librosa
    # (tested: onnxruntime 1.30.0, mlx 0.32.3, numpy 2.5.3, ffmpeg 9.0.1, macOS / Apple M4)
    # ffmpeg must be on PATH (brew install ffmpeg)

Run:
    trailer/.venv-tts/bin/python trailer/audio/tts/make_tts.py            # main voice + alts
    trailer/.venv-tts/bin/python trailer/audio/tts/make_tts.py --only main

First run downloads ~400 MB of Supertonic weights (into trailer/.venv-tts/models) and
~1.6 GB of Whisper weights (into ~/.cache/huggingface).
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
import soundfile as sf
import soxr
import pyloudnorm as pyln

HERE = Path(__file__).resolve().parent
TRAILER = HERE.parent.parent
os.environ.setdefault("SUPERTONIC_CACHE_DIR", str(TRAILER / ".venv-tts" / "models"))

from supertonic import TTS  # noqa: E402
from supertonic.config import get_model_config  # noqa: E402

MODEL = "supertonic-3"
MAIN_VOICE = "M2"
ALT_VOICES = ["M5", "M3"]
TOTAL_STEPS = 32          # flow-matching steps (default 8); more = cleaner, still fast on CPU
SEEDS = list(range(1, 13))  # tried in order; first render that passes ASR + length wins
OUT_SR = 48000
PAD_S = 0.030             # silence kept before onset / after offset
TARGET_LUFS = -16.0
TARGET_TP = -1.5          # aim a bit under -1 dBTP for headroom
ASR_REPO = "mlx-community/whisper-large-v3-turbo"

# segments: list of phrases synthesized separately and joined with `pause` seconds of
# silence (used for "..." beats; the model only gives a very short gap for an ellipsis).
LINES = [
    dict(id="n01", start=14.40, text="초대장은... 없다.", segments=["초대장은...", "없다."], pause=0.50, speed=0.92, max_s=2.0),
    dict(id="n02", start=16.60, text="괜찮아. 황금 오리만 가져가면 되니까.", segments=None, speed=0.95, max_s=3.4),
    dict(id="n03", start=22.20, text="섞여들거나.", segments=None, speed=1.00, max_s=1.3),
    dict(id="n04", start=26.20, text="꾀어내거나.", segments=None, speed=1.00, max_s=1.3),
    dict(id="n05", start=30.20, text="불을 끄거나.", segments=None, speed=1.00, max_s=1.3),
    dict(id="n06", start=34.20, text="재우거나.", segments=None, speed=1.00, max_s=1.3),
    dict(id="n07", start=38.20, text="급하게 만들거나.", segments=None, speed=1.00, max_s=1.3),
    dict(id="n08", start=42.15, text="슬쩍하거나.", segments=None, speed=1.05, max_s=1.2),
    dict(id="n09", start=44.15, text="판을 키우거나.", segments=None, speed=1.05, max_s=1.2),
    dict(id="n10", start=46.40, text="아니면... 아무도 모르게.", segments=["아니면...", "아무도 모르게."], pause=0.45, speed=0.92, max_s=3.0),
    dict(id="n11", start=84.60, text="완벽한 불청객.", segments=None, speed=0.88, max_s=2.4),
    dict(id="n12", start=87.20, text="길은 여럿. 오리는 하나.", segments=None, speed=0.90, max_s=3.0),
]


# ----------------------------------------------------------------------------- audio utils
def frame_db(y: np.ndarray, sr: int, win=0.010) -> np.ndarray:
    n = max(1, int(sr * win))
    k = len(y) // n
    fr = y[: k * n].reshape(k, n)
    return 20 * np.log10(np.sqrt((fr ** 2).mean(axis=1)) + 1e-9), n


def speech_bounds(y: np.ndarray, sr: int, rel_db=45.0, floor_db=-60.0):
    db, n = frame_db(y, sr)
    thr = max(db.max() - rel_db, floor_db)
    idx = np.where(db > thr)[0]
    if len(idx) == 0:
        return 0, len(y)
    return idx[0] * n, min(len(y), (idx[-1] + 1) * n)


def ffmpeg(*args):
    r = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-y", *args], capture_output=True, text=True)
    if r.returncode:
        raise RuntimeError(r.stderr[-2000:])
    return r.stderr


def true_peak_env(y: np.ndarray) -> np.ndarray:
    """Per-sample true-peak estimate (4x oversampled, BS.1770-style)."""
    up = soxr.resample(y, OUT_SR, OUT_SR * 4, quality="VHQ")
    up = np.abs(np.pad(up, (0, max(0, len(y) * 4 - len(up)))))[: len(y) * 4]
    return up.reshape(len(y), 4).max(axis=1)


def tp_limit(y: np.ndarray, ceil_db: float) -> np.ndarray:
    """Look-ahead true-peak limiter: 1.5 ms attack ramp, 60 ms release."""
    sr, ceil = OUT_SR, 10 ** (ceil_db / 20)
    L = int(0.0015 * sr)
    for _ in range(8):
        pk = true_peak_env(y)
        if pk.max() <= ceil:
            break
        g = np.minimum(1.0, ceil / np.maximum(pk, 1e-9))
        gp = np.concatenate([g, np.ones(2 * L)])
        gmin = np.array([gp[i:i + 2 * L].min() for i in range(len(g))])  # look ahead 2L
        a = np.exp(-1.0 / (0.060 * sr))
        r = np.empty_like(gmin)
        prev = 1.0
        for i, v in enumerate(gmin):
            prev = min(v, 1.0 - (1.0 - prev) * a)
            r[i] = prev
        sm = np.convolve(np.concatenate([np.ones(L), r]), np.ones(L) / L, mode="valid")[: len(y)]
        y = y * np.minimum(sm, r)
        ceil *= 10 ** (-0.05 / 20)  # tighten a hair if oversampled peaks still poke over
    return y


COMPRESSOR = "acompressor=threshold=0.04:ratio=4:attack=3:release=70:knee=4:detection=rms"


def ffmpeg_filter(y: np.ndarray, af: str) -> np.ndarray:
    with tempfile.TemporaryDirectory() as td:
        a, b = Path(td) / "a.wav", Path(td) / "b.wav"
        sf.write(str(a), y.astype(np.float32), OUT_SR, subtype="FLOAT")
        ffmpeg("-i", str(a), "-af", af, "-c:a", "pcm_f32le", str(b))
        z, _ = sf.read(str(b))
    return z[: len(y)]


def normalize(y: np.ndarray) -> tuple[np.ndarray, dict]:
    """VO chain: pre-gain to -23 LUFS -> 4:1 soft-knee RMS compressor (ffmpeg acompressor,
    threshold -28 dBFS) -> make-up gain to TARGET_LUFS (BS.1770, pyloudnorm) -> look-ahead
    true-peak limiter to TARGET_TP.

    ffmpeg's loudnorm was the first choice, but for clips < 3 s it always falls back to its
    dynamic mode (3 s analysis window) and lands 1-3 LU off target, so the equivalent
    linear-gain + look-ahead TP limiter is done here and verified with ffmpeg ebur128.
    """
    meter = pyln.Meter(OUT_SR)
    # pad only if shorter than one 400 ms gating block (padding skews short clips otherwise)
    padded = lambda z: z if len(z) >= 0.45 * OUT_SR else np.concatenate([z, np.zeros(int(0.45 * OUT_SR) - len(z))])
    in_lufs = meter.integrated_loudness(padded(y))
    y = ffmpeg_filter(y * 10 ** ((-23.0 - in_lufs) / 20), COMPRESSOR)
    out = y
    gain_db = 0.0
    for _ in range(6):  # limiting lowers loudness slightly: iterate the make-up gain
        gain_db += TARGET_LUFS - meter.integrated_loudness(padded(out))
        out = tp_limit(y * 10 ** (gain_db / 20), TARGET_TP)
    peak_red = 20 * np.log10(np.abs(y * 10 ** (gain_db / 20)).max() / np.abs(out).max())
    return out, dict(input_lufs=round(in_lufs, 2), makeup_gain_db=round(gain_db, 2), limiter_gr_db=round(peak_red, 2))


def write48(path: Path, y: np.ndarray):
    sf.write(str(path), y, OUT_SR, subtype="PCM_24")


def measure(path: Path) -> dict:
    err = ffmpeg("-i", str(path), "-af", "ebur128=peak=true", "-f", "null", "-")
    s = err[err.rindex("Summary:"):]
    i = float(re.search(r"I:\s+(-?[\d.]+) LUFS", s).group(1))
    tp = float(re.search(r"Peak:\s+(-?[\d.]+|-inf) dBFS", s).group(1))
    y, sr = sf.read(str(path))
    a, b = speech_bounds(y, sr)
    return dict(lufs_integrated=i, true_peak_dbtp=tp, sample_peak=float(np.abs(y).max()),
                lead_silence_ms=round(a / sr * 1000, 1), tail_silence_ms=round((len(y) - b) / sr * 1000, 1))


# ----------------------------------------------------------------------------- ASR
def hangul(s: str) -> str:
    return re.sub(r"[^가-힣]", "", s)


def cer(ref: str, hyp: str) -> float:
    a, b = hangul(ref), hangul(hyp)
    # Levenshtein distance on Hangul syllables
    d = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        prev, d[0] = d[0], i
        for j, cb in enumerate(b, 1):
            prev, d[j] = d[j], min(d[j] + 1, d[j - 1] + 1, prev + (ca != cb))
    return d[len(b)] / max(1, len(a))


def transcribe(path: Path) -> str:
    import mlx_whisper
    import librosa
    y, _ = librosa.load(str(path), sr=16000)
    r = mlx_whisper.transcribe(y, path_or_hf_repo=ASR_REPO, language="ko", temperature=0.0,
                               condition_on_previous_text=False)
    return r["text"].strip()


# ----------------------------------------------------------------------------- render
def synth(tts: TTS, style, text: str, speed: float, seed: int) -> np.ndarray:
    np.random.seed(seed)  # the SDK samples its initial latent noise from np.random
    w, _ = tts.synthesize(text, voice_style=style, lang="ko", speed=speed, total_steps=TOTAL_STEPS)
    return w[0].astype(np.float64)


def render_line(tts, style, line, seed, tmpdir: Path):
    sr = tts.sample_rate
    segs = line["segments"] or [line["text"]]
    raw_peak = 0.0
    parts = []
    for k, s in enumerate(segs):
        y = synth(tts, style, s, line["speed"], seed)
        raw_peak = max(raw_peak, float(np.abs(y).max()))
        a, b = speech_bounds(y, sr)
        parts.append(y[a:b])
        if k < len(segs) - 1:
            parts.append(np.zeros(int(line["pause"] * sr)))
    y = np.concatenate(parts)
    p = int(PAD_S * sr)
    y = np.concatenate([np.zeros(p), y, np.zeros(p)])
    fi, fo = int(0.003 * sr), int(0.015 * sr)
    y[p:p + fi] *= np.linspace(0, 1, fi)
    y[len(y) - p - fo:len(y) - p] *= np.linspace(1, 0, fo)
    y = soxr.resample(y, sr, OUT_SR, quality="VHQ")  # 44.1k -> 48k
    y, ln = normalize(y)
    dst = tmpdir / f"{line['id']}_{seed}.wav"
    write48(dst, y)
    return dst, raw_peak, ln


def render_voice(tts: TTS, voice: str, outdir: Path, log=print) -> list[dict]:
    outdir.mkdir(parents=True, exist_ok=True)
    style = tts.get_voice_style(voice)
    results = []
    with tempfile.TemporaryDirectory() as td:
        td = Path(td)
        for line in LINES:
            best = None
            for seed in SEEDS:
                dst, raw_peak, ln = render_line(tts, style, line, seed, td)
                dur = sf.info(str(dst)).duration
                hyp = transcribe(dst)
                c = cer(line["text"], hyp)
                ok = c == 0.0 and dur <= line["max_s"]
                log(f"  {voice} {line['id']} seed={seed} {dur:.3f}s cer={c:.2f} {'OK ' if ok else 'bad'} | {hyp}")
                cand = dict(seed=seed, dst=dst, dur=dur, hyp=hyp, cer=c, raw_peak=raw_peak, ln=ln, ok=ok)
                if best is None or (c, dur > line["max_s"]) < (best["cer"], best["dur"] > line["max_s"]):
                    best = cand
                if ok:
                    best = cand
                    break
            final = outdir / f"{line['id']}.wav"
            shutil.copyfile(best["dst"], final)
            meas = measure(final)
            results.append(dict(
                id=line["id"], start_seconds=line["start"], text=line["text"],
                file=str(final.relative_to(HERE)), duration_seconds=round(best["dur"], 3),
                max_seconds=line["max_s"], fits=best["dur"] <= line["max_s"],
                asr_transcript=best["hyp"], asr_cer=round(best["cer"], 3), voice=voice,
                settings=dict(model=MODEL, model_revision=get_model_config(MODEL)["revision"],
                              voice_style=voice, lang="ko", speed=line["speed"], total_steps=TOTAL_STEPS,
                              seed=best["seed"], segments=line["segments"] or [line["text"]],
                              pause_seconds=line.get("pause") if line["segments"] else None,
                              pad_seconds=PAD_S, compressor=COMPRESSOR, loudness_target=f"I={TARGET_LUFS} LUFS, TP<={TARGET_TP} dBTP",
                              normalize=best["ln"]),
                raw_model_peak=round(best["raw_peak"], 4), clipped=best["raw_peak"] >= 0.999,
                **meas,
            ))
    return results


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", choices=["main", "alts", "all"], default="all")
    args = ap.parse_args()
    tts = TTS(model=MODEL)
    jobs = []
    if args.only in ("main", "all"):
        jobs.append((MAIN_VOICE, HERE, HERE / "lines.json"))
    if args.only in ("alts", "all"):
        jobs += [(v, HERE / "alt" / v, HERE / "alt" / v / "lines.json") for v in ALT_VOICES]
    for voice, outdir, jpath in jobs:
        print(f"== {voice} -> {outdir}", flush=True)
        res = render_voice(tts, voice, outdir, log=lambda s: print(s, flush=True))
        jpath.write_text(json.dumps(res, ensure_ascii=False, indent=2) + "\n")
        for r in res:
            flag = "" if (r["fits"] and r["asr_cer"] == 0) else "  <-- CHECK"
            print(f"{r['id']} {r['duration_seconds']:.3f}s/{r['max_seconds']}s  {r['lufs_integrated']:.1f} LUFS "
                  f"TP {r['true_peak_dbtp']:.1f}  seed {r['settings']['seed']}  | {r['asr_transcript']}{flag}")
    return 0


if __name__ == "__main__":
    rc = main()
    sys.stdout.flush()
    os._exit(rc)  # skip MLX/onnxruntime teardown (it can abort with a mutex error at exit)
