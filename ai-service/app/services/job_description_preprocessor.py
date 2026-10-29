from app.models.job_description import ProcessedJobDescription
from app.utils.responses import AppError
from app.utils.text_cleaner import clean_resume_text


def preprocess_job_description(text: str) -> str:
    """Normalise job description text so it is ready for requirement extraction.

    This reuses the resume cleaning pipeline, which only changes formatting:
    line endings, Unicode form, invisible characters, runs of spaces and runs of
    blank lines. Bullets, punctuation and line breaks are kept, so lists such as
    "Requirements:" followed by "- React" stay readable.
    """
    cleaned = clean_resume_text(text)

    # Input made up only of invisible/control characters is empty once cleaned.
    if not cleaned:
        raise AppError(400, "EMPTY_JOB_DESCRIPTION_TEXT", "Job description text cannot be empty")
    return cleaned


def process_job_description(job_description_id: str, text: str) -> ProcessedJobDescription:
    return ProcessedJobDescription(
        jobDescriptionId=job_description_id,
        processedText=preprocess_job_description(text),
    )
