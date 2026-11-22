#!/usr/bin/env python3
"""Build the audio version of a blog entry.

Reads ``blog/<entry>/index.html``, turns the article body into a narration
script (tables become sentences, code blocks and the source list are
summarised rather than spelled out), then renders ``audio.mp3`` next to the
page with the macOS ``say`` voice and ``ffmpeg``.

Usage:
    python3 tools/build_blog_audio.py blog/log-002
    python3 tools/build_blog_audio.py blog/log-002 --text-only   # print the script, render nothing

Requirements: macOS ``say`` and ``ffmpeg`` on PATH. Python 3.9+ (the system
python3 on macOS), standard library only.
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
import tempfile
from html.parser import HTMLParser
from pathlib import Path

VOICE = "Samantha"
WORDS_PER_MINUTE = 172
MP3_BITRATE = "48k"  # mono speech; keeps a ten-minute entry near 4 MB

# Sections whose body is replaced by one spoken line.
SUMMARISED_SECTIONS: dict[str, str] = {
    "sources": "The sources for this entry are listed at the end of the written version.",
}
CODE_PLACEHOLDER = "The exact text is shown in the written version."


class NarrationParser(HTMLParser):
    """Collect speakable lines from the ``<main>`` element of an entry page."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.lines: list[str] = []
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

    def _say(self, text: str) -> None:
        if text and not self._skip_section:
            self.lines.append(text if text[-1] in ".?!:" else text + ".")

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
            self._say(text)
            if key in SUMMARISED_SECTIONS:
                self._say(SUMMARISED_SECTIONS[key])
                self._skip_section = True
        elif tag == "h3":
            self._say(text)
        elif tag == "th":
            self._headers.append(text)
        elif tag == "td":
            self._row.append(text)
        else:  # p, li
            self._say(text)

    def handle_data(self, data: str) -> None:
        if self._in_h1 or (self._in_main and self._capture and not self._skip_depth):
            self._buf.append(data)


def narration_for(page: Path) -> str:
    """Return the full narration script for one entry page."""
    parser = NarrationParser()
    parser.feed(page.read_text(encoding="utf-8"))
    if not parser.lines:
        raise ValueError(f"no article text found in {page} (is there a <main> element?)")
    intro = [parser.title + "." if parser.title else "", "An audio version of the written entry."]
    outro = ["End of entry."]
    # Blank lines make the voice pause between paragraphs.
    return "\n\n".join(line for line in intro + parser.lines + outro if line)


def render(script: str, out_mp3: Path) -> None:
    """Render ``script`` to ``out_mp3`` with say + ffmpeg."""
    for tool in ("say", "ffmpeg"):
        if shutil.which(tool) is None:
            raise RuntimeError(f"required tool not found on PATH: {tool}")
    with tempfile.TemporaryDirectory() as tmp:
        text_file = Path(tmp) / "narration.txt"
        aiff = Path(tmp) / "narration.aiff"
        text_file.write_text(script, encoding="utf-8")
        subprocess.run(
            ["say", "-v", VOICE, "-r", str(WORDS_PER_MINUTE), "-o", str(aiff), "-f", str(text_file)],
            check=True,
        )
        subprocess.run(
            ["ffmpeg", "-y", "-loglevel", "error", "-i", str(aiff), "-ac", "1", "-b:a", MP3_BITRATE, str(out_mp3)],
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
    args = parser.parse_args()

    page = args.entry / "index.html"
    if not page.is_file():
        print(f"error: {page} not found", file=sys.stderr)
        return 2
    try:
        script = narration_for(page)
        if args.text_only:
            print(script)
            return 0
        out = args.entry / "audio.mp3"
        render(script, out)
        seconds = duration_seconds(out)
    except (ValueError, RuntimeError, subprocess.CalledProcessError, OSError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    minutes = max(1, round(seconds / 60))
    print(f"{out}: {seconds:.0f}s (~{minutes} min), {out.stat().st_size / 1_048_576:.1f} MB, {len(script.split())} words")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
