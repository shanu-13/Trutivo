"""Semantic similarity between a structured resume and a structured job (Step 6C).

Four comparisons, each a cosine similarity of embeddings shown as 0-100:

* overall:    whole resume text            vs whole job text
* experience: resume experience            vs job responsibilities + experience requirements
* projects:   resume projects              vs job responsibilities + required skills
* skills:     resume skills                vs job required + preferred skills

A section longer than the model's input limit is split into chunks; its
embedding is the normalised mean of the chunk embeddings. Every chunk of every
section is embedded in one batch. A comparison with an empty side is reported
as "not_available" rather than scored.

This is additional information next to the deterministic match (Steps 6A/6B);
it does not change those results or the match score.
"""

import numpy as np

from app.models.matching import (
    SemanticMatchMetadata,
    SemanticMatchRequest,
    SemanticMatchResult,
    SemanticSimilarityComponent,
)
from app.services.embedding_service import (
    EmbeddingService,
    calculate_cosine_similarity,
    get_embedding_service,
    normalize,
    public_model_name,
)
from app.services.match_score_calculator import round_score
from app.services.semantic_text_builder import build_job_text, build_resume_text, chunk_text
from app.utils.responses import AppError


def similarity_percentage(cosine: float | None) -> int | float | None:
    """Cosine similarity as a 0-100 value (negative similarity counts as 0)."""
    if cosine is None:
        return None
    return round_score(min(max(cosine * 100, 0), 100))


def _section_vector(vectors: list[np.ndarray | None]) -> np.ndarray | None:
    usable = [v for v in vectors if v is not None]
    if not usable:
        return None
    return normalize(np.mean(usable, axis=0))


def match_semantically(request: SemanticMatchRequest, service: EmbeddingService | None = None) -> SemanticMatchResult:
    service = service or get_embedding_service()
    resume = build_resume_text(request.resume)
    job = build_job_text(request.job)

    resume_full, job_full = resume.full(), job.full()
    if not resume_full:
        raise AppError(422, "EMPTY_RESUME_CONTENT", "The resume has no content to compare")
    if not job_full:
        raise AppError(422, "EMPTY_JOB_CONTENT", "The job description has no content to compare")

    # name -> (resume text, job text, reason when the resume side is empty, reason when the job side is empty)
    comparisons = {
        "overall": (resume_full, job_full, "", ""),
        "experience": (
            resume.experience,
            job.responsibilities_and_experience(),
            "The resume lists no work experience",
            "The job lists no responsibilities or experience requirements",
        ),
        "projects": (
            resume.projects,
            job.responsibilities_and_required_skills(),
            "The resume lists no projects",
            "The job lists no responsibilities or required skills",
        ),
        "skills": (resume.skills, job.all_skills(), "The resume lists no skills", "The job lists no skills"),
    }

    # Chunk every non-empty text once, then embed all chunks together.
    chunked: dict[str, tuple[list[str], bool]] = {}
    for resume_text, job_text, _, _ in comparisons.values():
        for text in (resume_text, job_text):
            if text and text not in chunked:
                chunked[text] = chunk_text(text)
    all_chunks = [chunk for chunks, _ in chunked.values() for chunk in chunks]
    vectors = dict(zip(all_chunks, service.generate_embeddings(all_chunks)))
    section_vectors = {text: _section_vector([vectors[c] for c in chunks]) for text, (chunks, _) in chunked.items()}

    components: dict[str, SemanticSimilarityComponent] = {}
    for name, (resume_text, job_text, resume_reason, job_reason) in comparisons.items():
        if not resume_text or not job_text:
            components[name] = SemanticSimilarityComponent(status="not_available", reason=resume_reason if not resume_text else job_reason)
            continue
        resume_vector, job_vector = section_vectors[resume_text], section_vectors[job_text]
        cosine = (
            calculate_cosine_similarity(resume_vector, job_vector)
            if resume_vector is not None and job_vector is not None
            else None
        )
        similarity = similarity_percentage(cosine)
        truncated = chunked[resume_text][1] or chunked[job_text][1]
        if similarity is None:
            components[name] = SemanticSimilarityComponent(
                status="not_available", reason="The embedding for this content was not usable", truncated=truncated
            )
        else:
            components[name] = SemanticSimilarityComponent(similarity=similarity, status="calculated", truncated=truncated)

    return SemanticMatchResult(
        resumeId=request.resume_id,
        jobDescriptionId=request.job_description_id,
        overallSemanticSimilarity=components["overall"],
        experienceSemanticSimilarity=components["experience"],
        projectSemanticSimilarity=components["projects"],
        skillsSemanticSimilarity=components["skills"],
        metadata=SemanticMatchMetadata(model=public_model_name(service.model_name)),
    )
