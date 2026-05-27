import os
import base64
import hashlib
import logging
from cryptography.fernet import Fernet, InvalidToken

_MARKER = "enc:"
_fernet: Fernet | None = None
_warned_no_key = False

SENSITIVE_KEYS = {
    "discord_key",
    "ai_key",
    "discord_oauth_client_secret",
    "fallback_ai_key",
    "multimodal_ai_api",
}


def _get_fernet() -> Fernet | None:
    global _fernet, _warned_no_key
    if _fernet is None:
        raw = os.getenv("TOKEN_KEY", "")
        if not raw:
            if not _warned_no_key:
                logging.warning("TOKEN_KEY is not set — sensitive config values will not be encrypted.")
                _warned_no_key = True
            return None
        key = base64.urlsafe_b64encode(hashlib.sha256(raw.encode()).digest())
        _fernet = Fernet(key)
    return _fernet


def is_encrypted(value: str) -> bool:
    return isinstance(value, str) and value.startswith(_MARKER)


def encrypt(value: str) -> str:
    if not value:
        return value
    if is_encrypted(value):
        return value
    f = _get_fernet()
    if f is None:
        return value
    return _MARKER + f.encrypt(value.encode()).decode()


def decrypt(value: str) -> str:
    if not value or not is_encrypted(value):
        return value
    f = _get_fernet()
    if f is None:
        return value
    try:
        return f.decrypt(value[len(_MARKER):].encode()).decode()
    except InvalidToken:
        logging.warning("Failed to decrypt config value — wrong key or corrupted data.")
        return value


def encrypt_providers(providers: list) -> list:
    """Encrypt api_key in each multimodal provider."""
    result = []
    for p in providers:
        p = dict(p)
        if p.get("api_key"):
            p["api_key"] = encrypt(p["api_key"])
        result.append(p)
    return result


def decrypt_providers(providers: list) -> list:
    """Decrypt api_key in each multimodal provider."""
    result = []
    for p in providers:
        p = dict(p)
        if p.get("api_key"):
            p["api_key"] = decrypt(p["api_key"])
        result.append(p)
    return result
