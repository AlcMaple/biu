#!/usr/bin/env python3
"""
Shazam song recognition script.
Usage: python3 shazam_recognize.py <audio_file_path>
Outputs JSON to stdout.
"""
import asyncio
import json
import shutil
import subprocess
import sys
from pathlib import Path


def convert_to_wav(input_path: str) -> str | None:
    """Convert audio file to WAV using ffmpeg. Returns new path or None on failure."""
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        return None

    output_path = str(Path(input_path).with_suffix(".wav"))
    try:
        result = subprocess.run(
            [ffmpeg, "-i", input_path, "-ar", "44100", "-ac", "1", "-f", "wav", output_path, "-y"],
            capture_output=True,
            timeout=30,
        )
        if result.returncode == 0 and Path(output_path).exists():
            return output_path
    except Exception:
        pass
    return None


async def recognize(file_path: str) -> dict:
    from shazamio import Shazam

    shazam = Shazam()
    return await shazam.recognize(file_path)


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: shazam_recognize.py <file_path>"}))
        sys.exit(1)

    input_path = sys.argv[1]

    if not Path(input_path).exists():
        print(json.dumps({"error": f"File not found: {input_path}"}))
        sys.exit(1)

    try:
        import shazamio  # noqa: F401
    except ImportError:
        print(json.dumps({"error": "shazamio not installed. Please run: pip install shazamio"}))
        sys.exit(1)

    # Try to convert to WAV for better compatibility
    wav_path = convert_to_wav(input_path)
    recognize_path = wav_path if wav_path else input_path
    cleanup_wav = wav_path is not None

    try:
        result = asyncio.run(recognize(recognize_path))
        print(json.dumps(result, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)
    finally:
        if cleanup_wav and wav_path:
            try:
                Path(wav_path).unlink(missing_ok=True)
            except Exception:
                pass


if __name__ == "__main__":
    main()
