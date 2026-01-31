"""Tests for Smithers configuration handling."""

from __future__ import annotations

import importlib
from pathlib import Path

import pytest

import smithers.config as config


ENV_KEYS = [
    "SMITHERS_MODEL",
    "SMITHERS_MAX_CONCURRENCY",
    "SMITHERS_CACHE_DIR",
    "SMITHERS_LOG_LEVEL",
]


def _reload_config(monkeypatch: pytest.MonkeyPatch, env: dict[str, str] | None = None):
    for key in ENV_KEYS:
        monkeypatch.delenv(key, raising=False)
    if env:
        for key, value in env.items():
            monkeypatch.setenv(key, value)
    return importlib.reload(config)


class TestConfigDefaults:
    def test_defaults_without_env(self, monkeypatch: pytest.MonkeyPatch) -> None:
        cfg = _reload_config(monkeypatch).get_config()
        assert cfg.model == "claude-sonnet-4-20250514"
        assert cfg.max_concurrency is None
        assert cfg.cache_dir is None
        assert cfg.log_level is None


class TestConfigEnvOverrides:
    def test_env_overrides(self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
        cfg = _reload_config(
            monkeypatch,
            {
                "SMITHERS_MODEL": "claude-3-opus-20240229",
                "SMITHERS_MAX_CONCURRENCY": "8",
                "SMITHERS_CACHE_DIR": str(tmp_path / "cache"),
                "SMITHERS_LOG_LEVEL": "debug",
            },
        ).get_config()

        assert cfg.model == "claude-3-opus-20240229"
        assert cfg.max_concurrency == 8
        assert cfg.cache_dir == tmp_path / "cache"
        assert cfg.log_level == "debug"

    def test_invalid_max_concurrency_raises(self, monkeypatch: pytest.MonkeyPatch) -> None:
        with pytest.raises(ValueError):
            _reload_config(
                monkeypatch,
                {"SMITHERS_MAX_CONCURRENCY": "not-a-number"},
            )

        # Restore to a valid state for any subsequent imports
        _reload_config(monkeypatch)


class TestConfigure:
    def test_configure_updates_values(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        cfg_module = _reload_config(monkeypatch)

        cfg_module.configure(
            model="claude-3-sonnet-20240229",
            max_concurrency=4,
            cache_dir=tmp_path / "cache",
            log_level="info",
        )

        cfg = cfg_module.get_config()
        assert cfg.model == "claude-3-sonnet-20240229"
        assert cfg.max_concurrency == 4
        assert cfg.cache_dir == tmp_path / "cache"
        assert cfg.log_level == "info"

    def test_configure_partial_updates(self, monkeypatch: pytest.MonkeyPatch) -> None:
        cfg_module = _reload_config(
            monkeypatch,
            {
                "SMITHERS_MODEL": "claude-3-opus-20240229",
                "SMITHERS_MAX_CONCURRENCY": "2",
            },
        )

        cfg_module.configure(model="claude-3-haiku-20240307")

        cfg = cfg_module.get_config()
        assert cfg.model == "claude-3-haiku-20240307"
        assert cfg.max_concurrency == 2
