"""Shared logic for slash-command tools (dice, wheel, search, image)."""

from __future__ import annotations

import random
import re
from typing import List, Tuple

import aiohttp

from api.db.database import Database
from api.models.models import BotConfig
from src.utils.duckduckgo import research

# Standard RPG polyhedral dice (plus percentile d100)
STANDARD_DICE_FACES: Tuple[int, ...] = (4, 6, 8, 10, 12, 20, 100)
STANDARD_DICE_SET = frozenset(STANDARD_DICE_FACES)

_RANDOM_RANGE_ABS_MAX = 10**12
_RANDOM_COUNT_MAX = 100
_DICE_COUNT_MAX = 50


def roll_standard_die(sides: int, count: int) -> List[int]:
    if sides not in STANDARD_DICE_SET:
        allowed = ", ".join(f"d{n}" for n in STANDARD_DICE_FACES)
        raise ValueError(f"Use a standard die: {allowed}.")
    if count < 1:
        count = 1
    if count > _DICE_COUNT_MAX:
        count = _DICE_COUNT_MAX
    return [random.randint(1, sides) for _ in range(count)]


def random_integers_inclusive(minimum: int, maximum: int, count: int) -> Tuple[int, int, List[int]]:
    """Returns (lo, hi, values) with lo <= hi after normalization; count clamped."""
    lo = int(minimum)
    hi = int(maximum)
    lo = max(-_RANDOM_RANGE_ABS_MAX, min(lo, _RANDOM_RANGE_ABS_MAX))
    hi = max(-_RANDOM_RANGE_ABS_MAX, min(hi, _RANDOM_RANGE_ABS_MAX))
    if lo > hi:
        lo, hi = hi, lo
    if count < 1:
        count = 1
    if count > _RANDOM_COUNT_MAX:
        count = _RANDOM_COUNT_MAX
    values = [random.randint(lo, hi) for _ in range(count)]
    return lo, hi, values


def spin_wheel(choices_text: str) -> tuple[List[str], str]:
    raw = [p.strip() for p in re.split(r"[,|]", choices_text) if p.strip()]
    if len(raw) < 2:
        raise ValueError("Enter at least two options separated by commas (e.g. A, B, C).")
    winner = random.choice(raw)
    return raw, winner


async def run_search(query: str, db: Database) -> str:
    text = await research(query.strip(), db)
    return (text or "").strip() or "(no results)"


async def generate_electronhub_image(prompt: str, token: str) -> str:
    url = "https://api.electronhub.ai/v1/images/generations"
    payload = {
        "model": "flux-dev",
        "prompt": prompt.strip(),
        "n": 1,
        "size": "1024x1024",
        "response_format": "url",
        "public": False,
    }
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }
    async with aiohttp.ClientSession() as session:
        async with session.post(url, json=payload, headers=headers) as resp:
            if resp.status != 200:
                t = await resp.text()
                raise RuntimeError(f"Image API ({resp.status}): {t[:500]}")
            data = await resp.json()
            return data["data"][0]["url"]


async def generate_image_from_config(prompt: str, db: Database) -> str:
    cfg = BotConfig(**db.list_configs())
    token = (cfg.ai_key or "").strip()
    if not token:
        raise RuntimeError("AI Config is missing an API key (needed for ElectronHub image generation).")
    return await generate_electronhub_image(prompt, token)
