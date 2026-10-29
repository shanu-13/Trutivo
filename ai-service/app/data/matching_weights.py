"""Central configuration for the resume <-> job match score (Step 6B).

Change the weights here only. They are fractions that must sum to 1. When a
component does not apply to a job (for example, the job lists no preferred
skills), its weight is left out and the remaining weights are rescaled, so a
candidate is never penalised for a requirement the job does not have.

Bump SCORE_VERSION whenever the weights or the scoring rules change, so stored
or displayed scores can be traced to the method that produced them.
"""

from typing import Final, Literal, TypedDict

ComponentName = Literal["requiredSkills", "preferredSkills", "experience", "education"]


class MatchingWeights(TypedDict):
    requiredSkills: float
    preferredSkills: float
    experience: float
    education: float


MATCHING_WEIGHTS: Final[MatchingWeights] = {
    "requiredSkills": 0.60,
    "preferredSkills": 0.15,
    "experience": 0.15,
    "education": 0.10,
}

SCORING_METHOD: Final = "weighted_deterministic"
SCORE_VERSION: Final = "1.0"


def validate_weights(weights: MatchingWeights) -> None:
    if any(weight < 0 for weight in weights.values()):
        raise ValueError("Matching weights cannot be negative")
    if abs(sum(weights.values()) - 1) > 1e-9:
        raise ValueError("Matching weights must sum to 1")


validate_weights(MATCHING_WEIGHTS)
