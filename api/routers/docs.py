"""
Serves the Markdown guides in docs/ to the panel's /docs reader.

Only files directly inside docs/ are exposed — subdirectories (docs/moje) and
non-Markdown files stay private. Slugs are validated against the listing rather
than being joined onto a path, so a crafted slug cannot escape the folder.
"""
import os
import re
from fastapi import APIRouter, Depends, HTTPException

from api.auth import require_role

router = APIRouter(prefix="/api/docs", tags=["Documentation"])

DOCS_DIR = "/app/docs" if os.path.isdir("/app/docs") else "docs"

# Per-document icon. Anything not listed still shows up with the fallback icon,
# so adding a guide needs no code change. Colour is uniform, set in CSS.
DOC_ICON = {
    "01-getting-started": "rocket",
    "02-ai-config": "brain",
    "03-characters": "robot",
    "04-servers": "server",
    "05-scheduler": "clock",
    "06-slash-commands": "terminal",
    "07-panel-security": "shield-halved",
    "08-discord-oauth": "right-to-bracket",
    "09-users": "users",
    "10-panel-tools": "screwdriver-wrench",
    "11-multi-model": "layer-group",
    "12-system-addon": "puzzle-piece",
    "13-theme": "palette",
    "14-account": "user-gear",
}
FALLBACK_ICON = "book"

# The reader itself is the index, so the index file is not shown as a card.
HIDDEN_SLUGS = {"00-guide"}

_WORDS_PER_MINUTE = 200


def _slug_of(filename: str) -> str:
    return filename[:-3]


def _title_of(text: str, slug: str) -> str:
    for line in text.splitlines():
        if line.startswith("# "):
            return line[2:].strip()
    return slug.replace("-", " ").title()


def _summary_of(text: str) -> str:
    """First real paragraph after the H1 — skips tables, lists and headings."""
    body = []
    seen_h1 = False
    for raw in text.splitlines():
        line = raw.strip()
        if line.startswith("# "):
            seen_h1 = True
            continue
        if not seen_h1 or not line:
            continue
        if line.startswith(("|", ">", "-", "*", "#", "```", "1.")):
            if body:
                break
            continue
        body.append(line)
        if len(" ".join(body)) > 160:
            break
    summary = re.sub(r"[*`_]", "", " ".join(body)).strip()
    summary = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", summary)
    if len(summary) > 180:
        summary = summary[:177].rsplit(" ", 1)[0] + "…"
    return summary


def _read_minutes(text: str) -> int:
    return max(1, round(len(text.split()) / _WORDS_PER_MINUTE))


def _list_files() -> list[str]:
    if not os.path.isdir(DOCS_DIR):
        return []
    names = [
        n for n in os.listdir(DOCS_DIR)
        if n.endswith(".md") and os.path.isfile(os.path.join(DOCS_DIR, n))
    ]
    return sorted(names)


def _load(name: str) -> str:
    with open(os.path.join(DOCS_DIR, name), encoding="utf-8") as fh:
        return fh.read()


@router.get("/")
async def list_docs(_: dict = Depends(require_role("guest"))):
    """Metadata for every guide. Readable by any signed-in role."""
    result = []
    for name in _list_files():
        slug = _slug_of(name)
        if slug in HIDDEN_SLUGS:
            continue
        try:
            text = _load(name)
        except OSError:
            continue
        result.append({
            "slug": slug,
            "title": _title_of(text, slug),
            "summary": _summary_of(text),
            "icon": DOC_ICON.get(slug, FALLBACK_ICON),
            "read_minutes": _read_minutes(text),
        })
    return result


@router.get("/{slug}")
async def get_doc(slug: str, _: dict = Depends(require_role("guest"))):
    """Raw Markdown for one guide. The slug must match a real file in docs/."""
    known = {_slug_of(n): n for n in _list_files()}
    name = known.get(slug)
    if not name:
        raise HTTPException(status_code=404, detail="Guide not found.")
    try:
        text = _load(name)
    except OSError:
        raise HTTPException(status_code=404, detail="Guide not found.")
    return {
        "slug": slug,
        "title": _title_of(text, slug),
        "markdown": text,
        "read_minutes": _read_minutes(text),
    }
