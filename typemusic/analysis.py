# Vendored from pytheory-studio @ eb206c5 (src/pytheory_studio/analysis.py). Keep in sync by hand.
"""What PyTheory hears in a :class:`~pytheory_studio.parse.Piece`.

Everything here is PyTheory doing the thinking; this module only asks the
questions and arranges the answers as plain data (JSON-ready, and pleasant
to print in a terminal).
"""

from __future__ import annotations

import re
from typing import Optional

from pytheory import Chord, Key, find_cadences

from .parse import Piece

TONICS = ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"]
_DEGREE = {"i": 1, "ii": 2, "iii": 3, "iv": 4, "v": 5, "vi": 6, "vii": 7}
_FUNCTION = {1: "tonic", 3: "tonic", 6: "tonic",
             2: "subdominant", 4: "subdominant",
             5: "dominant", 7: "dominant"}
_INTERVAL_NAMES = {0: "root", 1: "♭9", 2: "9", 3: "♭3", 4: "3", 5: "4", 6: "♭5",
                   7: "5", 8: "♯5", 9: "6", 10: "♭7", 11: "7"}


_PCS = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}


def _pitch_class(name: str) -> int:
    pc = _PCS[name[0].upper()]
    for acc in name[1:]:
        pc += {"#": 1, "b": -1}.get(acc, 0)
    return pc % 12


def _root(chord: Chord):
    """The chord's root — or its bass when PyTheory can't name one (sus chords)."""
    return chord.root or chord.tones[0]


def key_name(key: Key) -> str:
    return f"{key.tonic_name} {key.mode}"


def degree(roman: Optional[str]) -> Optional[int]:
    """Scale degree of a roman numeral (``"bVII7"`` → 7, ``"V7/V"`` → 5)."""
    if not roman:
        return None
    head = roman.split("/")[0].lstrip("b#♭♯")
    m = re.match(r"(vii|iii|iv|vi|ii|v|i)", head, re.IGNORECASE)
    return _DEGREE[m.group(1).lower()] if m else None


def function_of(roman: Optional[str]) -> str:
    """Tonic / subdominant / dominant, in the plain words a musician uses."""
    if not roman:
        return "outside the key"
    if "/" in roman:
        return f"applied dominant → {roman.split('/', 1)[1]}"
    if roman[0] in "b#♭♯":
        return "borrowed"
    return _FUNCTION.get(degree(roman), "—")


def guess_key(piece: Piece) -> Key:
    """Best key for the piece: the most notes in the scale, then a nudge
    toward keys whose tonic chord opens or closes the music."""
    if piece.key is not None:
        return piece.key
    pcs = [_pitch_class(t.name) for t in piece.tones]
    chords = piece.chords
    melody = [e.tone for e in piece.events if e.tone is not None]
    best, best_score = None, None
    for i, tonic in enumerate(TONICS):
        for mode in ("major", "minor"):
            k = Key(tonic, mode)
            scale = {_pitch_class(n) for n in k.note_names}
            score = sum(1.0 for pc in pcs if pc in scale) - 1.5 * sum(
                1 for pc in pcs if pc not in scale)
            ends = []
            if chords:
                ends = [chords[0], chords[-1]]
            for weight, c in zip((2.0, 3.0), ends):
                is_minor = "minor" in (c.quality or "")
                if _pitch_class(_root(c).name) == i and is_minor == (mode == "minor"):
                    score += weight
            if melody:
                if _pitch_class(melody[-1].name) == i:
                    score += 2.0
                if _pitch_class(melody[0].name) == i:
                    score += 1.0
            if mode == "major":
                score += 0.1          # ties go to major
            if best_score is None or score > best_score:
                best, best_score = k, score
    return best


_ROMANS = ["i", "ii", "iii", "iv", "v", "vi", "vii"]


def diatonic_row(key: Key, index: int) -> dict:
    """The triad on scale degree ``index`` (0-based), with its numeral
    spelled from the chord's own quality so it holds in every mode."""
    chord = key.triad(index)
    quality = chord.quality or ""
    numeral = _ROMANS[index]
    if quality.startswith("major") or quality.startswith("augmented"):
        numeral = numeral.upper()
    if quality.startswith("diminished"):
        numeral += "°"
    elif quality.startswith("augmented"):
        numeral += "+"
    return {"symbol": chord.symbol, "name": chord.identify(), "roman": numeral,
            "function": _FUNCTION[index + 1]}


def _chord_row(chord: Chord, key: Key, beats: float, token: str) -> dict:
    roman = chord.analyze(key.tonic_name, _analysis_mode(key), secondary_dominants=True)
    root = _pitch_class(_root(chord).name)
    tones = []
    for t in chord.tones:
        tones.append({"name": t.name, "octave": t.octave,
                      "interval": _INTERVAL_NAMES[(_pitch_class(t.name) - root) % 12]})
    scale = {_pitch_class(n) for n in key.note_names}
    return {
        "symbol": chord.symbol or token,
        "name": chord.identify() or chord.symbol,
        "roman": roman or "?",
        "function": function_of(roman),
        "tones": tones,
        "outside": [t.name for t in chord.tones if _pitch_class(t.name) not in scale],
        "beats": beats,
    }


def _analysis_mode(key: Key) -> str:
    # Roman numerals are a major/minor idea; modes read relative to their
    # own parallel major or minor.
    if key.mode in ("minor", "aeolian", "harmonic minor", "dorian", "phrygian", "locrian"):
        return "minor"
    return "major"


def analyze(piece: Piece) -> dict:
    key = guess_key(piece)
    out = {
        "kind": piece.kind,
        "key": key_name(key),
        "key_detected": not piece.key_given,
        "key_notes": key.note_names[:-1] if key.note_names[0] == key.note_names[-1] else key.note_names,
        "signature": key.signature,
    }

    if piece.kind in ("progression", "chord"):
        rows = [_chord_row(e.chord, key, e.beats, e.token)
                for e in piece.events if e.chord is not None]
        out["chords"] = rows
        out["numerals"] = " – ".join(r["roman"] for r in rows)
        cad = []
        try:
            for idx, kind in find_cadences(piece.chords, key.tonic_name, _analysis_mode(key)):
                cad.append({"at": idx, "kind": kind,
                            "chords": f"{rows[idx - 1]['symbol']} → {rows[idx]['symbol']}"})
        except Exception:
            pass
        out["cadences"] = cad

    if piece.kind == "scale":
        tones = [e.tone for e in piece.events]
        steps = []
        for a, b in zip(tones, tones[1:]):
            semis = (_pitch_class(b.name) - _pitch_class(a.name)) % 12
            steps.append({1: "H", 2: "W", 3: "W+H"}.get(semis, str(semis)))
        out["steps"] = steps
        out["triads"] = [diatonic_row(key, i) for i in range(7)]

    if piece.kind == "melody":
        notes = [e.tone for e in piece.events if e.tone is not None]
        scale = {_pitch_class(n) for n in key.note_names}
        out["notes"] = [{"name": f"{t.name}{t.octave}",
                         "in_key": _pitch_class(t.name) in scale} for t in notes]
        if notes:
            lo = min(notes, key=lambda t: t.midi)
            hi = max(notes, key=lambda t: t.midi)
            out["range"] = f"{lo.name}{lo.octave} – {hi.name}{hi.octave}"
        out["intervals"] = [
            ("↑ " if b.midi > a.midi else "↓ " if b.midi < a.midi else "") + a.interval_to(b)
            for a, b in zip(notes, notes[1:])]
        out["beats"] = sum(e.beats for e in piece.events)
        tonic_pc = _pitch_class(key.tonic_name)
        out["ending"] = ("ends home, on the tonic"
                         if notes and _pitch_class(notes[-1].name) == tonic_pc
                         else "ends away from the tonic")
    return out


def as_text(a: dict) -> str:
    """The analysis as a few honest lines of plain text."""
    lines = [f"Key: {a['key']}" + ("  (detected)" if a["key_detected"] else "")]
    if "chords" in a:
        lines.append(f"Numerals: {a['numerals']}")
        lines.append("")
        for r in a["chords"]:
            tones = " ".join(f"{t['name']}({t['interval']})" for t in r["tones"])
            lines.append(f"  {r['symbol']:<8} {r['roman']:<8} {r['function']:<24} {tones}")
        for c in a.get("cadences", []):
            lines.append(f"Cadence: {c['kind']} ({c['chords']})")
    if "triads" in a:
        lines.append("Steps: " + " ".join(a["steps"]))
        for t in a["triads"]:
            lines.append(f"  {t['roman']:<6} {t['symbol']:<6} {t['function']}")
    if "notes" in a:
        lines.append("Notes: " + " ".join(n["name"] for n in a["notes"]))
        lines.append("Moves: " + ", ".join(a["intervals"]))
        lines.append(f"Range: {a.get('range', '—')}   {a['ending']}")
    return "\n".join(lines)
