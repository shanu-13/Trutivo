"""Deterministic extraction of contact details from a resume.

Values are only returned when a pattern clearly identifies them; otherwise the
field stays None. The resume header (the personal information section) is
searched first. Email, phone, LinkedIn and GitHub fall back to the rest of the
resume, which callers pass without the references section so a referee's
details are never mistaken for the candidate's.
"""

import re

from app.data.resume_entities import JOB_TITLE_KEYWORDS, ORGANIZATION_KEYWORDS
from app.data.sections import OTHER_SECTION_HEADINGS, SECTION_ALIASES
from app.models.resume import PersonalInformation
from app.utils.entry_parsing import collapse, contains_keyword, looks_like_location

# Bounded quantifiers keep matching linear on long unbroken input.
_EMAIL_RE = re.compile(
    r"(?<![\w.%+-])[A-Za-z0-9](?:[A-Za-z0-9._%+-]{0,62}[A-Za-z0-9])?@"
    r"(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.){1,5}[A-Za-z]{2,24}(?![\w-])"
)

# A run of digits with the usual phone punctuation; the digit count is checked separately.
_PHONE_RE = re.compile(r"(?<![\w+/.-])(\+?\(?\d[\d\s().-]{6,20}\d)(?![\w/-])")
_MIN_PHONE_DIGITS = 10
_MAX_PHONE_DIGITS = 15
_YEAR_GROUP_RE = re.compile(r"^(?:19|20)\d\d$")

_URL_TAIL = r"[A-Za-z0-9_%.~/?=&#+-]*"
_LINKEDIN_RE = re.compile(
    rf"(?:https?://)?(?:[a-z]{{2,3}}\.)?linkedin\.com/(?:in|pub)/[A-Za-z0-9_%-]{{2,100}}/?",
    re.IGNORECASE,
)
_GITHUB_RE = re.compile(
    r"(?:https?://)?(?:www\.)?github\.com/(?P<user>[A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))(?P<repo>/[\w.-]+)?/?",
    re.IGNORECASE,
)
# An explicit URL, or a bare lowercase domain with a common personal-site TLD ("janedoe.dev").
_PORTFOLIO_RE = re.compile(
    rf"https?://[A-Za-z0-9.-]{{1,253}}(?:/{_URL_TAIL})?"
    rf"|www\.[A-Za-z0-9.-]{{1,253}}(?:/{_URL_TAIL})?"
    rf"|(?<![\w@.-])[a-z0-9-]{{2,63}}(?:\.[a-z0-9-]{{1,63}}){{0,3}}\.(?:com|dev|io|me|net|org|in|co|app|tech|site|xyz|ai|page|design|online|portfolio)(?:/{_URL_TAIL})?(?![\w@])"
)
_NOT_PORTFOLIO_DOMAINS = ("linkedin.com", "github.com", "gmail.com", "outlook.com", "yahoo.com", "hotmail.com")

_LABEL_RE = re.compile(r"^\s*(?P<label>name|location|address|city)\s*[:\-–]\s*(?P<value>.+)$", re.IGNORECASE)
_NAME_WORD_RE = re.compile(r"^[A-Z][A-Za-z'’.-]*$|^[A-Z]\.$")
_NON_NAME_WORDS = {"resume", "curriculum", "vitae", "cv", "profile"}
_SEGMENT_SEPARATOR_RE = re.compile(r"\s*[|•·◦]\s*|\s{2,}|\s+[–—-]\s+")
_TRAILING_PUNCTUATION = ".,;:)]}>"

_KNOWN_HEADINGS = {h.casefold() for headings in SECTION_ALIASES.values() for h in headings} | {
    h.casefold() for h in OTHER_SECTION_HEADINGS
}


def _find_email(text: str) -> str | None:
    for match in _EMAIL_RE.finditer(text):
        email = match.group(0)
        local, domain = email.split("@", 1)
        if ".." not in email and not local.endswith(".") and not domain.startswith("-"):
            return email
    return None


def _find_phone(text: str) -> str | None:
    for match in _PHONE_RE.finditer(text):
        candidate = collapse(match.group(1))
        digits = re.sub(r"\D", "", candidate)
        if not _MIN_PHONE_DIGITS <= len(digits) <= _MAX_PHONE_DIGITS:
            continue
        # "2016 - 2020" or "2020 2021 2022" are years, not a phone number.
        if all(_YEAR_GROUP_RE.match(group) for group in re.findall(r"\d+", candidate)):
            continue
        # Unbalanced parentheses mean the match cut through surrounding text.
        if candidate.count("(") != candidate.count(")"):
            candidate = candidate.lstrip("(").rstrip(")")
            if candidate.count("(") != candidate.count(")"):
                continue
        return candidate
    return None


def _find_linkedin(text: str) -> str | None:
    match = _LINKEDIN_RE.search(text)
    return match.group(0).rstrip("/") if match else None


def _find_github(text: str, allow_repository: bool) -> str | None:
    for match in _GITHUB_RE.finditer(text):
        # Outside the header, only a profile link identifies the candidate; a
        # repository link may belong to a project or someone else.
        if match.group("repo") and not allow_repository:
            continue
        return match.group(0).rstrip("/")
    return None


def _find_portfolio(header: str) -> str | None:
    # Emails contain domains; remove them so "jane@janedoe.dev" is not a portfolio.
    text = _EMAIL_RE.sub(" ", header)
    for match in _PORTFOLIO_RE.finditer(text):
        url = match.group(0).rstrip(_TRAILING_PUNCTUATION)
        if any(domain in url.lower() for domain in _NOT_PORTFOLIO_DOMAINS):
            continue
        return url
    return None


def _labelled(header: str, labels: set[str]) -> str | None:
    for line in header.splitlines():
        match = _LABEL_RE.match(line)
        if match and match.group("label").lower() in labels:
            return collapse(match.group("value"))
    return None


def _looks_like_name(line: str) -> bool:
    if any(ch.isdigit() for ch in line) or "@" in line or "/" in line or "," in line:
        return False
    words = line.split()
    if not 2 <= len(words) <= 4 or len(line) > 50:
        return False
    if line.casefold() in _KNOWN_HEADINGS or any(w.casefold() in _NON_NAME_WORDS for w in words):
        return False
    if contains_keyword(line, JOB_TITLE_KEYWORDS) or contains_keyword(line, ORGANIZATION_KEYWORDS):
        return False
    return all(_NAME_WORD_RE.match(w) for w in words)


def _find_name(header: str) -> str | None:
    labelled = _labelled(header, {"name"})
    if labelled and _looks_like_name(labelled):
        return labelled

    lines = [line.strip().strip("#*").strip() for line in header.splitlines() if line.strip()]
    for line in lines[:3]:
        if _looks_like_name(line):
            # "JOHN DOE" -> "John Doe"; mixed-case names are kept exactly as written.
            return line.title() if line.isupper() else line
    return None


def _find_location(header: str) -> str | None:
    labelled = _labelled(header, {"location", "address", "city"})
    if labelled:
        return labelled
    for line in header.splitlines():
        for segment in _SEGMENT_SEPARATOR_RE.split(line):
            segment = segment.strip()
            if (
                looks_like_location(segment)
                and not contains_keyword(segment, JOB_TITLE_KEYWORDS)
                and not contains_keyword(segment, ORGANIZATION_KEYWORDS)
            ):
                return segment
    return None


def extract_personal_info(header: str, rest: str = "") -> PersonalInformation:
    """Extract contact details from the resume header, falling back to ``rest``."""
    return PersonalInformation(
        name=_find_name(header),
        email=_find_email(header) or _find_email(rest),
        phone=_find_phone(header) or _find_phone(rest),
        location=_find_location(header),
        linkedin=_find_linkedin(header) or _find_linkedin(rest),
        github=_find_github(header, allow_repository=True) or _find_github(rest, allow_repository=False),
        portfolio=_find_portfolio(header),
    )
