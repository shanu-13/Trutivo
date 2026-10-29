"""Thresholds for the rule-based match analysis (Step 7A).

The levels describe a measurement (how much of the required skill list was
found, how similar two texts are). They never rate the candidate.

Each list is ordered from highest to lowest; a value gets the first level whose
minimum it reaches.
"""

from typing import Final, Literal

CoverageLevel = Literal["complete", "strong", "partial", "limited", "none"]
SimilarityLevel = Literal["very_high", "high", "moderate", "low", "very_low"]

# Required/preferred skill coverage (percent). "limited" is anything above 0.
COVERAGE_LEVELS: Final[list[tuple[float, CoverageLevel]]] = [
    (100, "complete"),
    (80, "strong"),
    (50, "partial"),
    (1e-9, "limited"),
    (0, "none"),
]

# Semantic similarity (percent). all-MiniLM-L6-v2 similarities are not
# calibrated: closely related job/resume texts often fall in 60-80.
SIMILARITY_LEVELS: Final[list[tuple[float, SimilarityLevel]]] = [
    (90, "very_high"),
    (75, "high"),
    (50, "moderate"),
    (25, "low"),
    (0, "very_low"),
]

# Similarity levels strong enough to be reported as a strength.
STRENGTH_SIMILARITY_LEVELS: Final[set[SimilarityLevel]] = {"very_high", "high"}

# Points by which semantic skill similarity and exact required-skill coverage
# must differ before the difference is pointed out.
SIGNAL_DIFFERENCE_THRESHOLD: Final = 25

# Preferred-skill coverage (percent) needed to report preferred skills as a strength.
PREFERRED_STRENGTH_MIN_COVERAGE: Final = 50

MAX_STRENGTHS: Final = 5
MAX_GAPS: Final = 5
# Up to this many missing required skills are reported as separate gaps; more are grouped into one.
MAX_INDIVIDUAL_SKILL_GAPS: Final = 3


def level_for(value: float, levels: list[tuple[float, str]]) -> str:
    for minimum, level in levels:
        if value >= minimum:
            return level
    return levels[-1][1]
