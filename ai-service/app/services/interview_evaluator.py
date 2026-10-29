"""Rule-based evaluation of mock interview answers (Step 16).

The score (0-100) is an automated estimate made of four parts:
  * coverage (50): how many of the question's expected points the answer touches;
  * relevance (20): whether it stays on the question's subject;
  * development (20): type-specific depth (technical: an example and reasoning;
    behavioural: personal actions and an outcome; HR: link to the role and evidence);
  * length and specificity (10): a reasonable length and concrete details.
Very short or off-topic answers are marked as lacking detail and capped.

Feedback only describes the answer; it never adds facts about the candidate.
Example answers are outlines with [bracketed] parts for the candidate to fill
in from their own real experience.
"""

import re

from app.data.interview_bank import RULES_VERSION
from app.models.interview import Evaluation, EvaluationRequest, ExpectedPoint
from app.services.skill_extractor import get_skill_matcher

WEIGHTS = {"coverage": 50, "relevance": 20, "development": 20, "length": 10}
# Ideal answer length in words, by difficulty.
LENGTH_RANGE = {"beginner": (40, 250), "intermediate": (60, 350), "advanced": (80, 450)}
MIN_WORDS = 20
INSUFFICIENT_CAP = 25
TOO_SHORT_CAP = 15
EXAMPLE_BELOW = 85

_WORD_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9'+#.\-]*")
_NUMBER_RE = re.compile(r"\b\d+(?:[.,]\d+)?\s*(?:%|percent|x|ms|seconds|minutes|hours|days|weeks|users|people|requests)?")
_STOP = set(
    "about above after again against also among another answer apply approach based because before being below between both could "
    "describe during each either every example explain first from have having into it's itself just like make many might more most "
    "much must other over role same should since some such than that their them then there these they thing this those through under "
    "until used using very want what when where which while whom whose with within without would your yours you're".split()
)
_EXAMPLE_RE = re.compile(r"\b(for example|for instance|e\.g\.|such as|in my|i used|we used|in one project|in a project|on a project)\b")
_REASONING_RE = re.compile(r"\b(because|so that|trade-?offs?|however|depends|instead|downside|advantage|disadvantage|on the other hand|the reason)\b")
_FIRST_PERSON_RE = re.compile(r"\b(i|i'm|i've|my)\b")
_EVIDENCE_RE = re.compile(r"\b(for example|for instance|when i|i have|i've|project|i built|i worked|i led|i delivered)\b")


def _keyword_re(keyword: str) -> re.Pattern:
    k = keyword.lower().strip()
    # Longer word stems ("collaborat", "priorit") also match their endings; short words allow a plural.
    suffix = r"[a-z]*" if len(k) >= 6 and k[-1].isalpha() else r"(?:s|es)?"
    return re.compile(r"(?<![a-z0-9])" + re.escape(k) + (suffix if k[-1].isalnum() else "") + r"(?![a-z0-9])")


def _covers(point: ExpectedPoint, text: str) -> bool:
    return any(_keyword_re(k).search(text) for k in point.keywords)


def _content_words(text: str) -> list[str]:
    seen: list[str] = []
    for w in _WORD_RE.findall(text.lower()):
        w = w.strip(".-'")
        if len(w) >= 5 and w not in _STOP and w not in seen:
            seen.append(w)
    return seen


def evaluate_answer(req: EvaluationRequest) -> Evaluation:
    q = req.question
    answer = req.answer.strip()
    lowered = answer.lower()
    words = _WORD_RE.findall(answer)
    word_count = len(words)

    covered = [p for p in q.expectedPoints if _covers(p, lowered)]
    uncovered = [p for p in q.expectedPoints if p not in covered]
    coverage = len(covered) / len(q.expectedPoints)

    # Relevance: the subject (skill) is named, and the answer shares the question's key words.
    key_words = _content_words(q.text)[:10]
    overlap = sum(1 for w in key_words if _keyword_re(w).search(lowered)) / len(key_words) if key_words else 0.0
    skill = q.grounding.skill
    if skill:
        named = skill in {s for names in get_skill_matcher().extract(answer).values() for s in names} or skill.lower() in lowered
        relevance = 0.5 * float(named) + 0.5 * min(1.0, overlap * 2)
    else:
        relevance = min(1.0, overlap * 2)

    # Development, by question type.
    strengths: list[str] = []
    missing: list[str] = []
    suggestions: list[str] = []
    if q.type == "technical":
        has_example = bool(_EXAMPLE_RE.search(lowered))
        has_reasoning = bool(_REASONING_RE.search(lowered))
        development = 0.5 * has_example + 0.5 * has_reasoning
        if has_example:
            strengths.append("Gives a concrete example.")
        else:
            missing.append("No concrete example.")
            suggestions.append("Add a short example. Use one from your own work or study if you have it; if you have not used this yet, say so and explain how you would approach it.")
        if has_reasoning:
            strengths.append("Explains reasoning or trade-offs.")
        else:
            missing.append("Little explanation of why, or of trade-offs.")
            suggestions.append("Explain why you would choose an approach and what its limitations are.")
    elif q.type == "behavioral":
        first_person = len(_FIRST_PERSON_RE.findall(lowered))
        has_outcome = bool(_NUMBER_RE.search(answer)) or any(p.label.startswith("result") for p in covered)
        development = 0.5 * (first_person >= 3) + 0.5 * has_outcome
        if first_person >= 3:
            strengths.append("Makes your own part clear.")
        else:
            missing.append("Your personal contribution is unclear.")
            suggestions.append("Say what you personally did (\"I ...\"), not only what the team did.")
        if has_outcome:
            strengths.append("Describes an outcome.")
        star_missing = [p.label.split(" (")[0] for p in uncovered if "(" in p.label]
        if star_missing:
            suggestions.append(f"Structure the answer with STAR; it is missing: {', '.join(star_missing)}.")
        suggestions.append("Use a real example. Do not invent situations or results; if you have no matching experience, say so and use the closest real one.")
    else:
        role_words = [w for w in _content_words(q.text) if w not in {"interested", "strengths", "relevant", "evidence", "career", "prefer", "handle"}]
        linked = any(_keyword_re(w).search(lowered) for w in role_words) or bool(re.search(r"\b(this role|this position|this job|the role|the team|your company)\b", lowered))
        has_evidence = bool(_EVIDENCE_RE.search(lowered))
        development = 0.5 * linked + 0.5 * has_evidence
        if linked:
            strengths.append("Connects the answer to this role.")
        else:
            missing.append("Not clearly linked to this role.")
            suggestions.append("Connect your answer to this specific role and what it involves.")
        if has_evidence:
            strengths.append("Backs points up with your own experience.")
        else:
            missing.append("No evidence from your own experience.")
            suggestions.append("Support your points with something you have actually done.")

    low, high = LENGTH_RANGE[q.difficulty]
    in_range = low <= word_count <= high
    specific = bool(_NUMBER_RE.search(answer)) or bool(get_skill_matcher().extract_in_order(answer))
    length_part = 0.6 * in_range + 0.4 * specific
    if word_count > high:
        suggestions.append(f"Tighten the answer to its key points (about {high} words or fewer).")
    elif word_count < low and word_count >= MIN_WORDS:
        suggestions.append(f"Develop the answer further (about {low}-{high} words is typical).")

    score = round(
        WEIGHTS["coverage"] * coverage
        + WEIGHTS["relevance"] * relevance
        + WEIGHTS["development"] * development
        + WEIGHTS["length"] * length_part
    )

    insufficient = word_count < MIN_WORDS or (coverage == 0 and overlap == 0)
    if insufficient:
        score = min(score, TOO_SHORT_CAP if word_count < MIN_WORDS else INSUFFICIENT_CAP)
        suggestions.insert(
            0,
            "The answer does not give enough information to assess. Add what you actually know or did, in your own words."
            if word_count >= MIN_WORDS
            else "The answer is too short to assess. Explain your point and support it with a real example.",
        )

    strengths = [f"Covers {p.label}." for p in covered] + strengths
    missing = [f"Does not address {p.label}." for p in uncovered] + missing
    for p in uncovered:
        if q.type == "technical":
            suggestions.append(f"Explain {p.label}{f' in {skill}' if skill else ''}.")
        elif "(" not in p.label:
            suggestions.append(f"Address {p.label}.")

    if q.type == "technical":
        concepts = [f"{p.label} ({skill})" if skill else p.label for p in uncovered]
    else:
        concepts = [p.label for p in uncovered if "(" not in p.label]
        if q.type == "behavioral" and any("(" in p.label for p in uncovered):
            concepts.append("STAR answer structure")

    return Evaluation(
        rulesVersion=RULES_VERSION,
        score=max(0, min(100, score)),
        insufficientDetail=insufficient,
        strengths=strengths if not insufficient else strengths[:2],
        missingPoints=missing,
        suggestions=list(dict.fromkeys(suggestions))[:8],
        exampleAnswer=_example(req) if score < EXAMPLE_BELOW else None,
        conceptsToReview=list(dict.fromkeys(concepts))[:8],
        coveredPoints=[p.label for p in covered],
        wordCount=word_count,
    )


def _example(req: EvaluationRequest) -> str:
    """An outline of a stronger answer; personal details stay as [placeholders]."""
    q = req.question
    labels = [p.label for p in q.expectedPoints]
    if q.type == "technical":
        subject = q.grounding.skill or q.focus
        parts = "; ".join(f"explain {label} in a sentence or two" for label in labels)
        return (
            f"Outline: {parts[0].upper() + parts[1:]}. Then give an example: \"In [a project, job or course where you really used {subject}], "
            f"I [what you did] so that [why it mattered].\" Finish with a trade-off or limitation you would watch for. "
            f"If you have not used {subject}, say so and describe how you would approach it instead."
        )
    if q.type == "behavioral":
        return (
            "Outline (STAR): Situation: [when and where this happened, briefly]. Task: [what you were responsible for]. "
            "Action: [the steps you personally took, and why]. Result: [what changed, with a real figure if you have one, "
            "and what you learned]. Use only real events."
        )
    return (
        "Outline: \"I'm interested in this role because [a specific, honest reason about the role or company]. "
        "In [a real experience], I [something you did that is relevant]. I'd bring [a strength you can show] "
        "and I'd like to develop [an area this role offers].\""
    )
