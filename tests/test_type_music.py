"""Type Music: pytheory-studio's sketchpad inside the playground.

The safety contract matters more than the music here: visitor text is parsed
into pytheory objects and never reaches LilyPond, input is bounded, and the
engraver refuses anything that smells like Scheme.
"""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import typemusic  # noqa: E402
from typemusic.engrave import EngraveError, assert_safe, lilypond_binary  # noqa: E402


class TypeMusicAnalysisTest(unittest.TestCase):
    def test_progression(self):
        a = typemusic.analyze(typemusic.parse_limited("C E7 Am | Dm7 G7 | C"))
        self.assertEqual(a["key"], "C major")
        self.assertEqual([c["roman"] for c in a["chords"]],
                         ["I", "V7/vi", "vi", "ii7", "V7", "I"])
        self.assertEqual(a["chords"][1]["outside"], ["G#"])

    def test_scale_and_melody(self):
        a = typemusic.analyze(typemusic.parse_limited("D dorian"))
        self.assertEqual(a["steps"], ["W", "H", "W", "W", "W", "H", "W"])
        m = typemusic.analyze(typemusic.parse_limited("in G: G4:e A4 B4 C5 D5:q B4 G4:h"))
        self.assertEqual(m["range"], "G4 – D5")

    def test_limits(self):
        with self.assertRaises(typemusic.ParseError):
            typemusic.parse_limited("C " * 300)
        with self.assertRaises(typemusic.ParseError):
            typemusic.parse_limited("C " * 100)


class TypeMusicSafetyTest(unittest.TestCase):
    def test_visitor_text_never_reaches_lilypond(self):
        ly = typemusic.to_lilypond(typemusic.parse_limited("# a comment\nC Am F G7"))
        self.assertNotIn("comment", ly)
        self.assertNotIn("title", ly)
        self.assertIs(assert_safe(ly), ly)

    def test_refuses_scheme(self):
        for bad in ['#(system "x")', "$(x)", '\\include "x"', 'title = #"x"', "#{ #}"]:
            with self.assertRaises(EngraveError, msg=bad):
                assert_safe(bad)

    @unittest.skipIf(lilypond_binary() is None, "lilypond not installed")
    def test_engraves_and_caches(self):
        ly = typemusic.to_lilypond(typemusic.parse_limited("in G: ii V I"))
        svg = typemusic.engrave_svg(ly)
        self.assertTrue(svg.lstrip().startswith("<svg"))
        self.assertIs(typemusic.engrave_svg(ly), svg)          # served from the LRU


class TypeMusicRoutesTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from app import api
        cls.client = api.requests

    def test_render(self):
        r = self.client.post("/api/type/render", json={"text": "C Am F G7"})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["analysis"]["numerals"], "I – vi – IV – V7")

    def test_bad_input_is_a_400(self):
        for body in ({"text": "C Am H"}, {"text": 5}, {"text": "x" * 500}):
            r = self.client.post("/api/type/render", json=body)
            self.assertEqual(r.status_code, 400, body)
            self.assertIn("error", r.json())

    def test_midi(self):
        r = self.client.get("/api/type/midi", params={"text": "C Am F G7"})
        self.assertEqual(r.content[:4], b"MThd")


if __name__ == "__main__":
    unittest.main()
