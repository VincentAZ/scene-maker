"""python3 -m unittest discover -s tests -p test_local_generate.py -v
Image tests also run with .data/ai-pilot/venv/bin/python (no torch needed).
"""
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("local_generate", ROOT / "engine/local_generate.py")
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


class ValidationTests(unittest.TestCase):
    def test_defaults(self):
        result = runner.validate_spec(dict(prompt="a lamp", category="props"))
        self.assertEqual((result["seed"], result["steps"], result["octreeResolution"], result["allowDownload"]), (39004, 40, 384, False))

    def test_invalid_specs(self):
        cases = [None, [], {}, {"prompt": "", "category": "props"}]
        for patch in ({"category": "other"}, {"seed": True}, {"seed": -1}, {"steps": 101},
                      {"steps": 1.2}, {"octreeResolution": 1024}, {"allowDownload": "false"},
                      {"reference": "https://example.com/a.png"}, {"prompt": "a" * 4001}):
            cases.append(dict(prompt="a lamp", category="props") | patch)
        for value in cases:
            with self.subTest(value=value), self.assertRaises((ValueError, FileNotFoundError)):
                runner.validate_spec(value)

    def test_prompt(self):
        character = runner.reference_prompt(dict(prompt="archivist", category="characters"))
        self.assertIn("T pose", character)
        self.assertIn("white background", character)
        self.assertNotIn("T pose", runner.reference_prompt(dict(prompt="lamp", category="props")))

    def test_cli_paths_and_overwrite(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "spec.json"
            source.write_text(json.dumps(dict(prompt="lamp", category="props")))
            args = list(map(str, [source, root / "raw.glb", root / "thumb.png", root / "provenance.json"]))
            actual, paths = runner.parse_arguments(["--"] + args)
            self.assertEqual(actual["seed"], 39004)
            self.assertEqual(paths[1], root / "raw.glb")
            with self.assertRaises(ValueError):
                runner.parse_arguments(args[:-1] + [str(source)])
            (root / "raw.glb").write_bytes(b"existing")
            with self.assertRaises(ValueError):
                runner.parse_arguments(args)
            self.assertEqual((root / "raw.glb").read_bytes(), b"existing")

    def test_reference_path_validation(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "reference.png"
            path.write_bytes(b"reference")
            result = runner.validate_spec(dict(prompt="lamp", category="props", reference=str(path)))
            self.assertEqual(result["reference"], str(path.resolve()))
            path.write_bytes(b"")
            with self.assertRaises(ValueError):
                runner.validate_spec(dict(prompt="lamp", category="props", reference=str(path)))

    def test_failure_is_nonzero_without_loading_torch(self):
        result = subprocess.run([sys.executable, str(ROOT / "engine/local_generate.py"), "--"], capture_output=True, text=True)
        self.assertEqual(result.returncode, 1)
        self.assertIn("usage:", result.stderr)
        self.assertNotIn("STATS", result.stdout)

    def test_sha256(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "x"
            path.write_bytes(b"abc")
            self.assertEqual(runner.sha256(path), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")


class BackgroundTests(unittest.TestCase):
    def test_border_only_and_existing_alpha(self):
        try:
            from PIL import Image
            import numpy as np
            import scipy
        except ImportError:
            self.skipTest("Pillow/numpy/scipy optional; use isolated AI venv for image tests")
        rgba = np.full((7, 7, 4), 255, dtype=np.uint8)
        rgba[1:6, 1:6, :3] = 10
        rgba[3, 3, :3] = 255  # enclosed white must remain opaque
        rgba[2, 2, 3] = 42  # existing alpha must survive
        result = np.array(runner.remove_white_background(Image.fromarray(rgba)))
        self.assertTrue(np.all(result[0, :, 3] == 0))
        self.assertEqual(result[3, 3, 3], 255)
        self.assertEqual(result[2, 2, 3], 42)
        self.assertTrue(np.array_equal(result[..., :3], rgba[..., :3]))


if __name__ == "__main__":
    unittest.main()
