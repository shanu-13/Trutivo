"""Request and response models for resume <-> job requirement matching.

The request carries only the structured data matching needs; raw resume or job
text is never sent. The response is a factual comparison: no score, rating or
recommendation.
"""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

ShortText = Annotated[str, StringConstraints(max_length=200)]
LongText = Annotated[str, StringConstraints(max_length=20_000)]
# int is kept for whole numbers so "2 years" serialises as 2, not 2.0.
Years = Annotated[int | float, Field(ge=0, le=60)]
Number = int | float

_MAX_SKILLS = 500
_MAX_ENTRIES = 100


class _Input(BaseModel):
    # Fields outside the contract are dropped, never trusted.
    model_config = ConfigDict(extra="ignore")


# --- Request --------------------------------------------------------------


class ResumeExperienceInput(_Input):
    startDate: ShortText | None = None
    endDate: ShortText | None = None
    isCurrent: bool = False
    # The entry's text, used only to find which skills a job mentions.
    text: LongText = ""


class ResumeEducationInput(_Input):
    degree: ShortText | None = None
    field: ShortText | None = None


class ResumeMatchInput(_Input):
    # Canonical skill names, either grouped by category or as a flat list.
    skills: dict[ShortText, list[ShortText]] | list[ShortText] = Field(default_factory=list)
    experience: list[ResumeExperienceInput] = Field(default_factory=list, max_length=_MAX_ENTRIES)
    education: list[ResumeEducationInput] = Field(default_factory=list, max_length=_MAX_ENTRIES)


class ExperienceRequirementInput(_Input):
    minimumYears: Years | None = None
    maximumYears: Years | None = None
    areas: list[ShortText] = Field(default_factory=list, max_length=_MAX_SKILLS)
    preferred: bool = False
    text: LongText = ""


class EducationRequirementInput(_Input):
    degree: ShortText | None = None
    fields: list[ShortText] = Field(default_factory=list, max_length=50)
    preferred: bool = False
    text: LongText = ""


class JobRequirementsInput(_Input):
    requiredSkills: list[ShortText] = Field(default_factory=list, max_length=_MAX_SKILLS)
    preferredSkills: list[ShortText] = Field(default_factory=list, max_length=_MAX_SKILLS)
    experienceRequirements: list[ExperienceRequirementInput] = Field(default_factory=list, max_length=_MAX_ENTRIES)
    educationRequirements: list[EducationRequirementInput] = Field(default_factory=list, max_length=_MAX_ENTRIES)


class MatchingRequest(_Input):
    resume_id: str = Field(min_length=1, max_length=64)
    job_description_id: str = Field(min_length=1, max_length=64)
    resume: ResumeMatchInput
    job_requirements: JobRequirementsInput


# --- Response -------------------------------------------------------------


class CategorySkills(BaseModel):
    matched: list[str] = Field(default_factory=list)
    missing: list[str] = Field(default_factory=list)


class SkillComparison(BaseModel):
    matched: list[str] = Field(default_factory=list)
    missing: list[str] = Field(default_factory=list)
    # Percentage of these skills found in the resume; None when the job lists none.
    coverage: Number | None = None
    # Skill dictionary category -> matched/missing skills in it.
    byCategory: dict[str, CategorySkills] = Field(default_factory=dict)


class SkillsMatch(BaseModel):
    required: SkillComparison
    preferred: SkillComparison


class ExperienceAreaComparison(BaseModel):
    area: str
    requiredYears: Number | None = None
    # Years of dated jobs whose description names this skill: a lower bound, or
    # None when no dated job names it.
    candidateYears: Number | None = None
    # True when the evidence meets the requirement, False when the skill is not in
    # the resume at all, None when the evidence is not enough to tell.
    meetsRequirement: bool | None = None


class ExperienceRequirementComparison(BaseModel):
    minimumYears: Number | None = None
    maximumYears: Number | None = None
    preferred: bool = False
    text: str = ""
    # For requirements without areas: compared against total experience.
    candidateYears: Number | None = None
    meetsRequirement: bool | None = None
    areas: list[ExperienceAreaComparison] = Field(default_factory=list)


class ExperienceMatch(BaseModel):
    status: Literal["compared", "not_applicable"]
    # The largest minimum among required (not preferred) requirements that name
    # no specific skill, compared with the resume's total experience.
    requiredYears: Number | None = None
    candidateYears: Number | None = None
    # Why candidateYears could not be calculated, when it is None.
    candidateYearsReason: str | None = None
    meetsRequirement: bool | None = None
    requirements: list[ExperienceRequirementComparison] = Field(default_factory=list)


class EducationRequirementComparison(BaseModel):
    requirement: str | None = None
    requiredFields: list[str] = Field(default_factory=list)
    preferred: bool = False
    text: str = ""
    requiredLevel: str | None = None
    # The resume entry used for the comparison, as "degree field".
    candidateEducation: str | None = None
    candidateLevel: str | None = None
    # Degree level comparison only; None when either level is unknown.
    meetsRequirement: bool | None = None
    # Whether the candidate's field is one of the required fields; None when not comparable.
    fieldMatch: bool | None = None


class EducationMatch(BaseModel):
    status: Literal["compared", "not_applicable"]
    requirements: list[EducationRequirementComparison] = Field(default_factory=list)


class MatchingSummary(BaseModel):
    requiredSkillCount: int
    matchedRequiredSkillCount: int
    missingRequiredSkillCount: int
    preferredSkillCount: int
    matchedPreferredSkillCount: int
    missingPreferredSkillCount: int


class MatchingResult(BaseModel):
    resumeId: str
    jobDescriptionId: str
    skills: SkillsMatch
    experience: ExperienceMatch
    education: EducationMatch
    summary: MatchingSummary


# --- Match score (Step 6B) ------------------------------------------------

ComponentStatus = Literal["calculated", "not_applicable", "insufficient_data"]


class MatchScoreComponent(BaseModel):
    # 0-100, rounded to two decimals; None unless status is "calculated".
    score: Number | None = None
    # Configured weight, in percent.
    weight: Number
    # Weight after rescaling over the applicable components, in percent; None when not applicable.
    effectiveWeight: Number | None = None
    # score x effectiveWeight / 100: the points this component adds to the overall score.
    contribution: Number | None = None
    status: ComponentStatus
    # Why the component was not calculated, when it was not.
    reason: str | None = None


class MatchScoreComponents(BaseModel):
    requiredSkills: MatchScoreComponent
    preferredSkills: MatchScoreComponent
    experience: MatchScoreComponent
    education: MatchScoreComponent


class MatchScoreWeights(BaseModel):
    requiredSkills: Number
    preferredSkills: Number
    experience: Number
    education: Number


class MatchScoreMetadata(BaseModel):
    scoringMethod: str
    version: str
    # Configured weights, in percent.
    weights: MatchScoreWeights


class MatchScoreResult(BaseModel):
    # 0-100, rounded to two decimals; None when no component could be calculated.
    overallScore: Number | None = None
    scoreStatus: Literal["calculated", "insufficient_data"]
    components: MatchScoreComponents
    scoreMetadata: MatchScoreMetadata


class ScoredMatchingResult(MatchingResult):
    """Step 6A's factual comparison together with the Step 6B score."""

    overallScore: Number | None = None
    scoreStatus: Literal["calculated", "insufficient_data"]
    components: MatchScoreComponents
    scoreMetadata: MatchScoreMetadata


# --- Semantic matching (Step 6C) -------------------------------------------
# Only professional content is accepted. Personal details (name, email, phone,
# links), ids and file paths have no field here, and unknown fields are dropped,
# so they can never reach the embedding text.


class SemanticExperienceInput(_Input):
    title: ShortText | None = None
    company: ShortText | None = None
    description: list[LongText] = Field(default_factory=list, max_length=200)
    # Used only when title, company and description are all empty.
    rawText: LongText = ""


class SemanticProjectInput(_Input):
    name: ShortText | None = None
    description: list[LongText] = Field(default_factory=list, max_length=200)
    technologies: list[ShortText] = Field(default_factory=list, max_length=_MAX_SKILLS)


class SemanticEducationInput(_Input):
    degree: ShortText | None = None
    field: ShortText | None = None
    institution: ShortText | None = None


class SemanticResumeInput(_Input):
    summary: LongText | None = None
    experience: list[SemanticExperienceInput] = Field(default_factory=list, max_length=_MAX_ENTRIES)
    projects: list[SemanticProjectInput] = Field(default_factory=list, max_length=_MAX_ENTRIES)
    skills: dict[ShortText, list[ShortText]] | list[ShortText] = Field(default_factory=list)
    education: list[SemanticEducationInput] = Field(default_factory=list, max_length=_MAX_ENTRIES)


class SemanticRequirementText(_Input):
    text: LongText = ""


class SemanticJobInput(_Input):
    title: ShortText | None = None
    # The job description as entered; used for the overall comparison.
    description: Annotated[str, StringConstraints(max_length=60_000)] | None = None
    responsibilities: list[LongText] = Field(default_factory=list, max_length=200)
    requiredSkills: list[ShortText] = Field(default_factory=list, max_length=_MAX_SKILLS)
    preferredSkills: list[ShortText] = Field(default_factory=list, max_length=_MAX_SKILLS)
    experienceRequirements: list[SemanticRequirementText] = Field(default_factory=list, max_length=_MAX_ENTRIES)
    educationRequirements: list[SemanticRequirementText] = Field(default_factory=list, max_length=_MAX_ENTRIES)


class SemanticMatchRequest(_Input):
    resume_id: str = Field(min_length=1, max_length=64)
    job_description_id: str = Field(min_length=1, max_length=64)
    resume: SemanticResumeInput
    job: SemanticJobInput


class SemanticSimilarityComponent(BaseModel):
    # Cosine similarity x 100, clamped to 0-100 and rounded to two decimals;
    # None unless status is "calculated".
    similarity: Number | None = None
    status: Literal["calculated", "not_available"]
    # Why the similarity was not calculated, when it was not.
    reason: str | None = None
    # True when a section was longer than the embedding limit and its end was left out.
    truncated: bool = False


class SemanticMatchMetadata(BaseModel):
    model: str
    method: Literal["cosine_similarity"] = "cosine_similarity"


class SemanticMatchResult(BaseModel):
    resumeId: str
    jobDescriptionId: str
    overallSemanticSimilarity: SemanticSimilarityComponent
    experienceSemanticSimilarity: SemanticSimilarityComponent
    projectSemanticSimilarity: SemanticSimilarityComponent
    skillsSemanticSimilarity: SemanticSimilarityComponent
    metadata: SemanticMatchMetadata


# --- Match analysis (Step 7A) ----------------------------------------------
# Rule-based explanation of the Step 6A/6B/6C results. Every statement is
# derived from those results; nothing about the candidate is inferred.

StrengthCategory = Literal["skills", "experience", "education", "projects", "semantic_similarity"]
GapCategory = Literal["required_skill", "preferred_skill", "experience", "education", "insufficient_data"]
HighlightCategory = Literal["required_skills", "preferred_skills", "experience", "education", "semantic_similarity"]
CoverageLevelName = Literal["complete", "strong", "partial", "limited", "none"]
SimilarityLevelName = Literal["very_high", "high", "moderate", "low", "very_low"]


class AnalysisObservation(BaseModel):
    category: HighlightCategory
    message: str


class StrengthObservation(BaseModel):
    category: StrengthCategory
    message: str


class GapObservation(BaseModel):
    category: GapCategory
    message: str


class SkillCoverageAnalysis(BaseModel):
    status: Literal["calculated", "not_applicable"]
    matched: list[str] = Field(default_factory=list)
    missing: list[str] = Field(default_factory=list)
    coverage: Number | None = None
    # Describes how much of the list was found, not the candidate.
    coverageLevel: CoverageLevelName | None = None


class SkillAnalysis(BaseModel):
    required: SkillCoverageAnalysis
    preferred: SkillCoverageAnalysis


class ExperienceAreaAnalysis(BaseModel):
    area: str
    requiredYears: Number | None = None
    # Years of dated jobs that name the skill: a lower bound.
    evidenceYears: Number | None = None
    status: Literal["satisfied", "skill_not_found", "insufficient_evidence"]
    preferred: bool = False


class ExperienceAnalysis(BaseModel):
    status: Literal["satisfied", "below_requirement", "not_applicable", "insufficient_data"]
    requiredYears: Number | None = None
    candidateYears: Number | None = None
    # The Step 6B experience score.
    score: Number | None = None
    reason: str | None = None
    skillSpecific: list[ExperienceAreaAnalysis] = Field(default_factory=list)


class EducationAnalysis(BaseModel):
    status: Literal["satisfied", "not_satisfied", "not_applicable", "insufficient_data"]
    requiredDegree: str | None = None
    requiredFields: list[str] = Field(default_factory=list)
    candidateDegree: str | None = None
    fieldMatch: bool | None = None
    reason: str | None = None


class SemanticAspectAnalysis(BaseModel):
    similarity: Number | None = None
    level: SimilarityLevelName | None = None
    status: Literal["calculated", "not_available"]


class SignalComparison(BaseModel):
    exactRequiredSkillCoverage: Number
    semanticSkillsSimilarity: Number
    # semantic minus exact, in percentage points.
    difference: Number
    observation: str | None = None


class SemanticAnalysis(BaseModel):
    status: Literal["calculated", "unavailable"]
    overall: SemanticAspectAnalysis | None = None
    experience: SemanticAspectAnalysis | None = None
    projects: SemanticAspectAnalysis | None = None
    skills: SemanticAspectAnalysis | None = None
    reason: str | None = None
    # Exact skill coverage next to semantic skill similarity, when both exist.
    signalComparison: SignalComparison | None = None


class DataQualityAnalysis(BaseModel):
    status: Literal["complete", "mostly_complete", "partial", "insufficient"]
    # Applicable parts that could not be evaluated.
    issues: list[str] = Field(default_factory=list)
    # Parts the job does not specify. These are not data-quality problems.
    notApplicable: list[str] = Field(default_factory=list)


class OverallAnalysis(BaseModel):
    # The Step 6B deterministic score, unchanged.
    matchScore: Number | None = None
    scoreAvailable: bool
    summary: str
    highlights: list[AnalysisObservation] = Field(default_factory=list)


class MatchAnalysisResult(BaseModel):
    overall: OverallAnalysis
    skills: SkillAnalysis
    experience: ExperienceAnalysis
    education: EducationAnalysis
    semanticSimilarity: SemanticAnalysis
    dataQuality: DataQualityAnalysis
    strengths: list[StrengthObservation] = Field(default_factory=list)
    gaps: list[GapObservation] = Field(default_factory=list)
    # Gaps left out of ``gaps`` by the length limit (they remain in the detailed sections).
    additionalGapCount: int = 0


class SemanticErrorInput(_Input):
    code: Annotated[str, StringConstraints(max_length=100)]
    message: Annotated[str, StringConstraints(max_length=500)]


class MatchAnalysisRequest(_Input):
    # The exact Step 6A/6B and 6C results; the analysis never recomputes them.
    matching: ScoredMatchingResult
    semanticMatch: SemanticMatchResult | None = None
    semanticError: SemanticErrorInput | None = None


# --- Resume improvement recommendations (Step 7B) --------------------------
# Deterministic suggestions derived from the Step 6A/6B/6C/7A results and the
# structured resume. They never claim the candidate has (or lacks) a skill:
# "not detected" is reported, never "absent".

RecommendationCategory = Literal[
    "required_skill", "preferred_skill", "experience", "projects", "education", "resume_content", "data_quality"
]
RecommendationPriority = Literal["high", "medium", "low"]


class ResumeRecommendation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: Annotated[str, StringConstraints(pattern=r"^rec-\d{3}$")]
    category: RecommendationCategory
    priority: RecommendationPriority
    title: Annotated[str, StringConstraints(min_length=1, max_length=200)]
    issue: Annotated[str, StringConstraints(min_length=1, max_length=600)]
    reason: Annotated[str, StringConstraints(min_length=1, max_length=600)]
    action: Annotated[str, StringConstraints(min_length=1, max_length=800)]
    relatedSkills: list[str] = Field(default_factory=list)
    # Short pointer to the requirement or resume entry the recommendation is based on.
    evidence: Annotated[str, StringConstraints(max_length=300)] | None = None


class ResumeRecommendations(BaseModel):
    items: list[ResumeRecommendation] = Field(default_factory=list, max_length=8)
    total: int
    # Things that limited the recommendations but are not the user's to fix
    # (for example an ambiguous job requirement or an unavailable service).
    limitations: list[str] = Field(default_factory=list)
    # Set when no recommendation could be reliably generated.
    message: str | None = None


class RecommendationExperienceInput(_Input):
    title: ShortText | None = None
    company: ShortText | None = None
    startDate: ShortText | None = None
    endDate: ShortText | None = None
    isCurrent: bool = False
    description: list[LongText] = Field(default_factory=list, max_length=200)


class RecommendationProjectInput(_Input):
    name: ShortText | None = None
    description: list[LongText] = Field(default_factory=list, max_length=200)
    technologies: list[ShortText] = Field(default_factory=list, max_length=_MAX_SKILLS)


class RecommendationResumeInput(_Input):
    experience: list[RecommendationExperienceInput] = Field(default_factory=list, max_length=_MAX_ENTRIES)
    projects: list[RecommendationProjectInput] = Field(default_factory=list, max_length=_MAX_ENTRIES)


class RecommendationRequest(_Input):
    # Results of the earlier steps, used as-is.
    matching: ScoredMatchingResult
    analysis: MatchAnalysisResult
    # Only the resume entries needed to point at specific roles and projects.
    resume: RecommendationResumeInput = Field(default_factory=RecommendationResumeInput)
