"""Limits and thresholds for resume improvement recommendations (Step 7B).

Priorities express how directly an item relates to the job's stated
requirements, never a judgement of the candidate.
"""

from typing import Final

# Total recommendations returned (the spec asks for a manageable five to eight).
MAX_RECOMMENDATIONS: Final = 8
# Missing required skills beyond this many are grouped into one recommendation.
MAX_INDIVIDUAL_SKILL_RECOMMENDATIONS: Final = 3
# At most this many project-specific recommendations.
MAX_PROJECT_RECOMMENDATIONS: Final = 2
# A relevant project whose description has fewer words than this is reported as brief.
BRIEF_PROJECT_DESCRIPTION_WORDS: Final = 12
# Sort order for priorities.
PRIORITY_RANK: Final = {"high": 0, "medium": 1, "low": 2}
