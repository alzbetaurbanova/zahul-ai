"""
Which endpoint a completion is sent to.

_resolve_fallback_client decides between the primary endpoint, a dedicated
fallback endpoint and a named provider. Getting it wrong is invisible - the bot
keeps answering, just through the wrong account, with the wrong key, or against
an endpoint that is rate-limited - so every branch is pinned down here.

resolve_system_addon is the other silent one: a per-model rule that stops
winning means the wrong prompt is prepended to every message.
"""
from unittest.mock import Mock

import pytest

from api.models.models import BotConfig, MultiModelProvider
from src.utils.llm_new import _resolve_fallback_client, resolve_system_addon

PRIMARY_ENDPOINT = "https://primary.example/v1"
FALLBACK_ENDPOINT = "https://fallback.example/v1"


def config(**overrides) -> BotConfig:
    base = {
        "default_character": "zahul",
        "ai_endpoint": PRIMARY_ENDPOINT,
        "base_llm": "gpt-4o-mini",
        "ai_key": "primary-key",
    }
    base.update(overrides)
    return BotConfig(**base)


@pytest.fixture
def primary_client():
    return Mock(name="primary-client")


def test_unset_source_stays_on_the_primary_client(primary_client):
    client, endpoint = _resolve_fallback_client(config(fallback_llm_source=""), primary_client)

    assert client is primary_client
    assert endpoint == PRIMARY_ENDPOINT


def test_explicit_primary_stays_on_the_primary_client(primary_client):
    client, endpoint = _resolve_fallback_client(config(fallback_llm_source="primary"), primary_client)

    assert client is primary_client
    assert endpoint == PRIMARY_ENDPOINT


def test_dedicated_fallback_endpoint_is_used_when_enabled(primary_client):
    client, endpoint = _resolve_fallback_client(
        config(
            fallback_llm_source="fallback",
            fallback_use_different_endpoint=True,
            fallback_ai_endpoint=FALLBACK_ENDPOINT,
            fallback_ai_key="fallback-key",
        ),
        primary_client,
    )

    assert client is not primary_client
    assert endpoint == FALLBACK_ENDPOINT
    assert str(client.base_url).startswith(FALLBACK_ENDPOINT)
    assert client.api_key == "fallback-key"


def test_fallback_without_its_own_key_borrows_the_primary_key(primary_client):
    client, _ = _resolve_fallback_client(
        config(
            fallback_llm_source="fallback",
            fallback_use_different_endpoint=True,
            fallback_ai_endpoint=FALLBACK_ENDPOINT,
            fallback_ai_key="",
        ),
        primary_client,
    )

    assert client.api_key == "primary-key"


def test_fallback_falls_back_to_primary_when_the_toggle_is_off(primary_client):
    client, endpoint = _resolve_fallback_client(
        config(
            fallback_llm_source="fallback",
            fallback_use_different_endpoint=False,
            fallback_ai_endpoint=FALLBACK_ENDPOINT,
        ),
        primary_client,
    )

    assert client is primary_client
    assert endpoint == PRIMARY_ENDPOINT


def test_fallback_falls_back_to_primary_when_no_endpoint_is_configured(primary_client):
    client, endpoint = _resolve_fallback_client(
        config(fallback_llm_source="fallback", fallback_use_different_endpoint=True, fallback_ai_endpoint=""),
        primary_client,
    )

    assert client is primary_client
    assert endpoint == PRIMARY_ENDPOINT


def test_a_named_fallback_provider_wins_over_the_fallback_endpoint_fields(primary_client):
    provider = MultiModelProvider(name="groq", endpoint="https://groq.example/v1", api_key="groq-key")

    client, endpoint = _resolve_fallback_client(
        config(
            fallback_llm_source="fallback",
            fallback_use_different_endpoint=True,
            fallback_provider="groq",
            fallback_ai_endpoint=FALLBACK_ENDPOINT,
            fallback_ai_key="fallback-key",
            multi_model_providers=[provider],
        ),
        primary_client,
    )

    assert endpoint == "https://groq.example/v1"
    assert client.api_key == "groq-key"


def test_a_source_naming_a_provider_routes_straight_to_it(primary_client):
    provider = MultiModelProvider(name="local", endpoint="http://localhost:1234/v1", api_key="")

    client, endpoint = _resolve_fallback_client(
        config(fallback_llm_source="local", multi_model_providers=[provider]),
        primary_client,
    )

    assert endpoint == "http://localhost:1234/v1"
    # A provider without its own key uses the primary one rather than none.
    assert client.api_key == "primary-key"


def test_an_unknown_source_never_leaves_the_bot_without_a_client(primary_client):
    client, endpoint = _resolve_fallback_client(
        config(fallback_llm_source="provider-that-was-deleted"), primary_client
    )

    assert client is primary_client
    assert endpoint == PRIMARY_ENDPOINT


def test_a_provider_without_an_endpoint_is_skipped(primary_client):
    provider = MultiModelProvider(name="broken", endpoint="", api_key="key")

    client, endpoint = _resolve_fallback_client(
        config(fallback_llm_source="broken", multi_model_providers=[provider]),
        primary_client,
    )

    assert client is primary_client
    assert endpoint == PRIMARY_ENDPOINT


class TestSystemAddon:
    def test_a_matching_model_rule_wins_over_the_global_addon(self):
        cfg = config(
            system_addon="global addon",
            system_addon_rules=[{"models": ["gpt-4o-mini"], "text": "rule addon"}],
        )

        assert resolve_system_addon(cfg, Mock(), "gpt-4o-mini") == "rule addon"

    def test_a_model_without_a_rule_gets_the_global_addon(self):
        cfg = config(
            system_addon="global addon",
            system_addon_rules=[{"models": ["some-other-model"], "text": "rule addon"}],
        )

        assert resolve_system_addon(cfg, Mock(), "gpt-4o-mini") == "global addon"

    def test_a_rule_asking_for_the_default_reads_the_global_config(self):
        db = Mock()
        db.list_configs.return_value = {
            "default_character": "zahul",
            "ai_endpoint": PRIMARY_ENDPOINT,
            "base_llm": "gpt-4o-mini",
            "system_addon": "addon from the database",
        }
        cfg = config(
            system_addon="per-server addon",
            system_addon_rules=[{"models": ["gpt-4o-mini"], "use_default": True, "text": "ignored"}],
        )

        assert resolve_system_addon(cfg, db, "gpt-4o-mini") == "addon from the database"

    def test_a_rule_with_no_text_prepends_nothing(self):
        cfg = config(system_addon="global addon", system_addon_rules=[{"models": ["gpt-4o-mini"]}])

        assert resolve_system_addon(cfg, Mock(), "gpt-4o-mini") == ""

    def test_no_rules_and_no_addon_is_an_empty_string_not_none(self):
        assert resolve_system_addon(config(), Mock(), "gpt-4o-mini") == ""
