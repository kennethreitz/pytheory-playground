"""Guitar-tab voicings for pytheory 0.59.

The headline shape is Fretboard.chord(name). The voicings list is
Fretboard.chord(name, multiple=True), best first, and it starts with
that same shape. Curated standard-tuning grips must stay put.
"""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import APIError, _tuning_label, build_chord  # noqa: E402
from pytheory import CHARTS, Fretboard  # noqa: E402


def _shapes(payload):
    return [v["positions"] for v in payload["voicings"]]


class ChordVoicingsTest(unittest.TestCase):
    def test_standard_curated_shapes_stay_first(self):
        expect = {
            "C": [None, 3, 2, 0, 1, 0],
            "G": [3, 2, 0, 0, 0, 3],
            "D": [None, None, 0, 2, 3, 2],
            "Am": [None, 0, 2, 2, 1, 0],
            "F": [1, 3, 3, 2, 1, 1],
            "G7": [3, 2, 0, 0, 0, 1],
        }
        for name, positions in expect.items():
            got = build_chord(name)
            self.assertEqual(got["positions"], positions, name)
            self.assertEqual(got["voicings"][0]["positions"], positions, name)
            self.assertEqual(got["strings"], ["E", "A", "D", "G", "B", "e"])
            self.assertFalse(got["computed"], name)
            self.assertEqual(got["tuning"], "standard")
            self.assertEqual(got["capo"], 0)
            self.assertLessEqual(len(got["voicings"]), 8)
            self.assertGreaterEqual(len(got["voicings"]), 3)
            self.assertEqual(len({tuple(s) for s in _shapes(got)}), len(got["voicings"]))
            self.assertEqual(
                got["alternatives"],
                [v["positions"] for v in got["voicings"][1:]],
            )
            self.assertTrue(got["tab"].startswith(name + "\n"), got["tab"])

    def test_standard_c_tab_matches_the_chart(self):
        chart = CHARTS["western"]["C"].tab(fretboard=Fretboard.guitar())
        self.assertEqual(build_chord("C")["tab"], chart)

    def test_ranked_set_includes_the_other_common_grips(self):
        c = _shapes(build_chord("C"))
        self.assertIn([None, 3, 5, 5, 5, 3], c)  # A-shape barre
        f = _shapes(build_chord("F"))
        self.assertIn([None, None, 3, 2, 1, 1], f)  # small F

    def test_limit_keeps_the_best_grip(self):
        full = build_chord("C")
        two = build_chord("C", limit=2)
        self.assertEqual(len(two["voicings"]), 2)
        self.assertEqual(two["positions"], full["positions"])
        self.assertEqual(_shapes(two), _shapes(full)[:2])

    def test_smoke_matrix_standard_dadgad_and_capo(self):
        """C, F, G7, and Am in the three setups the playground needs to serve."""
        dadgad = {
            "C": [None, 3, 2, 0, 3, None],
            "F": [3, 3, 3, 2, 0, 3],
            "G7": [3, 2, 0, 0, 2, 0],
            "Am": [None, 0, 2, 2, 3, 2],
        }
        capo2 = {
            "C": [None, 1, 3, 3, 3, 1],
            "F": [None, 6, 5, 0, 4, 6],
            "G7": [1, 3, 1, 2, 1, 1],
            "Am": [3, 1, 0, 0, 3, 3],
        }
        for name in ("C", "F", "G7", "Am"):
            standard = build_chord(name)
            dad = build_chord(name, tuning="DADGAD")
            capo = build_chord(name, capo=2)
            for got in (standard, dad, capo):
                self.assertEqual(got["voicings"][0]["positions"], got["positions"])
                self.assertGreaterEqual(len(got["voicings"]), 3)
                self.assertLessEqual(len(got["voicings"]), 8)
                self.assertEqual(len(got["open_strings"]), 6)
            self.assertEqual(dad["tuning"], "dadgad")
            self.assertEqual(dad["open_strings"], ["D2", "A2", "D3", "G3", "A3", "D4"])
            self.assertEqual(dad["strings"], ["D2", "A2", "D3", "G3", "A3", "D4"])
            self.assertEqual(dad["positions"], dadgad[name], name)
            self.assertNotEqual(dad["positions"], standard["positions"], name)
            self.assertEqual(capo["capo"], 2)
            self.assertEqual(capo["open_strings"], ["F#2", "B2", "E3", "A3", "C#4", "F#4"])
            self.assertEqual(capo["strings"], ["F#2", "B2", "E3", "A3", "C#4", "F#4"])
            self.assertEqual(capo["positions"], capo2[name], name)
            self.assertNotEqual(capo["positions"], standard["positions"], name)

    def test_named_tunings_the_picker_exposes(self):
        self.assertEqual(
            build_chord("D", tuning="drop d")["positions"],
            [0, 0, 0, 2, 3, 2],
        )
        self.assertEqual(
            build_chord("D", tuning="dadgad")["positions"],
            [0, 0, 4, 2, 0, 0],
        )
        self.assertEqual(
            build_chord("G", tuning="open g")["positions"],
            [None, 0, 0, 0, 0, 0],
        )
        self.assertEqual(
            build_chord("A", capo=2)["positions"],
            [3, 2, 0, 0, 0, 3],
        )
        self.assertEqual(
            build_chord("D", capo=2)["positions"],
            [None, 3, 2, 0, 1, 0],
        )
        self.assertEqual(
            build_chord("Bm", capo=2)["positions"],
            [None, 0, 2, 2, 1, 0],
        )
        half = build_chord("Am", tuning="half step down")
        self.assertEqual(half["positions"], [None, 1, 3, 3, 2, 1])
        self.assertEqual(half["tuning"], "half step down")
        open_d = build_chord("D", tuning="open d")
        self.assertEqual(open_d["voicings"][0]["positions"], open_d["positions"])
        self.assertEqual(
            build_chord("G", tuning="p4")["positions"],
            build_chord("G", tuning="all fourths")["positions"],
        )
        for name in Fretboard.TUNINGS:
            got = build_chord("G", tuning=name)
            self.assertEqual(got["tuning"], name)
            self.assertEqual(got["voicings"][0]["positions"], got["positions"])
            self.assertGreaterEqual(len(got["voicings"]), 1)

    def test_tuning_labels(self):
        self.assertEqual(_tuning_label("drop d"), "drop D")
        self.assertEqual(_tuning_label("open g"), "open G")
        self.assertEqual(_tuning_label("dadgad"), "DADGAD")
        self.assertEqual(_tuning_label("half step down"), "half-step down")
        self.assertEqual(_tuning_label("standard"), "standard")
        self.assertEqual(_tuning_label("p4"), "P4 (all fourths)")

    def test_uncharted_symbol_lists_several_grips(self):
        got = build_chord("F#m7b5")
        self.assertTrue(got["computed"])
        self.assertGreaterEqual(len(got["voicings"]), 2)
        self.assertEqual(got["voicings"][0]["positions"], got["positions"])
        self.assertFalse(isinstance(got["positions"], tuple))

    def test_ukulele_keeps_its_open_c(self):
        got = build_chord("C", instrument="ukulele")
        self.assertEqual(got["positions"], [0, 0, 0, 3])
        self.assertEqual(got["voicings"][0]["positions"], got["positions"])
        self.assertGreaterEqual(len(got["voicings"]), 2)

    def test_rejections(self):
        with self.assertRaises(APIError) as bad_limit:
            build_chord("C", limit=0)
        self.assertEqual(bad_limit.exception.status, 400)
        with self.assertRaises(APIError) as bad_tuning:
            build_chord("C", instrument="ukulele", tuning="dadgad")
        self.assertEqual(bad_tuning.exception.status, 400)
        with self.assertRaises(APIError) as bad_capo:
            build_chord("C", capo=13)
        self.assertEqual(bad_capo.exception.status, 400)
        with self.assertRaises(APIError) as bad_name:
            build_chord("not-a-chord")
        self.assertEqual(bad_name.exception.status, 404)
        with self.assertRaises(APIError) as bad_instrument:
            build_chord("C", instrument="piano")
        self.assertEqual(bad_instrument.exception.status, 400)


if __name__ == "__main__":
    unittest.main()
