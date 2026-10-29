"""Fixed wording for rule-based cover letters (Step 12).

Every sentence here is a frame: the facts placed into it come only from the
candidate's resume analysis and the job's title, company and requirements.
No frame asserts experience, years, numbers or achievements by itself.
"""

from typing import Final

GREETING: Final = "Dear Hiring Manager,"

# {role} is the job title; {at} is " at <company>" or "".
OPENING: Final = {
    "professional": "I am writing to apply for the {role} position{at}.",
    "confident": "I am excited to apply for the {role} position{at}.",
    "conversational": "I was glad to come across the {role} opening{at}, and I would like to be considered for it.",
    "concise": "Please consider my application for the {role} position{at}.",
}

# Background sentences, chosen from what the resume shows.
CURRENT_ROLE: Final = "My current role is {title}{at}."
RECENT_ROLE: Final = "My most recent role was {title}{at}."
EDUCATION_BACKGROUND: Final = "My education includes {education}."

# {skills} is a list of job skills that also appear in the resume.
SKILLS_MATCH: Final = {
    "professional": "The position calls for {skills}, {which} part of my skill set.",
    "confident": "My skills in {skills} line up directly with what this role asks for.",
    "conversational": "I noticed the role asks for {skills}, and {these} skills I have.",
    "concise": "My skills include {skills}, as the role requires.",
}
SKILLS_PREFERRED: Final = "I also bring {skills}, which the posting lists as a plus."
SKILLS_GENERAL: Final = "My skills include {skills}."

# Evidence from a role: {clause} is one of the candidate's own description lines, in first person.
ROLE_EVIDENCE: Final = {
    "professional": "As {title}{at}, I {clause}.",
    "confident": "In my role as {title}{at}, I {clause}.",
    "conversational": "{At_cap}, I {clause}.",
    "concise": "As {title}{at}, I {clause}.",
}
# When no description line can be phrased safely: only skills named in that role's own text.
ROLE_SKILLS: Final = "As {title}{at}, my work involved {skills}."
PROJECT_EVIDENCE: Final = "In my {name} project, I {clause}."
PROJECT_TECHNOLOGIES: Final = "My {name} project used {skills}."
CERTIFICATIONS: Final = "I also hold the following certification{s}: {names}."

MOTIVATION_PLACEHOLDER: Final = (
    "[Add a sentence about why you want to join {company}, for example something specific about its work or the team.]"
)

CLOSING: Final = {
    "professional": "Thank you for considering my application. I would welcome the opportunity to discuss how I could contribute to {company}.",
    "confident": "I would be glad to discuss how I can contribute to {company}, and I look forward to hearing from you.",
    "conversational": "Thank you for taking the time to read my application. I would be happy to talk more about the role whenever it suits you.",
    "concise": "Thank you for your time. I look forward to hearing from you.",
}
SIGN_OFF: Final = {
    "professional": "Sincerely,",
    "confident": "Sincerely,",
    "conversational": "Best regards,",
    "concise": "Regards,",
}
NAME_PLACEHOLDER: Final = "[Your Name]"

# How much evidence each length includes.
LENGTH_PLAN: Final = {
    "short": {"roles": 1, "lines_per_role": 1, "projects": 0, "education": False, "certifications": False, "motivation": False},
    "standard": {"roles": 2, "lines_per_role": 1, "projects": 1, "education": False, "certifications": False, "motivation": True},
    "detailed": {"roles": 2, "lines_per_role": 2, "projects": 2, "education": True, "certifications": True, "motivation": True},
}

# A description line can become "I <line>" only when it starts with a past-tense action verb.
IRREGULAR_PAST: Final = frozenset(
    "built led wrote ran made drove grew won taught set cut began oversaw spoke held brought found got gave kept "
    "sold sent spent took understood upheld rebuilt rewrote overhauled".split()
)

MAX_LETTER_CHARS: Final = 6000
