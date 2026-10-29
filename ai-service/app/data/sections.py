"""Controlled section-heading dictionary used for resume section extraction.

To recognise another heading for an existing section, add it to that section's
list in ``SECTION_ALIASES``. To add a new canonical section, add a new key here
and a matching field to ``ResumeSections`` in ``app/models/resume.py``.

Headings are compared after normalisation: case is ignored, "&" is treated as
"and", and surrounding punctuation such as a trailing ":" is dropped. Each
heading may belong to only one section; this is validated when the extractor
is loaded.
"""

# Canonical section key -> headings that introduce it. Section order here is
# the order sections are returned in.
SECTION_ALIASES: dict[str, list[str]] = {
    "personal_information": [
        "personal information",
        "personal info",
        "personal details",
        "personal data",
        "contact",
        "contact information",
        "contact info",
        "contact details",
    ],
    "summary": [
        "summary",
        "professional summary",
        "career summary",
        "executive summary",
        "summary of qualifications",
        "profile",
        "professional profile",
        "career profile",
        "personal profile",
        "profile summary",
        "about me",
        "objective",
        "career objective",
        "professional objective",
        "job objective",
    ],
    "experience": [
        "experience",
        "work experience",
        "professional experience",
        "relevant experience",
        "industry experience",
        "employment",
        "employment history",
        "work history",
        "career history",
        "professional background",
        "internships",
        "internship",
        "internship experience",
    ],
    "education": [
        "education",
        "academic background",
        "academic qualifications",
        "educational qualifications",
        "educational background",
        "education and training",
        "academics",
        "qualifications",
    ],
    "projects": [
        "projects",
        "personal projects",
        "academic projects",
        "key projects",
        "technical projects",
        "selected projects",
        "project experience",
        "side projects",
    ],
    "skills": [
        "skills",
        "technical skills",
        "core skills",
        "key skills",
        "core competencies",
        "competencies",
        "skills and abilities",
        "skill set",
        "skillset",
        "technical expertise",
        "areas of expertise",
        "tools and technologies",
    ],
    "certifications": [
        "certifications",
        "certification",
        "certificates",
        "certifications and courses",
        "licenses and certifications",
        "courses",
        "online courses",
        "professional development",
        "trainings",
    ],
    "achievements": [
        "achievements",
        "accomplishments",
        "key achievements",
        "awards",
        "honors",
        "honours",
        "awards and achievements",
        "achievements and awards",
        "honors and awards",
        "honours and awards",
        "awards and honors",
    ],
    "languages": [
        "languages",
        "language skills",
        "languages known",
        "spoken languages",
    ],
    "interests": [
        "interests",
        "hobbies",
        "hobbies and interests",
        "interests and hobbies",
        "personal interests",
    ],
    "references": [
        "references",
        "referees",
        "professional references",
    ],
}

# Single words that often appear as sub-labels inside another section
# ("Technologies:" under a project, "Training" under a job) are deliberately
# left out, because a match splits the surrounding section.

# Recognised headings that have no canonical section yet. Their content is
# returned under ``other_sections``, keyed by the heading as written.
OTHER_SECTION_HEADINGS: list[str] = [
    "publications",
    "research",
    "research experience",
    "patents",
    "volunteering",
    "volunteer experience",
    "volunteer work",
    "community service",
    "leadership",
    "leadership experience",
    "extracurricular activities",
    "extra curricular activities",
    "activities",
    "affiliations",
    "memberships",
    "professional memberships",
    "conferences",
    "presentations",
    "workshops",
    "portfolio",
    "declaration",
]
