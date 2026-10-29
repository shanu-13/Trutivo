"""Controlled mapping from degree names to comparable education levels.

Only degrees whose level is unambiguous are listed. A degree not listed here
(for example "Postgraduate Diploma" or "PGDM", whose standing varies) has no
level, and any comparison involving it is reported as unknown rather than
guessed.

Keys are compared after lower-casing and removing dots, spaces and
apostrophes, so "B.Tech", "BTech" and "B. Tech" are the same key.
"""

# Level -> rank. A candidate meets a degree requirement when their highest
# rank is at least the required rank.
LEVEL_RANKS: dict[str, int] = {
    "secondary": 1,
    "diploma": 2,
    "associate": 3,
    "bachelor": 4,
    "master": 5,
    "doctorate": 6,
}

DEGREE_LEVELS: dict[str, list[str]] = {
    "secondary": [
        "High School",
        "High School Diploma",
        "Higher Secondary",
        "Senior Secondary",
        "Secondary School Certificate",
        "HSC",
        "SSC",
        "Intermediate",
        "Class XII",
        "Class X",
        "12th",
        "10th",
        "GED",
    ],
    "diploma": ["Diploma"],
    "associate": ["Associate Degree", "A.S.", "AS"],
    "bachelor": [
        "B.Tech",
        "B.E.",
        "B.Sc",
        "B.S.",
        "B.A.",
        "B.Com",
        "B.Arch",
        "B.Des",
        "B.Pharm",
        "B.Ed",
        "BCA",
        "BBA",
        "BBM",
        "BFA",
        "LLB",
        "MBBS",
        "BS",
        "BA",
        "BE",
        "Bachelor's",
        "Bachelors",
        "Bachelor's Degree",
        "Bachelor",
    ],
    "master": [
        "M.Tech",
        "M.E.",
        "M.Sc",
        "M.S.",
        "M.A.",
        "M.Com",
        "M.Des",
        "M.Phil",
        "M.Ed",
        "MCA",
        "MBA",
        "MFA",
        "LLM",
        "MS",
        "Master's",
        "Masters",
        "Master's Degree",
        "Master",
    ],
    "doctorate": ["Ph.D", "PhD", "Doctorate", "Doctor of Philosophy", "Doctoral Degree"],
}

# Prefixes of written-out degree names: "Bachelor of Science" -> bachelor.
LEVEL_PREFIXES: dict[str, str] = {
    "bachelor": "bachelor",
    "master": "master",
    "doctor of": "doctorate",
    "doctorate": "doctorate",
}

# Field-of-study spellings that name the same field. Matching is otherwise by
# exact (case-insensitive) name, or one name containing the other as whole words.
FIELD_ALIASES: dict[str, list[str]] = {
    "Computer Science": [
        "CS",
        "CSE",
        "Computer Science and Engineering",
        "Computer Science & Engineering",
        "Computer Sci",
        "Computing",
    ],
    "Information Technology": ["IT", "Info Tech"],
    "Electronics and Communication Engineering": ["ECE", "Electronics and Communication", "Electronics & Communication"],
    "Electrical and Electronics Engineering": ["EEE", "Electrical and Electronics", "Electrical & Electronics"],
    "Electrical Engineering": ["EE"],
    "Mechanical Engineering": ["ME", "Mech"],
    "Computer Applications": ["CA"],
    "Artificial Intelligence": ["AI"],
    "Data Science": ["DS"],
}
