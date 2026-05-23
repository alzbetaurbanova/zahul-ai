"""Application version metadata for the admin panel footer."""

from __future__ import annotations

import os
import subprocess
import tomllib
from pathlib import Path

_ROOT = Path(__file__).resolve().parent.parent
_PYPROJECT = _ROOT / "pyproject.toml"


def get_version_info() -> dict[str, str | None]:
    version = os.environ.get("ZAHUL_VERSION", "").strip() or _read_pyproject_version()
    commit = os.environ.get("ZAHUL_GIT_COMMIT", "").strip() or _read_git_commit()
    return {"version": version, "commit": commit or None}


def get_app_version() -> str:
    """Single version string (pyproject / ZAHUL_VERSION)."""
    return get_version_info()["version"]


def _read_pyproject_version() -> str:
    try:
        with _PYPROJECT.open("rb") as f:
            data = tomllib.load(f)
        return str(data.get("project", {}).get("version", "unknown"))
    except OSError:
        return "unknown"


def _read_git_commit() -> str:
    if not (_ROOT / ".git").is_dir():
        return ""
    try:
        out = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=_ROOT,
            capture_output=True,
            text=True,
            timeout=2,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        return ""
    if out.returncode != 0:
        return ""
    return (out.stdout or "").strip()
