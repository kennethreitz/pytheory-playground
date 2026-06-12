"""PyTheory Playground — interactive showcase backed by real pytheory code."""

import hashlib
import hmac
import io
import os
import secrets
import tempfile
import wave

import numpy as np
import responder
from pytheory import (
    CHARTS,
    Chord,
    Fretboard,
    Key,
    PROGRESSIONS,
    SYSTEMS,
    Score,
    Tone,
    TonedScale,
    render_score,
    save_midi,
)
from pytheory import INSTRUMENTS as SOUND_PRESETS
from pytheory import Pattern
from pytheory._statics import TEMPERAMENTS

SAMPLE_RATE = 44100

# Fretted instruments that make sense for chord charts.
INSTRUMENTS = ["guitar", "twelve_string", "ukulele", "banjo", "mandolin", "bass"]

ROOTS = ["A", "Bb", "B", "C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab"]
QUALITIES = ["", "m", "5", "7", "9", "dim", "m6", "m7", "m9", "maj7", "maj9"]

# Curated synth presets for the playback sound picker.
SOUNDS = [s for s in (
    "piano", "electric_piano", "organ", "harpsichord", "music_box",
    "acoustic_guitar", "electric_guitar", "violin", "cello", "flute",
    "trumpet", "marimba", "vibraphone", "synth_lead", "synth_pad",
    "sitar", "koto", "theremin", "choir",
) if s in SOUND_PRESETS]


def _system_meta():
    """Tonics and scale names for every tonal system pytheory ships."""
    out = {}
    for name, system in SYSTEMS.items():
        try:
            tonics = []
            for t in system.tones:
                n = t[0] if isinstance(t, tuple) else getattr(t, "name", str(t))
                if n not in tonics:
                    tonics.append(n)
            scales = list(TonedScale(tonic=f"{tonics[0]}4", system=name).scales)
            out[name] = {
                "tonics": tonics,
                "scales": scales,
                # 12-TET systems using western note names (piano/fretboard views apply)
                "western_notes": name in ("western", "japanese", "blues"),
            }
        except Exception:
            continue
    return out


SYSTEM_META = _system_meta()
SCALE_NAMES = SYSTEM_META["western"]["scales"]

api = responder.API(static_dir="static", static_route="/static")

# LilyPond embeds Guile Scheme, so engraving arbitrary user source would be
# remote code execution. We only engrave LilyPond we generated ourselves,
# proven by an HMAC signature minted alongside each conversion result.
_LILYPOND_KEY = secrets.token_bytes(32)


def _sign_lilypond(source: str) -> str:
    return hmac.new(_LILYPOND_KEY, source.encode(), hashlib.sha256).hexdigest()


def wav_bytes(audio: np.ndarray) -> bytes:
    """Encode a stereo float numpy array from render_score() as a WAV file."""
    clipped = np.clip(audio, -1.0, 1.0)
    pcm = (clipped * 32767).astype(np.int16)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(pcm.shape[1] if pcm.ndim == 2 else 1)
        w.setsampwidth(2)
        w.setframerate(SAMPLE_RATE)
        w.writeframes(pcm.tobytes())
    return buf.getvalue()


def score_for(items, *, bpm=110, duration=1.0, synth="sine", strum=False,
              sound=None, system="western", temperament="equal") -> Score:
    """Build a one-part Score from a list of Tones/Chords."""
    score = Score(bpm=bpm, system=system, temperament=temperament)
    kwargs = dict(volume=0.6, reverb=0.15,
                  fretboard=Fretboard.guitar() if strum else None)
    if sound:
        part = score.part("playground", instrument=sound, **kwargs)
    else:
        part = score.part("playground", synth=synth, **kwargs)
    for item in items:
        if strum and hasattr(item, "symbol"):
            try:
                part.strum(item.symbol, duration)
                continue
            except Exception:
                pass
        part.add(item, duration)
    return score


def _parse_chord(symbol: str) -> Chord:
    """Parse a chord symbol, falling back to the wider from_symbol grammar
    (sus4, add9, ... — anything scale.harmonize() can emit)."""
    try:
        return Chord.from_name(symbol)
    except Exception:
        return Chord.from_symbol(symbol)


def _sound(req):
    s = req.params.get("sound", "").strip()
    return s if s in SOUNDS else None


def send_wav(resp, audio: np.ndarray):
    resp.content = wav_bytes(audio)
    resp.headers["Content-Type"] = "audio/wav"
    resp.headers["Cache-Control"] = "max-age=3600"


def error(resp, status, message):
    resp.status_code = status
    resp.media = {"error": message}


@api.route("/")
async def index(req, resp):
    with open(os.path.join("static", "index.html")) as f:
        html = f.read()
    # Absolute URLs for the social-card tags, whatever host we're served from.
    base = f"{req.url.scheme}://{req.url.netloc}"
    html = html.replace("__BASE__", base)
    # Cache-bust the app assets so browsers pick up new JS/CSS on deploy.
    for asset in ("style.css", "app.js"):
        version = int(os.path.getmtime(os.path.join("static", asset)))
        html = html.replace(f"/static/{asset}", f"/static/{asset}?v={version}")
    resp.html = html


@api.route("/api/meta")
async def meta(req, resp):
    resp.media = {
        "instruments": INSTRUMENTS,
        "roots": ROOTS,
        "qualities": QUALITIES,
        "chords": list(CHARTS["western"].keys()),
        "tunings": list(Fretboard.TUNINGS.keys()),
        "scales": SCALE_NAMES,
        "systems": SYSTEM_META,
        "sounds": SOUNDS,
        "temperaments": list(TEMPERAMENTS.keys()),
        "drum_presets": sorted(Pattern._PRESETS),
        "drum_fills": sorted(Pattern._FILLS),
        "progressions": {name: list(numerals) for name, numerals in PROGRESSIONS.items()},
        "version": __import__("pytheory").__version__,
    }


# --- Guitar tab / chords -------------------------------------------------

def _fretboard(name: str, tuning: str = "", capo: int = 0) -> Fretboard:
    if name not in INSTRUMENTS:
        raise KeyError(name)
    tuning = (tuning or "").strip()
    if not tuning or tuning == "standard":
        fretboard = getattr(Fretboard, name)()
    elif (named := tuning.lower().replace("_", " ")) in Fretboard.TUNINGS:
        if name != "guitar":
            raise ValueError(f"Named tuning '{named}' is a guitar tuning")
        fretboard = Fretboard.guitar(tuning=named)
    else:
        # Custom tuning: comma-separated open-string tones, low to high (e.g. D2,A2,D3,G3,A3,D4).
        try:
            tones = [Tone.from_string(s.strip(), system="western")
                     for s in tuning.split(",") if s.strip()]
        except Exception as e:
            raise ValueError(f"Bad tuning '{tuning}': {e}") from e
        if len(tones) < 2:
            raise ValueError("A tuning needs at least two strings, e.g. D2,A2,D3,G3,A3,D4")
        fretboard = Fretboard(tones=tones)
    if not 0 <= capo <= 12:
        raise ValueError("Capo must be between 0 and 12")
    return fretboard.capo(capo) if capo else fretboard


def _fretboard_params(req) -> Fretboard:
    return _fretboard(
        req.params.get("instrument", "guitar"),
        req.params.get("tuning", ""),
        int(req.params.get("capo", "0") or 0),
    )


@api.route("/api/chord")
async def chord_view(req, resp):
    name = req.params.get("name", "C")
    instrument = req.params.get("instrument", "guitar")
    try:
        fretboard = _fretboard_params(req)
    except KeyError:
        return error(resp, 400, f"Unknown instrument: {instrument}")
    except ValueError as e:
        return error(resp, 400, str(e))
    named = CHARTS["western"].get(name)
    if named is None:
        return error(resp, 404, f"No chart for chord: {name}")
    try:
        fingering = named.fingering(fretboard=fretboard)
        tab = named.tab(fretboard=fretboard)
    except Exception as e:
        return error(resp, 422, f"Couldn't voice {name} on {instrument}: {e}")
    chord = _parse_chord(name)
    resp.media = {
        "name": name,
        "instrument": instrument,
        "tab": tab,
        "positions": list(fingering.positions),  # low string first; null = muted
        "strings": list(fingering.string_names),
        "tones": [t.name for t in named.acceptable_tones],
        "pitches": [str(t) for t in chord.tones],
        "alternatives": _alt_fingerings(named, fretboard,
                                        skip=tuple(fingering.positions)),
    }


def _alt_fingerings(named, fretboard, *, skip=None, count=5):
    """A handful of playable voicings spread up the neck (low string first;
    None = muted). Raw chart fingerings use -1 for muted strings."""
    try:
        raw = named.fingerings(fretboard=fretboard)  # tuples, high string first
    except Exception:
        return []

    def norm(t):
        return tuple(None if p is None or p < 0 else p for p in t)

    def fretted(t):
        return [p for p in t if p is not None and p > 0]

    def sounding(t):
        return [p for p in t if p is not None]

    def span(t):
        f = fretted(t)
        return max(f) - min(f) if f else 0

    def base(t):
        f = fretted(t)
        return min(f) if f else 0

    def contiguous(t):
        # mutes only at the edges — no dead strings in the middle of a strum
        idx = [i for i, p in enumerate(t) if p is not None]
        return bool(idx) and idx == list(range(idx[0], idx[-1] + 1))

    def hand_fits(t):
        f = fretted(t)
        if not f:
            return True
        # 5-6 fretted strings only work as a barre (tight span)
        if len(f) > 4 and span(t) > 2:
            return False
        # open strings don't mix with positions up the neck
        if max(f) > 4 and any(p == 0 for p in t):
            return False
        return span(t) <= 3

    playable = [t for t in (norm(r) for r in raw)
                if len(sounding(t)) >= 4 and contiguous(t) and hand_fits(t)]
    playable.sort(key=lambda t: (base(t), span(t), -len(sounding(t))))
    out, seen_bases = [], set()
    for t in playable:
        low_first = tuple(reversed(t))
        if low_first == skip or base(t) in seen_bases:
            continue
        seen_bases.add(base(t))
        out.append(list(low_first))
        if len(out) >= count:
            break
    return out


@api.route("/api/chord/audio")
async def chord_audio(req, resp):
    name = req.params.get("name", "C")
    temperament = req.params.get("temperament", "equal")
    if temperament not in TEMPERAMENTS:
        return error(resp, 400, f"Unknown temperament: {temperament}")
    try:
        chord = _parse_chord(name)
    except Exception:
        return error(resp, 404, f"Unknown chord: {name}")
    # Strumming resolves via chord charts (equal-tempered); for non-equal
    # temperaments play the block chord so the tuning math is audible.
    score = score_for([chord], bpm=60, duration=2.0, sound=_sound(req),
                      strum=temperament == "equal", temperament=temperament)
    send_wav(resp, render_score(score))


@api.route("/api/voicing/audio")
async def voicing_audio(req, resp):
    """Play an exact set of pitches (e.g. a custom fingering), strummed low to high."""
    raw = req.params.get("tones", "")
    names = [n.strip() for n in raw.split(",") if n.strip()]
    if not names or len(names) > 12:
        return error(resp, 400, "Pass 1-12 tones, e.g. tones=C3,E3,G3,C4")
    try:
        tones = sorted((Tone.from_string(n, system="western") for n in names),
                       key=lambda t: t.midi)
        chord = Chord(tones=tones)
    except Exception as e:
        return error(resp, 422, f"Couldn't parse tones: {e}")
    score = score_for([chord], bpm=60, duration=2.0, sound=_sound(req))
    send_wav(resp, render_score(score))


@api.route("/api/chord/lab")
async def chord_lab(req, resp):
    """Deep analysis of a chord: voicings, set theory, tension, substitutions."""
    symbol = req.params.get("name", "Cmaj7")
    try:
        chord = _parse_chord(symbol)
    except Exception as e:
        return error(resp, 404, f"Couldn't parse chord '{symbol}': {e}")

    def tone_strs(c):
        return [str(t) for t in c.tones]

    voicings = [{"label": "root position", "tones": tone_strs(chord)}]
    for i in range(1, min(len(chord.tones), 4)):
        try:
            inv = chord.inversion(i)
            voicings.append({"label": f"inversion {i} ({inv.slash_name})",
                             "tones": tone_strs(inv)})
        except Exception:
            pass
    for label, fn in (("drop 2", chord.drop2), ("drop 3", chord.drop3),
                      ("open voicing", chord.open_voicing)):
        try:
            voicings.append({"label": label, "tones": tone_strs(fn())})
        except Exception:
            pass

    try:
        tritone_sub = chord.tritone_sub().symbol
    except Exception:
        tritone_sub = None
    try:
        extensions = [str(t) for t in chord.extensions()]
    except Exception:
        extensions = []

    try:
        beats = [{"pair": f"{a.full_name}–{b.full_name}", "hz": round(hz, 1)}
                 for a, b, hz in chord.beat_frequencies]
    except Exception:
        beats = []
    try:
        names = [t.name for t in chord.tones]
        solo_scales = [{"tonic": tonic, "scale": scale, "fit": round(fit, 2)}
                       for tonic, scale, fit in
                       TonedScale(tonic="C4")["major"].recommend(*names, top=5)]
    except Exception:
        solo_scales = []

    resp.media = {
        "symbol": chord.symbol,
        "tones": tone_strs(chord),
        "beat_frequencies": beats,
        "intervals": list(chord.intervals),
        "pitch_classes": sorted(chord.pitch_classes),
        "forte_number": chord.forte_number,
        "figured_bass": chord.figured_bass,
        "tension": chord.tension,
        "dissonance": round(chord.dissonance, 2),
        "voicings": voicings,
        "tritone_sub": tritone_sub,
        "extensions": extensions,
        "solo_scales": solo_scales,
    }


@api.route("/api/chord/voice-leading")
async def chord_voice_leading(req, resp):
    """How each voice moves between two chords (chord.voice_leading)."""
    try:
        a = _parse_chord(req.params.get("from", "G7"))
        b = _parse_chord(req.params.get("to", "C"))
    except Exception as e:
        return error(resp, 422, f"Couldn't parse chords: {e}")
    try:
        moves = [{"from": str(x), "to": str(y), "semitones": n}
                 for x, y, n in a.voice_leading(b)]
    except Exception as e:
        return error(resp, 422, f"Voice leading failed: {e}")
    resp.media = {"from": a.symbol, "to": b.symbol, "moves": moves,
                  "total_motion": sum(abs(m["semitones"]) for m in moves)}


@api.route("/api/symbols/audio")
async def symbols_audio(req, resp):
    """Play a comma-separated list of chord symbols in sequence."""
    symbols = [s.strip() for s in req.params.get("symbols", "").split(",") if s.strip()]
    if not symbols or len(symbols) > 16:
        return error(resp, 400, "Pass 1-16 chord symbols, e.g. symbols=C,Am,F,G")
    try:
        chords = [_parse_chord(s) for s in symbols]
    except Exception as e:
        return error(resp, 422, f"Couldn't parse chords: {e}")
    score = score_for(chords, bpm=80, duration=2.0, strum=True, sound=_sound(req))
    send_wav(resp, render_score(score))


# --- Scales ---------------------------------------------------------------

def _toned_scale(req):
    system = req.params.get("system", "western")
    if system not in SYSTEM_META:
        raise ValueError(f"Unknown system: {system}")
    tonic = req.params.get("tonic", SYSTEM_META[system]["tonics"][0])
    octave = int(req.params.get("octave", "4"))
    name = req.params.get("name", "major")
    if name not in SYSTEM_META[system]["scales"]:
        raise ValueError(f"Unknown scale for {system}: {name}")
    return TonedScale(tonic=f"{tonic}{octave}", system=system)[name], name, system


@api.route("/api/scale")
async def scale_view(req, resp):
    try:
        scale, name, system = _toned_scale(req)
    except ValueError as e:
        return error(resp, 400, str(e))
    except Exception as e:
        return error(resp, 400, f"Bad scale request: {e}")
    harmonized = []
    if name not in ("chromatic",):
        try:
            harmonized = [c.symbol for c in scale.harmonize() if c is not None and c.symbol]
        except Exception:
            harmonized = []
    resp.media = {
        "name": name,
        "system": system,
        "tones": [str(t) for t in scale.tones],
        "note_names": list(scale.note_names),
        "harmonized": harmonized,
    }


@api.route("/api/scale/fretboard")
async def scale_fretboard(req, resp):
    instrument = req.params.get("instrument", "guitar")
    frets = min(int(req.params.get("frets", "12")), 24)
    try:
        fretboard = _fretboard_params(req)
    except KeyError:
        return error(resp, 400, f"Unknown instrument: {instrument}")
    except ValueError as e:
        return error(resp, 400, str(e))
    try:
        scale, name, system = _toned_scale(req)
    except Exception as e:
        return error(resp, 400, f"Bad scale request: {e}")
    resp.media = {"diagram": fretboard.scale_diagram(scale, frets=frets),
                  "instrument": instrument, "name": name}


@api.route("/api/scale/positions")
async def scale_positions(req, resp):
    """Scale tone positions on a fretboard (for the graphical fingering view)."""
    frets = min(int(req.params.get("frets", "12")), 15)
    try:
        fretboard = _fretboard_params(req)
    except KeyError:
        return error(resp, 400, "Unknown instrument")
    except ValueError as e:
        return error(resp, 400, str(e))
    try:
        scale, name, _ = _toned_scale(req)
    except Exception as e:
        return error(resp, 400, f"Bad scale request: {e}")
    resp.media = {"name": name, "frets": frets,
                  "strings": _board_positions(fretboard, scale.tones,
                                              scale.tones[0], frets)}


def _board_positions(fretboard, tones, root_tone, frets):
    """Positions of the given tones' pitch classes across a fretboard."""
    pcs = {t.midi % 12 for t in tones}
    root_pc = root_tone.midi % 12
    strings = []
    for open_tone in fretboard.tones:  # low string first
        row = {"open": str(open_tone), "frets": []}
        for f in range(frets + 1):
            midi = open_tone.midi + f
            if midi % 12 in pcs:
                tone = Tone.from_midi(midi)
                row["frets"].append({
                    "fret": f,
                    "note": tone.name,
                    "pitch": str(tone),
                    "root": midi % 12 == root_pc,
                })
        strings.append(row)
    return strings


@api.route("/api/chord/positions")
async def chord_positions(req, resp):
    """Chord-tone (arpeggio) positions across the fretboard."""
    frets = min(int(req.params.get("frets", "12")), 15)
    try:
        fretboard = _fretboard_params(req)
    except KeyError:
        return error(resp, 400, "Unknown instrument")
    except ValueError as e:
        return error(resp, 400, str(e))
    name = req.params.get("name", "C")
    try:
        chord = _parse_chord(name)
    except Exception as e:
        return error(resp, 404, f"Unknown chord: {e}")
    root = chord.root if getattr(chord, "root", None) is not None else chord.tones[0]
    resp.media = {"name": chord.symbol, "frets": frets,
                  "strings": _board_positions(fretboard, chord.tones, root, frets)}


@api.route("/api/scale/audio")
async def scale_audio(req, resp):
    try:
        scale, _, system = _toned_scale(req)
    except Exception as e:
        return error(resp, 400, f"Bad scale request: {e}")
    score = score_for(list(scale.tones), bpm=140, duration=0.5, sound=_sound(req), system=system)
    send_wav(resp, render_score(score))


# --- Keys & progressions ---------------------------------------------------

def _key(req) -> Key:
    tonic = req.params.get("tonic", "C")
    mode = req.params.get("mode", "major")
    return Key(tonic, mode=mode)


@api.route("/api/key")
async def key_view(req, resp):
    try:
        key = _key(req)
    except Exception as e:
        return error(resp, 400, f"Bad key: {e}")
    resp.media = {
        "tonic": key.tonic_name,
        "mode": key.mode,
        "notes": list(key.note_names),
        "chords": list(key.chords),
        "seventh_chords": list(key.seventh_chords),
        "signature": key.signature,
        "relative": str(key.relative),
    }


@api.route("/api/key/explore")
async def key_explore(req, resp):
    """Beyond the diatonic set: borrowed chords, secondary dominants, what's next."""
    try:
        key = _key(req)
    except Exception as e:
        return error(resp, 400, f"Bad key: {e}")
    secondary = []
    for degree in range(2, 7):
        try:
            secondary.append({"degree": degree,
                              "symbol": key.secondary_dominant(degree).symbol})
        except Exception:
            pass
    suggestions = []
    after = req.params.get("after", "").strip()
    if after:
        try:
            suggestions = [c.symbol for c in key.suggest_next(_parse_chord(after))]
        except Exception:
            pass
    try:
        borrowed = list(key.borrowed_chords)
    except Exception:
        borrowed = []
    resp.media = {
        "key": f"{key.tonic_name} {key.mode}",
        "borrowed": borrowed,
        "secondary_dominants": secondary,
        "after": after or None,
        "suggestions": suggestions,
    }


@api.route("/api/key/modulate")
async def key_modulate(req, resp):
    """Plan a modulation: chord path and pivot chords between two keys."""
    try:
        key = _key(req)
        target = Key(req.params.get("to_tonic", "G"),
                     mode=req.params.get("to_mode", "major"))
    except Exception as e:
        return error(resp, 400, f"Bad key: {e}")
    try:
        path = [c.symbol for c in key.modulation_path(target)]
    except Exception:
        path = []
    try:
        pivots = list(key.pivot_chords(target))
    except Exception:
        pivots = []
    resp.media = {
        "from": f"{key.tonic_name} {key.mode}",
        "to": f"{target.tonic_name} {target.mode}",
        "path": path,
        "pivot_chords": pivots,
    }


def _progression_chords(req):
    key = _key(req)
    numerals_param = req.params.get("numerals", "I-V-vi-IV")
    numerals = PROGRESSIONS.get(numerals_param, tuple(numerals_param.split("-")))
    return key, list(numerals), key.progression(*numerals)


def _chords_payload(numerals, chords):
    """Per-chord display payload (symbol + guitar fingering) for a progression."""
    fretboard = Fretboard.guitar()
    out = []
    for numeral, chord in zip(numerals, chords):
        symbol = chord.symbol
        entry = {"numeral": numeral, "symbol": symbol, "tab": None, "positions": None}
        named = CHARTS["western"].get(symbol)
        if named is not None:
            try:
                fingering = named.fingering(fretboard=fretboard)
                entry["tab"] = named.tab(fretboard=fretboard)
                entry["positions"] = list(fingering.positions)
                entry["strings"] = list(fingering.string_names)
            except Exception:
                pass
        out.append(entry)
    return out


@api.route("/api/progression")
async def progression_view(req, resp):
    try:
        key, numerals, chords = _progression_chords(req)
    except Exception as e:
        return error(resp, 400, f"Bad progression: {e}")
    resp.media = {"key": f"{key.tonic_name} {key.mode}",
                  "chords": _chords_payload(numerals, chords)}


@api.route("/api/progression/random")
async def progression_random(req, resp):
    """Roll the dice: key.random_progression, with Roman-numeral analysis."""
    from pytheory import analyze_progression

    try:
        key = _key(req)
    except Exception as e:
        return error(resp, 400, f"Bad key: {e}")
    length = max(2, min(8, int(req.params.get("length", "4") or 4)))
    chords = key.random_progression(length)
    try:
        numerals = analyze_progression(chords, key=key.tonic_name, mode=key.mode)
        numerals = [n or "?" for n in numerals]
    except Exception:
        numerals = ["?"] * len(chords)
    resp.media = {
        "key": f"{key.tonic_name} {key.mode}",
        "symbols": [c.symbol for c in chords],
        "chords": _chords_payload(numerals, chords),
    }


@api.route("/api/progression/audio")
async def progression_audio(req, resp):
    try:
        _, _, chords = _progression_chords(req)
    except Exception as e:
        return error(resp, 400, f"Bad progression: {e}")
    score = score_for(chords, bpm=80, duration=2.0, strum=True, sound=_sound(req))
    send_wav(resp, render_score(score))


@api.route("/api/progression/midi")
async def progression_midi(req, resp):
    try:
        _, _, chords = _progression_chords(req)
    except Exception as e:
        return error(resp, 400, f"Bad progression: {e}")
    with tempfile.NamedTemporaryFile(suffix=".mid", delete=False) as f:
        path = f.name
    try:
        save_midi(chords, path, t=1000)
        with open(path, "rb") as f:
            resp.content = f.read()
    finally:
        os.unlink(path)
    resp.headers["Content-Type"] = "audio/midi"
    resp.headers["Content-Disposition"] = "attachment; filename=progression.mid"


# --- Groove Lab --------------------------------------------------------------

def _groove_score(req) -> Score:
    preset = req.params.get("preset", "rock")
    bpm = max(40, min(240, int(req.params.get("bpm", "100") or 100)))
    swing = max(0.0, min(0.7, float(req.params.get("swing", "0") or 0)))
    repeats = max(1, min(8, int(req.params.get("repeats", "4") or 4)))
    fill = req.params.get("fill") or None
    fill_every = int(req.params.get("fill_every", "0") or 0) or None
    score = Score(bpm=bpm, swing=swing)
    score.drums(preset, repeats=repeats, fill=fill, fill_every=fill_every)

    # Optional chord backing: cycle a progression underneath, one chord per bar.
    numerals_param = req.params.get("numerals", "")
    if numerals_param:
        key = _key(req)
        numerals = PROGRESSIONS.get(numerals_param, tuple(numerals_param.split("-")))
        chords = key.progression(*numerals)
        part = score.part("chords", instrument=_sound(req) or "electric_piano",
                          volume=0.45, reverb=0.2)
        beats = 0.0
        i = 0
        while beats < score.total_beats and i < 64:
            part.add(chords[i % len(chords)], 4.0)
            beats += 4.0
            i += 1
    return score


@api.route("/api/groove/audio")
async def groove_audio(req, resp):
    try:
        score = _groove_score(req)
    except Exception as e:
        return error(resp, 400, f"Bad groove: {e}")
    send_wav(resp, render_score(score))


@api.route("/api/groove/midi")
async def groove_midi(req, resp):
    try:
        score = _groove_score(req)
    except Exception as e:
        return error(resp, 400, f"Bad groove: {e}")
    with tempfile.NamedTemporaryFile(suffix=".mid", delete=False) as f:
        path = f.name
    try:
        score.save_midi(path)
        with open(path, "rb") as f:
            resp.content = f.read()
    finally:
        os.unlink(path)
    resp.headers["Content-Type"] = "audio/midi"
    resp.headers["Content-Disposition"] = "attachment; filename=groove.mid"


# --- Circle of fifths ---------------------------------------------------------

_FIFTHS_ORDER = ["C", "G", "D", "A", "E", "B", "Gb", "Db", "Ab", "Eb", "Bb", "F"]


@api.route("/api/circle")
async def circle_of_fifths(req, resp):
    out = []
    for tonic in _FIFTHS_ORDER:
        key = Key(tonic)
        sig = key.signature
        out.append({
            "major": tonic,
            "minor": str(key.relative).replace(" minor", "m"),
            "sharps": sig["sharps"],
            "flats": sig["flats"],
        })
    resp.media = {"keys": out}


# --- Songwriter ---------------------------------------------------------------

# One-click song skeletons per vibe; the UI loads these into the editor.
VIBES = {
    "pop": {"bpm": 112, "swing": 0.0, "sound": "electric_piano", "sections": [
        {"name": "intro", "numerals": "I-vi", "groove": "none", "style": "arpeggio"},
        {"name": "verse", "numerals": "I-V-vi-IV", "groove": "rock", "style": "block"},
        {"name": "chorus", "numerals": "IV-I-V-vi", "groove": "disco", "style": "strum"},
        {"name": "verse 2", "numerals": "I-V-vi-IV", "groove": "rock", "style": "block"},
        {"name": "chorus 2", "numerals": "IV-I-V-vi", "groove": "disco", "style": "strum"},
    ]},
    "rock": {"bpm": 126, "swing": 0.0, "sound": "electric_guitar", "sections": [
        {"name": "intro", "numerals": "I-I", "groove": "none", "style": "strum"},
        {"name": "verse", "numerals": "vi-IV-I-V", "groove": "rock", "style": "strum"},
        {"name": "chorus", "numerals": "I-V-vi-IV", "groove": "double time", "style": "strum"},
        {"name": "verse 2", "numerals": "vi-IV-I-V", "groove": "rock", "style": "strum"},
        {"name": "chorus 2", "numerals": "I-V-vi-IV", "groove": "double time", "style": "strum"},
    ]},
    "jazz": {"bpm": 140, "swing": 0.55, "sound": "piano", "sections": [
        {"name": "head", "numerals": "ii-V-I-I", "groove": "jazz", "style": "block"},
        {"name": "solo", "numerals": "ii-V-I-I", "groove": "bebop", "style": "arpeggio"},
        {"name": "head out", "numerals": "ii-V-I-I", "groove": "jazz", "style": "block"},
    ]},
    "blues": {"bpm": 84, "swing": 0.35, "sound": "organ", "sections": [
        {"name": "chorus 1", "numerals": "12-bar blues", "groove": "12/8 blues", "style": "block"},
        {"name": "chorus 2", "numerals": "12-bar blues", "groove": "12/8 blues", "style": "arpeggio"},
    ]},
    "folk": {"bpm": 96, "swing": 0.0, "sound": "acoustic_guitar", "sections": [
        {"name": "intro", "numerals": "I-IV", "groove": "none", "style": "arpeggio"},
        {"name": "verse", "numerals": "I-IV-I-V", "groove": "cajon folk", "style": "strum"},
        {"name": "chorus", "numerals": "IV-I-IV-V", "groove": "cajon folk", "style": "strum"},
        {"name": "verse 2", "numerals": "I-IV-I-V", "groove": "cajon folk", "style": "strum"},
    ]},
    "lofi": {"bpm": 78, "swing": 0.12, "sound": "electric_piano", "sections": [
        {"name": "loop a", "numerals": "I-vi-ii-V", "groove": "hip hop", "style": "block"},
        {"name": "loop b", "numerals": "I-vi-ii-V", "groove": "hip hop", "style": "arpeggio"},
        {"name": "loop a again", "numerals": "I-vi-ii-V", "groove": "hip hop", "style": "block"},
    ]},
    "latin": {"bpm": 120, "swing": 0.0, "sound": "piano", "sections": [
        {"name": "intro", "numerals": "i-bVII", "groove": "none", "style": "arpeggio"},
        {"name": "verse", "numerals": "i-bVI-bIII-bVII", "groove": "bossa nova", "style": "block"},
        {"name": "chorus", "numerals": "i-bVI-bIII-bVII", "groove": "salsa", "style": "strum"},
        {"name": "verse 2", "numerals": "i-bVI-bIII-bVII", "groove": "bossa nova", "style": "block"},
    ]},
}


@api.route("/api/song/sketch")
async def song_sketch(req, resp):
    vibe = req.params.get("vibe", "pop")
    if vibe not in VIBES:
        return error(resp, 400, f"Unknown vibe: {vibe}. Try: {', '.join(VIBES)}")
    spec = {k: v for k, v in VIBES[vibe].items()}
    spec["sections"] = [dict(s) for s in spec["sections"]]
    spec["tonic"] = req.params.get("tonic", "C")
    spec["mode"] = "minor" if vibe == "latin" else req.params.get("mode", "major")
    spec["fade_out"] = True
    resp.media = spec


def _build_song(spec) -> Score:
    tonic = spec.get("tonic", "C")
    mode = spec.get("mode", "major")
    bpm = max(40, min(220, int(spec.get("bpm", 110))))
    swing = max(0.0, min(0.7, float(spec.get("swing", 0))))
    sound = spec.get("sound") if spec.get("sound") in SOUND_PRESETS else "electric_piano"
    key = Key(tonic, mode=mode)

    score = Score(bpm=bpm, swing=swing)
    chords = score.part("chords", instrument=sound, volume=0.42, reverb=0.2,
                        fretboard=Fretboard.guitar())
    bass = score.part("bass", instrument="upright_bass", volume=0.5)

    sections = spec.get("sections", [])[:12]
    if not sections:
        raise ValueError("A song needs at least one section")
    for i, sec in enumerate(sections):
        numerals_param = str(sec.get("numerals", "I-IV-V-I"))
        numerals = PROGRESSIONS.get(numerals_param, tuple(numerals_param.split("-")))
        prog = key.progression(*numerals)
        style = sec.get("style", "block")
        groove = sec.get("groove", "none")

        score.section(str(sec.get("name", f"section {i + 1}")))
        if groove and groove != "none" and groove in Pattern._PRESETS:
            fill = spec.get("fill") if spec.get("fill") in Pattern._FILLS else None
            fill_every = int(spec.get("fill_every", 0) or 0) or None
            score.drums(groove, repeats=len(prog),
                        fill=fill, fill_every=fill_every if fill else None)
        for ch in prog:
            if style == "drums":
                chords.rest(4.0)
                bass.rest(4.0)
                continue
            if style == "arpeggio":
                chords.arpeggio(ch, bars=1, pattern="up-down", octaves=2)
            elif style == "strum":
                try:
                    chords.strum(ch.symbol, 4.0)
                except Exception:
                    chords.add(ch, 4.0)
            else:
                chords.add(ch, 4.0)
            root = ch.root if getattr(ch, "root", None) is not None else ch.tones[0]
            low = max(28, root.midi - 12)
            if groove and groove != "none":
                bass.add(Tone.from_midi(low), 2.0)
                bass.add(Tone.from_midi(low + 7), 2.0)  # root-fifth movement
            else:
                bass.rest(4.0)

    if spec.get("fade_out"):
        for part in (chords, bass):
            part.fade_out(2)
    return score


async def _read_song_spec(req):
    import json

    raw = await req.content
    if not raw:
        raise ValueError("POST a song spec as JSON")
    return json.loads(raw)


@api.route("/api/song/audio")
async def song_audio(req, resp):
    try:
        score = _build_song(await _read_song_spec(req))
    except Exception as e:
        return error(resp, 400, f"Bad song: {e}")
    send_wav(resp, render_score(score))


@api.route("/api/song/midi")
async def song_midi(req, resp):
    try:
        score = _build_song(await _read_song_spec(req))
    except Exception as e:
        return error(resp, 400, f"Bad song: {e}")
    with tempfile.NamedTemporaryFile(suffix=".mid", delete=False) as f:
        path = f.name
    try:
        score.save_midi(path)
        with open(path, "rb") as f:
            resp.content = f.read()
    finally:
        os.unlink(path)
    resp.headers["Content-Type"] = "audio/midi"
    resp.headers["Content-Disposition"] = "attachment; filename=song.mid"


@api.route("/api/song/notation")
async def song_notation(req, resp):
    try:
        spec = await _read_song_spec(req)
        score = _build_song(spec)
    except Exception as e:
        return error(resp, 400, f"Bad song: {e}")
    resp.media = _score_outputs(score, spec.get("title", "Song sketch"),
                                spec.get("tonic", "C"), spec.get("mode", "major"))


# --- Tools: identify / analyze / detect -------------------------------------

@api.route("/api/tools/identify")
async def identify_chord(req, resp):
    """Name the chord for a set of fret positions (low string first; x = muted)."""
    from pytheory.charts import Fingering

    instrument = req.params.get("instrument", "guitar")
    raw = req.params.get("frets", "")
    try:
        fretboard = _fretboard_params(req)
    except KeyError:
        return error(resp, 400, f"Unknown instrument: {instrument}")
    except ValueError as e:
        return error(resp, 400, str(e))
    try:
        positions = [None if p.strip().lower() in ("x", "") else int(p)
                     for p in raw.split(",")]
    except ValueError:
        return error(resp, 400, "Frets must be numbers or 'x', e.g. x,3,2,0,1,0")
    open_tones = list(fretboard.tones)  # low string first
    if len(positions) != len(open_tones):
        return error(resp, 400,
                     f"{instrument} has {len(open_tones)} strings; got {len(positions)} positions")
    names = [t.name for t in open_tones]
    # Fingering's identify() expects canonical high-to-low order.
    fingering = Fingering(tuple(reversed(positions)), tuple(reversed(names)),
                          fretboard=fretboard, high_to_low=True)
    try:
        chord = fingering.to_chord()
    except Exception:
        chord = None
    name = fingering.identify()
    symbol = getattr(chord, "symbol", None)
    # Compose the tab low-string-first, matching the chord panel's layout.
    label = name or symbol or "?"
    tab = "\n".join([label] + [f"{nm}|--{'x' if p is None else p}--"
                               for nm, p in zip(names, positions)])
    resp.media = {
        "name": name,
        "symbol": symbol,
        "tones": [str(t) for t in chord.tones] if chord is not None else [],
        "tab": tab,
    }


@api.route("/api/tools/analyze")
async def analyze(req, resp):
    """Roman-numeral analysis of a chord progression in a key."""
    from pytheory import analyze_progression

    key = req.params.get("key", "C")
    mode = req.params.get("mode", "major")
    raw = req.params.get("chords", "")
    symbols = [s.strip() for s in raw.split(",") if s.strip()]
    if not symbols:
        return error(resp, 400, "Pass chords as a comma-separated list, e.g. C,Am,F,G")
    try:
        chords = [_parse_chord(s) for s in symbols]
    except Exception as e:
        return error(resp, 422, f"Couldn't parse chords: {e}")
    numerals = analyze_progression(chords, key=key, mode=mode)
    resp.media = {
        "key": f"{key} {mode}",
        "analysis": [{"symbol": s, "numeral": n} for s, n in zip(symbols, numerals)],
    }


@api.route("/api/tools/detect-key")
async def detect_key(req, resp):
    """Guess the key from a set of note names."""
    raw = req.params.get("notes", "")
    notes = [n.strip() for n in raw.split(",") if n.strip()]
    if not notes:
        return error(resp, 400, "Pass notes as a comma-separated list, e.g. C,E,G,B")
    try:
        key = Key.detect(*notes)
    except Exception as e:
        return error(resp, 422, f"Couldn't detect key: {e}")
    # Scale detection casts a wider net than major/minor keys (modes,
    # pentatonics, harmonic minor, ...).
    scale_match = None
    try:
        detected = TonedScale(tonic="C4")["major"].detect(*notes)
        if detected:
            scale_match = {"tonic": detected[0], "scale": detected[1],
                           "matched": detected[2]}
    except Exception:
        pass
    if key is None:
        resp.media = {"key": None, "message": "No clear key match.",
                      "scale_match": scale_match}
        return
    resp.media = {
        "key": str(key),
        "tonic": key.tonic_name,
        "mode": key.mode,
        "chords": list(key.chords),
        "signature": key.signature,
        "relative": str(key.relative),
        "scale_match": scale_match,
    }


# --- Tools: MIDI import / export -------------------------------------------

def _clean_audio(samples: np.ndarray, rate: int, cutoff: float = 70.0) -> np.ndarray:
    """Compensate for background noise before pitch tracking.

    Steep high-pass (default 70 Hz — below any hummable note, above
    mains hum) so YIN stops tracking room rumble as a bass line, then
    soft-gate frames near the recording's noise floor.
    """
    spectrum = np.fft.rfft(samples)
    freqs = np.fft.rfftfreq(len(samples), 1.0 / rate)
    taper = np.clip(freqs / cutoff, 0.0, 1.0) ** 4
    cleaned = np.fft.irfft(spectrum * taper, len(samples))

    # Noise floor from the quietest 10% of 50 ms frames; duck frames near it.
    frame = int(rate * 0.05)
    n = len(cleaned) // frame
    if n >= 4:
        frames = cleaned[:n * frame].reshape(n, frame).copy()
        rms = np.sqrt((frames ** 2).mean(axis=1))
        floor = np.percentile(rms, 10)
        # only gate when there's a real noise floor to speak of
        if floor > 1e-6 and rms.max() / floor < 40:
            loud = rms >= floor * 2.5
            # hangover: keep ±300 ms around loud frames so decay tails survive
            keep = np.convolve(loud.astype(float), np.ones(13), mode="same") > 0
            frames[~keep] *= 0.05
            cleaned[:n * frame] = frames.reshape(-1)
    return cleaned


def _cleaned_wav_path(path: str, cutoff: float = 70.0) -> str:
    """Write a noise-compensated mono WAV next to the upload; returns its path."""
    from pytheory.audio import load_wav

    samples, rate = load_wav(path)
    cleaned = _clean_audio(samples, rate, cutoff)
    pcm = (np.clip(cleaned, -1.0, 1.0) * 32767).astype(np.int16)
    out_path = path + ".clean.wav"
    with wave.open(out_path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(pcm.tobytes())
    return out_path


def _detect_score_key(score):
    """Guess the key of a Score from every note name it contains."""
    names = set()
    for part in score.parts.values():
        for note in getattr(part, "notes", None) or getattr(part, "_notes", []):
            tone = getattr(note, "tone", None)
            if tone is None:
                continue
            for t in (tone.tones if hasattr(tone, "tones") else [tone]):
                if getattr(t, "name", None):
                    names.add(t.name)
    if not names:
        return None
    try:
        return Key.detect(*names)
    except Exception:
        return None


@api.route("/api/tools/midi-convert")
async def midi_convert(req, resp):
    """POST raw MIDI bytes; returns LilyPond, ABC, MusicXML, and ASCII tab renderings."""
    body = await req.content
    if not body:
        return error(resp, 400, "Upload a MIDI file as the request body.")
    title = req.params.get("title", "Imported from MIDI")
    key = req.params.get("key", "auto")
    mode = req.params.get("mode", "major")
    with tempfile.NamedTemporaryFile(suffix=".mid", delete=False) as f:
        f.write(body)
        path = f.name
    try:
        score = Score.from_midi(path)
    except Exception as e:
        os.unlink(path)
        return error(resp, 422, f"Couldn't parse MIDI file: {e}")
    os.unlink(path)

    resp.media = _score_outputs(score, title, key, mode)


def _score_outputs(score, title, key="auto", mode="major"):
    """Render a Score to every export format, auto-detecting the key if asked."""
    detected = None
    if key in ("auto", ""):
        detected = _detect_score_key(score)
        key = detected.tonic_name if detected else "C"
        mode = detected.mode if detected else "major"

    out = {"detected_key": str(detected) if detected else None,
           "key": f"{key} {mode}"}
    try:
        out["lilypond"] = score.to_lilypond(title=title, key=key, mode=mode)
        out["lilypond_sig"] = _sign_lilypond(out["lilypond"])
    except Exception as e:
        out["lilypond"] = f"LilyPond export failed: {e}"
    try:
        out["abc"] = score.to_abc(title=title, key=key)
    except Exception as e:
        out["abc"] = f"ABC export failed: {e}"
    try:
        out["tab"] = score.to_tab()
    except Exception as e:
        out["tab"] = f"Tab export failed: {e}"
    try:
        out["musicxml"] = score.to_musicxml(title=title)
    except Exception as e:
        out["musicxml"] = f"MusicXML export failed: {e}"
    return out


@api.route("/api/tools/audio-convert")
async def audio_convert(req, resp):
    """POST a recording (wav/m4a/mp3); transcribe it and return score exports.

    Monophonic per pass (Score.from_wav, YIN pitch tracking) — hum a melody,
    whistle a hook, or record a bass line.
    """
    import base64

    body = await req.content
    if not body:
        return error(resp, 400, "Upload an audio file as the request body.")
    ext = os.path.splitext(req.params.get("filename", ""))[1].lower() or ".wav"
    title = req.params.get("title", "Transcribed audio")
    kwargs = {}
    if req.params.get("quantize"):
        kwargs["quantize"] = float(req.params["quantize"])
    if req.params.get("bpm"):
        kwargs["bpm"] = float(req.params["bpm"])
    if req.params.get("split") in ("1", "true", "on"):
        kwargs["split"] = True

    with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as f:
        f.write(body)
        path = f.name
    clean_path = None
    try:
        # bass/melody split needs the low end; melody-only can ignore
        # everything below a hummable 70 Hz
        if kwargs.get("split"):
            clean_path = _cleaned_wav_path(path, cutoff=40.0)
        else:
            clean_path = _cleaned_wav_path(path, cutoff=70.0)
            kwargs.setdefault("fmin", 70.0)
        score = Score.from_wav(clean_path, **kwargs)
    except Exception as e:
        return error(resp, 422, f"Couldn't transcribe audio: {e}")
    finally:
        os.unlink(path)
        if clean_path and os.path.exists(clean_path):
            os.unlink(clean_path)

    out = _score_outputs(score, title)
    out["bpm"] = score.bpm
    with tempfile.NamedTemporaryFile(suffix=".mid", delete=False) as f:
        midi_path = f.name
    try:
        score.save_midi(midi_path)
        with open(midi_path, "rb") as f:
            out["midi_b64"] = base64.b64encode(f.read()).decode()
    except Exception:
        out["midi_b64"] = None
    finally:
        os.unlink(midi_path)
    resp.media = out


@api.route("/api/tuner/strings")
async def tuner_strings(req, resp):
    """Open-string reference tones for the tuner (honors tuning + capo)."""
    instrument = req.params.get("instrument", "guitar")
    try:
        fretboard = _fretboard_params(req)
    except KeyError:
        return error(resp, 400, f"Unknown instrument: {instrument}")
    except ValueError as e:
        return error(resp, 400, str(e))
    resp.media = {"strings": [
        {"label": str(t), "frequency": round(t.frequency, 2)}
        for t in fretboard.tones  # low string first
    ]}


@api.route("/api/tools/note")
async def note_inspector(req, resp):
    """Everything pytheory knows about one note: names, frequency, overtones."""
    name = req.params.get("name", "A")
    octave = int(req.params.get("octave", "4"))
    reference = float(req.params.get("reference", "440") or 440)
    temperament = req.params.get("temperament", "equal")
    if temperament not in TEMPERAMENTS:
        return error(resp, 400, f"Unknown temperament: {temperament}")
    try:
        tone = Tone.from_string(f"{name}{octave}", system="western")
    except Exception as e:
        return error(resp, 404, f"Unknown note: {e}")
    freq = tone.pitch(reference_pitch=reference, temperament=temperament)
    a4 = Tone.from_string("A4", system="western")
    overtones = []
    for i, hz in enumerate(tone.overtones(8), start=1):
        hz = hz * (freq / tone.frequency)  # honor reference pitch + temperament
        nearest = Tone.from_frequency(hz)
        cents = 1200 * np.log2(hz / nearest.frequency)
        overtones.append({"n": i, "hz": round(hz, 1),
                          "nearest": str(nearest), "cents": round(cents)})
    resp.media = {
        "note": str(tone),
        "frequency": round(freq, 2),
        "midi": tone.midi,
        "solfege": tone.solfege,
        "helmholtz": tone.helmholtz,
        "interval_from_a4": tone.interval_to(a4),
        "overtones": overtones,
    }


# pytheory's native tuner (mic on the server, SSE stream on :8123).
_pytuner = {"tuner": None, "serving": False}


@api.route("/api/tuner/start")
async def tuner_native_start(req, resp):
    """Start pytheory's built-in tuner and SSE server (Tuner + serve)."""
    import threading

    try:
        from pytheory.tuner import Tuner, serve
    except Exception as e:
        return error(resp, 501, f"pytheory tuner unavailable: {e}")
    reference = float(req.params.get("reference", "440") or 440)
    try:
        if _pytuner["tuner"] is None:
            _pytuner["tuner"] = Tuner(reference_pitch=reference)
            _pytuner["tuner"].start()
        elif _pytuner["tuner"]._stream is None:  # restarted after stop
            _pytuner["tuner"].reference_pitch = reference
            _pytuner["tuner"].start()
        else:
            _pytuner["tuner"].reference_pitch = reference  # live retune
    except Exception as e:
        _pytuner["tuner"] = None
        return error(resp, 501, f"Couldn't open the server microphone: {e}")
    if not _pytuner["serving"]:
        threading.Thread(target=serve, args=(_pytuner["tuner"],),
                         kwargs={"port": 8123, "open_browser": False},
                         daemon=True).start()
        _pytuner["serving"] = True
    resp.media = {"ok": True, "stream": "http://localhost:8123/stream"}


@api.route("/api/tuner/stop")
async def tuner_native_stop(req, resp):
    if _pytuner["tuner"] is not None:
        try:
            _pytuner["tuner"].stop()
        except Exception:
            pass
    resp.media = {"ok": True}


@api.route("/api/tools/tune")
async def tune(req, resp):
    """Detect the pitch of a raw float32 PCM chunk (the tuner's mic loop).

    YIN pitch tracking via pytheory.audio.detect_pitch; the nearest tone
    and cents offset come from Tone.from_frequency.
    """
    import math

    from pytheory.audio import detect_pitch

    body = await req.content
    if not body or len(body) < 8192:
        resp.media = {"voiced": False}
        return
    rate = int(req.params.get("rate", "48000"))
    samples = np.frombuffer(body, dtype=np.float32).astype(np.float64)
    # high-pass sub-audio rumble (35 Hz keeps even a bass low E at 41 Hz intact)
    spectrum = np.fft.rfft(samples)
    bins = np.fft.rfftfreq(len(samples), 1.0 / rate)
    samples = np.fft.irfft(spectrum * np.clip(bins / 35.0, 0.0, 1.0) ** 2, len(samples))
    _, freqs, voiced = detect_pitch(samples, rate, fmin=55.0, fmax=1500.0)
    # Demand a stable pitch across most of the chunk, not a single blip.
    if not voiced.any() or voiced.mean() < 0.25:
        resp.media = {"voiced": False}
        return
    system = req.params.get("system", "western")
    if system not in SYSTEM_META:
        return error(resp, 400, f"Unknown system: {system}")
    reference = float(req.params.get("reference", "440") or 440)
    freq = float(np.median(freqs[voiced]))
    # Tone frequencies assume A4=440; normalize the measurement instead.
    tone = Tone.from_frequency(freq * 440.0 / reference, system=system)
    target = tone.frequency * reference / 440.0
    cents = 1200 * math.log2(freq / target)
    resp.media = {
        "voiced": True,
        "frequency": round(freq, 2),
        "note": tone.name,
        "octave": getattr(tone, "octave", None),
        "target": round(target, 2),
        "cents": round(cents, 1),
        "system": system,
    }


@api.route("/api/tools/harmonize")
async def harmonize(req, resp):
    """Hum a melody → transcription, key detection, per-bar chords, and a
    full arrangement (melody + chords + bass) with audio and notation."""
    import base64
    import math
    from collections import defaultdict

    body = await req.content
    if not body:
        return error(resp, 400, "Upload or record some audio first.")
    ext = os.path.splitext(req.params.get("filename", ""))[1].lower() or ".wav"
    title = req.params.get("title", "Harmonized melody")
    kwargs = {"quantize": float(req.params.get("quantize", "0.25") or 0.25)}
    if req.params.get("bpm"):
        kwargs["bpm"] = float(req.params["bpm"])

    with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as f:
        f.write(body)
        path = f.name
    clean_path = None
    try:
        clean_path = _cleaned_wav_path(path, cutoff=70.0)
        kwargs.setdefault("fmin", 70.0)
        score = Score.from_wav(clean_path, **kwargs)
        from pytheory.audio import load_wav
        # the cleaned take is also what we mix under the accompaniment
        original, original_rate = load_wav(clean_path)
    except Exception as e:
        return error(resp, 422, f"Couldn't transcribe audio: {e}")
    finally:
        os.unlink(path)
        if clean_path and os.path.exists(clean_path):
            os.unlink(clean_path)

    melody = score.parts.get("melody")
    notes = (getattr(melody, "notes", None) or getattr(melody, "_notes", [])) if melody else []
    pitched = [n for n in notes if getattr(n, "tone", None) is not None
               and hasattr(n.tone, "midi")]
    if not pitched:
        return error(resp, 422, "Couldn't hear a melody in that recording — try again closer to the mic.")

    key = _detect_score_key(score) or Key("C")
    mode = key.mode if key.mode in ("major", "minor") else "major"
    candidates = [c for c in TonedScale(tonic=f"{key.tonic_name}4")[mode].harmonize()
                  if c is not None]

    # Collect melody pitch classes per 4-beat bar.
    bar_pcs = defaultdict(set)
    beat = 0.0
    for n in notes:
        dur = float(n.duration.value)
        tone = getattr(n, "tone", None)
        if tone is not None and hasattr(tone, "midi"):
            for b in range(int(beat // 4), int(max(beat, beat + dur - 1e-9) // 4) + 1):
                bar_pcs[b].add(tone.midi % 12)
        beat += dur
    n_bars = max(1, math.ceil(score.total_beats / 4))

    # Pick the diatonic chord that best covers each bar's melody notes.
    chosen = []
    for b in range(n_bars):
        pcs = bar_pcs.get(b, set())
        if not pcs:
            chosen.append(chosen[-1] if chosen else candidates[0])
            continue
        def fit(c):
            root = c.root if getattr(c, "root", None) is not None else c.tones[0]
            return (len(pcs & c.pitch_classes) * 2
                    + (1 if root.midi % 12 in pcs else 0))
        chosen.append(max(candidates, key=fit))

    # Accompaniment: block chords + a root bass line under the melody.
    chords_part = score.part("chords", instrument="electric_piano",
                             volume=0.35, reverb=0.2)
    bass_part = score.part("bass", instrument="upright_bass", volume=0.5)
    for ch in chosen:
        chords_part.add(ch, 4.0)
        root = ch.root if getattr(ch, "root", None) is not None else ch.tones[0]
        bass_part.add(Tone.from_midi(max(28, root.midi - 12)), 4.0)

    # Playback mixes YOUR recording over the accompaniment — the synthesized
    # melody is muted for audio (it stays in the MIDI and notation).
    if melody is not None:
        melody.volume = 0.0
    accompaniment = render_score(score)
    if original_rate != SAMPLE_RATE:
        x_new = np.arange(int(len(original) * SAMPLE_RATE / original_rate))
        original = np.interp(x_new * original_rate / SAMPLE_RATE,
                             np.arange(len(original)), original)
    voice = np.stack([original, original], axis=1)
    length = max(len(accompaniment), len(voice))
    mix = np.zeros((length, 2))
    mix[:len(accompaniment)] += accompaniment
    mix[:len(voice)] += voice * 0.9
    peak = np.abs(mix).max()
    if peak > 1.0:
        mix /= peak

    out = _score_outputs(score, title, key.tonic_name, mode)
    out.update({
        "key": str(key),
        "bpm": score.bpm,
        "bars": n_bars,
        "chords": [c.symbol for c in chosen],
        "melody_notes": len(pitched),
        "audio_b64": base64.b64encode(wav_bytes(mix)).decode(),
    })
    with tempfile.NamedTemporaryFile(suffix=".mid", delete=False) as f:
        midi_path = f.name
    try:
        score.save_midi(midi_path)
        with open(midi_path, "rb") as f:
            out["midi_b64"] = base64.b64encode(f.read()).decode()
    except Exception:
        out["midi_b64"] = None
    finally:
        os.unlink(midi_path)
    resp.media = out


@api.route("/api/tools/lilypond-pdf")
async def lilypond_pdf(req, resp):
    """POST LilyPond source; returns engraved PDF (requires the lilypond binary)."""
    import shutil
    import subprocess

    if shutil.which("lilypond") is None:
        return error(resp, 501, "lilypond binary not installed on the server")
    body = await req.content
    if not body:
        return error(resp, 400, "POST LilyPond source as the request body.")
    # Only engrave sources this server generated (LilyPond can run Scheme).
    sig = req.params.get("sig", "")
    if not hmac.compare_digest(sig, _sign_lilypond(body.decode("utf-8", "replace"))):
        return error(resp, 403, "Signature mismatch — only server-generated LilyPond can be engraved.")
    with tempfile.TemporaryDirectory() as tmp:
        src = os.path.join(tmp, "score.ly")
        with open(src, "wb") as f:
            f.write(body)
        try:
            proc = subprocess.run(
                ["lilypond", "--pdf", "-dno-point-and-click", "-o", os.path.join(tmp, "score"), src],
                capture_output=True, text=True, timeout=60,
            )
        except subprocess.TimeoutExpired:
            return error(resp, 504, "LilyPond timed out after 60s")
        pdf = os.path.join(tmp, "score.pdf")
        if proc.returncode != 0 or not os.path.exists(pdf):
            tail = (proc.stderr or "").strip().splitlines()[-8:]
            return error(resp, 422, "LilyPond failed:\n" + "\n".join(tail))
        with open(pdf, "rb") as f:
            resp.content = f.read()
    resp.headers["Content-Type"] = "application/pdf"
    resp.headers["Content-Disposition"] = "inline; filename=score.pdf"


if __name__ == "__main__":
    api.run(address="127.0.0.1", port=5042)
