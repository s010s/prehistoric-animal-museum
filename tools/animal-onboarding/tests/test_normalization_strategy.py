"""Regression tests for the generic normalizer's destructive strategy boundary."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path


BLENDER_DIRECTORY = Path(__file__).resolve().parents[1] / "blender"
if str(BLENDER_DIRECTORY) not in sys.path:
    sys.path.insert(0, str(BLENDER_DIRECTORY))

from normalize_animal import processing_strategy, verify_imported_strategy  # noqa: E402


def strategy(
    mode: str = "replace-with-project-morph",
    *,
    armature: str = "absent",
    animation: str = "absent",
    accepted: bool = False,
) -> dict[str, object]:
    return {
        "normalizationStrategy": mode,
        "animationStrategy": {
            "mode": mode,
            "sourceArmature": armature,
            "sourceAnimation": animation,
            "destructiveReplacementAccepted": accepted,
            "reason": "Explicit regression-test decision.",
        },
    }


class NormalizationStrategyTests(unittest.TestCase):
    def test_requires_acknowledgement_before_discarding_source_animation(self) -> None:
        declared = processing_strategy(
            strategy(armature="present", animation="present", accepted=False)
        )
        detected = {
            "armaturePresent": True,
            "animationPresent": True,
        }
        with self.assertRaisesRegex(RuntimeError, "destructively discard"):
            verify_imported_strategy(declared, detected)

        accepted = processing_strategy(
            strategy(armature="present", animation="present", accepted=True)
        )
        verify_imported_strategy(accepted, detected)


if __name__ == "__main__":
    unittest.main(argv=[__file__])
