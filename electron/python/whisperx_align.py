#!/usr/bin/env python3
# ruff: noqa: E402
"""Align plain-text lyric lines to audio using whisperx.

Steps:
  1. Transcribe vocals with whisperx (base model, CPU, int8).
  2. Run word-level forced alignment.
  3. Map each lyric line to the nearest word timestamp (proportional distribution).
  4. Output JSON: [{start: float, text: str}, ...]

Usage:
    python whisperx_align.py <audio_path> <lyrics_txt_path> <language>

<lyrics_txt_path> must be a plain-text file with one lyric line per row
(no LRC timestamps).  <language> is an ISO 639-1 code: zh, en, ja, ko, etc.
"""

import json
import os
import platform
import ssl
import sys

# Bypass SSL verification for model downloads (torch.hub, HuggingFace, etc.)
ssl._create_default_https_context = ssl._create_unverified_context
os.environ["PYTHONHTTPSVERIFY"] = "0"
os.environ["CURL_CA_BUNDLE"] = ""
os.environ["REQUESTS_CA_BUNDLE"] = ""
# Suppress tqdm progress bars to stderr so stdout stays clean JSON
os.environ["TQDM_DISABLE"] = "1"


class _StderrProxy:
    """Redirect stdout writes to stderr during model processing."""

    def write(self, s):
        sys.stderr.write(s)

    def flush(self):
        sys.stderr.flush()


def _detect_device() -> str:
    """Return the best available torch device: mps > cuda > cpu."""
    try:
        import torch  # noqa: PLC0415
        if torch.backends.mps.is_available():
            return "mps"
        if torch.cuda.is_available():
            return "cuda"
    except Exception:
        pass
    return "cpu"


def evenly_distribute(audio, lrc_lines):
    """Fallback: assign evenly-spaced timestamps when alignment is unavailable."""
    duration = len(audio) / 16000.0
    step = duration / len(lrc_lines)
    return [{"start": round(i * step, 3), "text": line} for i, line in enumerate(lrc_lines)]


def main():
    if len(sys.argv) < 4:
        sys.stdout.write(json.dumps({"error": "Usage: whisperx_align.py <audio> <lyrics> <language>"}) + "\n")
        sys.exit(1)

    audio_path = sys.argv[1]
    lyrics_path = sys.argv[2]
    language = sys.argv[3]

    try:
        import whisperx  # noqa: PLC0415
    except ImportError:
        sys.stderr.write("whisperx 未安装，请运行: pip install whisperx\n")
        sys.exit(1)

    # Redirect stdout → stderr so model progress/warnings don't corrupt JSON output
    _real_stdout = sys.stdout
    sys.stdout = _StderrProxy()

    try:
        device = _detect_device()
        sys.stderr.write(f"[whisperx_align] device={device}\n")

        with open(lyrics_path, encoding="utf-8") as f:
            lrc_lines = [line.strip() for line in f if line.strip()]

        if not lrc_lines:
            _real_stdout.write(json.dumps([]) + "\n")
            return

        audio = whisperx.load_audio(audio_path)

        # ── Step 1: Transcribe ────────────────────────────────────────────────
        # faster-whisper (used by whisperx) only supports cpu/cuda, not mps
        transcribe_device = "cpu" if device == "mps" else device
        compute_type = "int8" if transcribe_device == "cpu" else "float16"
        try:
            model = whisperx.load_model(
                "base",
                device=transcribe_device,
                language=language,
                compute_type=compute_type,
            )
            result = model.transcribe(audio, batch_size=4)
        except Exception as exc:
            sys.stderr.write(f"[warning] transcription failed: {exc}\n")
            _real_stdout.write(json.dumps(evenly_distribute(audio, lrc_lines)) + "\n")
            return

        if not result.get("segments"):
            _real_stdout.write(json.dumps(evenly_distribute(audio, lrc_lines)) + "\n")
            return

        # ── Step 2: Word-level alignment ──────────────────────────────────────
        # Alignment model (wav2vec2) supports mps via PyTorch
        try:
            model_a, metadata = whisperx.load_align_model(
                language_code=language, device=device
            )
            result = whisperx.align(
                result["segments"],
                model_a,
                metadata,
                audio,
                device=device,
                return_char_alignments=False,
            )
        except Exception as exc:
            sys.stderr.write(f"[warning] word-level align failed: {exc}\n")
            # Continue with segment-level timestamps

        # ── Step 3: Collect word timestamps ───────────────────────────────────
        all_words = []
        for seg in result.get("segments", []):
            words = seg.get("words", [])
            if words:
                for w in words:
                    start = w.get("start")
                    if start is not None:
                        all_words.append({"word": w.get("word", ""), "start": float(start)})
            else:
                seg_start = seg.get("start")
                if seg_start is not None:
                    all_words.append({"word": seg.get("text", ""), "start": float(seg_start)})

        if not all_words:
            _real_stdout.write(json.dumps(evenly_distribute(audio, lrc_lines)) + "\n")
            return

        # ── Step 4: Map lyric lines → word timestamps (proportional) ──────────
        words_per_line = len(all_words) / len(lrc_lines)
        output = []
        for i, line in enumerate(lrc_lines):
            word_idx = min(int(i * words_per_line), len(all_words) - 1)
            output.append({"start": all_words[word_idx]["start"], "text": line})

        _real_stdout.write(json.dumps(output) + "\n")

    finally:
        sys.stdout = _real_stdout


if __name__ == "__main__":
    main()
