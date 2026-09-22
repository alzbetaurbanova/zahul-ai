"""
Config encryption. This is the one place where a bug corrupts stored data
instead of showing an error - a value that cannot be decrypted is a Discord
token or an API key the operator has to find again by hand. The rules pinned
here are the ones the callers rely on: round-trip fidelity, idempotence, and
never destroying the input when the key is missing or wrong.
"""
import importlib

import pytest

import api.utils.crypto as crypto


@pytest.fixture(autouse=True)
def fresh_crypto(monkeypatch):
    """Each test gets the module with its cached Fernet cleared."""
    monkeypatch.setenv("TOKEN_KEY", "the-test-key")
    importlib.reload(crypto)
    yield crypto


def test_round_trip_returns_the_original_value(fresh_crypto):
    secret = "discord-token-12345"
    encrypted = fresh_crypto.encrypt(secret)

    assert encrypted != secret
    assert fresh_crypto.is_encrypted(encrypted)
    assert fresh_crypto.decrypt(encrypted) == secret


def test_round_trip_survives_unicode_and_newlines(fresh_crypto):
    secret = "hešlo\nsľubné 🙂\ttab"
    assert fresh_crypto.decrypt(fresh_crypto.encrypt(secret)) == secret


def test_encrypting_twice_does_not_double_encrypt(fresh_crypto):
    once = fresh_crypto.encrypt("api-key")
    twice = fresh_crypto.encrypt(once)

    assert twice == once
    assert fresh_crypto.decrypt(twice) == "api-key"


def test_decrypting_a_plain_value_leaves_it_alone(fresh_crypto):
    # Config written before encryption existed is still plain text.
    assert fresh_crypto.decrypt("plain-api-key") == "plain-api-key"


def test_empty_values_pass_through_untouched(fresh_crypto):
    assert fresh_crypto.encrypt("") == ""
    assert fresh_crypto.decrypt("") == ""


def test_without_a_key_values_stay_readable_instead_of_being_lost(monkeypatch):
    monkeypatch.delenv("TOKEN_KEY", raising=False)
    no_key = importlib.reload(crypto)

    assert no_key.encrypt("api-key") == "api-key"
    assert no_key.decrypt("api-key") == "api-key"


def test_a_wrong_key_returns_the_stored_value_rather_than_crashing(monkeypatch):
    monkeypatch.setenv("TOKEN_KEY", "first-key")
    first = importlib.reload(crypto)
    encrypted = first.encrypt("api-key")

    monkeypatch.setenv("TOKEN_KEY", "different-key")
    second = importlib.reload(crypto)

    # The value is unreadable, but the caller gets the stored ciphertext back
    # instead of an exception that would take the whole config load down.
    result = second.decrypt(encrypted)
    assert result == encrypted
    assert result != "api-key"


def test_provider_keys_round_trip_without_touching_other_fields(fresh_crypto):
    providers = [
        {"name": "groq", "endpoint": "https://api.groq.com", "api_key": "secret-1"},
        {"name": "local", "endpoint": "http://localhost:1234", "api_key": ""},
    ]

    encrypted = fresh_crypto.encrypt_providers(providers)
    assert fresh_crypto.is_encrypted(encrypted[0]["api_key"])
    assert encrypted[1]["api_key"] == ""  # nothing to encrypt
    assert encrypted[0]["endpoint"] == "https://api.groq.com"

    # The input list is not mutated - callers keep using their own copy.
    assert providers[0]["api_key"] == "secret-1"

    decrypted = fresh_crypto.decrypt_providers(encrypted)
    assert decrypted == providers


def test_every_sensitive_key_is_a_known_config_field(fresh_crypto):
    from api.models.models import BotConfig

    for key in fresh_crypto.SENSITIVE_KEYS:
        assert key in BotConfig.model_fields, f"{key} is encrypted but no longer exists in BotConfig"
