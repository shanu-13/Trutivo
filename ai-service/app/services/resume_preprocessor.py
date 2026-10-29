from app.models.resume import PreprocessedResume
from app.utils.responses import AppError
from app.utils.text_cleaner import clean_resume_text


def preprocess_resume(resume_id: str, text: str) -> PreprocessedResume:
    """Clean raw extracted resume text so it is ready for later NLP stages."""
    cleaned = clean_resume_text(text)

    # Input made up only of invisible/control characters is empty once cleaned.
    if not cleaned:
        raise AppError(400, "EMPTY_RESUME_TEXT", "Resume text cannot be empty")

    return PreprocessedResume(resumeId=resume_id, text=cleaned)
