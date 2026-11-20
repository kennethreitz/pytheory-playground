# Vendored from pytheory-studio @ eb206c5 (src/pytheory_studio/parse.py). Keep in sync by hand.
"""Plain text in, music out.

The studio speaks one tiny language, designed to be typed half-asleep::

    C Am F G7                 a chord progression (one chord per bar)
    C Am | F G7               bars: chords inside a bar share it
                              (three in a bar: half, quarter, quarter)
    in G: ii V I              roman numerals, in a key you name
    D dorian                  a scale
    Cmaj7                     a single chord
    E4 D4 C4 D4 | E4 E4 E4:h  a melody (octave numbers make it a melody)

Melody durations ride on the note after a colon and stick until changed:
``w`` whole, ``h`` half, ``q`` quarter, ``e`` eighth, ``s`` sixteenth, with a
trailing ``.`` for dotted. ``r`` is a rest. Prefix any line with
``in <key>:`` (or ``<key>:``) to pin the key instead of detecting it.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Optional

from pytheory import Chord, Key, Tone

MODES = ("major", "minor", "harmonic minor", "ionian", "dorian", "phrygian",
         "lydian", "mixolydian", "aeolian", "locrian")

# How a 4/4 bar is shared: three chords read as half, quarter, quarter.
SPLITS = {1: (4.0,), 2: (2.0, 2.0), 3: (2.0, 1.0, 1.0), 4: (1.0, 1.0, 1.0, 1.0)}

DURATIONS = {"w": 4.0, "h": 2.0, "q": 1.0, "e": 0.5, "s": 0.25}

_TONIC = r"[A-Ga-g](?:#|b)?"
_MODE = "|".join(sorted(MODES, key=len, reverse=True))
_KEY_PREFIX = re.compile(
    rf"^\s*(?:in\s+|key:?\s*)?(?P<tonic>{_TONIC})\s*(?P<mode>{_MODE}|m)?\s*:\s*(?P<rest>.*)$",
    re.IGNORECASE | re.DOTALL,
)
_SCALE = re.compile(rf"^\s*(?P<tonic>{_TONIC})\s+(?P<mode>{_MODE})(?:\s+scale)?\s*$",
                    re.IGNORECASE)
_NOTE = re.compile(r"^(?P<name>[A-Ga-g](?:#|b)?)(?P<octave>[0-8])(?::(?P<dur>[whqes])(?P<dot>\.)?)?$")
_REST = re.compile(r"^r(?::(?P<dur>[whqes])(?P<dot>\.)?)?$", re.IGNORECASE)
_ROMAN = re.compile(r"^[b#]?(?:VII|VI|V|IV|III|II|I|vii|vi|v|iv|iii|ii|i)", re.UNICODE)
# Octaves that read as a melody note. C6/A7/C9 etc. stay chords.
_MELODY_OCTAVES = set("012345")


class ParseError(ValueError):
    """Friendly, human-readable parse failure."""


@dataclass
class Event:
    """One thing that sounds (or doesn't) for some number of beats."""
    beats: float
    chord: Optional[Chord] = None
    tone: Optional[Tone] = None
    token: str = ""

    @property
    def is_rest(self) -> bool:
        return self.chord is None and self.tone is None


@dataclass
class Piece:
    kind: str                     # "progression" | "chord" | "scale" | "melody"
    text: str
    key: Optional[Key] = None
    key_given: bool = False
    events: list[Event] = field(default_factory=list)

    @property
    def chords(self) -> list[Chord]:
        return [e.chord for e in self.events if e.chord is not None]

    @property
    def tones(self) -> list[Tone]:
        out = []
        for e in self.events:
            if e.tone is not None:
                out.append(e.tone)
            elif e.chord is not None:
                out.extend(e.chord.tones)
        return out


def _norm_tonic(t: str) -> str:
    return t[0].upper() + t[1:]


def _norm_mode(m: Optional[str]) -> str:
    if not m:
        return "major"
    m = m.lower()
    return "minor" if m == "m" else m


def _tokens(body: str) -> list[str]:
    # Bars are tokens of their own; commas and dashes are just spacing.
    body = body.replace("|", " | ").replace(",", " ").replace(" - ", " ")
    return body.split()


def _bars(tokens: list[str]) -> list[list[str]]:
    if "|" not in tokens:            # no bar lines: one chord per bar
        return [[t] for t in tokens]
    bars, cur = [], []
    for t in tokens:
        if t == "|":
            if cur:
                bars.append(cur)
            cur = []
        else:
            cur.append(t)
    if cur:
        bars.append(cur)
    return bars


def _looks_like_melody(tokens: list[str]) -> bool:
    notes = [t for t in tokens if t != "|"]
    if not notes:
        return False
    ok = 0
    for t in notes:
        if _REST.match(t):
            continue
        m = _NOTE.match(t)
        if not m:
            return False
        if m.group("octave") in _MELODY_OCTAVES or m.group("dur"):
            ok += 1
    return ok > 0


def _beats(dur: Optional[str], dot: Optional[str], current: float) -> float:
    if not dur:
        return current
    b = DURATIONS[dur]
    return b * 1.5 if dot else b


def _parse_melody(tokens: list[str]) -> list[Event]:
    events, current = [], 1.0
    for t in tokens:
        if t == "|":
            continue
        if m := _REST.match(t):
            current = _beats(m.group("dur"), m.group("dot"), current)
            events.append(Event(beats=current, token=t))
            continue
        m = _NOTE.match(t)
        current = _beats(m.group("dur"), m.group("dot"), current)
        name = _norm_tonic(m.group("name")) + m.group("octave")
        events.append(Event(beats=current, tone=Tone.from_string(name), token=t))
    return events


def _chord_events(bars: list[list[str]], make) -> list[Event]:
    events = []
    for bar in bars:
        if len(bar) not in SPLITS:
            raise ParseError(
                f"A bar holds 1 to 4 chords — this one has {len(bar)}: "
                f"{' '.join(bar)}")
        for tok, beats in zip(bar, SPLITS[len(bar)]):
            events.append(Event(beats=beats, chord=make(tok), token=tok))
    return events


def _symbol(tok: str) -> Chord:
    try:
        return Chord.from_symbol(tok)
    except Exception:
        raise ParseError(f"I don't know the chord “{tok}”.") from None


def parse(text: str) -> Piece:
    """Turn a line of plain text into a :class:`Piece`."""
    raw = (text or "").strip()
    if not raw:
        raise ParseError("Type some music — try “C Am F G7”.")
    # Drop comment lines so a session can be annotated like a notebook.
    body = "\n".join(l for l in raw.splitlines() if not l.strip().startswith("#")).strip()

    key, key_given = None, False
    if m := _KEY_PREFIX.match(body):
        key = Key(_norm_tonic(m.group("tonic")), _norm_mode(m.group("mode")))
        key_given = True
        body = m.group("rest").strip()

    if m := _SCALE.match(body):
        k = Key(_norm_tonic(m.group("tonic")), _norm_mode(m.group("mode")))
        tones = list(k.scale.tones)
        events = [Event(beats=1.0, tone=t, token=t.name) for t in tones]
        return Piece(kind="scale", text=raw, key=k, key_given=True, events=events)

    tokens = _tokens(body)
    if not tokens:
        raise ParseError("There's a key, but no music after it.")

    if _looks_like_melody(tokens):
        return Piece(kind="melody", text=raw, key=key, key_given=key_given,
                     events=_parse_melody(tokens))

    bars = _bars(tokens)
    words = [t for b in bars for t in b]
    if all(_ROMAN.match(t) for t in words) and not all(
            re.match(r"^[A-G]", t) for t in words):
        k = key or Key("C", "major")
        try:
            chords = k.progression(*words)
        except Exception as e:
            raise ParseError(f"Couldn't read those numerals in {k}: {e}") from None
        it = iter(chords)
        events = _chord_events(bars, lambda _tok: next(it))
        return Piece(kind="progression", text=raw, key=k, key_given=True, events=events)

    events = _chord_events(bars, _symbol)
    kind = "chord" if len(events) == 1 else "progression"
    return Piece(kind=kind, text=raw, key=key, key_given=key_given, events=events)
