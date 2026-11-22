#!/usr/bin/env python3
# /// script
# requires-python = ">=3.12,<3.14"
# dependencies = ["kokoro-onnx>=0.4.9", "soundfile>=0.12"]
# ///
"""Build the audio version of a blog entry.

Reads ``blog/<entry>/index.html``, turns the article body into a narration
script (tables become sentences, code blocks and the source list are
summarised rather than spelled out), then renders ``audio.mp3`` next to the
page with the Kokoro neural voice (runs locally, no network at render time)
and ``ffmpeg``.

Usage:
    uv run tools/build_blog_audio.py blog/log-002
    uv run tools/build_blog_audio.py blog/log-002 --voice am_michael
    uv run tools/build_blog_audio.py blog/log-002 --text-only   # print the script, render nothing

Requirements: ``uv`` (installs the Python dependencies declared above into a
throwaway environment) and ``ffmpeg`` on PATH. The model files are fetched
once into ``~/.cache/kokoro-onnx`` and checked against the SHA-256 digests
below before every use.
"""

from __future__ import annotations

import argparse
import hashlib
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.request
from html.parser import HTMLParser
from pathlib import Path
from typing import NamedTuple

VOICE = "af_heart"
SPEED = 1.0
MP3_BITRATE = "64k"  # mono speech; a ten-minute entry lands near 5 MB

MODEL_DIR = Path.home() / ".cache" / "kokoro-onnx"
MODEL_URL = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/"
# Pinned digests: the model is executable-adjacent input, so a changed file is refused.
MODEL_FILES: dict[str, str] = {
    "kokoro-v1.0.onnx": "7d5df8ecf7d4b1878015a32686053fd0eebe2bc377234608764cc0ef3636a6c5",
    "voices-v1.0.bin": "bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d",
}

# Silence after each kind of block, in seconds. A reader pauses longer around
# a heading than between two paragraphs; one flat gap is what sounds mechanical.
PAUSE_SECONDS: dict[str, float] = {"title": 1.0, "heading": 0.8, "text": 0.45}
PAUSE_BEFORE_HEADING = 0.5


class Block(NamedTuple):
    kind: str  # "title", "heading" or "text"
    text: str

# Sections whose body is replaced by one spoken line.
SUMMARISED_SECTIONS: dict[str, str] = {
    "sources": "The sources for this entry are listed at the end of the written version.",
}
CODE_PLACEHOLDER = "The exact text is shown in the written version."


class NarrationParser(HTMLParser):
    """Collect speakable lines from the ``<main>`` element of an entry page."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.lines: list[Block] = []
        self.title = ""
        self._in_main = False
        self._in_h1 = False
        self._buf: list[str] = []
        self._capture: str | None = None  # tag currently being captured
        self._skip_depth = 0  # inside <pre>/<nav>, or a summarised section
        self._skip_section = False
        self._headers: list[str] = []
        self._row: list[str] = []
        self._in_thead = False

    # -- helpers -----------------------------------------------------------
    def _flush(self) -> str:
        text = " ".join("".join(self._buf).split())
        self._buf = []
        return text

    def _say(self, text: str, kind: str = "text") -> None:
        if text and not self._skip_section:
            self.lines.append(Block(kind, text if text[-1] in ".?!:" else text + "."))

    # -- parser callbacks --------------------------------------------------
    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "h1":
            self._in_h1 = True
            self._buf = []
            return
        if tag == "main":
            self._in_main = True
            return
        if not self._in_main:
            return
        if tag in ("pre", "nav"):
            if tag == "pre" and self._skip_depth == 0:
                self._say(CODE_PLACEHOLDER)
            self._skip_depth += 1
            return
        if self._skip_depth:
            return
        if tag == "thead":
            self._in_thead = True
            self._headers = []
        elif tag == "tr":
            self._row = []
        elif tag in ("h2", "h3", "p", "li", "th", "td"):
            self._capture = tag
            self._buf = []

    def handle_endtag(self, tag: str) -> None:
        if tag == "h1" and self._in_h1:
            self._in_h1 = False
            self.title = self._flush()
            return
        if tag == "main":
            self._in_main = False
            return
        if not self._in_main:
            return
        if tag in ("pre", "nav"):
            self._skip_depth = max(0, self._skip_depth - 1)
            return
        if self._skip_depth:
            return
        if tag == "thead":
            self._in_thead = False
            return
        if tag == "tr" and not self._in_thead and self._row:
            parts = []
            for i, cell in enumerate(self._row):
                head = self._headers[i] if i < len(self._headers) else ""
                parts.append(f"{head}: {cell}" if head else cell)
            self._say(". ".join(p.rstrip(".") for p in parts))
            return
        if tag != self._capture:
            return
        text = self._flush()
        self._capture = None
        if tag == "h2":
            key = text.strip().lower()
            self._skip_section = False
            self._say(text, "heading")
            if key in SUMMARISED_SECTIONS:
                self._say(SUMMARISED_SECTIONS[key])
                self._skip_section = True
        elif tag == "h3":
            self._say(text, "heading")
        elif tag == "th":
            self._headers.append(text)
        elif tag == "td":
            self._row.append(text)
        else:  # p, li
            self._say(text)

    def handle_data(self, data: str) -> None:
        if self._in_h1 or (self._in_main and self._capture and not self._skip_depth):
            self._buf.append(data)


def narration_for(page: Path) -> list[Block]:
    """Return the narration script for one entry page, one block per spoken unit."""
    parser = NarrationParser()
    parser.feed(page.read_text(encoding="utf-8"))
    if not parser.lines:
        raise ValueError(f"no article text found in {page} (is there a <main> element?)")
    intro = [Block("title", parser.title + ".")] if parser.title else []
    intro.append(Block("text", "An audio version of the written entry."))
    return intro + parser.lines + [Block("text", "End of entry.")]


_SPOKEN_RULES: tuple[tuple[re.Pattern[str], str], ...] = (
    # US$720 -> 720 US dollars
    (re.compile(r"\bUS\$(\d[\d,]*(?:\.\d+)?)"), r"\1 US dollars"),
    (re.compile(r"\$(\d[\d,]*(?:\.\d+)?)"), r"\1 dollars"),
    # 10.20.0.0/16 -> the prefix length is read as "slash 16"
    (re.compile(r"(\d)/(\d{1,3})\b"), r"\1 slash \2"),
)
_IPV4 = re.compile(r"\b(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\b")


def spoken(text: str) -> str:
    """Rewrite the few tokens a voice reads badly into the words a person would say."""
    for pattern, replacement in _SPOKEN_RULES:
        text = pattern.sub(replacement, text)
    return _IPV4.sub(lambda m: " dot ".join(m.groups()), text)


def ensure_model() -> tuple[Path, Path]:
    """Return the model and voices paths, fetching them once and verifying both."""
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    for name, expected in MODEL_FILES.items():
        path = MODEL_DIR / name
        if not path.is_file():
            print(f"fetching {name} (one time) ...", file=sys.stderr)
            partial = path.with_suffix(path.suffix + ".part")
            urllib.request.urlretrieve(MODEL_URL + name, partial)  # noqa: S310 - fixed https URL
            partial.replace(path)
        digest = hashlib.sha256()
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1 << 20), b""):
                digest.update(chunk)
        if digest.hexdigest() != expected:
            raise RuntimeError(f"{path} does not match its pinned SHA-256; delete it and run again")
    model, voices = (MODEL_DIR / name for name in MODEL_FILES)
    return model, voices


def render(blocks: list[Block], out_mp3: Path, voice: str = VOICE, speed: float = SPEED) -> None:
    """Render ``blocks`` to ``out_mp3`` with Kokoro + ffmpeg."""
    if shutil.which("ffmpeg") is None:
        raise RuntimeError("required tool not found on PATH: ffmpeg")
    try:
        import numpy as np
        import soundfile as sf
        from kokoro_onnx import Kokoro
    except ImportError as exc:
        raise RuntimeError(f"{exc.name} is not installed; run this script with `uv run`") from exc

    model, voices = ensure_model()
    kokoro = Kokoro(str(model), str(voices))
    if voice not in kokoro.get_voices():
        raise ValueError(f"unknown voice {voice!r}; choose one of: {', '.join(sorted(kokoro.get_voices()))}")

    pieces: list[np.ndarray] = []
    rate = 24_000
    for index, block in enumerate(blocks):
        samples, rate = kokoro.create(spoken(block.text), voice=voice, speed=speed, lang="en-us")
        if block.kind == "heading" and index:
            pieces.append(np.zeros(int(rate * PAUSE_BEFORE_HEADING), dtype=np.float32))
        pieces.append(samples.astype(np.float32))
        pieces.append(np.zeros(int(rate * PAUSE_SECONDS[block.kind]), dtype=np.float32))
        print(f"\r  rendered {index + 1}/{len(blocks)} blocks", end="", file=sys.stderr)
    print(file=sys.stderr)

    with tempfile.TemporaryDirectory() as tmp:
        wav = Path(tmp) / "narration.wav"
        sf.write(wav, np.concatenate(pieces), rate)
        subprocess.run(
            [
                "ffmpeg", "-y", "-loglevel", "error", "-i", str(wav),
                # Even out block-to-block level, then hit the spoken-word loudness target.
                "-af", "loudnorm=I=-18:TP=-1.5:LRA=11",
                "-ar", "44100", "-ac", "1", "-b:a", MP3_BITRATE, str(out_mp3),
            ],
            check=True,
        )


def duration_seconds(mp3: Path) -> float:
    """Return the duration of ``mp3`` in seconds via ffprobe."""
    result = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(mp3)],
        check=True,
        capture_output=True,
        text=True,
    )
    return float(result.stdout.strip())


def main() -> int:
    parser = argparse.ArgumentParser(description="Build audio.mp3 for a blog entry.")
    parser.add_argument("entry", type=Path, help="entry directory, e.g. blog/log-002")
    parser.add_argument("--text-only", action="store_true", help="print the narration script and exit")
    parser.add_argument("--voice", default=VOICE, help=f"Kokoro voice name (default: {VOICE})")
    parser.add_argument("--speed", type=float, default=SPEED, help=f"speaking rate multiplier (default: {SPEED})")
    parser.add_argument("--out", type=Path, help="write the MP3 here instead of <entry>/audio.mp3")
    args = parser.parse_args()

    page = args.entry / "index.html"
    if not page.is_file():
        print(f"error: {page} not found", file=sys.stderr)
        return 2
    try:
        blocks = narration_for(page)
        if args.text_only:
            # Blank lines separate the blocks, as they are paused in the audio.
            print("\n\n".join(spoken(block.text) for block in blocks))
            return 0
        out = args.out or args.entry / "audio.mp3"
        render(blocks, out, voice=args.voice, speed=args.speed)
        seconds = duration_seconds(out)
    except (ValueError, RuntimeError, subprocess.CalledProcessError, OSError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    minutes = max(1, round(seconds / 60))
    print(f"{out}: {seconds:.0f}s (~{minutes} min), {out.stat().st_size / 1_048_576:.1f} MB, {sum(len(b.text.split()) for b in blocks)} words")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
