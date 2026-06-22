# backend/config.py
"""Project configuration bridge.

Most editable experiment/runtime settings live in the root-level `config.json`
(next to `backend/` and `frontend/`). This file keeps the old Python constants
so existing backend modules can continue to `import config` without changes.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

ROOT_DIR = Path(__file__).resolve().parents[1]
CONFIG_JSON_PATH = ROOT_DIR / "config.json"

_DEFAULTS: dict[str, Any] = {
    "dev_password": "1234",

    "experiment_assignment_mode": "between_subject",
    "qualtrics_allow_url_condition_override": True,
    "qualtrics_require_condition_in_url": False,
    "between_subject_text_max_per_condition": 20,
    "between_subject_voice_max_per_condition": 20,
    "within_subject_text_max_per_order": 10,
    "within_subject_voice_max_per_order": 10,

    "llm_run_mode": "pilot",
    "pilot_llm_provider": "groq",
    "formal_llm_provider": "openai",
    "groq_model_name": "llama-3.1-8b-instant",
    "openai_model_name": "gpt-5-nano",
    "gemini_model_name": "gemini-2.5-flash-lite",

    "stt_provider": "groq",
    "stt_model_name": "whisper-large-v3-turbo",
    "stt_language": "zh",
    "stt_prompt_zh_tw": "請使用繁體中文逐字轉錄。不要翻譯成英文，不要使用簡體中文。",

    "scenario_a_round_limit": 6,
    "token_threshold": 6000,
    "summary_threshold": 0.8,
    "scenario_b_show_hint": True,

    "vad_threshold": 0.015,
    "vad_silence_timeout_a": 1.0,
    "vad_silence_timeout_b": 1.0,
    "vad_silence_timeout_c": 0.7,

    "system_prompt_zh": (
        "你是繁體中文 AI 助手。\n"
        "無論使用者輸入中文、英文、日文或語音轉文字結果如何，你都必須使用繁體中文回答。\n"
        "請不要使用英文回答，除非使用者明確要求翻譯或要求英文。\n"
        "回答要自然、清楚，符合台灣使用者習慣。"
    ),
    "summary_prompt_zh": (
        "請整理目前對話中需要延續到下一段對話的重要資訊。\n"
        "請一定使用繁體中文。\n"
        "不要使用英文。\n"
        "請用繁體中文條列。\n"
        "最多 8 點，每點 20 字以內。\n\n"
        "必須優先保留：\n"
        "1. 住宿位置\n"
        "2. 預算\n"
        "3. 必去景點\n"
        "4. 同行者限制\n"
        "5. 飲食限制\n"
        "6. 使用者偏好\n"
        "7. 已決定行程\n"
        "8. 後續注意事項"
    ),
}


def _load_external_config() -> dict[str, Any]:
    if not CONFIG_JSON_PATH.exists():
        return {}

    try:
        with CONFIG_JSON_PATH.open("r", encoding="utf-8-sig") as f:
            loaded = json.load(f)
        if not isinstance(loaded, dict):
            return {}
        return loaded
    except Exception as exc:
        # Keep the backend bootable even if config.json is temporarily invalid.
        print(f"[config] Failed to read {CONFIG_JSON_PATH}: {exc}")
        return {}


_EXTERNAL_CONFIG = _load_external_config()


def _get(key: str, default: Any = None) -> Any:
    if key in _EXTERNAL_CONFIG:
        return _EXTERNAL_CONFIG[key]
    upper_key = key.upper()
    if upper_key in _EXTERNAL_CONFIG:
        return _EXTERNAL_CONFIG[upper_key]
    return _DEFAULTS.get(key, default)


def _as_bool(value: Any, default: bool = False) -> bool:
    if isinstance(value, bool):
        return value
    if value is None:
        return default
    return str(value).strip().lower() in {"1", "true", "yes", "y", "on"}


def _as_int(value: Any, default: int = 0) -> int:
    try:
        return int(float(value))
    except Exception:
        return default


def _as_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except Exception:
        return default


# -----------------------------
# General / dev settings
# -----------------------------
DEV_PASSWORD = str(_get("dev_password", "1234"))

# -----------------------------
# Prompt settings
# -----------------------------
SYSTEM_PROMPT_ZH = str(_get("system_prompt_zh", _DEFAULTS["system_prompt_zh"]))
SUMMARY_PROMPT_ZH = str(_get("summary_prompt_zh", _DEFAULTS["summary_prompt_zh"]))

# -----------------------------
# Experiment assignment settings
# -----------------------------
EXPERIMENT_ASSIGNMENT_MODE = str(_get("experiment_assignment_mode", "between_subject"))
QUALTRICS_ALLOW_URL_CONDITION_OVERRIDE = _as_bool(_get("qualtrics_allow_url_condition_override", True), True)
QUALTRICS_REQUIRE_CONDITION_IN_URL = _as_bool(_get("qualtrics_require_condition_in_url", False), False)

BETWEEN_SUBJECT_TEXT_MAX_PER_CONDITION = _as_int(_get("between_subject_text_max_per_condition", 20), 20)
BETWEEN_SUBJECT_VOICE_MAX_PER_CONDITION = _as_int(_get("between_subject_voice_max_per_condition", 20), 20)

WITHIN_SUBJECT_TEXT_MAX_PER_ORDER = _as_int(_get("within_subject_text_max_per_order", 10), 10)
WITHIN_SUBJECT_VOICE_MAX_PER_ORDER = _as_int(_get("within_subject_voice_max_per_order", 10), 10)

# -----------------------------
# Runtime provider settings
# -----------------------------
LLM_RUN_MODE = str(_get("llm_run_mode", "pilot")).lower()
PILOT_LLM_PROVIDER = str(_get("pilot_llm_provider", "groq")).lower()
FORMAL_LLM_PROVIDER = str(_get("formal_llm_provider", "openai")).lower()

GROQ_MODEL_NAME = str(_get("groq_model_name", "llama-3.1-8b-instant"))
OPENAI_MODEL_NAME = str(_get("openai_model_name", "gpt-5-nano"))
GEMINI_MODEL_NAME = str(_get("gemini_model_name", "gemini-2.5-flash-lite"))

# Backward-compatible alias used by old scenario code.
MODEL_NAME = GROQ_MODEL_NAME

# -----------------------------
# Speech-to-text settings
# -----------------------------
STT_PROVIDER = str(_get("stt_provider", "groq")).lower()
STT_MODEL_NAME = str(_get("stt_model_name", "whisper-large-v3-turbo"))
STT_LANGUAGE = str(_get("stt_language", "zh"))
STT_PROMPT_ZH_TW = str(_get("stt_prompt_zh_tw", _DEFAULTS["stt_prompt_zh_tw"]))

# -----------------------------
# Experiment thresholds
# -----------------------------
SCENARIO_A_ROUND_LIMIT = _as_int(_get("scenario_a_round_limit", 6), 6)
SCENARIO_A_MSG_LIMIT = SCENARIO_A_ROUND_LIMIT * 2

TOKEN_THRESHOLD = _as_int(_get("token_threshold", 6000), 6000)
SUMMARY_THRESHOLD = _as_float(_get("summary_threshold", 0.8), 0.8)
SCENARIO_B_SHOW_HINT = _as_bool(_get("scenario_b_show_hint", True), True)

VAD_THRESHOLD = _as_float(_get("vad_threshold", 0.015), 0.015)
VAD_SILENCE_TIMEOUT_A = _as_float(_get("vad_silence_timeout_a", 1.0), 1.0)
VAD_SILENCE_TIMEOUT_B = _as_float(_get("vad_silence_timeout_b", 1.0), 1.0)
VAD_SILENCE_TIMEOUT_C = _as_float(_get("vad_silence_timeout_c", 0.7), 0.7)
