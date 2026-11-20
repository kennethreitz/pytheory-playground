"""Pieces → PyTheory Scores → LilyPond source → engraved SVG.

Adapted from pytheory-studio's engrave.py for a public server.

LilyPond embeds a full Scheme interpreter, so this module only ever engraves
source that PyTheory generated from *parsed* music. Visitor text never
reaches LilyPond: no titles, no lyrics, no symbols copied from the input —
only pitches, durations, chord qualities and roman numerals that PyTheory
produced. As a last line of defense, :func:`assert_safe` refuses any source
containing Scheme (``#(``, ``$``, ``#{``…) before the binary ever runs.
"""

from __future__ import annotations

import hashlib
import os
import re
import shutil
import subprocess
import tempfile
import threading
from collections import OrderedDict
from pathlib import Path

from pytheory import Duration, Score

from .analysis import analyze, guess_key
from .parse import Piece

LY_MODES = {"major": "major", "minor": "minor", "harmonic minor": "minor",
            "ionian": "ionian", "dorian": "dorian", "phrygian": "phrygian",
            "lydian": "lydian", "mixolydian": "mixolydian",
            "aeolian": "aeolian", "locrian": "locrian"}

PAPER = r"""\paper {
  indent = 0
  line-width = 170\mm
  ragged-last = ##t
  print-page-number = ##f
}
"""

LAYOUT = r"""\layout {
    \context { \Lyrics
      \override LyricSpace.minimum-distance = #2.5
      \override LyricText.font-size = #-0.5 }
  }"""

TIMEOUT = 20          # seconds per engraving
CACHE_SIZE = 256      # engraved SVGs kept in memory (~10 KB each)


class EngraveError(RuntimeError):
    pass


def lilypond_binary() -> str | None:
    found = os.environ.get("LILYPOND") or shutil.which("lilypond")
    if not found and os.path.exists("/opt/homebrew/bin/lilypond"):
        found = "/opt/homebrew/bin/lilypond"
    return found


def build_score(piece: Piece, *, bpm: int = 90, notation: bool = True,
                sound: str | None = "piano") -> Score:
    """A PyTheory Score for the piece — used for notation *and* playback.

    For notation, progressions carry a ``harmony`` part that PyTheory turns
    into chord symbols; playback leaves it out.
    """
    score = Score("4/4", bpm=bpm)
    voice = dict(instrument=sound) if sound else dict(synth="sine")
    if piece.kind in ("progression", "chord"):
        a = analyze(piece)
        names = score.part("harmony") if notation else None
        voicing = score.part("voicing", **voice)
        for event, row in zip(piece.events, a["chords"]):
            if names is not None:
                names.add(event.chord, event.beats)
            # Numerals ride along as lyrics — notation only, since PyTheory
            # 0.59 hands lyrics to every synth and only voices accept them.
            voicing.add(event.chord, event.beats,
                        **({"lyric": row["roman"]} if notation else {}))
    elif piece.kind == "scale":
        part = score.part("scale", **voice)
        for i, event in enumerate(piece.events, start=1):
            part.add(event.tone, Duration.QUARTER,
                     **({"lyric": str(i)} if notation else {}))
    else:
        part = score.part("melody", **voice)
        for event in piece.events:
            if event.is_rest:
                part.rest(event.beats)
            else:
                part.add(event.tone, event.beats)
    return score


def to_lilypond(piece: Piece) -> str:
    """LilyPond source for the piece, written by PyTheory and tidied for
    a clean, title-free embed. Never carries visitor text."""
    key = guess_key(piece)
    harmony = piece.kind in ("progression", "chord")
    ly = build_score(piece).to_lilypond(
        title="",                                   # never a visitor string
        key=key.tonic_name,
        mode=LY_MODES.get(key.mode, "major"),
        chord_names=harmony,
        chord_part="harmony" if harmony else None,
    )
    return assert_safe(tidy(ly))


def tidy(ly: str) -> str:
    """Strip the page furniture: no title, tagline, tempo, or part labels."""
    ly = re.sub(r"\\header \{.*?\n\}\n", lambda _m: "\\header { tagline = ##f }\n" + PAPER,
                ly, count=1, flags=re.DOTALL)
    ly = re.sub(r'\s*\\with \{ instrumentName = "[^"]*" \}', "", ly)
    ly = re.sub(r"\n\s*\\tempo [^\n]*", "", ly)
    ly = ly.replace("\\layout { }", LAYOUT)
    ly = re.sub(r"(\\lyricsto \"[^\"]+\" \{)([^}]*)(\})", _quote_lyrics, ly)
    return ly


def _quote_lyrics(m: re.Match) -> str:
    # Bare digits in \lyricmode read as durations ("ii7" fails to parse),
    # so any syllable carrying a digit gets quoted.
    words = [f'"{w}"' if any(c.isdigit() for c in w) and not w.startswith('"') else w
             for w in m.group(2).split()]
    return m.group(1) + " " + " ".join(words) + " " + m.group(3)


# The only '#' forms our template uses: ##t / ##f booleans and #1.6-style
# numbers. Anything else with '#' or '$' could be Scheme.
_HARMLESS_HASH = re.compile(r"##[tf]\b|#-?\d+(?:\.\d+)?\b")
_ALLOWED_COMMANDS = {
    "version", "header", "paper", "mm", "layout", "context", "Lyrics", "override",
    "score", "new", "StaffGroup", "ChordNames", "chordProg", "chordmode", "Staff",
    "clef", "key", "major", "minor", "ionian", "dorian", "phrygian", "lydian",
    "mixolydian", "aeolian", "locrian", "time", "Voice", "lyricsto",
}


def assert_safe(ly: str) -> str:
    """Refuse LilyPond that could run Scheme or uses commands we never emit."""
    if "#" in _HARMLESS_HASH.sub("", ly) or "$" in ly:
        raise EngraveError("Refusing to engrave: unexpected Scheme in generated LilyPond.")
    unknown = set(re.findall(r"\\([A-Za-z]+)", ly)) - _ALLOWED_COMMANDS
    if unknown:
        raise EngraveError(f"Refusing to engrave: unexpected LilyPond commands {sorted(unknown)}.")
    return ly


_cache: OrderedDict[str, str] = OrderedDict()
_cache_lock = threading.Lock()


def engrave_svg(ly: str, *, timeout: int = TIMEOUT) -> str:
    """Engrave (already generated, already checked) LilyPond to one cropped
    SVG. Results are kept in a bounded in-memory LRU — a disk cache keyed by
    visitor input would let anyone fill the disk."""
    assert_safe(ly)
    digest = hashlib.sha256(ly.encode()).hexdigest()
    with _cache_lock:
        if digest in _cache:
            _cache.move_to_end(digest)
            return _cache[digest]

    binary = lilypond_binary()
    if not binary:
        raise EngraveError("LilyPond isn't installed on this server.")

    with tempfile.TemporaryDirectory(prefix="typemusic-") as tmp:
        src = Path(tmp) / "score.ly"
        src.write_text(ly)
        try:
            proc = subprocess.run(
                [binary, "-fsvg", "-dcrop", "-dno-point-and-click",
                 "-o", str(Path(tmp) / "score"), str(src)],
                capture_output=True, text=True, timeout=timeout, cwd=tmp,
            )
        except subprocess.TimeoutExpired:
            raise EngraveError(f"LilyPond took longer than {timeout}s.") from None
        out = Path(tmp) / "score.cropped.svg"
        if proc.returncode != 0 or not out.exists():
            tail = "\n".join((proc.stderr or "").strip().splitlines()[-6:])
            raise EngraveError(f"LilyPond couldn't engrave that:\n{tail}")
        svg = out.read_text()

    with _cache_lock:
        _cache[digest] = svg
        while len(_cache) > CACHE_SIZE:
            _cache.popitem(last=False)
    return svg
