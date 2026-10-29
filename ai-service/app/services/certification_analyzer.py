"""Split a certifications section into individual certificates.

Each line (or bullet) is one certificate; "Issued by ..." or "Credential ID ..."
lines belong to the certificate above them. The issuer is only taken from the
text when it is stated explicitly ("by Coursera", "Issuer: Google") or written
as its own part next to the name ("... | Amazon Web Services"). It is never
inferred from the certificate's name, so "AWS Certified Cloud Practitioner"
alone has no issuer.
"""

import re
from functools import lru_cache

from app.data.resume_entities import CERTIFICATION_ISSUERS
from app.models.resume import CertificationEntry
from app.utils.dates import find_date_range, remove_span
from app.utils.entry_parsing import collapse, is_bullet, strip_bullet

_DETAIL_LINE_RE = re.compile(r"^(?:issued|issuer|issuing|credential|certificate\s+(?:id|no)|license|verify|id\s*:)", re.IGNORECASE)
_EXPLICIT_ISSUER_RE = re.compile(
    r"(?:\b(?:issued|offered|provided|awarded|conducted)\s+by|\bissuer\s*:|\bissuing\s+organi[sz]ation\s*:|\bby|\bfrom|\bvia|\bthrough)"
    r"\s+(?:the\s+)?(?P<issuer>(?-i:[A-Z])[^|,;()\n]{0,60}?)\s*(?=$|[|,;()\n]|\s[–—-]\s|\s+credential\b)",
    re.IGNORECASE,
)
# Separators between a certificate's name and its other parts.
_PART_RE = re.compile(r"\s+[|–—-]\s+|\s*\|\s*|\s*,\s*|\s*\(\s*|\s*\)\s*")
_CREDENTIAL_RE = re.compile(r"\s*[|,(]?\s*credential\s*(?:id|url)?\s*[:#]?\s*\S+\)?", re.IGNORECASE)


@lru_cache(maxsize=1)
def _issuers() -> dict[str, str]:
    return {issuer.casefold(): issuer for issuer in CERTIFICATION_ISSUERS}


def _split_certificates(section: str) -> list[str]:
    items: list[str] = []
    for raw in section.splitlines():
        line = raw.strip()
        if not line:
            continue
        text = strip_bullet(line) if is_bullet(line) else line
        if not text:
            continue
        continues_previous = not is_bullet(line) and (
            _DETAIL_LINE_RE.match(text) or text[0].islower() or text[0] in "(&"
        )
        if items and continues_previous:
            items[-1] = f"{items[-1]} | {text}"
        else:
            items.append(text)
    return items


def _tidy_name(text: str) -> str:
    text = re.sub(r"\(\s*\)", "", text)
    return collapse(text).strip(" |,;:-–—")


def _parse_certificate(item: str) -> CertificationEntry | None:
    text = item
    dates = find_date_range(text)
    if dates is not None:
        text = remove_span(text, dates.span)
    text = _CREDENTIAL_RE.sub("", text)

    issuer = None
    explicit = _EXPLICIT_ISSUER_RE.search(text)
    if explicit and explicit.start() > 0:
        issuer = collapse(explicit.group("issuer")).strip(" .")
        text = text[: explicit.start()] + text[explicit.end() :]
    else:
        # A separate part that is a known issuer: "Deep Learning Specialization | Coursera".
        parts = [p for p in _PART_RE.split(text) if p.strip()]
        known = _issuers()
        for index, part in enumerate(parts):
            if index == 0 and len(parts) == 1:
                break
            if part.strip().casefold() in known:
                issuer = part.strip()
                # Remove that part only, keeping the rest of the name as written.
                position = text.rfind(part) if index > 0 else text.find(part)
                text = text[:position] + text[position + len(part) :]
                break

    name = _tidy_name(text)
    if not name:
        return None
    return CertificationEntry(name=name, issuer=issuer or None, date=dates.start if dates else None)


def analyze_certifications(section: str | None) -> list[CertificationEntry]:
    if not section:
        return []
    entries = (_parse_certificate(item) for item in _split_certificates(section))
    return [entry for entry in entries if entry is not None]
