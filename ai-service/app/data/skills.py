"""Controlled skill dictionary used for resume skill extraction.

To add a skill, append its canonical name to the right category in ``SKILLS``.
To recognise another spelling of an existing skill, add it to ``SKILL_ALIASES``.
Matching is case-insensitive unless the term is listed in ``CASE_SENSITIVE_TERMS``.

Each canonical name must appear in exactly one category, and every alias must
point at a canonical name; this is validated when the extractor is loaded.
"""

# Category key -> canonical skill names. Category and skill order here is the
# order results are returned in.
SKILLS: dict[str, list[str]] = {
    "programming_languages": [
        "Python",
        "JavaScript",
        "TypeScript",
        "Java",
        "C",
        "C++",
        "C#",
        "Go",
        "Rust",
        "PHP",
        "Ruby",
    ],
    "frontend": [
        "React",
        "Next.js",
        "Angular",
        "Vue.js",
        "HTML",
        "CSS",
        "Tailwind CSS",
        "Bootstrap",
    ],
    "backend": [
        "Node.js",
        "Express.js",
        "Django",
        "Flask",
        "FastAPI",
        "Spring Boot",
        ".NET",
    ],
    "databases": [
        "MySQL",
        "PostgreSQL",
        "MongoDB",
        "Redis",
        "SQLite",
        "Oracle",
    ],
    "cloud": [
        "AWS",
        "Azure",
        "Google Cloud",
        "Docker",
        "Kubernetes",
    ],
    "tools": [
        "Git",
        "GitHub",
        "GitLab",
        "Jira",
        "Postman",
    ],
    "ai_ml": [
        "Machine Learning",
        "Deep Learning",
        "NLP",
        "TensorFlow",
        "PyTorch",
        "Scikit-learn",
        "Pandas",
        "NumPy",
    ],
    "other": [
        "REST API",
        "GraphQL",
        "Microservices",
        "Linux",
        "CI/CD",
    ],
}

# Alternative spelling -> canonical skill name. Spaces in an alias also match
# line breaks or repeated spaces in the resume text.
SKILL_ALIASES: dict[str, str] = {
    # Programming languages
    "JS": "JavaScript",
    "ES6": "JavaScript",
    "ECMAScript": "JavaScript",
    "Java Script": "JavaScript",
    "TS": "TypeScript",
    "Python3": "Python",
    "Python 3": "Python",
    "Golang": "Go",
    "CPP": "C++",
    "C Sharp": "C#",
    # Frontend
    "ReactJS": "React",
    "React.js": "React",
    "React JS": "React",
    "NextJS": "Next.js",
    "Next JS": "Next.js",
    "AngularJS": "Angular",
    "Vue": "Vue.js",
    "VueJS": "Vue.js",
    "HTML5": "HTML",
    "CSS3": "CSS",
    "TailwindCSS": "Tailwind CSS",
    "Tailwind": "Tailwind CSS",
    # Backend
    "Node": "Node.js",
    "NodeJS": "Node.js",
    "Node JS": "Node.js",
    "Express": "Express.js",
    "ExpressJS": "Express.js",
    "SpringBoot": "Spring Boot",
    "ASP.NET": ".NET",
    "ASP.NET Core": ".NET",
    ".NET Core": ".NET",
    "dotnet": ".NET",
    # Databases
    "Postgres": "PostgreSQL",
    "Postgre SQL": "PostgreSQL",
    "Mongo": "MongoDB",
    "Oracle DB": "Oracle",
    # Cloud
    "Amazon Web Services": "AWS",
    "Microsoft Azure": "Azure",
    "GCP": "Google Cloud",
    "Google Cloud Platform": "Google Cloud",
    "K8s": "Kubernetes",
    # AI / ML
    "ML": "Machine Learning",
    "DL": "Deep Learning",
    "Natural Language Processing": "NLP",
    "Sklearn": "Scikit-learn",
    "Scikit learn": "Scikit-learn",
    # Other
    "RESTful API": "REST API",
    "RESTful APIs": "REST API",
    "REST APIs": "REST API",
    "RESTful": "REST API",
    "Microservice": "Microservices",
    "Microservices Architecture": "Microservices",
    "CI-CD": "CI/CD",
    "CI / CD": "CI/CD",
    "CICD": "CI/CD",
}

# Terms that are also ordinary words or letters ("go ahead", "grade c", "ts" as
# an abbreviation). They only match when written with exactly this casing.
CASE_SENSITIVE_TERMS: set[str] = {
    "C",
    "Go",
    "Express",
    "Node",
    "Oracle",
    "ML",
    "DL",
    "JS",
    "TS",
}
