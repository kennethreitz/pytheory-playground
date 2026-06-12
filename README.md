# PyTheory Playground

A one-stop music theory toolbox — guitar or otherwise — where every result is
computed live on the server by [pytheory](https://github.com/kennethreitz/pytheory),
served by [responder](https://github.com/kennethreitz/responder). Styled after
[kennethreitz.org](https://kennethreitz.org).

## Run it

```console
$ uv run main.py
```

Then open <http://127.0.0.1:5042>. PDF engraving needs the `lilypond` binary
(`brew install lilypond`).

Or with Docker (lilypond + ffmpeg included):

```console
$ docker build -t pytheory-playground .
$ docker run -p 5042:5042 pytheory-playground
```

## What's inside

- **About** — what pytheory is and how to install it.
- **Guitar Tab** — chord charts for six fretted instruments with named guitar
  tunings (drop d, DADGAD, …), fully custom tunings, and capo support. The
  chord diagram is click-editable (pytheory names whatever you finger and
  selects the matching chord), alternative voicings up the neck load into the
  editor with a click, and an "on the neck" fretboard maps any scale — or the
  chord's own tones — across 12 frets, every note clickable and audible.
- **Tuner** — pytheory 0.47's native tuner: mic → YIN → note + signed cents at
  20 readings/sec over a Server-Sent Events stream, with a needle that goes
  green within ±5 cents. Chromatic or per-instrument (strings light up, click
  one for a reference tone), in any tonal system — tune to *Sa* if you like.
  Falls back to browser-mic capture when the server has no microphone (Docker).
- **Chord Lab** — voicings (inversions, drop 2/3, open), interval structure,
  pitch-class set theory (Forte numbers), tension/dissonance scoring, tritone
  substitutions, available extensions, beat frequencies, and the same chord
  playable in four temperaments (equal, pythagorean, meantone, just) — listen
  for the beating disappear under just intonation.
- **Scales** — every scale and mode across sixteen tonal systems (western,
  Indian rāgas, Arabic maqāmāt, gamelan slendro/pelog, 19-TET, Bohlen–Pierce…)
  with microtonal audio, harmonization, a piano view, and per-instrument
  fretboard diagrams.
- **Keys & Progressions** — diatonic triads/sevenths, borrowed chords,
  secondary dominants, chord suggestions, named progressions with per-chord
  diagrams, an interactive circle of fifths, a modulation planner with pivot
  chords, audio playback, and MIDI download.
- **Groove Lab** — one hundred drum patterns from the rhythm engine (bossa
  nova, dhol chaal, drum and bass, blast beat…) with auto-fills, a swing
  control, optional chord backing in any key, server-rendered audio, and
  MIDI export.
- **Tools**
  - *Chord identifier* — fret positions (any instrument/tuning) → chord name.
  - *Progression analyzer* — chord symbols → Roman-numeral analysis.
  - *Key detector* — note names → most likely key.
  - *Audio transcription* — hum, whistle, or record a line; `Score.from_wav`
    (YIN pitch tracking) turns it into LilyPond/ABC/MusicXML/tab + MIDI.
  - *MIDI converter* — `.mid` → LilyPond, ABC, MusicXML, or tab, with
    automatic key detection and PDF engraving via LilyPond.

Playback everywhere honors a global **sound** picker backed by pytheory's
synth presets (piano, theremin, koto, choir, …).

## API

Everything the UI does is a plain JSON/WAV/PDF endpoint:

| Endpoint | What it returns |
| --- | --- |
| `GET /api/meta` | Instruments, tunings, systems, sounds, progressions |
| `GET /api/chord?name=Cmaj7&instrument=guitar&tuning=drop d&capo=2` | Fingering, tab, tones |
| `GET /api/chord/lab?name=G7` | Voicings, set theory, tension, substitutions |
| `GET /api/chord/audio` / `GET /api/voicing/audio` / `GET /api/symbols/audio` | WAV |
| `GET /api/scale?system=gamelan&tonic=ji&name=slendro` | Tones, harmonization |
| `GET /api/scale/fretboard` / `GET /api/scale/audio` | Diagram / WAV |
| `GET /api/key?tonic=E&mode=minor` | Diatonic chords, signature, relative |
| `GET /api/key/explore?after=F` | Borrowed chords, secondary dominants, suggestions |
| `GET /api/key/modulate?to_tonic=Eb` | Modulation path + pivot chords |
| `GET /api/circle` | Circle of fifths with signatures + relatives |
| `GET /api/groove/audio?preset=funk&swing=0.15` (+`/midi`) | Drum groove WAV / MIDI |
| `GET /api/progression` (+`/audio`, `/midi`) | Chords with tabs / WAV / MIDI |
| `GET /api/tools/identify?frets=x,3,2,0,1,0` | Chord name from fingering |
| `GET /api/tools/analyze` / `GET /api/tools/detect-key` | Numerals / key |
| `POST /api/tools/midi-convert` (raw MIDI) | LilyPond, ABC, MusicXML, tab |
| `POST /api/tools/audio-convert` (raw audio) | Transcribed score in all formats + MIDI |
| `POST /api/tools/lilypond-pdf` (LilyPond source) | Engraved PDF |
| `POST /api/tuner/start` / `stop` | pytheory's native tuner (SSE at `:8123/stream`) |
| `POST /api/tools/tune?rate=&system=` (raw float32 PCM) | Pitch → note + cents, any system |
| `GET /api/tuner/strings?instrument=&tuning=&capo=` | Open-string reference tones |
