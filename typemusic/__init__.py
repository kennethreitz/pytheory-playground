"""Type Music — pytheory-studio's text-to-notation experience, for the playground.

parse.py and analysis.py are vendored verbatim from pytheory-studio
(@ eb206c5); engrave.py is the studio's engraver hardened for a public
server: bounded input, an in-memory LRU cache instead of a disk cache, a
timeout on lilypond, and a final check that the source holds no Scheme.
"""

from .analysis import analyze, as_text
from .engrave import EngraveError, build_score, engrave_svg, to_lilypond
from .parse import ParseError, parse

MAX_TEXT = 400        # characters a visitor may type
MAX_EVENTS = 64       # notes/chords per sketch


def parse_limited(text: str):
    """parse(), with the public-server limits applied."""
    text = text or ""
    if len(text) > MAX_TEXT:
        raise ParseError(f"Keep it under {MAX_TEXT} characters — this is a sketchpad.")
    piece = parse(text)
    if len(piece.events) > MAX_EVENTS:
        raise ParseError(f"That's {len(piece.events)} notes/chords; the limit is {MAX_EVENTS}.")
    return piece


__all__ = ["analyze", "as_text", "build_score", "engrave_svg", "to_lilypond",
           "parse", "parse_limited", "ParseError", "EngraveError",
           "MAX_TEXT", "MAX_EVENTS"]
