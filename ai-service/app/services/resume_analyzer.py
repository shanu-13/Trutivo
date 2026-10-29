"""Combine preprocessing, section and skill extraction, and per-section analysis
into one structured resume.

Each step lives in its own service; this module only wires them together.
"""

from app.models.resume import ResumeAnalysis, ResumeMetadata, ResumeSections, StructuredResume
from app.services.certification_analyzer import analyze_certifications
from app.services.education_analyzer import analyze_education
from app.services.experience_analyzer import analyze_experience
from app.services.personal_info_extractor import extract_personal_info
from app.services.project_analyzer import analyze_projects
from app.services.resume_preprocessor import preprocess_resume
from app.services.section_extractor import extract_sections
from app.services.skill_extractor import extract_skills
from app.utils.entry_parsing import split_lines, split_list

# Without any section headings, the resume header is taken to be its first few lines.
_HEADER_LINES_WITHOUT_SECTIONS = 5


def _contact_sources(text: str, sections: ResumeSections) -> tuple[str, str]:
    """Return (header, rest) for contact detection, never including references."""
    found = sections.model_dump(exclude={"personal_information", "references", "other_sections"}, exclude_none=True)
    if not found and not sections.other_sections:
        lines = [line for line in text.splitlines() if line.strip()]
        return "\n".join(lines[:_HEADER_LINES_WITHOUT_SECTIONS]), text
    rest = "\n\n".join([*found.values(), *sections.other_sections.values()])
    return sections.personal_information or "", rest


def analyze_resume(text: str) -> tuple[StructuredResume, ResumeMetadata]:
    """Build a structured resume from cleaned resume text."""
    sections = extract_sections(text)
    skills = extract_skills(text)
    header, rest = _contact_sources(text, sections)

    resume = StructuredResume(
        personalInformation=extract_personal_info(header, rest),
        summary=sections.summary,
        experience=analyze_experience(sections.experience),
        education=analyze_education(sections.education),
        projects=analyze_projects(sections.projects),
        skills=skills,
        certifications=analyze_certifications(sections.certifications),
        achievements=split_lines(sections.achievements or ""),
        languages=split_list(sections.languages or ""),
        interests=split_list(sections.interests or ""),
        otherSections=sections.other_sections,
    )
    metadata = ResumeMetadata(
        totalSkills=sum(len(names) for names in skills.values()),
        totalExperienceEntries=len(resume.experience),
        totalEducationEntries=len(resume.education),
        totalProjects=len(resume.projects),
        totalCertifications=len(resume.certifications),
    )
    return resume, metadata


def analyze_resume_text(resume_id: str, text: str) -> ResumeAnalysis:
    """Preprocess raw resume text, then analyze it."""
    cleaned = preprocess_resume(resume_id, text)
    resume, metadata = analyze_resume(cleaned.text)
    return ResumeAnalysis(resumeId=resume_id, resume=resume, metadata=metadata)
