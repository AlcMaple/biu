#!/usr/bin/env python3
"""SSL-patched wrapper around demucs vocal separation.

Usage:
    python demucs_separate.py --two-stems=vocals -o <output_dir> <audio_path>

Automatically converts the input to a 44100 Hz stereo WAV via ffmpeg before
running demucs, so that torchaudio can load it regardless of which audio
backend (soundfile / sox / ffmpeg) happens to be installed.
"""

import os
import shutil
import ssl
import subprocess
import sys

# Bypass SSL certificate verification for model downloads.
ssl._create_default_https_context = ssl._create_unverified_context
os.environ["PYTHONHTTPSVERIFY"] = "0"
os.environ["CURL_CA_BUNDLE"] = ""
os.environ["REQUESTS_CA_BUNDLE"] = ""


def _pip_install(package: str) -> bool:
    """Install *package* silently. Returns True on success."""
    result = subprocess.run(
        [sys.executable, "-m", "pip", "install", package, "-q"],
        capture_output=True,
        timeout=120,
    )
    return result.returncode == 0


# ── Ensure torchaudio has a working audio backend ────────────────────────────
# torchaudio needs one of: soundfile, sox_io, or its own ffmpeg binaries.
# On many conda/venv setups none of these are present by default, causing
# "Couldn't find appropriate backend" when demucs tries to save vocals.wav.
# soundfile is tiny and provides a reliable backend; install it if missing.
try:
    import soundfile  # noqa: F401
except ImportError:
    _pip_install("soundfile")
    try:
        import soundfile  # noqa: F401
    except ImportError:
        pass  # will proceed; demucs may raise its own error later

try:
    from demucs.separate import main  # noqa: PLC0415
except ImportError:
    print("demucs 未安装，请运行: pip install demucs", file=sys.stderr)
    sys.exit(1)


def find_ffmpeg() -> str | None:
    """Return the path to ffmpeg, or None if not found."""
    return shutil.which("ffmpeg") or shutil.which("ffmpeg.exe")


def convert_to_wav(src: str, dst: str) -> bool:
    """Convert *src* to a 44100 Hz stereo PCM WAV at *dst* using ffmpeg.
    Returns True on success."""
    ffmpeg = find_ffmpeg()
    if not ffmpeg:
        return False
    result = subprocess.run(
        [ffmpeg, "-y", "-i", src, "-ar", "44100", "-ac", "2", dst],
        capture_output=True,
        timeout=300,
    )
    return result.returncode == 0


# ── Parse argv to find the audio file argument ────────────────────────────────
# Our caller always puts the audio path as the last positional argument.
# We make a copy of sys.argv so we can replace it transparently.
original_args = sys.argv[1:]  # drop script name

# The audio file is the last non-option argument.
audio_arg_index = None
for i in range(len(original_args) - 1, -1, -1):
    if not original_args[i].startswith("-"):
        audio_arg_index = i
        break

wav_tmp = None  # temp WAV path (same dir + stem as original); cleaned up after demucs

if audio_arg_index is not None:
    input_path = original_args[audio_arg_index]
    if not input_path.lower().endswith(".wav"):
        # Place the WAV next to the original with the same stem so that the
        # demucs output directory name is predictable (htdemucs/<stem>/vocals.wav).
        stem = os.path.splitext(os.path.basename(input_path))[0]
        wav_tmp = os.path.join(os.path.dirname(input_path), stem + ".wav")
        if convert_to_wav(input_path, wav_tmp):
            original_args = list(original_args)
            original_args[audio_arg_index] = wav_tmp
        else:
            # Conversion failed — proceed with original; demucs may still work.
            if os.path.exists(wav_tmp):
                os.unlink(wav_tmp)
            wav_tmp = None

try:
    sys.argv = ["demucs"] + list(original_args)
    main()
finally:
    if wav_tmp and os.path.exists(wav_tmp):
        os.unlink(wav_tmp)
